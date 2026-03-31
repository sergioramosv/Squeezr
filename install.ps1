# Squeezr installer for Windows

Write-Host "Installing Squeezr..."
pip install -r requirements.txt

$existing = [System.Environment]::GetEnvironmentVariable("ANTHROPIC_BASE_URL", "User")
if (-not $existing) {
    [System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:8080", "User")
    Write-Host "Set ANTHROPIC_BASE_URL=http://localhost:8080 as user environment variable."
} else {
    Write-Host "ANTHROPIC_BASE_URL already set to: $existing"
}

Write-Host ""
Write-Host "Done. Start Squeezr with:"
Write-Host "  python main.py"
Write-Host ""
Write-Host "Restart your terminal for the env var to take effect."
