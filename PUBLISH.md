# 发布到 DeepSeek Harness 插件市场

面向 **deepseek.stream 的 zip 上传收录**（主路径）与 `dsh plugin` / npm 安装管路（备路径）。
规范来源：<https://deepseek.stream/guide>，并参照已上架的 `deepseek-ai-cordis`。

---

## 0. 最快路径

```bash
node scripts/package.mjs                      # 打出 dist/dsh-anime-theme-1.4.0.zip
# 打开 https://deepseek.stream/upload → 上传这个 zip
```

打包脚本会先自检（清单文件齐不齐、`plugin.json` 字段全不全、两处版本号一致不一致），
任何一项不过就**拒绝打包**，不会让你把一个会被市场打回的包传上去。

---

## 1. 收录规范核对（本插件已达成）

### 1.1 压缩包格式

- 只收 **`.zip`**
- 服务端会自动**穿透单层同名包裹**，所以顶层是 `dsh-anime-theme/` 文件夹最规范
- 缺 `plugin.json` 时会退化成「按文件名 + README 推导元数据」—— 别指望它，一定带上

### 1.2 目录树

```
dsh-anime-theme/
├── plugin.json          # 必选：市场元数据
├── dsh.plugin.json      # 同内容，供另一套读取器
├── package.json         # 必选：npm 元数据 + dsh.bundle / dsh.client 契约
├── cordis.patch.yml     # 必选：容器装载切片
├── index.js             # 宿主半体
├── client.js            # 客户端 bundle（exports["./client"] 指向它）
├── README.md            # 详情页正文
├── PUBLISH.md
├── LICENSE
├── config.example.json
├── assets/              # 图标与预览
└── scripts/             # check-install.js（安装脚本会调用）、probe-css.mjs
```

### 1.3 `plugin.json` 字段（guide 规定）

| 字段 | 本插件取值 |
|------|-----------|
| `id` | `dsh-anime-theme` |
| `name` | `dsh-anime-theme` |
| `version` | `1.4.0` |
| `description` | 一句话说明 |
| `author` | `zxr2115-1` |
| `platform` | `all`（可选 `all` / `desktop-exe` / `linux` / `web`） |
| `harnessVersion` | `>=0.1.0`（**别写 `>=1.0.0`**，会被低版本容器拒绝加载） |
| `entry` | `index.js` |
| `permissions` | `["network","storage","ui-injection"]` |
| `tags` | `["deepseek","deepseek-harness","dsh-plugin","theme","wallpaper","anime","background"]` |
| `category` | `theme` |

另外并入了已上架插件（`deepseek-ai-cordis`）同款字段：`displayName`、`main`、`client`、
`browser`、`icon`、`contributes`、`permissionsDisplay`。两套读取器都能解析。

> `name` 填的是**包名**而不是展示名 —— 市场里 `id` 才是身份（`dsh://plugin/install?id=` 用它），
> 已上架的 `deepseek-ai-cordis` 也是这个填法。展示名走 `displayName`。

### 1.4 Bundle 规范硬契约

缺任何一条都会被容器或客户端模块系统拒载：

```jsonc
// package.json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },        // 缺 → declares no dsh.bundle，容器崩
  "client": { "platform": "web", "immediately": true } // 缺 → 客户端半体不加载
},
"exports": { "./client": "./client.js" }              // 缺 → MissingClientBundleError
```

---

## 2. 本地先验证（发布前必做）

本插件**没有构建步骤** —— `client.js` 是手写的浏览器 bundle，直接发布，不需要 `npm run build`。

```bash
# ① 语法 + 编码/换行符（.ps1 需 BOM、.json 不能带 BOM、.sh 需 LF、版本号五处一致）
node --check index.js && node --check client.js
node scripts/check-encoding.mjs

# ② 离线抓样式 / 渲染控制坞，核对四档铺满方式、下拉框、拖动行为
node scripts/probe-css.mjs
PROBE_DARK=1 node scripts/probe-css.mjs      # 深色分支

# ③ 装到本机看实际效果
pwsh -File install.ps1          # Windows
bash install.sh                 # macOS / Linux
#    然后完全退出并重启 Harness

# ④ 装完后的闭环自检（真实模拟模块解析）
node scripts/check-install.js
```

