Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-CodexUsageSettings {
    $customHome = [Environment]::GetEnvironmentVariable('CODEX_USAGE_HOME', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($customHome)) {
        $stateDirectory = [IO.Path]::GetFullPath($customHome.Trim())
        $executablePath = Join-Path $stateDirectory 'bin\codex-usage.exe'
    }
    else {
        $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
        if ([string]::IsNullOrWhiteSpace($localAppData)) {
            throw '无法确定 Windows 用户的 LOCALAPPDATA 目录。'
        }

        $stateDirectory = Join-Path $localAppData 'codex-usage'
        $executablePath = Join-Path $localAppData 'Programs\codex-usage\codex-usage.exe'
    }

    $listenAddress = '127.0.0.1'
    $port = 43189
    $configPath = Join-Path $stateDirectory 'config.json'
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $configuration = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        catch {
            throw "无法读取 Dashboard 配置：$($_.Exception.Message)"
        }

        $listenProperty = $configuration.PSObject.Properties['listen_address']
        if ($null -ne $listenProperty -and -not [string]::IsNullOrWhiteSpace([string]$listenProperty.Value)) {
            $listenAddress = [string]$listenProperty.Value
        }
        $portProperty = $configuration.PSObject.Properties['port']
        if ($null -ne $portProperty -and $null -ne $portProperty.Value) {
            try {
                $port = [int]$portProperty.Value
            }
            catch {
                throw 'Dashboard 配置中的端口无效。'
            }
        }
    }

    if ($listenAddress -notin @('127.0.0.1', 'localhost')) {
        throw "拒绝管理非本机监听地址：$listenAddress"
    }
    if ($port -lt 1 -or $port -gt 65535) {
        throw "Dashboard 配置中的端口无效：$port"
    }

    [pscustomobject]@{
        StateDirectory = $stateDirectory
        ConfigPath     = $configPath
        ExecutablePath = [IO.Path]::GetFullPath($executablePath)
        Port           = $port
        BaseUrl        = "http://127.0.0.1:$port"
    }
}

function Test-CodexUsagePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CandidatePath,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedPath
    )

    if ([string]::IsNullOrWhiteSpace($CandidatePath)) {
        return $false
    }

    try {
        $candidate = [IO.Path]::GetFullPath($CandidatePath)
        $expected = [IO.Path]::GetFullPath($ExpectedPath)
        return [string]::Equals($candidate, $expected, [StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-CodexUsageProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId
    )

    $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    if ($null -eq $process) {
        return $null
    }

    [pscustomobject]@{
        Id             = [int]$process.ProcessId
        ExecutablePath = [string]$process.ExecutablePath
        CommandLine    = [string]$process.CommandLine
    }
}

function Test-CodexUsageHealth {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    try {
        $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz" -TimeoutSec 2
        return $health.ok -eq $true
    }
    catch {
        return $false
    }
}

function Get-CodexUsageRuntimeState {
    $settings = Get-CodexUsageSettings
    $connections = @(
        Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $settings.Port -State Listen -ErrorAction SilentlyContinue
    )
    $listenerIds = @(
        $connections |
            ForEach-Object { [int]$_.OwningProcess } |
            Sort-Object -Unique
    )

    if ($listenerIds.Count -gt 1) {
        return [pscustomobject]@{
            State      = 'failed'
            Message    = "端口 $($settings.Port) 对应多个监听进程，无法安全确认服务身份。"
            Url        = $settings.BaseUrl
            ProcessIds = $listenerIds
            Settings   = $settings
        }
    }

    if ($listenerIds.Count -eq 1) {
        $process = Get-CodexUsageProcess -ProcessId $listenerIds[0]
        if ($null -eq $process) {
            return [pscustomobject]@{
                State      = 'failed'
                Message    = '无法读取监听进程身份，未确认其属于 Codex Usage。'
                Url        = $settings.BaseUrl
                ProcessIds = $listenerIds
                Settings   = $settings
            }
        }

        if (-not (Test-CodexUsagePath -CandidatePath $process.ExecutablePath -ExpectedPath $settings.ExecutablePath)) {
            return [pscustomobject]@{
                State      = 'failed'
                Message    = "端口 $($settings.Port) 被其他程序占用；为避免误操作，未管理该进程。"
                Url        = $settings.BaseUrl
                ProcessIds = $listenerIds
                Settings   = $settings
            }
        }

        if (Test-CodexUsageHealth -BaseUrl $settings.BaseUrl) {
            return [pscustomobject]@{
                State      = 'running'
                Message    = 'Codex Usage 正在运行。'
                Url        = $settings.BaseUrl
                ProcessIds = $listenerIds
                Settings   = $settings
            }
        }

        return [pscustomobject]@{
            State      = 'starting'
            Message    = '已发现 Codex Usage 监听进程，健康端点尚未就绪。'
            Url        = $settings.BaseUrl
            ProcessIds = $listenerIds
            Settings   = $settings
        }
    }

    $matchingDaemons = @(
        Get-CimInstance -ClassName Win32_Process -Filter "Name = 'codex-usage.exe'" -ErrorAction Stop |
            Where-Object {
                (Test-CodexUsagePath -CandidatePath ([string]$_.ExecutablePath) -ExpectedPath $settings.ExecutablePath) -and
                ([string]$_.CommandLine -match '(?i)(?:^|\s)daemon(?:\s|$)')
            }
    )
    $daemonIds = @($matchingDaemons | ForEach-Object { [int]$_.ProcessId } | Sort-Object -Unique)
    if ($daemonIds.Count -gt 1) {
        return [pscustomobject]@{
            State      = 'failed'
            Message    = '发现多个 Dashboard 后台进程，但没有进程监听配置端口。'
            Url        = $settings.BaseUrl
            ProcessIds = $daemonIds
            Settings   = $settings
        }
    }
    if ($daemonIds.Count -eq 1) {
        return [pscustomobject]@{
            State      = 'starting'
            Message    = 'Dashboard 后台进程正在启动。'
            Url        = $settings.BaseUrl
            ProcessIds = $daemonIds
            Settings   = $settings
        }
    }

    $message = 'Codex Usage 当前已停止。'
    if (-not (Test-Path -LiteralPath $settings.ExecutablePath -PathType Leaf)) {
        $message = 'Codex Usage 当前未运行；找不到已安装的程序，启动前请先安装。'
    }

    [pscustomobject]@{
        State      = 'stopped'
        Message    = $message
        Url        = $settings.BaseUrl
        ProcessIds = @()
        Settings   = $settings
    }
}

function Write-CodexUsageStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string]$State,
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [string]$Url
    )

    $result = [ordered]@{
        state   = $State
        message = $Message
    }
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        $result.url = $Url
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
}
