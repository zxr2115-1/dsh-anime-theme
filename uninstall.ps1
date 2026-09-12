<#
============================================================================
  dsh-anime-theme 卸载脚本：移除软链、依赖声明、挂载项与插件目录
============================================================================
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$pluginName = 'dsh-anime-theme'
$dshRoot = Join-Path $env:USERPROFILE '.dsh'
$pluginsDir = Join-Path $dshRoot 'plugins'
$destDir = Join-Path $pluginsDir $pluginName
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

Write-Host ''
Write-Host '=== 卸载 dsh-anime-theme ===' -ForegroundColor Cyan

foreach ($name in @('web', 'default', 'desktop')) {
    $profileDir = Join-Path $dshRoot "profiles\$name"
    if (-not (Test-Path (Join-Path $profileDir 'package.json'))) { continue }
    Write-Host "  -> profile: $name" -ForegroundColor White

    # 软链
    $nmEntry = Join-Path $profileDir "node_modules\$pluginName"
    if (Test-Path $nmEntry) {
        try { cmd.exe /c "rmdir `"$nmEntry`"" 2>$null | Out-Null } catch { }
        if (Test-Path $nmEntry) { Remove-Item -LiteralPath $nmEntry -Recurse -Force -ErrorAction SilentlyContinue }
        Write-Host '     [OK] 软链已移除' -ForegroundColor Green
    }

    # package.json
    $pkgPath = Join-Path $profileDir 'package.json'
    $pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pkg.dependencies -and ($pkg.dependencies.PSObject.Properties.Name -contains $pluginName)) {
        $pkg.dependencies.PSObject.Properties.Remove($pluginName)
        [System.IO.File]::WriteAllText($pkgPath, ($pkg | ConvertTo-Json -Depth 10) + [Environment]::NewLine, $utf8NoBom)
        Write-Host '     [OK] dependencies 已清理' -ForegroundColor Green
    }

    # cordis.patch.yml
    $patchPath = Join-Path $profileDir 'cordis.patch.yml'
    if (Test-Path $patchPath) {
        $patch = [System.IO.File]::ReadAllText($patchPath, [System.Text.Encoding]::UTF8)
        $pattern = "(?m)^\s*-\s*insert:\s*\r?\n\s*-\s*id:\s*$pluginName[\s\S]*?(?=(^\s*-\s*insert:|\z))"
        $next = ($patch -replace $pattern, '').Trim()
        [System.IO.File]::WriteAllText($patchPath, $next + [Environment]::NewLine, $utf8NoBom)
        Write-Host '     [OK] cordis.patch.yml 已清理' -ForegroundColor Green
    }
}

if (Test-Path $destDir) {
    Remove-Item -LiteralPath $destDir -Recurse -Force
    Write-Host "  [OK] 插件目录已删除：$destDir" -ForegroundColor Green
}

$configDir = Join-Path $dshRoot 'anime-theme'
if (Test-Path $configDir) {
    Write-Host "  [i]  用户配置保留在：$configDir（如需一并删除请手动移除）" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '卸载完成，重启 DeepSeek Harness 生效。' -ForegroundColor Green
Write-Host ''