`scripts/probe-css.mjs` 会在启动 Harness 之前把大部分样式与交互断言跑完，
改样式时先跑它，能省掉大量重启。详见 README 的「离线验证」一节。

---

## 3. 打包与上传

```bash
node scripts/package.mjs
```

输出 `dist/dsh-anime-theme-<version>.zip`，结构为「一个顶层同名文件夹 + 21 个文件（约 73 KB）」，
刻意排除 `dist/` / `.git/` / `node_modules/` 与打包脚本自身。

然后打开 **<https://deepseek.stream/upload>** → 「上传压缩包 (zip)」→ 拖进去。

上传后服务端会做：解压 → 穿透单层包裹 → 定位 `plugin.json` → 元数据解析 → Bundle 规范校验。
本地可以先用同样逻辑自查一遍（把 `<zip>` 换成实际路径）：

```powershell
Expand-Archive -LiteralPath <zip> -DestinationPath $env:TEMP\dsh-check -Force
Get-Content $env:TEMP\dsh-check\dsh-anime-theme\plugin.json
```

---

## 4. `dsh://` 一键安装联动协议

本插件的实际链接（各参数已 URL 编码）：

```
dsh://plugin/install?id=dsh-anime-theme&name=%E4%BA%8C%E6%AC%A1%E5%85%83%E5%A3%81%E7%BA%B8%E4%B8%BB%E9%A2%98&version=1.4.0&repo=zxr2115-1/dsh-anime-theme&permissions=%E7%BD%91%E7%BB%9C%E8%AE%BF%E9%97%AE%2C%E6%9C%AC%E5%9C%B0%E5%AD%98%E5%82%A8
```

协议格式：`dsh://plugin/install?id=&name=&version=&repo=&permissions=&downloadUrl=`。
桌面端收到后会弹权限确认面板，确认才拉包并解压到 `~/.dsh/plugins/` 热加载。

### ⚠ GitHub 会过滤自定义协议

README 里写 `<a href="dsh://...">` **点不动** —— GitHub 的 HTML 消毒器只放行
http/https/mailto 等白名单协议，`dsh:` 会被剥成纯文本。

所以本插件提供了 [`test-uri-install.html`](./test-uri-install.html)：一个自包含的调试页，
里有可点按钮、参数解析预览、排查清单和可复制的前端代码。本地打开即可。
插件市场 deepseek.stream 自己的详情页不受此限制，那里的按钮可以直接点。

### Windows 上协议没注册？

桌面端（EXE）**通常自己会注册** `dsh://`。万一没有，跑一次 `install.ps1` 兜底写入
`HKCU\Software\Classes\dsh`（它会自动探测 EXE 路径，不硬编码）。验证：

```powershell
reg query "HKCU\Software\Classes\dsh\shell\open\command"
```

### 前端拉起方式

用隐藏 iframe，不跳转也不会被弹窗拦截：

```js
const params = new URLSearchParams({ id, name, version, repo, permissions });
const iframe = document.createElement('iframe');
iframe.style.display = 'none';
iframe.src = 'dsh://plugin/install?' + params.toString();
document.body.appendChild(iframe);
setTimeout(() => document.body.removeChild(iframe), 2000);
```

---

## 5. 备路径：GitHub + npm

如果还想支持 `dsh plugin --profile web add dsh-anime-theme` 这种管路：

```bash
git init && git add . && git commit -m "feat: 二次元壁纸主题 v1.4.0"
git branch -M main
git remote add origin https://github.com/zxr2115-1/dsh-anime-theme.git
git push -u origin main

npm login
npm publish --registry=https://registry.npmjs.org/
```

两个关键点：

1. **GitHub 仓库页 → 🏷 Topics 加 `dsh-plugin`**（建议再加 `deepseek-harness`、`dsh`、`theme`、`wallpaper`）。市场靠 topic 发现插件。
2. **发布必须显式带 `--registry=https://registry.npmjs.org/`** —— 本机 `npm config get registry` 很可能是镜像，不加会误发到镜像。

