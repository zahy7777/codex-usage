. (Join-Path $PSScriptRoot 'dashboard-common.ps1')

try {
    $runtime = Get-CodexUsageRuntimeState
    if ($runtime.State -eq 'stopped') {
        Write-Output 'Codex Usage 已停止。'
        exit 0
    }
    if ($runtime.State -eq 'failed') {
        throw $runtime.Message
    }

    foreach ($processId in @($runtime.ProcessIds | Sort-Object -Unique)) {
        $process = Get-CodexUsageProcess -ProcessId ([int]$processId)
        if ($null -eq $process) {
            continue
        }
        if (-not (Test-CodexUsagePath -CandidatePath $process.ExecutablePath -ExpectedPath $runtime.Settings.ExecutablePath)) {
            throw "进程 $processId 的程序路径与已安装的 Codex Usage 不一致；未停止该进程。"
        }

        Stop-Process -Id ([int]$processId) -ErrorAction Stop
        $deadline = [DateTime]::UtcNow.AddSeconds(10)
        while ([DateTime]::UtcNow -lt $deadline) {
            $remaining = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
            if ($null -eq $remaining) {
                break
            }
            Start-Sleep -Milliseconds 200
        }
        if ($null -ne (Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue)) {
            throw "等待 Codex Usage 进程 $processId 退出超时。"
        }
    }

    $finalState = Get-CodexUsageRuntimeState
    if ($finalState.State -notin @('stopped')) {
        throw "停止后状态仍为 $($finalState.State)：$($finalState.Message)"
    }

    Write-Output 'Codex Usage 已停止。'
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
