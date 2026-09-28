. (Join-Path $PSScriptRoot 'dashboard-common.ps1')

try {
    $runtime = Get-CodexUsageRuntimeState
    Write-CodexUsageStatus -State $runtime.State -Message $runtime.Message -Url $runtime.Url
    exit 0
}
catch {
    Write-CodexUsageStatus -State 'failed' -Message $_.Exception.Message
    exit 1
}
