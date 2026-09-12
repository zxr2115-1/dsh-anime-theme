/**
 * package.mjs —— 打出可直接上传到 deepseek.stream/upload 的 zip。
 *
 * 市场侧只收 .zip，服务端会自动解压、穿透单层同名文件夹、定位 plugin.json
 * 并做规范校验。所以这里的结构是「一个顶层同名文件夹 + 插件全部文件」。
 *
 * 用 plugin.json 的 files 白名单式清单控制内容，刻意排除：
 *   dist/  .git/  node_modules/  以及打包脚本自己
 *
 * 用法：node scripts/package.mjs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { makeZip } from "./lib/zip.mjs";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NAME = "dsh-anime-theme";
const VERSION = pkg.version;

/** 进包清单。安装脚本也带上 —— 手动下载 zip 的人用得到。 */
const INCLUDE = [
  "index.js",
  "client.js",
  "cordis.patch.yml",
  "package.json",
  "plugin.json",
  "dsh.plugin.json",
  "config.example.json",
  "README.md",
  "PUBLISH.md",
  "LICENSE",
  "install.ps1",
  "install.bat",
  "uninstall.ps1",
  "uninstall.bat",
  "install.sh",
  "uninstall.sh",
  "scripts",
  "assets",
];
/** 打包工具自己不进包（npm 走 files 仍会带，市场 zip 不带） */
const EXCLUDE_FILES = new Set(["scripts/package.mjs", "scripts/lib/zip.mjs"]);
const EXCLUDE_DIRS = new Set(["dist", ".git", "node_modules"]);

const DIST = join(ROOT, "dist");
const OUT = join(DIST, NAME + "-" + VERSION + ".zip");

// ---------- 1. 校验必备文件 ----------
const missing = INCLUDE.filter((entry) => !existsSync(join(ROOT, entry)));
if (missing.length > 0) {
  console.error("缺文件，拒绝打包：" + missing.join(", "));
  process.exit(1);
}
for (const must of ["plugin.json", "package.json", "cordis.patch.yml", "index.js", "client.js", "README.md"]) {
  if (!existsSync(join(ROOT, must))) {
    console.error("市场规范要求的必备文件缺失：" + must);
    process.exit(1);
  }
}

// ---------- 2. 校验 plugin.json 的关键字段 ----------
const manifest = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
const REQUIRED = ["id", "name", "version", "description", "author", "platform", "harnessVersion", "entry", "permissions", "tags", "category"];
const lacked = REQUIRED.filter((key) => manifest[key] === undefined);
if (lacked.length > 0) {
  console.error("plugin.json 缺少规范字段：" + lacked.join(", "));
  process.exit(1);
}
if (manifest.version !== VERSION) {
  console.error("版本号不一致：plugin.json=" + manifest.version + "  package.json=" + VERSION);
  process.exit(1);
}

// ---------- 3. 收集条目（条目名一律正斜杠，跨平台可解） ----------
/** 递归收集一个路径下的所有文件，返回 zip 内的相对路径与磁盘路径。 */
function collect(absPath, zipPrefix, acc) {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    acc.push({ name: zipPrefix + "/", dir: true });
    for (const entry of readdirSync(absPath, { withFileTypes: true })) {
      const child = join(absPath, entry.name);
      const rel = relative(ROOT, child).split("\\").join("/");
      if (EXCLUDE_FILES.has(rel)) continue;
      if (entry.isDirectory() && EXCLUDE_DIRS.has(entry.name)) continue;
      collect(child, zipPrefix + "/" + entry.name, acc);
    }
    return acc;
  }
  acc.push({ name: zipPrefix, data: readFileSync(absPath) });
  return acc;
}

const collected = [];
for (const entry of INCLUDE) {
  collected.push(...collect(join(ROOT, entry), NAME + "/" + entry.split("\\").join("/"), []));
}

// 剪掉空目录条目（例如整个目录下的文件都被 EXCLUDE_FILES 排掉时）
const dirsWithFiles = new Set();
for (const e of collected) {
  if (e.dir) continue;
  const parts = e.name.split("/");
  for (let i = 1; i < parts.length; i++) dirsWithFiles.add(parts.slice(0, i).join("/") + "/");
}
const entries = collected.filter((e) => !e.dir || dirsWithFiles.has(e.name));

// ---------- 4. 压缩（自写 ZIP 写入器，不依赖外部命令） ----------
mkdirSync(DIST, { recursive: true });
if (existsSync(OUT)) rmSync(OUT, { force: true });
writeFileSync(OUT, makeZip(entries));

// ---------- 5. 列包内容 ----------
function walk(dir, base) {
  const rows = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...walk(full, base));
    else rows.push(relative(base, full).split("\\").join("/") + "  " + statSync(full).size);
  }
  return rows;
}
const staged = entries
  .filter((e) => !e.dir)
  .map((e) => e.name.replace(NAME + "/", "") + "  " + e.data.length);

console.log("");
console.log("打包完成：" + relative(ROOT, OUT));
console.log("压缩包大小：" + statSync(OUT).size + " bytes");
console.log("顶层文件夹：" + NAME + "/（服务端会自动穿透）");
console.log("");
console.log("包内文件（" + staged.length + " 个）：");
for (const row of staged) console.log("  " + row);
