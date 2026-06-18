# start-grab.ps1 — launches the Grab downloader + its public tunnel.
# Registered to run at logon so the site is always available after a reboot.

$ErrorActionPreference = "SilentlyContinue"
$root   = "G:\Claude\yt-downloader"
$node   = (Get-Command node).Source
$ngrok  = "C:\Users\vickr\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
$domain = (Get-Content "$root\grab-domain.txt" -ErrorAction SilentlyContinue).Trim()

# Point the server at the aria2c accelerator (winget install location).
$aria = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\aria2*\aria2c.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($aria) { $env:ARIA2C_PATH = $aria.FullName }

# 1. Start the Node server on :3000 if it isn't already up.
$up = $false
try { $up = (Invoke-WebRequest "http://localhost:3000" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
if (-not $up) {
  Start-Process -FilePath $node -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden
  Start-Sleep -Seconds 3
}

# 2. Start the ngrok tunnel on the reserved static domain.
Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
if ($domain) {
  Start-Process -FilePath $ngrok -ArgumentList "http","--domain=$domain","3000" -WindowStyle Hidden
  Write-Host "Grab is live at https://$domain"
} else {
  Start-Process -FilePath $ngrok -ArgumentList "http","3000" -WindowStyle Hidden
  Write-Host "No reserved domain set (grab-domain.txt empty) — using a random ngrok URL."
}