> npm 走 `files` 白名单，会把 `scripts/package.mjs` 一起带上（市场 zip 不带）。
> 这没问题，它只是个打包工具。

---

## 6. 更新版本

版本号有五处，必须同步：

| 位置 | 字段 |
|------|------|
| `package.json` | `version` 与 `dsh.version` |
| `plugin.json` | `version` |
| `dsh.plugin.json` | `version` |
| `index.js` | `PLUGIN_VERSION` 常量（`/api/health` 会返回它） |

`scripts/package.mjs` 会校验 `plugin.json` 与 `package.json` 是否一致，不一致直接拒绝打包。
其余两处手工核对：

```bash
grep -rn "1\.4\.0" --include=*.js --include=*.json .
```

发完版：

```bash
node scripts/probe-css.mjs && node scripts/check-install.js
git commit -am "release: v1.4.1" && git tag v1.4.1 && git push --follow-tags
node scripts/package.mjs          # 重新打包上传
```

---

## 7. 实测踩坑记录

以下都是本机实际验证出来的，不是推测：

### ① 桌面端宿主会改写安装副本

DSH Desktop 每次启动会跑 `cleanLegacyState`，日志里能看到：

```
cleanLegacyState: sandboxed client script for dsh-anime-theme in isolated IIFE
cleanLegacyState: healed plugin exports and dsh.client for dsh-anime-theme
```

它会：
- 把 `client.js` 再包一层 IIFE 沙箱（无害，嵌套 IIFE 正常）
- 把 `index.js` 的 `apply` 包一层 try/catch 安全壳（无害）
- **把 `dsh.bundle` 从安装副本的 `package.json` 里剥掉**，改由 profile 级 `cordis.patch.yml` 挂载

所以 **安装目录里缺 `dsh.bundle` 是正常状态**，源码目录里必须有。
`scripts/check-install.js` 对此只提示、不判失败。

### ② profile 的 `bundles` 里不能放第三方插件

`dsh.profile.bundles` 只放 `@deepseek-ai/dsh-base` 这类系统 bundle。
第三方插件写进 `dependencies`（`file:../../plugins/<id>`）**且**在 profile 的
`cordis.patch.yml` 里加一条 `insert`。放错会重复加载报错。

### ③ 本地依赖一律用 `file:`，不要用 `"*"`

写成 `"*"` 时 pnpm 会去 npm registry 找同名包，失败则整个 `pnpm install`
以 `ERR_PNPM_FETCH_404` 退出（其他插件也会被连累）。

### ④ 自检要在装完之后跑，不能只看安装脚本的退出码

安装脚本成功 ≠ 宿主能起来。软链失效、`exports` 写错、profile 漏挂，
都只有 `check-install.js` 这种「真实模拟模块解析」的检查才抓得住。

### ⑤ 编码/换行符是最容易被无声破坏的东西（已做成自动检查）

`scripts/check-encoding.mjs` 会逐条校验：`.ps1` 必须带 UTF-8 BOM、`.json`/js/mjs/sh 不能带 BOM、
`.sh` 必须是 LF、版本号五处一致。`scripts/package.mjs` 会先跑它，不过就拒绝打包。

这条检查是被反复咬出来的 —— 包括编写本插件的过程中，一次普通的文本编辑就把
`install.ps1` 的 BOM 抹掉了，PowerShell 5.1 立刻按 GBK 读、中文全乱、报 6 处语法错误。
编码这种东西你看代码是看不出来的，只能靠机器查。

### ⑥ 细节：Windows 上 `.ps1` 必须存成 UTF-8 **带** BOM

PowerShell 5.1 默认按 ANSI/GBK 读 `.ps1`，无 BOM 的中文注释和路径会变乱码，
脚本直接找不到文件。反过来，所有 `.json` 产物必须**无** BOM，否则 Node 的
`JSON.parse` 会抛 `SyntaxError: Unexpected token`。

---

## 8. 一句话总览

```
node scripts/probe-css.mjs + check-install.js   →   node scripts/package.mjs
                                                →   传 https://deepseek.stream/upload
                                                →   （可选）GitHub 打 dsh-plugin topic + npm publish
```