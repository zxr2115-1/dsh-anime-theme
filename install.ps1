<#
============================================================================
  dsh-anime-theme · DeepSeek Harness 二次元壁纸主题插件 一键安装脚本
============================================================================
  用法（任选其一）：
    1. 右键 install.ps1 -> "使用 PowerShell 运行"
    2. 在 PowerShell 中执行：  .\install.ps1
    3. 双击 install.bat

  脚本依次完成：
    [1] 环境检查（~/.dsh、profile、pnpm）
    [2] 复制插件到 ~/.dsh/plugins/dsh-anime-theme（覆盖更新）
    [3] 时间戳备份 profile package.json 与 cordis.patch.yml
    [4] 写入 dependencies（file: 协议），并确保 bundles 中不含第三方插件
    [5] 在 profile cordis.patch.yml 追加挂载项（幂等）
    [6] 建立 NTFS Junction 实时软链（普通用户权限即可，无需 UAC）
    [7] 执行 pnpm install
    [8] 运行 scripts/check-install.js 闭环自检

  安全边界：
    - 只改动 ~/.dsh/plugins/ 与 ~/.dsh/profiles/<profile>/ 下的文件
    - 改动前一律备份，可随时用 uninstall.ps1 完整还原
    - 全程本地操作，不上传任何数据
============================================================================
#>

[CmdletBinding()]
param(
    [string]$ProfileName
)

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-anime-theme'
$pluginLabel = '二次元壁纸主题'

function Write-Step { param([string]$Message) Write-Host ''; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Message) Write-Host "    [OK] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    [!]  $Message" -ForegroundColor Yellow }
function Write-Err  { param([string]$Message) Write-Host "    [X]  $Message" -ForegroundColor Red }

$dshRoot    = Join-Path $env:USERPROFILE '.dsh'
$pluginsDir = Join-Path $dshRoot 'plugins'
$destDir    = Join-Path $pluginsDir $pluginName
$sourceDir  = $PSScriptRoot

Write-Host ''
Write-Host '====================================================' -ForegroundColor Cyan
Write-Host "  $pluginLabel ($pluginName) 一键安装" -ForegroundColor Cyan
Write-Host '====================================================' -ForegroundColor Cyan

# ---------- [1] 环境检查 ----------
Write-Step '检查环境'

if (-not (Test-Path $dshRoot)) {
    Write-Err "未找到 DSH 根目录：$dshRoot"
    Write-Host '请先安装并启动过一次 DeepSeek Harness（Web 版或 DSH Desktop）再运行本脚本。' -ForegroundColor Red
    exit 1
}
Write-Ok "DSH 根目录：$dshRoot"

$profilesRoot = Join-Path $dshRoot 'profiles'
if (-not (Test-Path $profilesRoot)) {
    Write-Err "未找到 profiles 目录：$profilesRoot"
    exit 1
}

$profileDirs = @()
if ($ProfileName) {
    $candidate = Join-Path $profilesRoot $ProfileName
    if (Test-Path (Join-Path $candidate 'package.json')) { $profileDirs = @($candidate) }
    else { Write-Err "指定的 profile 不存在：$candidate"; exit 1 }
} else {
    if ($env:DSH_PROFILE) {
        $candidate = Join-Path $profilesRoot $env:DSH_PROFILE
        if (Test-Path (Join-Path $candidate 'package.json')) { $profileDirs = @($candidate) }
    }
    if ($profileDirs.Count -eq 0) {
        foreach ($name in @('web', 'default', 'desktop')) {
            $candidate = Join-Path $profilesRoot $name
            if (Test-Path (Join-Path $candidate 'package.json')) { $profileDirs += $candidate }
        }
    }
}

if ($profileDirs.Count -eq 0) {
    Write-Err "在 $profilesRoot 下没有找到任何含 package.json 的 profile 目录。"
    exit 1
}
foreach ($profileDir in $profileDirs) {
    Write-Ok "目标 profile：$(Split-Path $profileDir -Leaf)"
}

