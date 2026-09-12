
/**
 * probe-css.mjs —— 离线抓取 client.js 生成的样式表并做断言式核对。
 *
 * 用一个极简 DOM/React 桩把 client.js 跑起来，把注入 <style> 的内容抠出来。
 * 这样不用启动整个 Harness 就能验证「四档铺满方式各自生成的 CSS 是否正确」。
 *
 * 用法（从插件根目录执行）：
 *   node scripts/probe-css.mjs                    # 用默认配置
 *   node scripts/probe-css.mjs client.js '{"fit":"cover-top"}'
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CLIENT = join(HERE, "..", "client.js");
const DEFAULT_CONFIG = JSON.stringify({ enabled: true, allowNsfw: false, sortSfw: "CDNcat", sortNsfw: "CDNsetu", dim: 0.3, fillBlur: 40, fit: "smart", veil: "auto", isolatePanels: false });

// ---------- 极简 DOM 桩，只为把 client.js 生成的 CSS 抓出来 ----------
const styleEls = [];
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), id: "", className: "", textContent: "", children: [],
    style: { setProperty() {}, removeProperty() {}, display: "", backgroundImage: "" },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    removeAttribute(k) { delete this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c) { c.parentNode = this; this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    querySelector() { return null; },
    getBoundingClientRect() { return { width: 1266, height: 762, left: 0, top: 0 }; },
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this._p || null; },
    set parentNode(p) { this._p = p; },
  };
  if (String(tag).toLowerCase() === "style") styleEls.push(el);
  return el;
}

const head = makeEl("head");
const body = makeEl("body");
const html = makeEl("html");
html.style = { setProperty(k, v) { this[k] = v; }, removeProperty() {} };
const doc = {
  head, body, documentElement: html,
  getElementById(id) {
    return [html, body, ...head.children, ...body.children, ...html.children].find(e => e.id === id) || null;
  },
  createElement: makeEl,
  querySelector(sel) {
    if (sel.includes("data-dsh-theme-bg")) { const s = makeEl("div"); s.attrs["data-dsh-theme-bg"] = "true"; s.parentNode = body; return s; }
    return null;
  },
  addEventListener() {}, removeEventListener() {},
};

// 探针默认跑浅色分支；PROBE_DARK=1 时先给 <body> 打上深色标记，跑深色分支
if (process.env.PROBE_DARK === "1") body.setAttribute("data-ds-dark-theme", "");

globalThis.document = doc;
globalThis.window = Object.assign(globalThis, {
  innerWidth: 1266, innerHeight: 762, devicePixelRatio: 1.25,
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ transform: "none", filter: "none", zoom: "1", contain: "none", willChange: "auto", backgroundSize: "cover, contain", backgroundImage: "" }),
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  MutationObserver: class { observe() {} disconnect() {} },
});
globalThis.MutationObserver = window.MutationObserver;
globalThis.Image = class { set src(v) { setTimeout(() => this.onload && this.onload(), 0); } get naturalWidth() { return 2400; } get naturalHeight() { return 2900; } };
globalThis.getComputedStyle = window.getComputedStyle;

let captured = null;
window.__ModuleLoader__ = { load(def) { captured = def; }, define() {} };

// 极简 react
// hooks 桩要跨多次渲染保持稳定，否则 ref.current 每次都是新的，
// 拖动相关的代码路径根本跑不到，也就测不出来。
let hookIndex = 0;
const hookSlots = [];
function resetHooks() { hookIndex = 0; }

const react = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (init) => {
    const i = hookIndex++;
    if (!(i in hookSlots)) hookSlots[i] = typeof init === "function" ? init() : init;
    return [hookSlots[i], () => {}];
  },
  useEffect: () => {},
  useRef: (init) => {
    const i = hookIndex++;
    if (!(i in hookSlots)) hookSlots[i] = { current: init === undefined ? null : init };
    return hookSlots[i];
  },
  useCallback: (f) => f,
  useSyncExternalStore: () => ({}),
};

// fetch 桩
const CFG = JSON.parse(process.argv[3] || DEFAULT_CONFIG);
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("/config") && (!opts || !opts.method)) {
    return { ok: true, text: async () => JSON.stringify({ ok: true, config: CFG }) };
  }
  if (String(url).includes("/random")) {
    return { ok: true, text: async () => JSON.stringify({ ok: true, url: "https://setu.iw233.top/large/fake.jpg", via: "host" }) };
  }
  if (String(url).includes("/diag")) return { ok: true, text: async () => JSON.stringify({ ok: true }) };
  return { ok: false, status: 404, text: async () => "" };
};

// 加载 client.js
const src = readFileSync(process.argv[2] || DEFAULT_CLIENT, "utf8");
new Function("window", "document", "getComputedStyle", "Image", "MutationObserver", "fetch", src)(
  window, doc, window.getComputedStyle, globalThis.Image, window.MutationObserver, globalThis.fetch);
const factory = captured.factory;
const mod = factory((name) => (name === "react" ? react : {}));

const registered = [];
let dockComponent = null;
mod.apply({
  slots: {
    inject(name, cb) { registered.push(name); cb(); },
    register(options, component) { dockComponent = component; return () => {}; },
  },
  effect: () => {},
});

await new Promise(r => setTimeout(r, 300));
const css = styleEls.map(e => e.textContent).join("\n");
// ---- 把控制坞真的渲染一次，点开「设置」，检查下拉框选项的可读性 ----
function walk(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.type && node.props) out.push(node);
  const kids = node.kids || [];
  for (const k of kids) {
    if (Array.isArray(k)) { for (const kk of k) walk(kk, out); } else walk(k, out);
  }
}
function findButton(nodes, text) {
  return nodes.find(n => n.type === "button" &&
    (n.kids || []).some(k => String(k) === text));
}
let optionReport = { rendered: false };
let dragReport = { tested: false };
if (dockComponent) {
  resetHooks();
  const first = dockComponent({});
  const firstNodes = []; walk(first, firstNodes);
  const dockIdle = firstNodes.find(n => n.props && n.props["data-dsh-anime-theme"] === "dock");
  // ---- 拖动 / 点击互不干扰的行为断言 ----
  // 回归点：早期版本在容器上按下就 setPointerCapture，
  // 导致 pointerup 被重定向、click 落到容器上，按钮永远点不动。
  const dockEl = firstNodes.find(n => n.props && n.props["data-dsh-anime-theme"] === "dock");
  if (dockEl && dockEl.props.ref) {
    const el = makeEl("div");
    let captured = false;
    el.setPointerCapture = () => { captured = true; };
    el.releasePointerCapture = () => { captured = false; };
    dockEl.props.ref.current = el;

    const ev = (tag, x, y) => ({ target: { tagName: tag }, clientX: x, clientY: y, button: 0, pointerId: 1 });

    // ① 从按钮上按下 → 不进入拖动，也不应捕获指针
    dockEl.props.onPointerDown(ev("BUTTON", 100, 100));
    dockEl.props.onPointerMove(ev("BUTTON", 80, 90));
    dockEl.props.onPointerUp(ev("BUTTON", 80, 90));
    const fromButton = { right: el.style.right, bottom: el.style.bottom, captured };

    // ② 从标签上按下 → 应正常拖动并捕获指针
    dockEl.props.onPointerDown(ev("SPAN", 100, 100));
    dockEl.props.onPointerMove(ev("SPAN", 80, 90));
    const fromLabel = { right: el.style.right, bottom: el.style.bottom, captured };
    dockEl.props.onPointerUp(ev("SPAN", 80, 90));

    // ③ 松手后位置应写回配置，并在下一次渲染的 style 上体现
    resetHooks();
    const after = dockComponent({});
    const afterNodes = []; walk(after, afterNodes);
    const dockAfter = afterNodes.find(n => n.props && n.props["data-dsh-anime-theme"] === "dock");
    dragReport = {
      tested: true,
      fromButton,
      fromLabel,
      persisted: dockAfter ? { right: dockAfter.props.style.right, bottom: dockAfter.props.style.bottom } : null,
    };
  }

  const openBtn = findButton(firstNodes, "设置");
  if (openBtn && openBtn.props && typeof openBtn.props.onClick === "function") openBtn.props.onClick();
  const second = dockComponent({});
  const nodes = []; walk(second, nodes);
  const options = nodes.filter(n => n.type === "option");
  const select = nodes.find(n => n.type === "select");
  const dock = nodes.find(n => n.props && n.props["data-dsh-anime-theme"] === "dock");
  optionReport = {
    rendered: true,
    optionCount: options.length,
    firstOptionText: options[0] ? String((options[0].kids || [])[0]) : null,
    firstOptionStyle: options[0] ? options[0].props.style : null,
    selectColor: select ? select.props.style.color : null,
    selectColorScheme: select ? select.props.style.colorScheme : null,
    dockRight: dock ? dock.props.style.right : null,
    dockBottom: dock ? dock.props.style.bottom : null,
    dockIdleOpacity: dockIdle ? dockIdle.props.style.opacity : null,
    dockOpenOpacity: dock ? dock.props.style.opacity : null,
    dockDragHandlers: dock
      ? ["onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel"]
          .filter(k => typeof dock.props[k] === "function").length
      : 0,
  };
}

const grab = (sel, prop) => {
  const m = css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{[^}]*" + prop + ":([^;]+);"));
  return m ? m[1].trim() : null;
};
const emptyAfter = (css.match(/::after\{([^}]*)\}/) || [])[1] || "";
const emptyBefore = (css.match(/::before\{([^}]*)\}/) || [])[1] || "";
console.log(JSON.stringify({
  slot: registered.join(","),
  dock: optionReport,
  drag: dragReport,
  afterBackgroundSize: grab("#dsh-anime-theme-bg::after", "background-size"),
  afterBackgroundPosition: grab("#dsh-anime-theme-bg::after", "background-position"),
  afterMask: /mask-image/.test(emptyAfter),
  beforeDisplay: (emptyBefore.match(/display:([^;!]+)/) || [])[1],
  beforeFillAlpha: (emptyBefore.match(/rgba\(\d+,\d+,\d+,([\d.]+)\)/) || [])[1],
  beforeFilter: grab("#dsh-anime-theme-bg::before", "filter"),
  // 注意：整张样式表是无换行拼接的，所以不能用 ^ + m；第一条匹配到的就是浅色基规则
  lightAfterAlpha: ((css.match(/#dsh-anime-theme-bg::after\{[^}]*rgba\(\d+,\d+,\d+,([\d.]+)\)/) || [])[1]),
  darkFillAlpha: ((css.match(/dark="1"\] #dsh-anime-theme-bg::before\{[^}]*rgba\(\d+,\d+,\d+,([\d.]+)\)/) || [])[1]),
  darkAfterAlpha: ((css.match(/dark="1"\] #dsh-anime-theme-bg::after\{[^}]*rgba\(\d+,\d+,\d+,([\d.]+)\)/) || [])[1]),
  darkAfterPosition: (css.match(/dark="1"\] #dsh-anime-theme-bg::after\{[^}]*background-position:([^;]+);/) || [])[1],
}, null, 2));