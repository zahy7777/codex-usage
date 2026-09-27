# Conversation

拥有 Codex rollout 事实。`usage/` 扫描与计量去重，`store/` 保存派生用量及元数据，`model/` 定义用量事实，`timezone/` 管理计量日期边界。

`ReadLedger` 组合去重后的聊天、轮次、模型调用用量。调用者提供 Thread ID；提供 Turn ID 及 `offset`、`limit` 时才读取公开正文。轮次消息流保持日志顺序；只有已有调用记录能确认归属时，消息才携带 `response_id`。工具结果通过工具请求的 `call_id` 关联，即使结果先于用量记录落盘也在完整扫描后确认。调用对象不重复携带正文。

旧格式缺少调用身份时保留轮级统计。正文不进入统计库；Dashboard 消费公开结果，不解析 JSONL。