$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
    Write-Err '未检测到 pnpm。请先执行：npm install -g pnpm'
    exit 1
}
Write-Ok "pnpm：$($pnpm.Source)"

if (-not (Test-Path (Join-Path $sourceDir 'index.js'))) {
    Write-Err "找不到插件源码（$sourceDir 下没有 index.js），脚本必须放在插件目录内运行。"
    exit 1
}

# ---------- [2] 复制插件 ----------
Write-Step '复制插件文件'

if (-not (Test-Path $pluginsDir)) { New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null }
if (Test-Path $destDir) {
    Write-Warn "已存在旧版本，自动覆盖更新：$destDir"
    Remove-Item -LiteralPath $destDir -Recurse -Force
}

robocopy $sourceDir $destDir /E /NFL /NDL /NJH /NJS /NC /NS /XD .git node_modules /XF install.ps1 install.bat uninstall.ps1 uninstall.bat | Out-Null
if ($LASTEXITCODE -ge 8) {
    Write-Err "复制失败（robocopy 退出码 $LASTEXITCODE）"
    exit 1
}
Write-Ok "插件已复制到：$destDir"

# ---------- 逐 profile 接线 ----------
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

foreach ($profileDir in $profileDirs) {
    $profileKey = Split-Path $profileDir -Leaf
    Write-Step "[$profileKey] 备份并写入 profile 配置"

    $pkgPath = Join-Path $profileDir 'package.json'
    $patchPath = Join-Path $profileDir 'cordis.patch.yml'

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Copy-Item -LiteralPath $pkgPath -Destination "$pkgPath.bak.$stamp" -Force
    Write-Ok "备份：$pkgPath.bak.$stamp"
    if (Test-Path $patchPath) {
        Copy-Item -LiteralPath $patchPath -Destination "$patchPath.bak.$stamp" -Force
        Write-Ok "备份：$patchPath.bak.$stamp"
    }

    # 4a. dependencies
    $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $pkg.dependencies) {
        $pkg | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue (New-Object PSObject)
    }
    $depValue = "file:../../plugins/$pluginName"
    $pkg.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue $depValue -Force
    Write-Ok "dependencies：$pluginName -> $depValue"

    # 4b. bundles 必须不含第三方插件
    if ($pkg.dsh -and $pkg.dsh.profile -and $pkg.dsh.profile.bundles) {
        $bundles = @($pkg.dsh.profile.bundles | Where-Object { $_ -ne $pluginName })
        $pkg.dsh.profile.bundles = $bundles
        Write-Ok "bundles 已清理（第三方插件不进 bundles）"
    }

    $json = $pkg | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($pkgPath, $json + [Environment]::NewLine, $utf8NoBom)
    Write-Ok 'package.json 已写入（无 BOM）'

    # 5. cordis.patch.yml
    $patch = ''
    if (Test-Path $patchPath) {
        $patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
        $patch = $patch -replace '(?m)^\s*\[\]\s*$', ''
    }
    if ($patch -notmatch "(?m)^\s*-\s*id:\s*$pluginName") {
        $block = "- insert:" + [Environment]::NewLine + "    - id: $pluginName" + [Environment]::NewLine + "      name: '$pluginName'"
        $patch = if ($patch.Trim().Length -gt 0) { $patch.Trim() + [Environment]::NewLine + [Environment]::NewLine + $block } else { $block }
        [System.IO.File]::WriteAllText($patchPath, $patch + [Environment]::NewLine, $utf8NoBom)
        Write-Ok 'cordis.patch.yml 已追加挂载项'
    } else {
        Write-Ok 'cordis.patch.yml 已包含挂载项，跳过'
    }

    # 6. Junction 软链
    Write-Step "[$profileKey] 建立 node_modules Junction"
    $nmDir = Join-Path $profileDir 'node_modules'
    if (-not (Test-Path $nmDir)) { New-Item -ItemType Directory -Path $nmDir -Force | Out-Null }
    $nmEntry = Join-Path $nmDir $pluginName
    if (Test-Path $nmEntry) {
        try {
            if ((Get-Item $nmEntry).LinkType -eq 'Junction') { cmd.exe /c "rmdir `"$nmEntry`"" 2>$null | Out-Null }
            else { Remove-Item -LiteralPath $nmEntry -Recurse -Force }
        } catch {
            Remove-Item -LiteralPath $nmEntry -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    cmd.exe /c "mklink /J `"$nmEntry`" `"$destDir`"" 2>$null | Out-Null
    if (Test-Path $nmEntry) { Write-Ok 'Junction 实时软链就绪' } else { Write-Warn 'Junction 建立失败，将依赖 pnpm install 的 file: 拷贝' }

    # 7. pnpm install
    Write-Step "[$profileKey] 安装依赖"
    Push-Location $profileDir
    try {
        pnpm install
        if ($LASTEXITCODE -ne 0) { Write-Warn "pnpm install 退出码 $LASTEXITCODE（已存在 Junction，通常不影响使用）" }
        else { Write-Ok '依赖安装完成' }
    } catch {
        Write-Warn "pnpm 提示：$($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# ---------- [8] 自检 ----------
Write-Step '闭环自检'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    & node (Join-Path $destDir 'scripts\check-install.js')
    if ($LASTEXITCODE -ne 0) { Write-Warn '自检未全部通过，请查看上方失败项' } else { Write-Ok '自检通过' }
} else {
    Write-Warn '未检测到 node，跳过自检'
}

# ---------- [7.5] dsh:// 桌面端一键联动协议 ----------
# 桌面端（EXE）通常自己会注册这个协议；这里只是兜底：
# 万一没注册，用户点市场页面上的「一键安装」按钮就没反应。
Write-Step '检查 dsh:// 一键联动协议'

try {
    $dshExePath = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek-Harness\DeepSeek Harness.exe'
    if (Test-Path $dshExePath) {
        $regPath = 'HKCU:\Software\Classes\dsh'
        if (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
            Set-ItemProperty -Path $regPath -Name '(default)' -Value 'DeepSeek Harness Protocol'
            Set-ItemProperty -Path $regPath -Name 'URL Protocol' -Value ''
            $iconPath = Join-Path $regPath 'DefaultIcon'
            New-Item -Path $iconPath -Force | Out-Null
            Set-ItemProperty -Path $iconPath -Name '(default)' -Value ('"' + $dshExePath + '",0')
            $cmdPath = Join-Path $regPath 'shell\open\command'
            New-Item -Path $cmdPath -Force | Out-Null
            Set-ItemProperty -Path $cmdPath -Name '(default)' -Value ('"' + $dshExePath + '" "%1"')
            Write-Ok '已注册 dsh:// 协议（浏览器可唤起客户端一键安装）'
        } else {
            Write-Ok 'dsh:// 协议已注册，跳过'
        }
    } else {
        Write-Warn "未检测到桌面端 EXE（$dshExePath）——多数情况下桌面端会自己注册，可忽略"
    }
} catch {
    Write-Warn "协议注册失败（可忽略，不影响插件本身）：$($_.Exception.Message)"
}

Write-Host ''
Write-Host '安装完成。' -ForegroundColor Green
Write-Host '最后一步：完全退出并重启 DeepSeek Harness（Web 版刷新页面 / 桌面版重新打开应用），新建会话即可生效。' -ForegroundColor White
Write-Host ''
Write-Host '验证：界面右下角应出现「二次元壁纸 / 换一张 / 开 关 设置」控制坞，壁纸自动加载。' -ForegroundColor Yellow
Write-Host '卸载：运行 uninstall.ps1' -ForegroundColor Yellow
Write-Host ''
Write-Host '一键安装链接（发给别人 / 贴到网页）：' -ForegroundColor White
Write-Host '  dsh://plugin/install?id=dsh-anime-theme&version=1.4.1&repo=zxr2115-1/dsh-anime-theme' -ForegroundColor DarkGray
Write-Host ''

if (-not $env:DSH_NO_PAUSE) {
    try { Read-Host '按回车键退出' } catch { }
}
