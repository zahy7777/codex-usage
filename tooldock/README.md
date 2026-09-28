# ToolDock 接入

ToolDock 将 Dashboard 作为一个本机网页单体服务管理。Conversation 与 Pricing 是 Dashboard 使用的内部能力，不是独立进程。接入脚本只调用 codex-usage.exe daemon、读取服务配置，并通过 /healthz 检查运行状态；不读取会话正文、数据库或定价配置。

状态脚本组合检查监听端口、端口所属进程的可执行路径和健康端点。导入与刷新只运行只读状态检查。启动会跳过已运行或正在启动的进程；停止只针对已核实为 Codex Usage 的监听进程。

Windows 默认使用 %LOCALAPPDATA%\Programs\codex-usage\codex-usage.exe 和 %LOCALAPPDATA%\codex-usage\config.json。设置 CODEX_USAGE_HOME 时，ToolDock 进程也需继承相同环境变量；程序会从该目录的 bin\codex-usage.exe 与 config.json 读取安装位置和端口。

当前 Dashboard 没有单独的优雅停止接口。停止脚本会在进程路径与配置端口匹配后结束该进程。删除本目录即可移除 ToolDock 接入，不影响项目原有运行方式。
