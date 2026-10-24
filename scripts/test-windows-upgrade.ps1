param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP 'fastaiapi-install-acceptance'
$install = Join-Path $root 'Programs with spaces\Codex++'
$env:CODEX_PLUS_STATE_DIR = Join-Path $root 'upgrade-test-state'
$env:CODEX_HOME = Join-Path $env:CODEX_PLUS_STATE_DIR 'codex-home'
$env:CODEX_PLUS_MANAGER_GUARD_PORT = '63172'
$env:CODEX_PLUS_LAUNCHER_GUARD_PORT = '63173'
New-Item -ItemType Directory -Force $root | Out-Null
$probe = (Resolve-Path 'target/release/examples/upgrade_state_probe.exe').Path
$report = [ordered]@{ platform = 'windows-x64'; checks = @() }
function Check([string]$Name, [scriptblock]$Body) {
  & $Body
  $script:report.checks += $Name
  Write-Output "PASS $Name"
}
function Install([string]$Package) {
  $process = Start-Process -FilePath $Package -ArgumentList @('/S', "/D=$install") -PassThru
  if (-not $process.WaitForExit(120000)) { throw '安装程序超时' }
  if ($process.ExitCode -ne 0) { throw "安装失败: $($process.ExitCode)" }
  if (-not (Test-Path "$install/codex-plus-plus.exe")) { throw '主程序缺失' }
}
function Probe([string]$Action) {
  & $probe $Action
  if ($LASTEXITCODE -ne 0) { throw "持久化验收失败: $Action" }
}
function Snapshot {
  $map = @{}
  foreach ($file in @('settings.json','codex-home/config.toml','codex-home/auth.json','watcher.disabled')) {
    $map[$file] = (Get-FileHash (Join-Path $env:CODEX_PLUS_STATE_DIR $file) -Algorithm SHA256).Hash
  }
  return $map
}
function Assert-Snapshot($Before) {
  $after = Snapshot
  foreach ($file in $Before.Keys) { if ($Before[$file] -ne $after[$file]) { throw '用户配置文件被安装器改写' } }
}
function Launch-Client {
  $p = Start-Process -FilePath "$install/codex-plus-plus.exe" -PassThru
  try {
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Milliseconds 500
      $p.Refresh()
      if ($p.HasExited) { throw "应用提前退出: $($p.ExitCode)" }
      if ($p.MainWindowHandle -ne 0 -and $p.Responding) { $ready = $true; break }
    }
    if (-not $ready) { throw '未检测到可响应的应用窗口' }
    Write-Output 'WINDOW_RESPONDING_OK'
  } finally {
    # 只关闭本测试新建的进程；不按名称结束其他进程。
    if (-not $p.HasExited) {
      $null = $p.CloseMainWindow()
      if (-not $p.WaitForExit(10000)) { $p.Kill(); $p.WaitForExit() }
    }
  }
}
$old = Join-Path $root 'CodexPlusPlus-1.11.3-windows-x64-setup.exe'
Invoke-WebRequest -Uri 'https://fastaiapi.cloud/fastaiapi/downloads/codexplus/1.11.3/9f9ee02dbdd80ad0b054f5ff7b6382089289ea88ab38963c1c32a6e05d660166/CodexPlusPlus-1.11.3-windows-x64-setup.exe' -OutFile $old
if ((Get-FileHash $old -Algorithm SHA256).Hash.ToLower() -ne '9f9ee02dbdd80ad0b054f5ff7b6382089289ea88ab38963c1c32a6e05d660166') { throw '旧版安装包校验失败' }
try {
  Check 'fresh-install-1.11.3-from-own-website' { Install $old }
  Check 'old-client-window-starts' { Launch-Client }
  # 1.11.3 的 Windows 登录只在内存，不能凭空恢复它没有保存的会话。
  # 合成凭据用新版真实系统凭据 API 写入，验证覆盖安装不会删除已保存的凭据。
  Check 'seed-native-credentials-and-config' { Probe 'seed' }
  $before = Snapshot
  $oldExeHash = (Get-FileHash "$install/codex-plus-plus.exe").Hash
  Check 'upgrade-to-candidate' { Install (Resolve-Path $Installer).Path }
  Check 'actual-executable-was-replaced' {
    if ($oldExeHash -eq (Get-FileHash "$install/codex-plus-plus.exe").Hash) { throw '主程序没有更新' }
  }
  Check 'upgrade-keeps-config-bytes' { Assert-Snapshot $before }
  Check 'upgrade-keeps-session-and-remembered-login' { Probe 'verify' }
  Check 'new-client-window-starts' { Launch-Client }
  Check 'restart-keeps-session-and-settings' { Probe 'verify' }
  Check 'same-version-reinstall' { Install (Resolve-Path $Installer).Path }
  Check 'reinstall-keeps-config-and-credentials' { Assert-Snapshot $before; Probe 'verify' }
  Check 'logout-keeps-remembered-account' { Probe 'logout' }
  Check 'forget-is-idempotent' { Probe 'forget' }
  $registered = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\CodexPlusPlus'
  Check 'registered-install-dir-is-preserved' { if ($registered.InstallLocation -ne $install) { throw '升级改变安装目录' } }
  $report.version = $registered.DisplayVersion
  $report.installer_sha256 = (Get-FileHash $Installer).Hash.ToLower()
  $report | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $root 'result.json') -Encoding utf8
} finally {
  Probe 'forget'
}
