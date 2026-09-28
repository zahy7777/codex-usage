. (Join-Path $PSScriptRoot 'dashboard-common.ps1')

try {
    $runtime = Get-CodexUsageRuntimeState
    if ($runtime.State -eq 'running') {
        Write-Output 'Codex Usage 已在运行。'
        exit 0
    }
    if ($runtime.State -eq 'starting') {
        Write-Output 'Codex Usage 正在启动，等待健康检查就绪。'
        exit 0
    }
    if ($runtime.State -eq 'failed') {
        throw $runtime.Message
    }

    $executablePath = $runtime.Settings.ExecutablePath
    if (-not (Test-Path -LiteralPath $executablePath -PathType Leaf)) {
        throw "找不到 Codex Usage 程序：$executablePath"
    }

    $null = Start-Process -FilePath $executablePath -ArgumentList @('daemon') -WindowStyle Hidden -PassThru
    Write-Output '已提交 Codex Usage 启动请求。'
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
