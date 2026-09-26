#!/usr/bin/env node
/**
 * sync-local.mjs —— 把仓库内容同步到本机所有已安装副本，一条命令搞定。
 *
 * 为什么需要它：
 *   DSH 的 profile 用 pnpm 的 file: 依赖装载插件，而 pnpm 是把包【复制】进
 *   自己的 store（node_modules/.pnpm/dsh-anime-theme@file+.../node_modules/dsh-anime-theme）。
 *   于是改了仓库之后，profile 里那份【不会】自动跟着变 —— 重启也没用，
 *   因为磁盘上它读的那份本来就是旧的。这个坑踩过一次，症状是「诊断日志几十分钟不更新」
 *   和「自动换图静默失效」，查了很久。
 *
 * 它做什么：
 *   1. 自动发现所有目标：~/.dsh/plugins/<name> 以及每个 profile 的 node_modules 入口
 *      （后者可能是 Junction，会先 realpath 解析到真身再写）
 *   2. 逐一镜像仓库内容（排除 dist / .git / node_modules）
 *   3. 逐个校验关键文件的 sha256，不一致就报错退出
 *
 * 用法（仓库根目录）：
 *   node scripts/sync-local.mjs          # 同步 + 校验
 *   node scripts/sync-local.mjs --dry    # 只列出会动哪些地方，不写盘
 */
import { cpSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name;
const DSH_ROOT = process.env.DSH_ROOT || join(process.env.USERPROFILE || process.env.HOME || homedir(), ".dsh");
const DRY = process.argv.includes("--dry");

/** 不进副本的东西 */
const EXCLUDE = new Set(["dist", ".git", "node_modules"]);
/**
 * 同步后要逐字节核对的文件。
 *
 * 刻意不含 package.json —— 桌面端宿主的 cleanLegacyState 会【故意】把
 * dsh.bundle 从安装副本里剥掉（改由 profile 级 cordis.patch.yml 挂载），
 * 所以它本来就与源不同。把它列进来只会恒报假阳性。
 * 核对运行时真正加载的那几个文件就够了。
 */
const VERIFY = ["index.js", "client.js", "cordis.patch.yml"];

function sha(file) {
  try { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
  catch { return null; }
}

/** 收集目标目录；Junction 先解析成真实路径，并去重。 */
function collectTargets() {
  const raw = [];
  const plugins = join(DSH_ROOT, "plugins", NAME);
  if (existsSync(plugins)) raw.push(plugins);

  const profiles = join(DSH_ROOT, "profiles");
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const linked = join(profiles, entry.name, "node_modules", NAME);
      if (existsSync(linked)) raw.push(linked);
    }
  }

  const seen = new Map();
  for (const p of raw) {
    let real = p;
    try { real = realpathSync(p); } catch { /* 解析失败就用原路径 */ }
    if (!seen.has(real)) seen.set(real, { path: real, via: p });
  }
  return [...seen.values()];
}

const targets = collectTargets();
if (targets.length === 0) {
  console.error("没找到任何已安装副本。先跑 install.ps1 / install.sh，或确认 DSH_ROOT 是否正确。");
  console.error("  DSH_ROOT = " + DSH_ROOT);
  process.exit(1);
}

console.log("源   ：" + ROOT);
console.log("目标 ：" + targets.length + " 个" + (DRY ? "   （--dry：不写盘）" : ""));
console.log("");

let bad = 0;
for (const t of targets) {
  const label = t.path.replace(DSH_ROOT, "~");
  const via = t.via === t.path ? "" : "   (Junction " + t.via.replace(DSH_ROOT, "~") + ")";
  console.log("  " + label + via);

  if (!DRY) {
    try {
      cpSync(ROOT, t.path, {
        recursive: true,
        force: true,
        filter: (src) => !EXCLUDE.has(basename(src)),
      });
    } catch (err) {
      console.log("      [X] 复制失败：" + err.message);
      bad += 1;
      continue;
    }
  }

  const diffs = VERIFY.filter((f) => {
    const a = sha(join(ROOT, f));
    const b = sha(join(t.path, f));
    return a !== null && a !== b;
  });
  if (diffs.length === 0) console.log("      [OK] " + VERIFY.join(" / ") + " 逐字节一致");
  else { console.log("      [X] 内容不一致：" + diffs.join(", ")); bad += 1; }
}

console.log("");
if (bad > 0) {
  console.error("有 " + bad + " 个目标没同步好。");
  process.exit(1);
}
console.log("全部同步完成。");
console.log("");
console.log("生效方式（两者不一样，别混）：");
console.log("  · 客户端半（client.js）—— 页面刷新即可");
console.log("  · 宿主半（index.js）  —— 必须【完全退出并重启】DSH Desktop");
console.log("");
console.log("想确认运行中的到底是哪一版：");
console.log("  curl http://127.0.0.1:3080/dsh-anime-theme/api/health");
