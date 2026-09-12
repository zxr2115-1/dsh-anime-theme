/**
 * dsh-anime-theme — 客户端半体 (client half)
 *
 * 由 DSH 客户端模块系统从 package.json 的 exports["./client"] 加载，
 * 通过 window.__ModuleLoader__.load 自注册。只依赖静态表里的 react。
 *
 * ── 关键设计（v1.1.0 重写）──────────────────────────────────────────────
 * 本机运行的构建里，全局背景壁纸由内置主题插件 deepseek-ai-cordis（dsh-skin）
 * 渲染：它在 document.body 挂 <div class="dt-bg" data-dsh-theme-bg="true">，
 * CSS 为 position:fixed; inset:0; z-index:-1，图片放在 .dt-bg-media > img。
 *
 * 所以本插件【不再自建壁纸层】，而是接管那一层：
 *   1. 给 [data-dsh-theme-bg] 覆写 background-image（暗幕渐变 + 中继后的随机图）
 *   2. 把它原有的 .dt-bg-media / .dt-bg-mask 子节点 display:none 让位
 *   3. 不覆写 --dsw-alias-bg-* token —— 面板透明度归 dsh-skin 的
 *      themeAlpha / dialogAlpha 管（它走 ctx.theme.overrideTokens），
 *      我再用 !important 去压会直接踩坏它的透明度滑杆
 *
 * 只有该层不存在时（纯净 Web 构建 / 未装 dsh-skin）才退回自建壁纸层，
 * 并自行接管 panel token。
 */
