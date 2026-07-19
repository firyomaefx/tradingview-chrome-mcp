# Start Chrome with remote debugging on port 9222.
# By default this uses a temporary profile for isolation.
# Set TV_ALLOW_REAL_PROFILE=1 to reuse your real Chrome profile (this also
# enables --remote-allow-origins=* which is required for Playwright to connect
# to a real-profile instance on some platforms).
$chrome = $env:TV_CHROME_PATH
if (-not $chrome) {
  $p1 = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
  $p2 = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
  $p3 = "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  if (Test-Path $p1) { $chrome = $p1 }
  elseif (Test-Path $p2) { $chrome = $p2 }
  elseif (Test-Path $p3) { $chrome = $p3 }
}
if (-not $chrome) { throw "Chrome not found. Set TV_CHROME_PATH." }

$allowRealProfile = $env:TV_ALLOW_REAL_PROFILE -eq "1"
if ($allowRealProfile) {
  $udd = if ($env:TV_CHROME_USER_DATA) { $env:TV_CHROME_USER_DATA } else { "$env:LocalAppData\Google\Chrome\User Data" }
  Write-Warning "Reusing the user's real Chrome profile. Set TV_ALLOW_REAL_PROFILE=0 to use a temp profile."
} else {
  $udd = Join-Path $env:TEMP ("tv-mcp-chrome-" + [System.Guid]::NewGuid().ToString("n").Substring(0, 12))
}

$argList = @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$udd",
  "--no-first-run",
  "--no-default-browser-check"
)
if ($allowRealProfile) {
  $argList += "--remote-allow-origins=*"
}

& $chrome @argList "https://www.tradingview.com/chart/"
Write-Host "Chrome started with remote debugging on http://127.0.0.1:9222"
