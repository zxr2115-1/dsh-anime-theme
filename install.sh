#!/usr/bin/env bash
#
# dsh-anime-theme · macOS / Linux 一键安装
# ---------------------------------------------------------------------------
# 与 install.ps1 等价，只是平台不同：
#   1. 环境检查（~/.dsh、profile、pnpm、node）
#   2. 复制插件到 ~/.dsh/plugins/dsh-anime-theme
#   3. 备份 profile 的 package.json 与 cordis.patch.yml
#   4. 写入 dependencies（file: 协议），并确保 bundles 里不含第三方插件
#   5. 在 profile cordis.patch.yml 追加挂载项（幂等）
#   6. 建立 node_modules 软链（macOS / Linux 原生 symlink，无需提权）
#   7. pnpm install
#   8. 运行 scripts/check-install.js 闭环自检
#
# 用法：
#   bash install.sh
#   DSH_PROFILE=desktop bash install.sh      # 只装到指定 profile
# ---------------------------------------------------------------------------

set -euo pipefail

PLUGIN_NAME="dsh-anime-theme"
DSH_ROOT="${DSH_ROOT:-$HOME/.dsh}"
PROFILES_DIR="$DSH_ROOT/profiles"
PLUGINS_DIR="$DSH_ROOT/plugins"
DEST_DIR="$PLUGINS_DIR/$PLUGIN_NAME"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [OK] %s\n' "$1"; }
warn() { printf '    [!]  %s\n' "$1"; }
die()  { printf '    [X]  %s\n' "$1" >&2; exit 1; }

printf '\n====================================================\n'
printf '  二次元壁纸主题 (%s) 一键安装\n' "$PLUGIN_NAME"
printf '====================================================\n'

# ---------- 1. 环境检查 ----------
step "检查环境"
[ -d "$DSH_ROOT" ] || die "未找到 DSH 根目录：$DSH_ROOT（请先启动过一次 DeepSeek Harness）"
ok "DSH 根目录：$DSH_ROOT"
[ -d "$PROFILES_DIR" ] || die "未找到 profiles 目录：$PROFILES_DIR"

PROFILE_DIRS=()
if [ -n "${DSH_PROFILE:-}" ]; then
  [ -f "$PROFILES_DIR/$DSH_PROFILE/package.json" ] || die "指定的 profile 不存在：$DSH_PROFILE"
  PROFILE_DIRS+=("$PROFILES_DIR/$DSH_PROFILE")
else
  for name in web default desktop; do
    [ -f "$PROFILES_DIR/$name/package.json" ] && PROFILE_DIRS+=("$PROFILES_DIR/$name")
  done
fi
[ ${#PROFILE_DIRS[@]} -gt 0 ] || die "在 $PROFILES_DIR 下没找到任何含 package.json 的 profile"
for d in "${PROFILE_DIRS[@]}"; do ok "目标 profile：$(basename "$d")"; done

command -v pnpm >/dev/null 2>&1 || die "未检测到 pnpm，请先执行：npm install -g pnpm"
ok "pnpm：$(command -v pnpm)"
command -v node >/dev/null 2>&1 || die "未检测到 node"
ok "node：$(node -v)"

[ -f "$SRC_DIR/index.js" ] || die "找不到插件源码（$SRC_DIR 下没有 index.js），脚本必须放在插件目录内运行"

# ---------- 2. 复制插件 ----------
step "复制插件文件"
mkdir -p "$PLUGINS_DIR"
if [ -d "$DEST_DIR" ]; then
  warn "已存在旧版本，自动覆盖更新：$DEST_DIR"
  rm -rf "$DEST_DIR"
fi
mkdir -p "$DEST_DIR"
# 用 tar 管道复制：排除 .git / node_modules / 安装脚本自身
tar -C "$SRC_DIR" \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./install.sh' \
    --exclude='./uninstall.sh' \
    --exclude='./install.ps1' \
    --exclude='./install.bat' \
    --exclude='./uninstall.ps1' \
    --exclude='./uninstall.bat' \
    -cf - . | tar -C "$DEST_DIR" -xf -
ok "插件已复制到：$DEST_DIR"

# ---------- 3~6. 逐 profile 接线 ----------
for PROFILE_DIR in "${PROFILE_DIRS[@]}"; do
  PROFILE_KEY="$(basename "$PROFILE_DIR")"
  step "[$PROFILE_KEY] 备份并写入 profile 配置"

  PKG="$PROFILE_DIR/package.json"
  PATCH="$PROFILE_DIR/cordis.patch.yml"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  cp "$PKG" "$PKG.bak.$STAMP"
  ok "备份：$PKG.bak.$STAMP"
  [ -f "$PATCH" ] && cp "$PATCH" "$PATCH.bak.$STAMP" && ok "备份：$PATCH.bak.$STAMP"

  # 4. dependencies + bundles（用 node 改，避免手写 JSON 出错）
  node -e '
    const fs = require("fs");
    const [pkgPath, name] = process.argv.slice(1);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.dependencies = pkg.dependencies || {};
    pkg.dependencies[name] = "file:../../plugins/" + name;
    if (pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)) {
      pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((x) => x !== name);
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  ' "$PKG" "$PLUGIN_NAME"
  ok "dependencies：$PLUGIN_NAME -> file:../../plugins/$PLUGIN_NAME"
  ok "bundles 已清理（第三方插件不进 bundles）"

  # 5. cordis.patch.yml
  if [ -f "$PATCH" ]; then
    # 去掉可能的空列表标记
    grep -v -E '^[[:space:]]*\[\][[:space:]]*$' "$PATCH" > "$PATCH.tmp" 2>/dev/null || true
    mv "$PATCH.tmp" "$PATCH"
  fi
  if ! grep -qE "^[[:space:]]*-[[:space:]]*id:[[:space:]]*$PLUGIN_NAME" "$PATCH" 2>/dev/null; then
    # 文件末尾补一个空行再追加，避免和上一条粘在一起
    [ -s "$PATCH" ] && printf '\n' >> "$PATCH"
    printf -- '- insert:\n    - id: %s\n      name: '\''%s'\''\n' "$PLUGIN_NAME" "$PLUGIN_NAME" >> "$PATCH"
    ok "cordis.patch.yml 已追加挂载项"
  else
    ok "cordis.patch.yml 已包含挂载项，跳过"
  fi

  # 6. 软链
  step "[$PROFILE_KEY] 建立 node_modules 软链"
  NM_DIR="$PROFILE_DIR/node_modules"
  mkdir -p "$NM_DIR"
  if ln -sfn "$DEST_DIR" "$NM_DIR/$PLUGIN_NAME" 2>/dev/null; then
    ok "软链就绪：$NM_DIR/$PLUGIN_NAME"
  else
    warn "软链建立失败（pnpm install 会用 file: 依赖兜底）"
  fi

  # 7. pnpm install
  step "[$PROFILE_KEY] 安装依赖"
  ( cd "$PROFILE_DIR" && pnpm install ) || warn "pnpm install 退出码非 0（软链已就位，通常不影响使用）"
done

# ---------- 8. 自检 ----------
step "闭环自检"
if node "$DEST_DIR/scripts/check-install.js"; then
  ok "自检通过"
else
  warn "自检未全部通过，请查看上方失败项"
fi

printf '\n安装完成。\n'
printf '最后一步：完全退出并重启 DeepSeek Harness，新建会话即可生效。\n\n'
printf '验证：界面右下角应出现「二次元壁纸 / 换一张 / 开 / 设置」控制坞，壁纸自动加载。\n'
printf '卸载：bash uninstall.sh\n\n'
