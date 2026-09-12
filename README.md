# 二次元壁纸主题 · dsh-anime-theme

给 **DeepSeek Harness**（Web 版 / DSH Desktop）换上一张随机二次元壁纸的主题插件。

点一下「换一张」，它就从图源取一张随机图铺成整屏背景，并处理好几件容易做丑的事：
**整图完整可见**（不裁掉大半张脸）、留白处用同一张图的模糊放大版晕染（不出现白块黑块）、
正片边缘羽化（消除硬缝）、深浅色主题自动适配。右下角常驻一个可拖动的控制坞，随时换图、切分类、调暗幕。

**不需要 Pixiv 账号，不需要 Token，不预爬不缓存** —— 每次触发按需直取。

![效果预览](https://cdn.jsdelivr.net/gh/zxr2115-1/dsh-anime-theme@main/assets/preview.png)

> 图源是 cnmiw.com（MirlKoi API）的公开随机图接口。本插件只转发它返回的图片地址，
> 不下载、不留存、不修改图片。

---

## ✨ 功能

| 功能 | 说明 |
|------|------|
| 🖼️ 随机壁纸 | 每次「换一张」直连 API 取随机图，不预爬不缓存 |
| 🖼️ 四档铺满方式 | **自适应（默认）**：整图可见 + 留白用同图模糊放大版晕染；`cover` 铺满居中裁切；`cover-top` 铺满但裁切焦点偏上（保住人脸）；`plain` 整图 + 纯色留白 |
| 🪶 留白不泛白 | 铺底幕色刻意比正片轻（浅色 0.135 / 深色 0.5）并 `saturate(1.45)`，让两侧是「这张图自己的颜色晕出去」而不是一层白膜 |
| ✂️ 边缘羽化 | 按图的实际渲染矩形算一条 `mask-image` 渐隐带（羽化宽度 = 图宽 ×0.22，24~160px），把正片与铺底之间的硬缝抹平 |
| 🎯 裁切焦点可调 | 「铺满·偏上」档的裁切位置 0~100% 可调（0 = 顶部，100 = 底部），默认 25% 保住人脸 |
| 🌓 幕色跟随主题 | `auto` 模式下深色主题用暗幕、浅色主题用亮幕，避免浅色模式被压黑 |
| 🌚 深色模式加深 | 深色 UI 配亮壁纸时浅色字压不住，所以深色主题额外多压一档（`dim + 0.2`，可关），浅色主题原样不动 |
| 🌗 暗幕 / 亮幕 | 壁纸上加可调遮罩，保证任何图下文字都可读 |
| 🎚️ 实时调节 | 暗幕强度、留白虚化实时可调，拖动即预览 |
| 🎛️ 悬浮控制坞 | 右下角常驻胶囊：换一张 / 开关 / 设置。**按住可拖动**，位置持久化；空闲时半透明（0.45），鼠标靠近或展开设置恢复实底，不挡状态栏读数 |
| ⚡ 预加载后上屏 | 先等图片真正解码出来（读到自然尺寸）再换背景，不会先闪一下空背景 |
| 🔁 失败自动重试 | 三段都有兜底：上游取地址失败退避重试 3 次；拿到地址却**取不到图**（403 防盗链 / 404 / 超时）也会自动换下一张；全过程保留上一张壁纸不清空 |
| ⏱️ 自动换图 | 可设每 5 / 15 / 30 / 60 分钟自动换一张，改完立即重新排程 |
| ♻️ 关闭即还原 | 关掉插件写空样式表 + 移除自建层，一条规则都不残留，原背景完整回归 |
| 🧩 自建壁纸层 | 挂在 `<html>` 之下（不是 body 里），避开「祖先 transform 抢走 `position:fixed` 包含块」导致图被放大的坑；同时把内置主题插件 dsh-skin 那层 `display:none` 让位 |
| 🛡️ 零 CORS 依赖 | 宿主半体代理上游 API，浏览器端不再受 `api.cnmiw.com` 缺 CORS 头影响 |
| 🖼️ 防盗链中继 | 直连链路（sinaimg.cn）自动补 `Referer: https://weibo.com/`，并做域名白名单 |

**图源相关（可选能力，默认关闭）**

| 功能 | 说明 |
|------|------|
| 🔞 色图 / 无色图 | 两套独立分类：无色图走 `sortSfw`、色图走 `sortNsfw`，**下拉框跟随模式切换，不会串台**。默认是**无色图**，色图需手动开启 |
| 🚧 混池拦截 | `random` / `CDNrandom` 是上游的「全站随机」，会混进色图；无色图模式下宿主会降级到 `CDNcat` 并在控制坞如实提示，绝不照单全收 |
| 🔁 近期去重 | 宿主侧记住最近 50 张，命中自动换一张 |

---

## 📦 安装

### 方法一：桌面端一键安装（最省事）

装了 **DeepSeek Harness 桌面端**的话，把下面这行粘进浏览器地址栏，客户端会被唤起并弹出安装确认：

```
dsh://plugin/install?id=dsh-anime-theme&name=%E4%BA%8C%E6%AC%A1%E5%85%83%E5%A3%81%E7%BA%B8%E4%B8%BB%E9%A2%98&version=1.4.1&repo=zxr2115-1/dsh-anime-theme&permissions=%E7%BD%91%E7%BB%9C%E8%AE%BF%E9%97%AE%2C%E6%9C%AC%E5%9C%B0%E5%AD%98%E5%82%A8
```

> ⚠ **GitHub 会过滤 `dsh:` 这类自定义协议的链接**，所以在 README 里做的按钮点不动 —— 上面是给你复制的。
> 想要能点的按钮，本地打开 [`test-uri-install.html`](./test-uri-install.html)（自带按钮、参数预览和排查清单）。
> 插件市场 deepseek.stream 的详情页不受此限制，那里的「⚡ 一键安装」可以直接点。

协议格式（`dsh://` 由桌面端注册，各参数需 `encodeURIComponent`）：

```
dsh://plugin/install?id={id}&name={name}&version={version}&repo={repo}&permissions={permissions}&downloadUrl={downloadUrl}
```

前端拉起用隐藏 iframe 即可，不跳转、也不会被弹窗拦截：

```js
const params = new URLSearchParams({ id, name, version, repo, permissions });
const iframe = document.createElement('iframe');
iframe.style.display = 'none';
iframe.src = 'dsh://plugin/install?' + params.toString();
document.body.appendChild(iframe);
setTimeout(() => document.body.removeChild(iframe), 2000);
```

Windows 上如果协议没注册，跑一次 `install.ps1` 即可（它会兜底写入
`HKCU\Software\Classes\dsh`）。验证：

```powershell
reg query "HKCU\Software\Classes\dsh\shell\open\command"
```

### 方法二：一键脚本（推荐）

1. 右键 `install.ps1` → **使用 PowerShell 运行**
   （被系统拦截时双击 `install.bat`，或在 PowerShell 里执行 `.\install.ps1`）
2. 完全退出并重启 DeepSeek Harness（Web 版刷新页面 / 桌面版重开应用）
3. 新建会话即可看到右下角控制坞

### 方法三：手动安装

```powershell
# 1) 复制到插件目录
robocopy . "$env:USERPROFILE\.dsh\plugins\dsh-anime-theme" /E /XD .git

# 2) 在 profile package.json 的 dependencies 里加一行
#    "dsh-anime-theme": "file:../../plugins/dsh-anime-theme"
#    注意：第三方插件不要写进 dsh.profile.bundles，否则会重复加载报错

# 3) 在 profile cordis.patch.yml 追加挂载项
#    - insert:
#        - id: dsh-anime-theme
#          name: 'dsh-anime-theme'

# 4) 建软链并安装依赖
cd "$env:USERPROFILE\.dsh\profiles\web"
cmd /c mklink /J "node_modules\dsh-anime-theme" "$env:USERPROFILE\.dsh\plugins\dsh-anime-theme"
pnpm install

# 5) 自检
node "$env:USERPROFILE\.dsh\plugins\dsh-anime-theme\scripts\check-install.js"
```

### 平台差异

| 平台 | profile 目录 | 说明 |
|------|-------------|------|
| Windows | `install.bat` / `install.ps1` | 用 NTFS 目录联接（`mklink /J`）建软链，普通用户即可，无需 UAC |
| macOS / Linux | `install.sh` | 原生 `ln -sfn` 软链；`.sh` 与 `.ps1` 逻辑等价 |

两个脚本都会遍历 `web` / `default` / `desktop` 中所有已初始化的 profile 并逐一接线，
支持 `DSH_PROFILE=desktop` 指定单个 profile，也支持 `DSH_ROOT` 覆盖根目录。二者都是幂等的。

profile 目录名：Web 版是 `web`，DSH Desktop 是 `desktop`（部分版本为 `default`）。

---

## 🎛️ 使用

重启后界面右下角出现控制坞：

```
● 二次元壁纸   [换一张]  [开]  [设置]
```

- **换一张**：重新取一张随机图
- **开 / 关**：临时开关壁纸（不清除配置）
- **设置**：展开面板，可切换无色图/色图、更换分类 sort、调节暗幕/虚化、切铺满方式、开关深色加深、跑诊断、重置位置
- **拖动**：按住胶囊任意位置拖到别处，松手即保存；空闲时它会自动变半透明，鼠标移上去恢复实底

---

## ⚙️ 配置文件

路径：`~/.dsh/anime-theme/config.json`（首次加载自动生成，参考 `config.example.json`）

```json
{
  "enabled": true,
  "allowNsfw": false,
  "sortSfw": "CDNcat",
  "sortNsfw": "CDNsetu",
  "autoRefreshMinutes": 0,
  "recentLimit": 50,
  "recent": [],
  "dim": 0.3,
  "fillBlur": 40,
  "fit": "smart",
  "veil": "auto",
  "darkBoost": true,
  "coverFocus": 25,
  "isolatePanels": false,
  "dockX": 18,
  "dockY": 76,
  "schemaVersion": 2
}
```

| 字段 | 默认 | 说明 |
|------|------|------|
| `enabled` | `true` | 总开关 |
| `allowNsfw` | `false` | 是否允许色图分类。**关闭时宿主会二次拦截**，客户端传参无效 |
| `sortSfw` | `CDNcat` | 无色图分类。**仅限于无色图池**，可选 `CDNcat` `cat` `CDNtop` `CDNpc` `CDNmp` `CDNiw233` `iw233` `daimao` |
| `sortNsfw` | `CDNsetu` | 色图分类。可选 `CDNsetu` `setu` `Capoo` `yuexinmiao` `Denia` `CDNrandom` `random` |
| `autoRefreshMinutes` | `0` | 自动换图间隔（分钟），0 = 关闭。控制坞里有 关 / 5 / 15 / 30 / 60 的下拉 |
| `recentLimit` | `50` | 近期去重缓冲长度 |
| `dim` | `0.3` | 暗幕强度 |
| `fillBlur` | `40` | 留白处模糊铺底的虚化半径 px，范围 **16~80**。下限 16 是硬约束：再低铺底就退化成一张清晰的放大副本，自适应等于没生效 |
| `schemaVersion` | `2` | 配置结构版本。展示层设置改语义时 +1，老版本配置里语义已变的键会被丢弃并回到新默认值 |
| `fit` | `smart` | `smart` = 自适应（整图 + 模糊铺底）/ `cover` = 铺满居中裁切 / `cover-top` = 铺满、裁切焦点偏上 / `plain` = 整图 + 纯色留白 |
| `veil` | `auto` | 暗幕色调：`auto` 跟随软件明暗主题自动切换 / `dark` 强制暗幕 / `light` 强制亮幕 |
| `coverFocus` | `25` | 「铺满·偏上」的裁切焦点，0~100（0 = 顶部，100 = 底部） |
| `darkBoost` | `true` | 深色主题额外压暗一档（正片 `dim + 0.2`、铺底跟随），浅色主题不受影响。关闭后深浅两档同值 |
| `dockX` / `dockY` | `18` / `76` | 控制坞相对**右下角**的偏移 px。默认 bottom 76 是为了让开底部的状态栏读数；拖动后自动写回，越界会被钳进视口 |
| `isolatePanels` | `false` | **仅兜底模式生效**。是否让本插件自行接管面板透明 token。装了 `dsh-skin` 时留 `false`，面板透明度用「设置 → 主题」里的滑杆 |

---

## 🔌 HTTP 接口

宿主半体把路由挂在 `/dsh-anime-theme` 前缀下（同源，无需鉴权）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/dsh-anime-theme/api/health` | 健康检查 |
| GET | `/dsh-anime-theme/api/config` | 读取配置 |
| POST | `/dsh-anime-theme/api/config` | 合并写入配置（只接受白名单键） |
| GET | `/dsh-anime-theme/api/random?num=10&nsfw=0` | 取随机图地址（服务端去重） |
| GET | `/dsh-anime-theme/api/img?u=<urlencoded>` | 图片中继（域名白名单 + Referer 补齐） |

---

## 🗂️ 分类白名单

按 MirlKoi 上游分类页自己的归组切分（全部实测可用）：

| 池 | 上游归类 | sort |
|---|---|---|
| 🟢 无色图 | 无色图 | `iw233` / `CDNiw233`、`top` / `CDNtop`、`pc` / `CDNpc`、`mp` / `CDNmp` |
| 🟢 无色图 | 呆猫八条 | `daimao`、`cat` / `CDNcat`、`yin`、`xing` |
| 🔴 色图 | 色图 | `setu` / `CDNsetu`、`Capoo`、`yuexinmiao`、`Denia` |
| ⚠️ 混池 | 区块级「全站随机」 | `random` / `CDNrandom` —— 跨两个池，**只出现在色图模式的下拉框里** |

`CDN*` 前缀走 `setu.iw233.top`，免 Referer 更稳；无前缀走 `sinaimg.cn`，需 `Referer: https://weibo.com/`（插件自动补）。

---

## 🔧 上游 API

- 端点：`GET https://api.cnmiw.com/api.php?sort=<KEY>&type=json&num=<N>`
- 返回：`{"pic": ["url1", "url2", ...]}`，`num` 上限 100，无需鉴权
- **CDN 链路**（`CDNsetu` / `CDNcat`）：返回 `setu.iw233.top` 图片，免 Referer
- **直连链路**（`setu` / `cat`）：返回 `sinaimg.cn` 图片，需 `Referer: https://weibo.com/`（本插件已自动补齐）
- 其它分类：`top`（精选）、`pc`（横屏）、`mp`（竖屏）、`random` / `iw233`（全部），均有 `CDN*` 变体

> `api.cnmiw.com` **不返回 `Access-Control-Allow-Origin`**，所以浏览器端不能直连。
> 本插件的宿主半体代劳这一步，这也是必须装宿主半体而不能只做纯前端注入的原因。

---

## 🧩 技术实现要点

遵循 DSH 官方插件工程规范（与 `deepseek.stream/guide` 白皮书一致）：

1. **双半体结构**：`index.js`（宿主，ESM，声明 `name` / `inject` / `apply`）+ `client.js`（客户端 bundle）
2. **客户端加载契约**：`package.json` 必须同时有
   `dsh.client.platform = "web"` 与 `exports["./client"]`，
   否则 `dsh-client-modules` 会以 `MissingClientBundleError` 拒绝加载
3. **容器装载切片**：`cordis.patch.yml` + `dsh.bundle.patch`
4. **可选服务注入**：宿主用 `ctx.inject(["webServer"], ...)`，没有 `webServer`（如 Electron file:// 宿主）时静默降级，不阻塞插件加载
5. **零运行时依赖**：客户端只 `require("react")`（静态表提供），不依赖任何 DSH 客户端包，避免模块图解析问题
6. **无 BOM 写入**：所有 JSON 产物用 `UTF8Encoding($false)` 写，避免 `JSON.parse` 报 `Unexpected token`
7. **软链优先**：`mklink /J`（目录联接）普通用户即可创建，改代码即时生效；`.ps1` 本身以 UTF-8 **带** BOM 保存，避免 GBK 代码页下中文乱码
8. **幂等安装 + 事务备份**：重复运行不会重复挂载，改动前一律时间戳备份
9. **闭环自检**：`scripts/check-install.js` 真实模拟模块解析并校验软链、`dsh.bundle`、`exports["./client"]`

### 渲染策略（自建层挂在 `<html>` 之下）

先说清一个背景：`deepseek-ai-cordis`（市场里的「deep桌面主题插件」）**自己就有一层全屏背景**：

```
<div class="dt-bg dt-fade" data-dsh-theme-bg="true">     ← position:fixed; inset:0; z-index:-1
  <div class="dt-bg-gradient">                            ← 内置主题渐变
  <div class="dt-bg-media"><img src="..."></div>          ← 图片 / 视频皮肤
  <div class="dt-bg-mask"></div>                          ← 暗幕
</div>
```

本插件的做法是：**把它整层 `display:none` 让位，自己另起一层**。

#### 为什么不能把自建层挂在 body 里

`position: fixed` 的包含块会被祖先抢走 —— 只要任一祖先带 `transform` / `filter` /
`will-change` / `contain` / `zoom`，fixed 就退化成 absolute，`inset: 0` 于是按**那个祖先的盒子**算。
盒子比视口大时，`cover` 会再放大一轮、`contain` 也会溢出被裁，表现就是「图铺得比屏幕大、显示不全」。

历史上 v1.0 / v1.1 两版都走过弯路：先是和 dsh-skin 抢同一个 `z-index:-1` 被压在后面完全看不见，
改成挂在 body 里又撞上包含块被抢。现在的做法绕开了这两个坑。

#### 现在的结构

```
document.documentElement
├── #dsh-anime-theme-bg                                ← 本插件自建，<html> 的第一个子节点
└── <body>
    └── <div class="dt-bg" data-dsh-theme-bg="true">   ← 被 display:none 让位
```

1. **挂到 `<html>` 之下**：上面只剩 `<html>`，没有祖先能抢走包含块；
2. **尺寸显式喂进去**：`window.innerWidth/innerHeight` 写进 CSS 变量 `--dsh-anime-theme-w/h`，
   `resize` 时重算 —— 不再依赖「包含块 + `inset:0`」推算出来的盒子；
3. **明暗标记镜像到 `<html>`**：自建层是 `body` 的**兄弟节点**，用不了
   `body[data-ds-dark-theme]` 后代选择器，所以由 JS 把 `data-dsh-anime-dark` 同步到 `<html>` 上供 CSS 取用。

#### 三层绘制

```css
/* ① 元素自身：兜底色 + 显式视口尺寸 */
#dsh-anime-theme-bg {
  position: fixed; top: 0; left: 0;
  width: var(--dsh-anime-theme-w, 100vw);
  height: var(--dsh-anime-theme-h, 100vh);
  z-index: -1; pointer-events: none; overflow: hidden;
  background-color: #f4f6fa;              /* 深色主题下为 #0b0d12 */
}

/* ② ::before 同一张图 cover + 大半径虚化 —— 留白处的颜色晕染 */
#dsh-anime-theme-bg::before {
  content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(铺底幕色, 铺底幕色), url(图);
  background-size: cover, cover;
  filter: blur(40px) saturate(1.45);
  transform: scale(1.15);
}

/* ③ ::after 幕色渐变铺满 + 正片；smart/plain 用 contain 保整图，cover 系直接铺满 */
#dsh-anime-theme-bg::after {
  content: ""; position: absolute; inset: 0;
  background-image: linear-gradient(幕色, 幕色), url(图);
  background-size: cover, contain;        /* 逐层尺寸：幕色永远铺满，图保整张 */
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
  mask-image: linear-gradient(to right, transparent …, #000 …, #000 …, transparent …);
}
```

`::before` / `::after` 都是绝对定位、按 DOM 顺序层叠，
且被本层自己的 `overflow: hidden` 裁掉，不会溢出到应用界面之上。

#### 其余要点

1. **不碰 `--dsw-alias-bg-*` token** —— 面板透明度归 dsh-skin 的 `themeAlpha` / `dialogAlpha`
   管（它走 `ctx.theme.overrideTokens`），再用 `!important` 去压会直接踩坏它的透明度滑杆；
   只有完全没装 dsh-skin 时才由本插件接管（`isolatePanels` 开关）；
2. **关闭即还原**：`buildCss()` 返回空串 + 自建层移除，写在 dsh-skin 那层上的 `display:none` 一并消失，
   原背景完整回归，一条规则都不残留；
3. **边缘羽化**：`::after` 挂一条按图的实际渲染矩形算出来的 `mask-image` 渐隐带，
   抹平正片与模糊铺底之间的硬缝（羽化宽度 = 图宽 ×0.22，钳在 24~160px）；
4. 控制坞注册进官方预留的浮动层槽位 `shell.overlay`（`kind: "list"`，可加性席位），
   注册失败时回退 `conversation.input.dock`。

> 副作用：本插件开启期间，dsh-skin 自己的壁纸设置（内置主题 / 图片 / 视频）会被让位，
> 点控制坞的「开 / 关」即恢复。面板透明度始终归「设置 → 主题」里的滑杆。

---

## 🧪 离线验证与打包

### 打包上传

```bash
node scripts/package.mjs        # → dist/dsh-anime-theme-<version>.zip
```

打包前会跑一轮硬校验（必备文件、`plugin.json` 规范字段、`platform` 取值、两处版本号一致），
不过就拒绝打包。产物是「一个顶层同名文件夹 + 21 个文件」，服务端会自动穿透单层包裹定位 `plugin.json`。

### 离线验证

`scripts/probe-css.mjs` 用一个极简 DOM/React 桩把 `client.js` 跑起来，抓出它生成的样式表并核对，
不需要启动整个 Harness：

```bash
node scripts/probe-css.mjs                              # 用默认配置
node scripts/probe-css.mjs client.js '{"fit":"cover-top"}'
```

输出形如：

```json
{
  "afterBackgroundSize": "cover,contain !important",
  "afterBackgroundPosition": "center,center !important",
  "afterMask": true,
  "beforeDisplay": "block ",
  "beforeFillAlpha": "0.135",
  "beforeFilter": "blur(40px) saturate(1.45) !important",
  "darkFillAlpha": "0.5"
}
```

四档 `fit` 各自的 `background-size` / `background-position` / 是否有羽化 / 铺底是否关闭，
以及深浅两档的幕色、控制坞下拉框的选项数与配色，都可以在这一步核对完再上机。
改样式时先跑它，能省掉大量重启。

它还会**真的把控制坞渲染一次、模拟拖动与点击、点开「设置」**，然后逐项核对。
两条断言都是被真实 bug 逼出来的：

**① 下拉框选项隐形**（`<select>` 字色写成 `color:"inherit"`）：
`<select>` 的字色原先写成 `color: "inherit"`，而 Chromium 在 Windows 上的下拉弹层用 UA 默认浅色底，
`<option>` 继承了深色 UI 的浅色字 → 白底白字，整个列表全隐形。现在 `<select>` 显式给
`color-scheme`，`<option>` 再各自写死底色与字色，双保险。

**② 按钮点不动**（拖动时在容器上 `setPointerCapture`，`pointerup` 被重定向，
浏览器取「按下 / 松开」目标的共同祖先作为 `click` 目标，于是 `click` 落到容器、
按钮的 `onClick` 永远收不到）。修法是：按下时不捕获，位移超过 5px 确认是拖动后才捕获，
且从 `button` / `select` / `input` 上按下的一律不进入拖动。

探针对应输出：

```json
"drag": {
  "fromButton": { "captured": false },                                   // 完全没动
  "fromLabel":  { "right": "38px", "bottom": "86px", "captured": true },  // 正常拖动
  "persisted":  { "right": "38px", "bottom": "86px" }                     // 写回配置
}
```

```bash
$env:PROBE_DARK='1'; node scripts/probe-css.mjs   # 跑深色分支
```

---

## 🩺 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 右下角没有控制坞 | 客户端 bundle 没加载 | 检查 `exports["./client"]` 与 `dsh.client.platform`；F12 看 `[dsh-anime-theme] client runtime error` |
| 控制坞出现但壁纸不显示 | 面板仍不透明 / 图片没取到 | 看控制坞底部提示；确认宿主路由 `/dsh-anime-theme/api/health` 可访问 |
| 控制坞底部提示「宿主路由：不可用」 | 宿主半体没起来（`webServer` 缺失） | 检查 profile `cordis.patch.yml` 是否挂载、`index.js` 是否有报错；此时客户端会退回浏览器直连，但会被 CORS 挡住 |
| 启动直接崩溃 `declares no dsh.bundle` | `package.json` 缺 `dsh.bundle.patch` | 补 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| `SyntaxError: Unexpected token` | JSON 带了 UTF-8 BOM | 用 `UTF8Encoding($false)` 重写该 JSON |
| 图片 403 | 直连链路防盗链 | 换回 `CDNsetu` / `CDNcat`，或确认走的是宿主中继 |
| `pnpm install` 报 `ERR_PNPM_FETCH_404` | 某个本地插件的依赖被写成 `"*"`，pnpm 会去 npm registry 找它 | 本地插件一律写成 `"file:../../plugins/<id>"`，重跑 `pnpm install` 即可 |
| 界面打不开 | 插件导致前端故障 | DSH Desktop 用 `Harness → 以安全模式重启…` 屏蔽第三方插件 |

---

## 📦 发布

市场（`deepseek.stream`）只收 **`.zip`**，一条命令打出可直接上传的包：

```bash
node scripts/package.mjs        # → dist/dsh-anime-theme-1.4.1.zip
```

打包脚本会先自检（清单文件齐不齐、`plugin.json` 字段全不全、两处版本号一致不一致），
**任何一项不过就直接拒绝打包**，不会让你把一个会被市场打回的包传上去。

然后把 zip 拖到 <https://deepseek.stream/upload> 即可。

收录规范、`dsh://` 一键安装链接、版本更新清单，以及几条**实测踩坑记录**
（桌面端宿主会剥离 `dsh.bundle`、profile `bundles` 不能放第三方插件、本地依赖必须用 `file:`、
Windows 下 `.ps1` 要带 BOM 而 `.json` 不能带等）都写在 **[PUBLISH.md](./PUBLISH.md)**。

---

## 🗑️ 卸载

运行 `uninstall.ps1`：移除软链、`dependencies` 项、`cordis.patch.yml` 挂载项与插件目录。
用户配置保留在 `~/.dsh/anime-theme/`，可手动删除。

---

## 📄 License

MIT。

图源版权归原作者所有，本插件仅转发公开随机图接口返回的图片地址，不在本地留存。

> 设计参考：[麦麦 (MaiBot)](https://github.com/Mai-with-u) 生态的「来点二次元图片」插件
> 把同一个图源用在 QQ 群聊里。本插件与之没有代码或依赖关系，只是选了同一个公开 API；
> 两者的形态完全不同 —— 那边是发图机器人，这边是界面主题。
