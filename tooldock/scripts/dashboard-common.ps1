Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8WithoutBom
$OutputEncoding = $utf8WithoutBom

function Get-CodexUsageSettings {
    $integrationDirectory = Split-Path -Parent $PSScriptRoot
    $configuredProjectRoot = [Environment]::GetEnvironmentVariable('TOOLDOCK_PROJECT_ROOT', 'Process')
    if ([string]::IsNullOrWhiteSpace($configuredProjectRoot)) {
        $projectRoot = [IO.Path]::GetFullPath((Join-Path $integrationDirectory '..'))
    }
    else {
        $projectRoot = [IO.Path]::GetFullPath($configuredProjectRoot)
    }

    $customHome = [Environment]::GetEnvironmentVariable('CODEX_USAGE_HOME', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($customHome)) {
        $stateDirectory = [IO.Path]::GetFullPath($customHome.Trim())
        $installedExecutablePath = Join-Path $stateDirectory 'bin\codex-usage.exe'
    }
    else {
        $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
        if ([string]::IsNullOrWhiteSpace($localAppData)) {
            throw '无法确定 Windows 用户的 LOCALAPPDATA 目录。'
        }

        $stateDirectory = Join-Path $localAppData 'codex-usage'
        $installedExecutablePath = Join-Path $localAppData 'Programs\codex-usage\codex-usage.exe'
    }
    $projectExecutablePath = Join-Path $integrationDirectory 'runtime\codex-usage.exe'
    $executablePath = if (Test-Path -LiteralPath $installedExecutablePath -PathType Leaf) {
        $installedExecutablePath
    }
    else {
        $projectExecutablePath
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
        InstalledExecutablePath = [IO.Path]::GetFullPath($installedExecutablePath)
        ProjectExecutablePath = [IO.Path]::GetFullPath($projectExecutablePath)
        ProjectRoot    = $projectRoot
        Port           = $port
        BaseUrl        = "http://127.0.0.1:$port"
    }
}

function Get-CodexUsageGoExecutable {
    $configuredGo = [Environment]::GetEnvironmentVariable('CODEX_USAGE_GO', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($configuredGo)) {
        $configuredPath = [IO.Path]::GetFullPath($configuredGo.Trim())
        if (Test-Path -LiteralPath $configuredPath -PathType Leaf) {
            return $configuredPath
        }
        throw "CODEX_USAGE_GO 指向的文件不存在：$configuredPath"
    }

    foreach ($commandName in @('go.exe', 'go')) {
        $command = Get-Command -Name $commandName -CommandType Application -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($null -ne $command) {
            return $command.Source
        }
    }

    $candidates = @()
    $localAppData = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        $toolchainsDirectory = Join-Path $localAppData 'codex-usage-tools'
        if (Test-Path -LiteralPath $toolchainsDirectory -PathType Container) {
            $candidates += Get-ChildItem -LiteralPath $toolchainsDirectory -Directory -Filter 'go*' |
                Sort-Object -Property Name -Descending |
                ForEach-Object { Join-Path $_.FullName 'bin\go.exe' }
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += Join-Path $env:ProgramFiles 'Go\bin\go.exe'
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }

    throw '找不到 Go 1.26。请安装 Go，或设置 CODEX_USAGE_GO 指向 go.exe。'
}

function Build-CodexUsageFromSource {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Settings
    )

    if (-not (Test-Path -LiteralPath (Join-Path $Settings.ProjectRoot 'go.mod') -PathType Leaf)) {
        throw "项目根目录中找不到 go.mod：$($Settings.ProjectRoot)"
    }

    $goExecutable = Get-CodexUsageGoExecutable
    $runtimeDirectory = Split-Path -Parent $Settings.ProjectExecutablePath
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

    $previousToolchain = [Environment]::GetEnvironmentVariable('GOTOOLCHAIN', 'Process')
    $previousProxy = [Environment]::GetEnvironmentVariable('GOPROXY', 'Process')
    $buildOutput = @()
    $buildExitCode = 1
    $locationPushed = $false
    try {
        $env:GOTOOLCHAIN = 'local'
        $env:GOPROXY = 'off'
        Push-Location -LiteralPath $Settings.ProjectRoot
        $locationPushed = $true
        $buildOutput = @(& $goExecutable build -mod=readonly -o $Settings.ProjectExecutablePath ./cmd/codex-usage 2>&1)
        $buildExitCode = $LASTEXITCODE
    }
    finally {
        if ($locationPushed) {
            Pop-Location
        }
        if ($null -eq $previousToolchain) {
            Remove-Item Env:GOTOOLCHAIN -ErrorAction SilentlyContinue
        }
        else {
            $env:GOTOOLCHAIN = $previousToolchain
        }
        if ($null -eq $previousProxy) {
            Remove-Item Env:GOPROXY -ErrorAction SilentlyContinue
        }
        else {
            $env:GOPROXY = $previousProxy
        }
    }

    if ($buildExitCode -ne 0 -or -not (Test-Path -LiteralPath $Settings.ProjectExecutablePath -PathType Leaf)) {
        $details = ($buildOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        if ([string]::IsNullOrWhiteSpace($details)) {
            $details = 'Go 没有生成可执行文件。'
        }
        throw "从本地源码构建 Codex Usage 失败（退出码 $buildExitCode）：$details"
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
        $message = 'Codex Usage 当前已停止；点击启动时会从当前仓库构建本地程序。'
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
