# Start Chrome with remote debugging on port 9222 using your real profile.
# Close all other Chrome windows first or the debug flag is ignored.
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
$udd = if ($env:TV_CHROME_USER_DATA) { $env:TV_CHROME_USER_DATA } else { "$env:LocalAppData\Google\Chrome\User Data" }
$argList = @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$udd",
  "--remote-allow-origins=*",
  "--no-first-run",
  "--no-default-browser-check"
)
& $chrome @argList "https://www.tradingview.com/chart/"
Write-Host "Chrome started with remote debugging on http://127.0.0.1:9222"
