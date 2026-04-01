# Squeezr installer for Windows
# Requires: Node.js 18+, npm install -g squeezr-ai already done (or run from repo)

$TaskName = "Squeezr"

# Resolve squeezr binary
$SqueezrExe = (Get-Command squeezr -ErrorAction SilentlyContinue)?.Source
if (-not $SqueezrExe) {
    Write-Host "ERROR: 'squeezr' not found in PATH. Run: npm install -g squeezr-ai" -ForegroundColor Red
    exit 1
}

Write-Host "Found Squeezr at: $SqueezrExe"

# Set ANTHROPIC_BASE_URL as persistent user env var
$existing = [System.Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "User")
if (-not $existing) {
    [System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:8080", "User")
    Write-Host "Set ANTHROPIC_BASE_URL=http://localhost:8080 (user environment)."
} else {
    Write-Host "ANTHROPIC_BASE_URL already set to: $existing"
}

# Register Task Scheduler task (auto-start on login, restart on failure)
$existing_task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing_task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Replaced existing Squeezr task."
}

$action   = New-ScheduledTaskAction -Execute $SqueezrExe -Argument "start"
$trigger  = New-ScheduledTaskTrigger -AtLogon
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

# Start it now without waiting for next login
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Done. Squeezr is running and will auto-start on every login." -ForegroundColor Green
Write-Host "Restart your terminal for ANTHROPIC_BASE_URL to take effect."
Write-Host ""
Write-Host "To check status:  Get-ScheduledTask -TaskName Squeezr"
Write-Host "To stop:          Stop-ScheduledTask -TaskName Squeezr"
Write-Host "To uninstall:     Unregister-ScheduledTask -TaskName Squeezr -Confirm:`$false"
