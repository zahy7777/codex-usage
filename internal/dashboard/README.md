# Dashboard

负责本机应用与呈现。`app/` 管理 CLI、Stop 通知及服务生命周期；`server/` 组合公开 API；`web/` 管理界面与聊天详情弹窗。`config/`、`platform/`、`updater/`、`cliui/` 支持运行管理。

`/api/v1/ledger` 从 Conversation 获取三级用量和按需正文，再从 Pricing 获取两种独立估算。弹窗的四色条分别为缓存输入、非缓存输入（含缓存写入）、推理输出、直接输出，总和等于总 Token。悬浮、聚焦和点击只激活一张计量卡片；顶部保留紧凑父级投影，避免长轮次把祖先色带滚出视野。正文只来自分页轮次消息流，按已确认的 `response_id` 分配到调用卡片，不重复展示。用户提问仅显示明确标注的所属轮次用量。

`/api/v1/pricing/credits` 管理带生效日期的本机费率。Stop 通知触发增量扫描，定期扫描补齐遗漏。JSONL 解析属于 Conversation。
