# ==============================================================================
# Clutch Arena - PartyKit Edge Multiplayer Deployment Script
# ==============================================================================
$ErrorActionPreference = "Stop"

Write-Host "🎈 ==========================================================" -ForegroundColor Cyan
Write-Host "   CLUTCH ARENA - PARTYKIT EDGE DEPLOYMENT SETUP" -ForegroundColor Yellow
Write-Host "   Deploys sub-30ms Edge WebSockets for Multiplayer Arena" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check PartyKit CLI availability
Write-Host "🔍 [1/4] Checking PartyKit CLI..." -ForegroundColor White
$pkVersion = npx partykit --version 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ PartyKit is not installed or accessible via npx." -ForegroundColor Red
    exit 1
}
Write-Host "   ✅ PartyKit CLI version: v$pkVersion" -ForegroundColor Green
Write-Host ""

# 2. Check Login Status
Write-Host "🔑 [2/4] Verifying PartyKit Authentication..." -ForegroundColor White
$whoami = npx partykit whoami 2>&1 | Out-String

if ($whoami -match "Not logged in") {
    Write-Host "   ⚠️  You are not logged in to PartyKit yet." -ForegroundColor Yellow
    Write-Host "   A browser window will open in a moment for 1-click GitHub / Email login." -ForegroundColor Yellow
    Write-Host ""
    $prompt = Read-Host "   Press Enter to open the login window (or Ctrl+C to cancel)"
    
    npx partykit login
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Login failed or was cancelled." -ForegroundColor Red
        exit 1
    }
    
    $whoami = npx partykit whoami 2>&1 | Out-String
}

Write-Host "   ✅ Authenticated!" -ForegroundColor Green
$whoamiLines = $whoami.Split("`n") | Where-Object { $_.Trim() -ne "" -and $_ -notmatch "PartyKit" -and $_ -notmatch "---" }
foreach ($line in $whoamiLines) {
    Write-Host "   $($line.Trim())" -ForegroundColor Gray
}
Write-Host ""

# 3. Deploy to PartyKit Cloud
Write-Host "🚀 [3/4] Deploying party/arena.ts to PartyKit Edge Network..." -ForegroundColor White
Write-Host "   Compiling room state, bot timers, and edge storage..." -ForegroundColor Gray
Write-Host ""

$deployOutput = $null
try {
    $deployOutput = npx partykit deploy 2>&1 | Tee-Object -Variable rawOutput
} catch {
    # Caught below
}

$rawString = ($rawOutput | Out-String)

if ($rawString -match "hosted PartyKit platform shut down") {
    Write-Host ""
    Write-Host "ℹ️  NOTICE: PartyKit's legacy hosted cloud service (partykit.dev) was retired on Oct 23, 2026." -ForegroundColor Yellow
    Write-Host "   PartyKit has moved to PartyServer (on your own Cloudflare account)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "🎉 GOOD NEWS: Clutch Arena already has built-in Supabase Realtime + SSE fallback!" -ForegroundColor Green
    Write-Host "   You do NOT need partykit.dev to run multiplayer." -ForegroundColor Green
    Write-Host "   Multiplayer runs out-of-the-box on your Vercel deployment and Supabase database." -ForegroundColor White
    Write-Host ""
    Write-Host "👉 Leave NEXT_PUBLIC_PARTYKIT_HOST blank in .env.local and Vercel to use the built-in engine." -ForegroundColor Cyan
    exit 0
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ Deployment encountered an error. Review the log above." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "   ✅ Edge WebSocket Deployment Complete!" -ForegroundColor Green
Write-Host ""

# 4. Extract or Prompt for Deployed Host
Write-Host "⚙️ [4/4] Configuring Environment Variables..." -ForegroundColor White

$detectedHost = ""
foreach ($line in $rawOutput) {
    if ($line -match "https?://([a-zA-Z0-9_\-\.]+\.partykit\.dev)") {
        $detectedHost = $Matches[1]
        break
    }
}

if (-not $detectedHost) {
    Write-Host "   Please enter the deployed PartyKit host shown above" -ForegroundColor Yellow
    Write-Host "   (Example: clutch-arena.yourusername.partykit.dev)" -ForegroundColor Gray
    $detectedHost = Read-Host "   Host"
}

if ($detectedHost) {
    # Clean protocol if user pasted with https://
    $cleanHost = $detectedHost.Replace("https://", "").Replace("http://", "").TrimEnd("/")
    
    $envPath = Join-Path $PSScriptRoot "..\.env.local"
    if (Test-Path $envPath) {
        $envContent = Get-Content $envPath -Raw
        if ($envContent -match "NEXT_PUBLIC_PARTYKIT_HOST=.*") {
            $updatedContent = $envContent -replace "NEXT_PUBLIC_PARTYKIT_HOST=.*", "NEXT_PUBLIC_PARTYKIT_HOST=$cleanHost"
            Set-Content -Path $envPath -Value $updatedContent -NoNewline
            Write-Host "   ✅ Updated NEXT_PUBLIC_PARTYKIT_HOST in .env.local to: $cleanHost" -ForegroundColor Green
        } else {
            Add-Content -Path $envPath -Value "`nNEXT_PUBLIC_PARTYKIT_HOST=$cleanHost"
            Write-Host "   ✅ Appended NEXT_PUBLIC_PARTYKIT_HOST to .env.local: $cleanHost" -ForegroundColor Green
        }
    }
    
    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "🎉 PARTYKIT DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
    Write-Host "   Host: $cleanHost" -ForegroundColor White
    Write-Host ""
    Write-Host "👉 Next step for Vercel production deployment:" -ForegroundColor Yellow
    Write-Host "   Add this environment variable in your Vercel Dashboard:" -ForegroundColor White
    Write-Host "   NEXT_PUBLIC_PARTYKIT_HOST = $cleanHost" -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
}
