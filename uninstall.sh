#!/usr/bin/env bash
#
# dsh-anime-theme · macOS / Linux 一键卸载
# 移除软链、dependencies 项、cordis.patch.yml 挂载项与插件目录。
# 用户配置保留在 ~/.dsh/anime-theme/，需要时可手动删除。
# ---------------------------------------------------------------------------

set -euo pipefail

PLUGIN_NAME="dsh-anime-theme"
DSH_ROOT="${DSH_ROOT:-$HOME/.dsh}"
PROFILES_DIR="$DSH_ROOT/profiles"
DEST_DIR="$DSH_ROOT/plugins/$PLUGIN_NAME"

ok() { printf '    [OK] %s\n' "$1"; }

printf '\n=== 卸载 %s ===\n' "$PLUGIN_NAME"

for name in web default desktop; do
  PROFILE_DIR="$PROFILES_DIR/$name"
  [ -f "$PROFILE_DIR/package.json" ] || continue
  printf '  -> profile: %s\n' "$name"

  # 软链
  NM_ENTRY="$PROFILE_DIR/node_modules/$PLUGIN_NAME"
  if [ -L "$NM_ENTRY" ] || [ -e "$NM_ENTRY" ]; then
    rm -rf "$NM_ENTRY"
    ok "软链已移除"
  fi

  # package.json
  node -e '
    const fs = require("fs");
    const [pkgPath, name] = process.argv.slice(1);
    if (!fs.existsSync(pkgPath)) process.exit(0);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg.dependencies && pkg.dependencies[name]) {
      delete pkg.dependencies[name];
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  ' "$PROFILE_DIR/package.json" "$PLUGIN_NAME"
  ok "dependencies 已清理"

  # cordis.patch.yml —— 删掉本插件那一段 insert
  PATCH="$PROFILE_DIR/cordis.patch.yml"
  if [ -f "$PATCH" ]; then
    node -e '
      const fs = require("fs");
      const [p, name] = process.argv.slice(1);
      const text = fs.readFileSync(p, "utf8");
      const blocks = text.split(/^(?=- insert:)/m);
      const kept = blocks.filter((b) => !new RegExp("^\\s*-\\s*id:\\s*" + name + "\\s*$", "m").test(b));
      const out = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
      fs.writeFileSync(p, out ? out + "\n" : "");
    ' "$PATCH" "$PLUGIN_NAME"
    ok "cordis.patch.yml 已清理"
  fi
done

if [ -d "$DEST_DIR" ]; then
  rm -rf "$DEST_DIR"
  ok "插件目录已删除：$DEST_DIR"
fi

if [ -d "$DSH_ROOT/anime-theme" ]; then
  printf '    [i]  用户配置保留在：%s（如需一并删除请手动移除）\n' "$DSH_ROOT/anime-theme"
fi

printf '\n卸载完成，重启 DeepSeek Harness 生效。\n\n'