(() => {
  try {
    window.__ModuleLoader__.load({
      id: "dsh-anime-theme",
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

        var react = require("react");

        // ------------------------------------------------------------------
        // 常量
        // ------------------------------------------------------------------
        var ROUTE = "/dsh-anime-theme";
        var API = ROUTE + "/api";
        var DIRECT_API = "https://api.cnmiw.com/api.php";
        var STYLE_ID = "dsh-anime-theme-style";
        var FALLBACK_BG_ID = "dsh-anime-theme-bg";
        var HOST_BG_SELECTOR = '[data-dsh-theme-bg="true"]';
        var MAX_RETRY = 3;

        var DEFAULTS = {
          enabled: true,
          allowNsfw: false,
          sortSfw: "CDNcat",
          sortNsfw: "CDNsetu",
          autoRefreshMinutes: 0,
          recentLimit: 50,
          recent: [],
          dim: 0.3,
          fillBlur: 40,
          fit: "smart",
          veil: "auto",
          darkBoost: true,
          coverFocus: 25,
          isolatePanels: false,
          // 停靠位：相对「右下角」的偏移，右下角状态栏有读数，默认抬高让开
          dockX: 18,
          dockY: 76
        };

        /**
         * 分类白名单 —— 按 MirlKoi 上游自己的归类切成两套，每个值都实测过能返回图片。
         *
         * 上游的分类页把 iw233 / top / pc / mp 归在「无色图」、daimao+cat+yin+xing 归在
         * 「呆猫八条」、setu / Capoo / yuexinmiao / Denia 归在「色图」。
         * random 是区块级「全站随机」，会混进色图，所以只放进色图池 ——
         * 这正是无色图模式下偶尔蹦出色图的隐患来源。
         */
        var SORT_PRESETS_SFW = [
          { value: "CDNcat", label: "CDNcat · 猫娘（默认·免 Referer）" },
          { value: "cat", label: "cat · 猫娘（直连·快）" },
          { value: "CDNtop", label: "CDNtop · 精选" },
          { value: "CDNpc", label: "CDNpc · 电脑横屏" },
          { value: "CDNmp", label: "CDNmp · 手机竖屏" },
          { value: "CDNiw233", label: "CDNiw233 · 无色图大池" },
          { value: "iw233", label: "iw233 · 无色图大池（直连）" },
          { value: "daimao", label: "daimao · 呆猫八条" }
        ];

        var SORT_PRESETS_NSFW = [
          { value: "CDNsetu", label: "CDNsetu · 色图（默认·免 Referer）" },
          { value: "setu", label: "setu · 色图（直连·快）" },
          { value: "Capoo", label: "Capoo · 色图系列" },
          { value: "yuexinmiao", label: "yuexinmiao · 色图系列" },
          { value: "Denia", label: "Denia · 色图系列" },
          { value: "CDNrandom", label: "CDNrandom · 全站随机（含色图）" },
          { value: "random", label: "random · 全站随机（含色图）" }
        ];

        // ------------------------------------------------------------------
        // 迷你 store
        // ------------------------------------------------------------------
        var store = {
          config: Object.assign({}, DEFAULTS),
          url: null,
          status: "idle",
          error: null,
          downgraded: null,
          imageSize: null,
          hostMode: null,
          probe: "",
          panelOpen: false
        };
        var listeners = [];
        function emit() {
          var list = listeners.slice();
          for (var i = 0; i < list.length; i++) {
            try { list[i](); } catch (err) { /* 单个订阅者失败不影响其它 */ }
          }
        }
        function subscribe(fn) {
          listeners.push(fn);
          return function () {
            var index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          };
        }
        function useStore() {
          var pair = react.useState(0);
          var bump = pair[1];
          react.useEffect(function () {
            return subscribe(function () { bump(function (n) { return n + 1; }); });
          }, []);
          return store;
        }

        // ------------------------------------------------------------------
        // 宿主通信
        // ------------------------------------------------------------------
        function sleep(ms) {
          return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }

        /** 调宿主路由；非 2xx 时抛出宿主给出的真实原因。 */
        async function hostJson(path, options) {
          var response = await fetch(API + path, Object.assign({ cache: "no-store" }, options || {}));
          var text = "";
          try { text = await response.text(); } catch (err) { text = ""; }
          var payload = null;
          try { payload = JSON.parse(text); } catch (err) { payload = null; }
          if (!response.ok) {
            throw new Error(payload && payload.error ? payload.error : "HTTP " + response.status);
          }
          if (!payload) throw new Error("宿主返回了非 JSON 响应");
          return payload;
        }

        async function loadConfig() {
          try {
            var payload = await hostJson("/config");
            store.hostMode = true;
            store.probe = "";
            store.config = Object.assign({}, DEFAULTS, payload.config || {});
            return store.config;
          } catch (err) {
            store.hostMode = false;
            store.probe = "宿主半体不可达：" + String((err && err.message) || err);
            store.config = Object.assign({}, DEFAULTS);
            return store.config;
          }
        }

        async function saveConfig(patch) {
          store.config = Object.assign({}, store.config, patch);
          emit();
          // 自动换图的周期可能在这次 patch 里被改了，重新排一次定时器
          scheduleAutoRefresh();
          if (!store.hostMode) return;
          try {
            await hostJson("/config", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(patch)
            });
          } catch (err) {
            store.probe = "配置保存失败：" + String((err && err.message) || err);
            emit();
          }
        }

        function directRandomUrl(sort, num) {
          return DIRECT_API + "?sort=" + encodeURIComponent(sort) + "&type=json&num=" + num;
        }

        /**
         * 取一张随机图 URL。
         * 宿主可达时【只走宿主】——失败原样抛出真实原因，不再偷偷退回直连：
         * 直连必然被 CORS 拦成 "Failed to fetch"，会把真正有用的信息盖掉。
         */
        async function fetchRandomUrl(wantNsfw) {
          var config = store.config;
          var useNsfw = wantNsfw === true && config.allowNsfw === true;
          var sort = useNsfw ? (config.sortNsfw || DEFAULTS.sortNsfw) : (config.sortSfw || DEFAULTS.sortSfw);

          if (store.hostMode) {
            var payload = await hostJson("/random?num=10&nsfw=" + (useNsfw ? "1" : "0"));
            if (!payload || payload.ok !== true || !payload.url) {
              throw new Error((payload && payload.error) || "宿主未返回可用图片地址");
            }
            // 宿主在无色图模式下把「全站随机」降级了，如实转达
            store.downgraded = payload.downgraded || null;
            return payload.url;
          }

          var direct = await fetch(directRandomUrl(sort, 10), { cache: "no-store" });
          if (!direct.ok) throw new Error("直连上游 HTTP " + direct.status);
          var text = await direct.text();
          var start = text.indexOf("{");
          if (start < 0) throw new Error("上游返回了非 JSON 内容");
          var parsed = JSON.parse(text.slice(start));
          var pic = parsed && parsed.pic;
          var list = Array.isArray(pic) ? pic : pic ? [pic] : [];
          if (list.length === 0) throw new Error("上游没有返回图片地址");
          return list[0];
        }

        /** 同源中继，顺带补齐直连链路需要的 Referer，避免防盗链 403。 */
        function relayUrl(url) {
          if (!store.hostMode) return url;
          return ROUTE + "/api/img?u=" + encodeURIComponent(url);
        }

        // ------------------------------------------------------------------
        // DOM
        // ------------------------------------------------------------------
        function ensureStyleElement() {
          var element = document.getElementById(STYLE_ID);
          if (!element) {
            element = document.createElement("style");
            element.id = STYLE_ID;
            document.head.appendChild(element);
          }
          return element;
        }

        /**
         * 读 dsh-skin 自己的设置（同源 localStorage，key 是它自己写的）。
         * 用来判断「对话栏是不是全透」—— 全透时正文会直接压在壁纸上，
         * 浅色字配亮壁纸就几乎看不见。这是它的 dialogAlpha 默认 0 造成的，
         * 不是本插件的层出了错，所以只提示、不改别人的状态。
         */
        function readSkinSettings() {
          try {
            if (!window.localStorage) return null;
            var raw = window.localStorage.getItem("dsh-theme:settings");
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" ? parsed : null;
          } catch (err) {
            return null;
          }
        }

        /** 对话栏透明度（缺省按 dsh-skin 的默认 0 处理）。 */
        function dialogAlphaOf() {
          var skin = readSkinSettings();
          if (!skin) return 0;
          return typeof skin.dialogAlpha === "number" ? skin.dialogAlpha : 0;
        }

        /** dsh-skin 的壁纸层在不在？（只用于状态提示） */
        function hostLayer() {
          try { return document.querySelector(HOST_BG_SELECTOR); } catch (err) { return null; }
        }

        /**
         * 自建壁纸层，挂在 document.documentElement 的最前面（即 <body> 之前）。
         *
         * 为什么不复用 dsh-skin 的 .dt-bg：
         * 它渲染在应用 React 树内部，只要任一祖先带 transform / filter /
         * will-change / contain / zoom，position:fixed 就会退化成 absolute，
         * inset:0 于是按那个祖先的盒子算 —— 盒子比视口大时 cover 会再放大一轮、
         * contain 也会溢出被裁，表现就是「图铺得比屏幕大、显示不全」。
         * 挂到 <html> 之下，上面只剩 html 自己，没有祖先能抢走它的包含块。
         */
        function ensureLayer() {
          var element = document.getElementById(FALLBACK_BG_ID);
          if (!element) {
            var root = document.documentElement;
            if (!root) return null;
            element = document.createElement("div");
            element.id = FALLBACK_BG_ID;
            element.setAttribute("aria-hidden", "true");
            root.insertBefore(element, root.firstChild);
          }
          return element;
        }

        /**
         * 把视口尺寸写进 CSS 变量，层的宽高直接取它，
         * 不再依赖「包含块 + inset:0」推算出来的盒子。
         */
        function syncViewport() {
          try {
            var root = document.documentElement;
            root.style.setProperty("--dsh-anime-theme-w", window.innerWidth + "px");
            root.style.setProperty("--dsh-anime-theme-h", window.innerHeight + "px");
          } catch (err) { /* 拿不到就算了，CSS 里还有 100vw/100vh 兜底 */ }
        }

        /**
         * 明暗标记打在 <html> 上。
         * 壁纸层现在是 body 的兄弟节点，用不了 body[data-ds-dark-theme] 后代选择器，
         * 所以由 JS 同步一个镜像属性给 CSS 用。
         */
        function syncDarkAttribute() {
          try {
            var body = document.body;
            if (!body) return;
            var dark = body.hasAttribute("data-ds-dark-theme");
            document.documentElement.setAttribute("data-dsh-anime-dark", dark ? "1" : "0");
          } catch (err) { /* 忽略 */ }
        }

        function surfaceStrength() {
          var glass = store.config.isolatePanels === true;
          return {
            base: glass ? 0.30 : 0.92,
            layer1: glass ? 0.42 : 0.96,
            layer2: glass ? 0.50 : 0.97,
            layer3: glass ? 0.58 : 0.98,
            overlay: glass ? 0.72 : 0.99
          };
        }

        function buildCss() {
          var config = store.config;
          var active = config.enabled === true && !!store.url;

          // 未激活时返回空样式表 —— 一条规则都不写，
          // 让 dsh-skin 原本的背景/皮肤完整回归，不做任何残留污染。
          if (!active) return "";

          var lines = [];
          var dim = Math.max(0, Math.min(0.85, Number(config.dim) || 0));
          /**
           * fillBlur = 留白处那张「同一张图的模糊放大版」的虚化半径。
           * 下限强制 16px —— 低于这个值时铺底会退化成一张清晰的放大副本，
           * 看上去就跟「整图被拉大裁切」没区别，自适应等于没生效。
           */
          var fillBlur = Math.max(16, Math.min(80, Number(config.fillBlur) || 40));

          // fit 四档：smart(整图 + 模糊铺底) / cover(铺满) / cover-top(铺满·偏上) / plain(整图 + 纯色留白)
          var fit = config.fit;
          if (fit !== "cover" && fit !== "cover-top" && fit !== "plain") fit = "smart";
          var isCover = fit === "cover" || fit === "cover-top";
          // 铺满系可以选裁切焦点：偏上能保住动漫图的脸和上半身，
          // 而不是从腰上随机下刀。焦点位置可调（0 = 顶部，100 = 底部）
          var coverFocus = Math.round(clampNumber(config.coverFocus, 0, 100));
          var imagePosition = fit === "cover-top" ? "center " + coverFocus + "%" : "center";

          var DARK_RGB = "8,10,16";
          var LIGHT_RGB = "244,246,250";
          var DARK_BASE = "#0b0d12";
          var LIGHT_BASE = "#f4f6fa";

          var IMAGE = 'url("' + store.url + '")';

          /**
           * 留白处要的是「这张图自己的颜色晕出去」，不是糊一层白膜 ——
           * 那层白膜正是之前两边发白、特别扎眼的原因。
           * 所以铺底的幕色刻意比正片轻，再靠 saturate 把颜色留住。
           * 深色主题下反过来要压得更狠，否则留白会亮得抢戏。
           */
          /**
           * 深色模式自动加深：深色 UI 配亮壁纸，浅色文字压不住。
           * 与其让用户为一件事来回拨两次「暗幕强度」，不如按主题分档 ——
           * 浅色主题保留原值，深色主题额外压一档。
           */
          var lightDim = dim;
          var darkDim = config.darkBoost === false ? dim : Math.min(0.85, dim + 0.2);

          var lightFillDim = Math.min(0.35, dim * 0.45);
          var darkFillDim = Math.min(0.85, darkDim + 0.2);

          /**
           * 正片按 contain 摆好后，图的两条边和模糊铺底之间会有一道硬缝。
           * 用一条渐隐蒙版把 ::after 的边羽化掉，缝就没了。
           * 位置必须按图的实际渲染矩形算，所以用 px 而不是百分比。
           */
          function edgeMask() {
            if (isCover) return null;            // 铺满时图占满全屏，本来就没有缝
            // measureImage 返回的是 { naturalW, naturalH }，别写成 w/h
            var size = store.imageSize;
            if (!size || !size.naturalW || !size.naturalH) return null;
            var vw = window.innerWidth, vh = window.innerHeight;
            var ia = size.naturalW / size.naturalH, ba = vw / vh;
            var rw, rh;
            if (ia > ba) { rw = vw; rh = vw / ia; } else { rh = vh; rw = vh * ia; }
            var feather, mask;
            if (ia <= ba) {
              // 左右留白 → 横向羽化
              var left = (vw - rw) / 2, right = left + rw;
              feather = Math.max(24, Math.min(160, rw * 0.22));
              mask = "linear-gradient(to right," +
                "transparent " + Math.round(left - feather) + "px," +
                "#000 " + Math.round(left + feather) + "px," +
                "#000 " + Math.round(right - feather) + "px," +
                "transparent " + Math.round(right + feather) + "px)";
            } else {
              // 上下留白 → 纵向羽化
              var top = (vh - rh) / 2, bottom = top + rh;
              feather = Math.max(24, Math.min(160, rh * 0.22));
              mask = "linear-gradient(to bottom," +
                "transparent " + Math.round(top - feather) + "px," +
                "#000 " + Math.round(top + feather) + "px," +
                "#000 " + Math.round(bottom - feather) + "px," +
                "transparent " + Math.round(bottom + feather) + "px)";
            }
            return mask;
          }

          /**
           * 三层绘制：
           *   ① 元素自身 background-color        → 最底层兜底色
           *   ② ::before  同图 cover + 大半径虚化 → 留白处的颜色晕染
           *   ③ ::after   幕色 + 正片            → cover 铺满 / contain 保整图
           * ::before / ::after 绝对定位按 DOM 顺序层叠，
           * 且被本层的 overflow:hidden 裁掉，不会溢出到应用界面之上。
           */
          function rule(selector, rgb, base, fillDimValue, dimValue) {
            var mask = edgeMask();
            lines.push(selector + "{");
            lines.push("background-image:none !important;");
            lines.push("background-color:" + base + " !important;");
            lines.push("filter:none !important;");
            lines.push("transform:none !important;");
            lines.push("}");

            lines.push(selector + "::before{");
            lines.push('content:"" !important;');
            lines.push("position:absolute !important;inset:0 !important;");
            lines.push("display:" + (fit === "plain" ? "none" : "block") + " !important;");
            lines.push("background-image:linear-gradient(rgba(" + rgb + "," + fillDimValue + "),rgba(" + rgb + "," + fillDimValue + "))," + IMAGE + " !important;");
            lines.push("background-size:cover,cover !important;");
            lines.push("background-position:center," + imagePosition + " !important;");
            lines.push("background-repeat:no-repeat,no-repeat !important;");
            // 放大一点点，避免虚化的透明边缘露出来
            lines.push("transform:scale(1.15) !important;");
            lines.push("filter:blur(" + fillBlur + "px) saturate(1.45) !important;");
            lines.push("}");

            lines.push(selector + "::after{");
            lines.push('content:"" !important;');
            lines.push("position:absolute !important;inset:0 !important;");
            lines.push("background-image:linear-gradient(rgba(" + rgb + "," + dimValue + "),rgba(" + rgb + "," + dimValue + "))," + IMAGE + " !important;");
            // 第一层幕色永远铺满；第二层图 smart/plain 用 contain 保整图，cover 系直接铺满
            lines.push("background-size:cover," + (isCover ? "cover" : "contain") + " !important;");
            lines.push("background-position:center," + imagePosition + " !important;");
            lines.push("background-repeat:no-repeat,no-repeat !important;");
            if (mask) {
              lines.push("-webkit-mask-image:" + mask + " !important;");
              lines.push("mask-image:" + mask + " !important;");
            }
            lines.push("}");
          }

          // veil: auto = 跟随软件明暗主题；dark / light = 强制
          var veilMode = config.veil === "dark" || config.veil === "light" ? config.veil : "auto";
          var forceDark = veilMode === "dark";
          var baseRgb = forceDark ? DARK_RGB : LIGHT_RGB;
          var baseColor = forceDark ? DARK_BASE : LIGHT_BASE;
          var baseFillDim = forceDark ? darkFillDim : lightFillDim;
          var baseDim = forceDark ? darkDim : lightDim;

          // ── 壁纸层：藏掉 dsh-skin 那层，改用挂在 <html> 下的自建层 ──
          lines.push(HOST_BG_SELECTOR + "{display:none !important;}");
          lines.push("html,body{background:transparent !important;}");

          var selfSelector = "#" + FALLBACK_BG_ID;
          // 尺寸显式取 window.innerWidth/Height，不靠包含块推算
          lines.push(selfSelector + "{");
          lines.push("position:fixed !important;top:0 !important;left:0 !important;");
          lines.push("right:auto !important;bottom:auto !important;");
          lines.push("width:var(--dsh-anime-theme-w, 100vw) !important;");
          lines.push("height:var(--dsh-anime-theme-h, 100vh) !important;");
          lines.push("margin:0 !important;padding:0 !important;");
          lines.push("z-index:-1 !important;pointer-events:none !important;overflow:hidden !important;");
          lines.push("}");

          // 基规则按浅色写；深色走 html 上的镜像属性（层是 body 的兄弟节点，
          // 用不了 body[data-ds-dark-theme] 后代选择器）
          rule(selfSelector, baseRgb, baseColor, baseFillDim, baseDim);
          if (veilMode !== "light") {
            rule('html[data-dsh-anime-dark="1"] ' + selfSelector, DARK_RGB, DARK_BASE, darkFillDim, darkDim);
          }

          // ── 3. panel token 不碰 ────────────────────────────────────
          //      面板透明度归 dsh-skin 的 themeAlpha / dialogAlpha（走
          //      ctx.theme.overrideTokens），再用 !important 去压会踩坏它的滑杆。
          //      isolatePanels 仅在完全没装 dsh-skin 时才生效。
          if (!hostLayer() && store.config.isolatePanels === true) {
            var strength = surfaceStrength();
            var selectors = ["body", "body[data-ds-dark-theme]"];
            for (var i = 0; i < selectors.length; i++) {
              var tint = selectors[i].indexOf("dark") >= 0 ? "12,14,20" : "255,255,255";
              lines.push(selectors[i] + "{");
              lines.push("--dsw-alias-bg-base:rgba(" + tint + "," + strength.base + ") !important;");
              lines.push("--dsw-alias-bg-layer-1:rgba(" + tint + "," + strength.layer1 + ") !important;");
              lines.push("--dsw-alias-bg-layer-2:rgba(" + tint + "," + strength.layer2 + ") !important;");
              lines.push("--dsw-alias-bg-layer-3:rgba(" + tint + "," + strength.layer3 + ") !important;");
              lines.push("--dsw-alias-bg-module-platform:rgba(" + tint + "," + strength.layer1 + ") !important;");
              lines.push("--dsw-alias-bg-overlay:rgba(" + tint + "," + strength.overlay + ") !important;");
              lines.push("}");
            }
          }

          return lines.join("");
        }

        function applyCss() {
          syncViewport();
          syncDarkAttribute();

          var style = ensureStyleElement();
          var next = buildCss();
          if (style.textContent !== next) style.textContent = next;

          var active = store.config.enabled === true && !!store.url;
          var layer = active ? ensureLayer() : document.getElementById(FALLBACK_BG_ID);
          if (layer) layer.style.display = active ? "block" : "none";
        }

        function teardown() {
          var style = document.getElementById(STYLE_ID);
          if (style && style.parentNode) style.parentNode.removeChild(style);
          var layer = document.getElementById(FALLBACK_BG_ID);
          if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
          try { document.documentElement.removeAttribute("data-dsh-anime-dark"); } catch (err) { /* 忽略 */ }
        }

        // ------------------------------------------------------------------
        // 动作
        // ------------------------------------------------------------------
        var refreshing = false;

        async function refresh(forceNsfw) {
          if (refreshing) return;
          refreshing = true;
          store.status = "loading";
          store.error = null;
          store.probe = "";
          emit();

          var lastError = null;
          for (var attempt = 1; attempt <= MAX_RETRY; attempt++) {
            try {
              var url = await fetchRandomUrl(forceNsfw);
              var relay = relayUrl(url);

              /**
               * 先预加载再上屏。
               * 一箭双雕：① 拿到自然尺寸说明图确实解码出来了，不会先闪一下空背景；
               * ② 上游给了地址却取不到图（403 防盗链 / 404 / 超时）时这里会返回 null，
               *    于是直接换下一张，而不是把一个加载不出来的壁纸永久停在屏幕上。
               */
              var size = await measureImage(relay);
              if (!size) throw new Error("图片加载失败：上游给了地址但取不到图");

              store.url = relay;
              store.imageSize = size;
              store.status = "ready";
              store.error = null;
              applyCss();
              refreshing = false;
              emit();
              return;
            } catch (err) {
              lastError = err;
              // 上游偶发抽风是常态，退避重试；失败时保留上一张壁纸不清空
              if (attempt < MAX_RETRY) await sleep(400 * attempt);
            }
          }

          store.status = "error";
          store.error = String((lastError && lastError.message) || lastError);
          refreshing = false;
          emit();
        }

        async function setEnabled(next) {
          await saveConfig({ enabled: next });
          if (next && !store.url) await refresh(false);
          applyCss();
        }

        // ------------------------------------------------------------------
        // 控制坞 UI
        // ------------------------------------------------------------------
        var COLORS = {
          panel: "rgba(20,22,30,.84)",
          panelLight: "rgba(255,255,255,.90)",
          border: "rgba(255,255,255,.14)",
          borderLight: "rgba(0,0,0,.10)",
          text: "#f2f4f8",
          textLight: "#15171c",
          sub: "rgba(242,244,248,.62)",
          subLight: "rgba(21,23,28,.58)",
          brand: "#4d8dff",
          danger: "#ff6b6b",
          ok: "#33d17a",
          warn: "#e5b567"
        };

        function useDarkUi() {
          var pair = react.useState(function () {
            return document.body ? document.body.hasAttribute("data-ds-dark-theme") : true;
          });
          var set = pair[1];
          react.useEffect(function () {
            var body = document.body;
            if (!body) return undefined;
            var observer = new MutationObserver(function () {
              set(body.hasAttribute("data-ds-dark-theme"));
            });
            observer.observe(body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
            return function () { observer.disconnect(); };
          }, []);
          return pair[0];
        }

        function chipStyle(dark, active, tone) {
          var accent = tone === "danger" ? "rgba(255,107,107,.24)" : "rgba(77,141,255,.22)";
          return {
            appearance: "none",
            border: "1px solid " + (dark ? COLORS.border : COLORS.borderLight),
            background: active ? accent : "rgba(127,127,127,.10)",
            color: dark ? COLORS.text : COLORS.textLight,
            borderRadius: "8px",
            padding: "5px 10px",
            fontSize: "12px",
            lineHeight: "16px",
            cursor: "pointer",
            fontFamily: "inherit",
            whiteSpace: "nowrap"
          };
        }

        function clampNumber(value, min, max) {
          var n = Number(value);
          if (!Number.isFinite(n)) n = min;
          return Math.max(min, Math.min(max, n));
        }

        /**
         * <select> 统一样式。两条铁律不能丢：
         *   - 字色必须显式给，不能 color:"inherit"（否则深色 UI 下弹层白底白字）
         *   - colorScheme 要跟着 UI 明暗走，让 UA 用对应的弹层底色
         */
        function selectStyle(dark) {
          return {
            width: "100%",
            padding: "5px 6px",
            borderRadius: "8px",
            border: "1px solid " + (dark ? COLORS.border : COLORS.borderLight),
            background: dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.04)",
            color: dark ? COLORS.text : COLORS.textLight,
            colorScheme: dark ? "dark" : "light",
            fontFamily: "inherit",
            fontSize: "12px"
          };
        }

        function ThemeDock() {
          var snap = useStore();
          var dark = useDarkUi();
          var config = snap.config;
          var open = snap.panelOpen;
          var takeover = !!hostLayer();

          var dockRef = react.useRef(null);
          var dragRef = react.useRef(null);
          var hoverPair = react.useState(false);
          var hovering = hoverPair[0];
          var setHovering = hoverPair[1];

          // 停靠位钳在视口内，窗口缩小后也不会跑到屏幕外
          var dockX = clampNumber(config.dockX, 8, Math.max(8, window.innerWidth - 120));
          var dockY = clampNumber(config.dockY, 8, Math.max(8, window.innerHeight - 72));

        /**
         * 拖动三件套。有两个必须守住的点，否则按钮会点不动：
         *
         *  1. 从按钮/下拉框上按下的，不进入拖动 —— 那些控件要自己吃事件；
         *  2. 按下时【不能】立刻 setPointerCapture —— 一旦捕获，pointerup 会被
         *     重定向到容器，浏览器算 click 时取「按下」与「松开」目标的共同祖先，
         *     于是 click 落到容器上，按钮的 onClick 永远收不到。
         *     所以只在位移真的超过阈值、确认是拖动之后才捕获。
         */
        function isControlTarget(target) {
          var tag = target && target.tagName ? String(target.tagName).toLowerCase() : "";
          return tag === "button" || tag === "select" || tag === "option" || tag === "input" || tag === "textarea";
        }

        function onDragStart(event) {
          if (event.button !== undefined && event.button !== 0) return;
          var el = dockRef.current;
          if (!el) return;
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            right: dockX,
            bottom: dockY,
            moved: false,
            captured: false,
            allowed: !isControlTarget(event.target),
            pointerId: event.pointerId
          };
        }

        function onDragMove(event) {
          var drag = dragRef.current;
          var el = dockRef.current;
          if (!drag || !el || !drag.allowed) return;

          var dx = event.clientX - drag.startX;
          var dy = event.clientY - drag.startY;
          if (!drag.moved) {
            if (Math.abs(dx) + Math.abs(dy) < 5) return; // 抖动阈值，别把点击吃掉
            drag.moved = true;
            // 确认是拖动之后才捕获，这样拖出元素外也还跟手
            try { el.setPointerCapture(drag.pointerId); drag.captured = true; } catch (err) { /* 忽略 */ }
          }

          drag.right = clampNumber(drag.right - dx, 8, Math.max(8, window.innerWidth - 120));
          drag.bottom = clampNumber(drag.bottom - dy, 8, Math.max(8, window.innerHeight - 72));
          drag.startX = event.clientX;
          drag.startY = event.clientY;
          el.style.right = drag.right + "px";
          el.style.bottom = drag.bottom + "px";
        }

        function onDragEnd() {
          var drag = dragRef.current;
          dragRef.current = null;
          if (!drag) return;
          var el = dockRef.current;
          if (drag.captured && el) {
            try { el.releasePointerCapture(drag.pointerId); } catch (err) { /* 忽略 */ }
          }
          if (!drag.moved) return; // 纯点击：什么都不做，交给按钮
          saveConfig({ dockX: Math.round(drag.right), dockY: Math.round(drag.bottom) });
        }

          var panelStyle = {
            position: "fixed",
            right: dockX + "px",
            bottom: dockY + "px",
            zIndex: 2147483000,
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            fontFamily: "inherit",
            // 空闲时半透明，鼠标靠近或面板展开时恢复实底 —— 不挡视线
            opacity: (open || hovering) ? 1 : 0.45,
            transition: "opacity .25s ease"
          };

          var dragHandlers = {
            ref: dockRef,
            onPointerDown: onDragStart,
            onPointerMove: onDragMove,
            onPointerUp: onDragEnd,
            onPointerCancel: onDragEnd,
            onMouseEnter: function () { setHovering(true); },
            onMouseLeave: function () { setHovering(false); }
          };
          var rowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" };
          var labelStyle = { color: dark ? COLORS.sub : COLORS.subLight, fontSize: "11px", wordBreak: "break-all" };
          var cardStyle = {
            width: "292px",
            maxHeight: "70vh",
            overflowY: "auto",
            borderRadius: "14px",
            border: "1px solid " + (dark ? COLORS.border : COLORS.borderLight),
            background: dark ? COLORS.panel : COLORS.panelLight,
            backdropFilter: "blur(18px) saturate(1.3)",
            WebkitBackdropFilter: "blur(18px) saturate(1.3)",
            boxShadow: "0 18px 44px rgba(0,0,0,.34)",
            padding: "12px",
            color: dark ? COLORS.text : COLORS.textLight,
            fontSize: "12px",
            lineHeight: "18px",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
          };

          var statusText = snap.status === "loading"
            ? "取图中…"
            : snap.status === "error"
              ? "取图失败"
              : snap.url
                ? "已就绪"
                : "未启用";
          var statusColor = snap.status === "error"
            ? COLORS.danger
            : snap.status === "ready"
              ? COLORS.ok
              : COLORS.warn;

          function slider(label, key, min, max, step, format) {
            return react.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "2px" } },
              react.createElement(
                "div",
                { style: rowStyle },
                react.createElement("span", { style: labelStyle }, label),
                react.createElement("span", { style: labelStyle }, format(config[key]))
              ),
              react.createElement("input", {
                type: "range",
                min: min,
                max: max,
                step: step,
                value: config[key],
                style: { width: "100%", accentColor: COLORS.brand },
                onChange: function (event) {
                  var value = Number(event.target.value);
                  store.config = Object.assign({}, store.config, { [key]: value });
                  applyCss();
                  emit();
                },
                onMouseUp: function () { saveConfig({ [key]: config[key] }); },
                onTouchEnd: function () { saveConfig({ [key]: config[key] }); }
              })
            );
          }

          var children = [];

          children.push(
            react.createElement(
              "div",
              {
                key: "pill",
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  borderRadius: "999px",
                  border: "1px solid " + (dark ? COLORS.border : COLORS.borderLight),
                  background: dark ? COLORS.panel : COLORS.panelLight,
                  backdropFilter: "blur(18px) saturate(1.3)",
                  WebkitBackdropFilter: "blur(18px) saturate(1.3)",
                  boxShadow: "0 10px 28px rgba(0,0,0,.30)",
                  color: dark ? COLORS.text : COLORS.textLight,
                  fontSize: "12px",
                  lineHeight: "16px",
                  userSelect: "none",
                  cursor: "grab",
                  touchAction: "none"
                },
                title: "按住可拖动；空闲时会自动半透明"
              },
              react.createElement("span", {
                style: { width: "7px", height: "7px", borderRadius: "50%", background: statusColor, flex: "none" }
              }),
              react.createElement("span", { style: { fontWeight: 500 } }, "二次元壁纸"),
              react.createElement(
                "button",
                { style: chipStyle(dark, false), title: "换一张随机壁纸", onClick: function () { refresh(false); } },
                "换一张"
              ),
              react.createElement(
                "button",
                {
                  style: chipStyle(dark, config.enabled),
                  title: config.enabled ? "关闭壁纸（恢复原背景）" : "开启壁纸",
                  onClick: function () { setEnabled(!config.enabled); }
                },
                config.enabled ? "开" : "关"
              ),
              react.createElement(
                "button",
                {
                  style: chipStyle(dark, open),
                  title: "展开设置",
                  onClick: function () { store.panelOpen = !store.panelOpen; emit(); }
                },
                open ? "收起" : "设置"
              )
            )
          );

          if (open) {
            var body = [];

            body.push(
              react.createElement(
                "div",
                { key: "head", style: rowStyle },
                react.createElement("strong", { style: { fontSize: "13px" } }, "二次元壁纸主题"),
                react.createElement("span", { style: { color: dark ? COLORS.sub : COLORS.subLight, fontSize: "11px" } }, statusText)
              )
            );

            body.push(
              react.createElement(
                "div",
                { key: "mode", style: rowStyle },
                react.createElement("span", { style: labelStyle }, "图片来源"),
                react.createElement(
                  "div",
                  { style: { display: "flex", gap: "6px" } },
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.allowNsfw !== true),
                      onClick: function () { saveConfig({ allowNsfw: false }).then(function () { refresh(false); }); }
                    },
                    "无色图"
                  ),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.allowNsfw === true, "danger"),
                      onClick: function () { saveConfig({ allowNsfw: true }).then(function () { refresh(false); }); }
                    },
                    "色图"
                  )
                )
              )
            );

            // 下拉框必须跟着模式走：
            //   无色图模式 → 只列无色图池，写 sortSfw
            //   色图模式   → 只列色图池，写 sortNsfw
            // 之前写死读 sortSfw / 写 sortSfw，导致色图模式下改了也不生效。
            var nsfwMode = config.allowNsfw === true;
            var sortKey = nsfwMode ? "sortNsfw" : "sortSfw";
            var presets = nsfwMode ? SORT_PRESETS_NSFW : SORT_PRESETS_SFW;
            var currentSort = config[sortKey] || (nsfwMode ? DEFAULTS.sortNsfw : DEFAULTS.sortSfw);
            var sortKnown = presets.some(function (preset) { return preset.value === currentSort; });
            var sortOptions = sortKnown
              ? presets
              : [{ value: currentSort, label: currentSort + " · 当前值（不在推荐列表）" }].concat(presets);

            body.push(
              react.createElement(
                "div",
                { key: "sort", style: { display: "flex", flexDirection: "column", gap: "4px" } },
                react.createElement("span", { style: labelStyle }, nsfwMode ? "分类 sort · 色图池" : "分类 sort · 无色图池"),
                react.createElement(
                  "select",
                  {
                    value: currentSort,
                    style: selectStyle(dark),
                    onChange: function (event) {
                      var patch = {};
                      patch[sortKey] = event.target.value;
                      saveConfig(patch).then(function () { refresh(false); });
                    }
                  },
                  sortOptions.map(function (preset) {
                    return react.createElement("option", {
                      key: preset.value,
                      value: preset.value,
                      // 双保险：弹层底色与字色都显式给死，不依赖 color-scheme
                      style: {
                        background: dark ? "#191c24" : "#ffffff",
                        color: dark ? "#f2f4f8" : "#15171c"
                      }
                    }, preset.label);
                  })
                )
              )
            );

            if (config.fit === "cover-top") {
              body.push(slider("裁切焦点", "coverFocus", 0, 100, 1, function (v) {
                return Math.round(v) + "%" + (v < 34 ? " · 偏上" : v > 66 ? " · 偏下" : " · 居中");
              }));
            }

            body.push(slider("暗幕强度", "dim", 0, 0.85, 0.01, function (v) { return Math.round(v * 100) + "%"; }));
            body.push(slider("留白虚化", "fillBlur", 16, 80, 1, function (v) { return Math.round(v) + "px"; }));

            body.push(
              react.createElement(
                "div",
                { key: "fit", style: rowStyle },
                react.createElement("span", { style: labelStyle }, "铺满方式"),
                react.createElement(
                  "div",
                  { style: { display: "flex", gap: "6px" } },
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.fit !== "cover" && config.fit !== "cover-top" && config.fit !== "plain"),
                      title: "整图可见，留白处用同一张图的模糊放大版晕染",
                      onClick: function () { saveConfig({ fit: "smart" }).then(applyCss); }
                    },
                    "自适应"
                  ),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.fit === "cover"),
                      title: "铺满整屏，超出部分居中裁切",
                      onClick: function () { saveConfig({ fit: "cover" }).then(applyCss); }
                    },
                    "铺满"
                  ),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.fit === "cover-top"),
                      title: "铺满整屏，裁切焦点偏上（保住人脸和上半身）",
                      onClick: function () { saveConfig({ fit: "cover-top" }).then(applyCss); }
                    },
                    "铺满·偏上"
                  ),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.fit === "plain"),
                      title: "整图可见，留白处是纯色块（不铺模糊底）",
                      onClick: function () { saveConfig({ fit: "plain" }).then(applyCss); }
                    },
                    "纯整图"
                  )
                )
              )
            );

            body.push(
              react.createElement(
                "div",
                { key: "veil", style: rowStyle },
                react.createElement("span", { style: labelStyle }, "暗幕色调"),
                react.createElement(
                  "div",
                  { style: { display: "flex", gap: "6px" } },
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.veil !== "dark" && config.veil !== "light"),
                      title: "跟随软件明暗主题自动切换",
                      onClick: function () { saveConfig({ veil: "auto" }).then(applyCss); }
                    },
                    "自动"
                  ),
                  react.createElement(
                    "button",
                    { style: chipStyle(dark, config.veil === "dark"), onClick: function () { saveConfig({ veil: "dark" }).then(applyCss); } },
                    "暗"
                  ),
                  react.createElement(
                    "button",
                    { style: chipStyle(dark, config.veil === "light"), onClick: function () { saveConfig({ veil: "light" }).then(applyCss); } },
                    "亮"
                  )
                )
              )
            );

            body.push(
              react.createElement(
                "div",
                { key: "autoRefresh", style: { display: "flex", flexDirection: "column", gap: "4px" } },
                react.createElement("span", { style: labelStyle }, "自动换图"),
                react.createElement(
                  "select",
                  {
                    value: String(Number(config.autoRefreshMinutes) || 0),
                    style: selectStyle(dark),
                    onChange: function (event) {
                      saveConfig({ autoRefreshMinutes: Number(event.target.value) });
                    }
                  },
                  [0, 5, 15, 30, 60].map(function (minutes) {
                    return react.createElement("option", {
                      key: String(minutes),
                      value: String(minutes),
                      style: {
                        background: dark ? "#191c24" : "#ffffff",
                        color: dark ? "#f2f4f8" : "#15171c"
                      }
                    }, minutes === 0 ? "关闭" : "每 " + minutes + " 分钟");
                  })
                )
              )
            );

            body.push(
              react.createElement(
                "div",
                { key: "darkBoost", style: rowStyle },
                react.createElement("span", { style: labelStyle }, "深色模式加深"),
                react.createElement(
                  "button",
                  {
                    style: chipStyle(dark, config.darkBoost !== false),
                    title: "开启后，深色主题额外压暗一档（浅色主题不受影响）",
                    onClick: function () { saveConfig({ darkBoost: !(config.darkBoost !== false) }).then(applyCss); }
                  },
                  config.darkBoost !== false ? "已开启 +20%" : "已关闭"
                )
              )
            );

            if (!takeover) {
              body.push(
                react.createElement(
                  "div",
                  { key: "glass", style: rowStyle },
                  react.createElement("span", { style: labelStyle }, "毛玻璃面板"),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, config.isolatePanels === true),
                      onClick: function () { saveConfig({ isolatePanels: !config.isolatePanels }).then(applyCss); }
                    },
                    config.isolatePanels ? "已开启" : "已关闭"
                  )
                )
              );
            }

            body.push(
              react.createElement(
                "div",
                {
                  key: "footer",
                  style: {
                    borderTop: "1px solid " + (dark ? COLORS.border : COLORS.borderLight),
                    paddingTop: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px"
                  }
                },
                react.createElement("span", { style: labelStyle }, "图源：cnmiw.com (MirlKoi API)"),
                react.createElement(
                  "span",
                  { style: labelStyle },
                  "当前分类：" + (config.allowNsfw === true ? (config.sortNsfw || DEFAULTS.sortNsfw) : (config.sortSfw || DEFAULTS.sortSfw)) + (config.allowNsfw === true ? "（色图池）" : "（无色图池）")
                ),
                dialogAlphaOf() < 0.25
                  ? react.createElement(
                      "span",
                      { style: { color: COLORS.warn, fontSize: "11px", wordBreak: "break-all" } },
                      "对话栏几乎全透（dsh-skin dialogAlpha=" + dialogAlphaOf() + "），正文会直接压在壁纸上导致看不清。" +
                      "到「设置 → 主题」把「对话栏透明度」拉到 0.6 以上即可（侧栏/设置面板不受影响）。"
                    )
                  : null,
                snap.downgraded
                  ? react.createElement("span", { style: { color: COLORS.warn, fontSize: "11px", wordBreak: "break-all" } }, snap.downgraded)
                  : null,
                react.createElement(
                  "span",
                  { style: labelStyle },
                  takeover ? "壁纸层：自建（已挂到 <html> 下）" : "壁纸层：自建（未检测到 dsh-skin）"
                ),
                react.createElement(
                  "span",
                  { style: labelStyle },
                  snap.hostMode ? "宿主路由：已就绪" : "宿主路由：不可用"
                ),
                takeover
                  ? react.createElement("span", { style: labelStyle }, "面板透明度请到「设置 → 主题」里调")
                  : null,
                react.createElement(
                  "div",
                  { style: { display: "flex", gap: "6px" } },
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, false),
                      title: "把当前几何/样式实测结果追加写入 ~/.dsh/anime-theme/diagnostics.jsonl",
                      onClick: function () {
                        store.probe = "正在诊断…";
                        emit();
                        reportDiagnostics().then(function () {
                          store.probe = "诊断已写入";
                          emit();
                        });
                      }
                    },
                    "诊断"
                  ),
                  react.createElement(
                    "button",
                    {
                      style: chipStyle(dark, false),
                      title: "把控制坞挪回右下角默认位置",
                      onClick: function () { saveConfig({ dockX: 18, dockY: 76 }); }
                    },
                    "重置位置"
                  )
                ),
                snap.error
                  ? react.createElement("span", { style: { color: COLORS.danger, fontSize: "11px", wordBreak: "break-all" } }, snap.error)
                  : null,
                snap.probe
                  ? react.createElement("span", { style: { color: COLORS.warn, fontSize: "11px", wordBreak: "break-all" } }, snap.probe)
                  : null
              )
            );

            children.push(react.createElement("div", { key: "card", style: cardStyle }, body));
          }

          return react.createElement(
            "div",
            Object.assign({ style: panelStyle, "data-dsh-anime-theme": "dock" }, dragHandlers),
            children
          );
        }

        // ------------------------------------------------------------------
        // 插件入口
        // ------------------------------------------------------------------
        var autoTimer = null;

        function scheduleAutoRefresh() {
          if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
          }
          var minutes = Number(store.config.autoRefreshMinutes) || 0;
          if (minutes > 0 && store.config.enabled) {
            autoTimer = setInterval(function () {
              if (store.config.enabled) refresh(false);
            }, minutes * 60 * 1000);
          }
        }

        /**
         * 一次性自测量：把几处关键尺寸/包含块信息报给宿主，落到
         * ~/.dsh/anime-theme/diagnostics.jsonl，用来定位「层比屏幕大」这类问题。
         * 只上报几何量，不含任何隐私数据。失败了就静默放弃，不影响主流程。
         */
        /** 探当前壁纸的原始尺寸，用来算 contain 到底会画多大。 */
        function measureImage(url) {
          return new Promise(function (resolve) {
            if (!url) return resolve(null);
            var img = new Image();
            var done = false;
            var finish = function (value) { if (!done) { done = true; resolve(value); } };
            img.onload = function () {
              finish({ naturalW: img.naturalWidth, naturalH: img.naturalHeight });
            };
            img.onerror = function () { finish(null); };
            img.src = url;
            setTimeout(function () { finish(null); }, 8000);
          });
        }

        async function reportDiagnostics() {
          try {
            await sleep(1500);
            var root = document.documentElement;
            var layer = document.getElementById(FALLBACK_BG_ID);
            var hostNode = hostLayer();
            var blockers = [];
            // 找出会抢走 position:fixed 包含块的祖先（经典的「层比视口大」成因）
            var node = layer ? layer.parentElement : null;
            while (node && node !== root) {
              var cs = window.getComputedStyle(node);
              if (cs.transform !== "none" || cs.filter !== "none" || cs.perspective !== "none" ||
                  (cs.willChange && cs.willChange.indexOf("transform") >= 0) ||
                  (cs.contain && cs.contain !== "none") || (cs.zoom && cs.zoom !== "1")) {
                blockers.push({
                  tag: node.tagName,
                  cls: String(node.className || "").slice(0, 80),
                  transform: cs.transform, filter: cs.filter, zoom: cs.zoom, contain: cs.contain,
                  rect: node.getBoundingClientRect().width + "x" + node.getBoundingClientRect().height,
                });
              }
              node = node.parentElement;
            }
            // 实际吃到的 CSS：读计算样式，验证 fit 有没有真的生效
            var afterStyle = null;
            var beforeStyle = null;
            if (layer) {
              try {
                var csAfter = window.getComputedStyle(layer, "::after");
                afterStyle = { backgroundSize: csAfter.backgroundSize, backgroundImage: String(csAfter.backgroundImage).slice(0, 120) };
                var csBefore = window.getComputedStyle(layer, "::before");
                beforeStyle = { filter: csBefore.filter, display: csBefore.display };
              } catch (err) { /* 忽略 */ }
            }

            // 当前壁纸的自然尺寸 + contain 实际渲染盒子
            var measured = await measureImage(store.url);
            var containBox = null;
            if (measured && measured.naturalW > 0 && measured.naturalH > 0) {
              var vw = window.innerWidth, vh = window.innerHeight;
              var ia = measured.naturalW / measured.naturalH, ba = vw / vh;
              var rw, rh;
              if (ia > ba) { rw = vw; rh = vw / ia; } else { rh = vh; rw = vh * ia; }
              var covScale = Math.max(vw / measured.naturalW, vh / measured.naturalH);
              containBox = {
                naturalW: measured.naturalW, naturalH: measured.naturalH,
                containW: Math.round(rw), containH: Math.round(rh),
                containFits: rw <= vw + 1 && rh <= vh + 1,
                coverW: Math.round(measured.naturalW * covScale),
                coverH: Math.round(measured.naturalH * covScale),
                visibleHeightPctUnderCover: Math.round((vh / (measured.naturalH * covScale)) * 1000) / 10,
              };
            }

            var payload = {
              at: new Date().toISOString(),
              innerW: window.innerWidth, innerH: window.innerHeight,
              dpr: window.devicePixelRatio,
              docClientW: root.clientWidth, docClientH: root.clientHeight,
              docScrollW: root.scrollWidth, docScrollH: root.scrollHeight,
              bodyClientW: document.body ? document.body.clientWidth : null,
              bodyClientH: document.body ? document.body.clientHeight : null,
              bodyScrollW: document.body ? document.body.scrollWidth : null,
              bodyScrollH: document.body ? document.body.scrollHeight : null,
              htmlTransform: window.getComputedStyle(root).transform,
              htmlZoom: window.getComputedStyle(root).zoom,
              bodyTransform: document.body ? window.getComputedStyle(document.body).transform : null,
              selfLayerRect: layer ? (function () { var b = layer.getBoundingClientRect(); return b.width + "x" + b.height + "@" + b.left + "," + b.top; })() : null,
              selfLayerParent: layer && layer.parentElement ? layer.parentElement.tagName : null,
              hostLayerPresent: !!hostNode,
              hostLayerRect: hostNode ? (function () { var b = hostNode.getBoundingClientRect(); return b.width + "x" + b.height + "@" + b.left + "," + b.top; })() : null,
              hostLayerParent: hostNode && hostNode.parentElement ? hostNode.parentElement.tagName + "." + String(hostNode.parentElement.className || "").slice(0, 60) : null,
              fixedBlockersAboveLayer: blockers,
              appliedAfterStyle: afterStyle,
              appliedBeforeStyle: beforeStyle,
              // 明暗标记到底有没有落到 <html> 上 + 宿主的 dsh-skin 皮肤设置
              darkAttr: document.documentElement.getAttribute("data-dsh-anime-dark"),
              bodyHasDarkAttr: document.body ? document.body.hasAttribute("data-ds-dark-theme") : null,
              skinSettings: readSkinSettings(),
              wallpaperUrl: store.url,
              containBox: containBox,
              config: { fit: store.config.fit, fillBlur: store.config.fillBlur, dim: store.config.dim, veil: store.config.veil },
            };
            await hostJson("/diag", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
          } catch (err) { /* 诊断失败静默 */ }
        }

        async function boot() {
          await loadConfig();
          applyCss();
          emit();

          try {
            window.addEventListener("resize", function () {
              syncViewport();
              applyCss();
            });
          } catch (err) { /* 忽略 */ }

          if (store.config.enabled) {
            await refresh(false);
          }
          reportDiagnostics();
          scheduleAutoRefresh();
        }

        function apply(ctx) {
          if (typeof document !== "undefined") {
            if (document.body) {
              applyCss();
              boot();
            } else {
              document.addEventListener("DOMContentLoaded", function () {
                applyCss();
                boot();
              }, { once: true });
            }
          }

          if (ctx && typeof ctx.effect === "function") {
            ctx.effect(function () {
              return function () {
                if (autoTimer) clearInterval(autoTimer);
                teardown();
              };
            }, "dsh-anime-theme: dom");
          }

          if (!ctx || !ctx.slots) return;

          var register = function (slotName) {
            return function () {
              return ctx.slots.register(
                { name: slotName, id: "dsh-anime-theme", order: 70 },
                ThemeDock
              );
            };
          };

          try {
            ctx.slots.inject("shell.overlay", register("shell.overlay"));
          } catch (err) {
            try {
              ctx.slots.inject("conversation.input.dock", register("conversation.input.dock"));
            } catch (inner) {
              console.warn("[dsh-anime-theme] 控制坞槽位注册失败：", inner && inner.message);
            }
          }
        }

        exports.name = "dsh-anime-theme";
        exports.inject = ["slots"];
        exports.apply = apply;
        return module.exports;
      }
    });
  } catch (err) {
    console.warn("[dsh-anime-theme] client runtime error:", err);
  }
})();
