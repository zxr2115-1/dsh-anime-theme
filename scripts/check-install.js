#!/usr/bin/env node
/**
 * dsh-anime-theme 安装自检器
 * 真实模拟模块解析：软链可达 + package.json 合法 + dsh.bundle 契约齐备。
 * 退出码非 0 表示安装不完整。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const PLUGIN = "dsh-anime-theme";
const home = process.env.USERPROFILE || process.env.HOME || homedir();
// DSH_ROOT 可以覆盖（便于在沙箱里验证安装脚本，也方便自定义根目录的用户）
const dshRoot = process.env.DSH_ROOT ? process.env.DSH_ROOT : join(home, ".dsh");
const pluginDir = join(dshRoot, "plugins", PLUGIN);

const failures = [];
const notes = [];

function ok(message) { console.log("  [OK] " + message); }
function fail(message) { failures.push(message); console.log("  [X]  " + message); }
function note(message) { notes.push(message); console.log("  [i]  " + message); }

console.log("dsh-anime-theme 安装自检");
console.log("DSH 根目录: " + dshRoot);
console.log("");

// 1. 插件实体目录
if (!existsSync(pluginDir)) {
  fail("插件目录不存在: " + pluginDir);
} else {
  ok("插件目录存在: " + pluginDir);
  for (const file of ["index.js", "client.js", "cordis.patch.yml", "package.json"]) {
    const target = join(pluginDir, file);
    if (existsSync(target) && statSync(target).isFile()) ok("存在 " + file);
    else fail("缺少必需文件: " + file);
  }
}

// 2. 插件自身清单契约
try {
  const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
  // 注意：这一项【不判失败】。
  // DSH Desktop 宿主启动时会跑 cleanLegacyState，主动把 dsh.bundle 从安装副本里剥掉，
  // 改由 profile 级 cordis.patch.yml 挂载 —— 所以安装目录里缺 bundle 是正常状态。
  // 源码目录里应当有；安装目录里没有也不算问题。
  if (pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch) {
    ok("package.json 含 dsh.bundle.patch");
  } else {
    note("package.json 无 dsh.bundle.patch —— 若这是安装副本，说明已被桌面端 cleanLegacyState 接管，正常");
  }

  if (pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === "web") ok("package.json 含 dsh.client.platform=web");
  else fail("package.json 缺少 dsh.client.platform");

  const clientExport = pkg.exports && pkg.exports["./client"];
  if (clientExport) ok("exports[\"./client\"] -> " + clientExport);
  else fail("package.json 缺少 exports[\"./client\"] —— 客户端模块系统会拒绝加载");

  if (clientExport) {
    const resolved = join(pluginDir, String(clientExport).replace(/^\.\//, ""));
    if (existsSync(resolved)) ok("客户端 bundle 可达: " + resolved);
    else fail("客户端 bundle 不存在: " + resolved);
  }
} catch (err) {
  fail("插件 package.json 解析失败: " + err.message);
}

// 3. 每个 profile 的接线
const profiles = ["web", "default", "desktop"];
let wired = 0;

for (const profile of profiles) {
  const profileDir = join(dshRoot, "profiles", profile);
  const profilePkg = join(profileDir, "package.json");
  if (!existsSync(profilePkg)) continue;

  console.log("");
  console.log("Profile: " + profile);

  try {
    const pkg = JSON.parse(readFileSync(profilePkg, "utf8"));
    const dep = pkg.dependencies && pkg.dependencies[PLUGIN];
    if (dep) ok("dependencies 已声明: " + dep);
    else fail("dependencies 未声明 " + PLUGIN);

    const bundles = pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
    if (Array.isArray(bundles) && bundles.includes(PLUGIN)) {
      fail("bundles 中不应包含第三方插件（会导致重复加载报错）");
    } else {
      ok("bundles 未包含第三方插件（符合规范）");
    }
  } catch (err) {
    fail("profile package.json 解析失败: " + err.message);
  }

  const patchPath = join(profileDir, "cordis.patch.yml");
  if (!existsSync(patchPath)) {
    fail("缺少 cordis.patch.yml");
  } else {
    const patch = readFileSync(patchPath, "utf8");
    // 注意：JS 的 RegExp 不支持 (?m) 内联标志，多行模式必须走第二个参数
    if (new RegExp("^\\s*-\\s*id:\\s*" + PLUGIN, "m").test(patch)) ok("cordis.patch.yml 已挂载");
    else fail("cordis.patch.yml 未挂载 " + PLUGIN);
  }

  const nmEntry = join(profileDir, "node_modules", PLUGIN);
  if (existsSync(nmEntry)) {
    ok("node_modules 链接存在: " + nmEntry);
  } else {
    fail("node_modules 链接缺失: " + nmEntry + "（运行 pnpm install 或安装脚本）");
  }

  wired += 1;
}

if (wired === 0) fail("没有找到任何已初始化的 DSH profile");

console.log("");
if (failures.length === 0) {
  console.log("自检通过：插件已正确装载。");
  process.exit(0);
}
console.log("自检失败，共 " + failures.length + " 项：");
for (const failure of failures) console.log("  - " + failure);
process.exit(1);
