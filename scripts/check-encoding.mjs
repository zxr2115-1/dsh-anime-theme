/**
 * check-encoding.mjs —— 编码与换行符的硬检查。
 *
 * 这些规则每一条都是踩过坑才写下的，而且都很容易被编辑器/工具无声破坏：
 *
 *   1. .ps1 必须带 UTF-8 BOM      —— PowerShell 5.1 无 BOM 时按 ANSI/GBK 读，
 *                                    中文注释和路径会变乱码，脚本直接解析失败
 *   2. .json / .js / .mjs / .sh 不能带 BOM
 *                                —— Node 的 JSON.parse 遇 BOM 抛 SyntaxError
 *   3. .sh 必须是 LF             —— CRLF 会让 shebang 变成 "bash\r"，
 *                                    Linux/macOS 报 bad interpreter
 *   4. plugin.json 与 package.json 版本必须一致
 *
 * 用法：node scripts/check-encoding.mjs   （打包脚本会先跑它）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["dist", ".git", "node_modules"]);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** 递归收集全部文件。 */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), acc);
    } else {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const MUST_HAVE_BOM = [".ps1"];
const MUST_NOT_HAVE_BOM = [".json", ".js", ".mjs", ".cjs", ".sh", ".yml", ".md", ".svg", ".txt"];
const MUST_BE_LF = [".sh", ".mjs", ".js", ".json", ".yml"];

const problems = [];
const files = walk(ROOT);

for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  const ext = rel.slice(rel.lastIndexOf(".")).toLowerCase();
  const buf = readFileSync(file);
  const hasBom = buf.length >= 3 && buf.subarray(0, 3).equals(BOM);

  if (MUST_HAVE_BOM.includes(ext) && !hasBom) {
    problems.push(rel + " 缺少 UTF-8 BOM（PowerShell 5.1 会按 GBK 读，中文必乱）");
  }
  if (MUST_NOT_HAVE_BOM.includes(ext) && hasBom) {
    problems.push(rel + " 带了 UTF-8 BOM（Node 的 JSON.parse 会报 Unexpected token）");
  }
  if (MUST_BE_LF.includes(ext) && buf.length > 0) {
    if (buf.includes(13)) {
      problems.push(rel + " 含 CRLF（.sh 的 shebang 会变成 bash\\r，Linux/macOS 报 bad interpreter）");
    }
  }
}

// 版本号一致性
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const plugin = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
  const dshPlugin = JSON.parse(readFileSync(join(ROOT, "dsh.plugin.json"), "utf8"));
  const index = readFileSync(join(ROOT, "index.js"), "utf8");
  const constVer = (index.match(/PLUGIN_VERSION = "([^"]+)"/) || [])[1];
  const versions = {
    "package.json": pkg.version,
    "package.json dsh.version": pkg.dsh && pkg.dsh.version,
    "plugin.json": plugin.version,
    "dsh.plugin.json": dshPlugin.version,
    "index.js PLUGIN_VERSION": constVer,
  };
  const all = Object.values(versions);
  if (new Set(all).size !== 1) {
    problems.push("版本号不一致： " + Object.entries(versions).map(([k, v]) => k + "=" + v).join("  "));
  } else {
    console.log("  版本号五处一致：" + all[0]);
  }
} catch (err) {
  problems.push("读取清单失败：" + err.message);
}

console.log("  检查文件数：" + files.length);
console.log("  .ps1 需带 BOM / .json 等不能带 BOM / .sh 需 LF");

if (problems.length === 0) {
  console.log("  编码与换行符检查通过");
  process.exit(0);
}
console.error("");
console.error("  发现 " + problems.length + " 个问题：");
for (const p of problems) console.error("    - " + p);
process.exit(1);
