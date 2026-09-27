# Pricing

Pricing 拥有模型费率和估算规则。`catalog.go` 与 `pricing.go` 计算 API 等价美元；`credits.go` 用独立价目表及按生效日期配置的覆盖值估算 Codex credits；`fast.go` 定义已证实支持的倍率。缓存读取单独计价，API 缓存写入使用专属费率，credits 将缓存写入计入普通输入。推理 token 已包含在输出中。未知模型或缺少对应历史费率时维持“未定价”。两种估算都不是实际账单或账户余额。

## 费率维护

每周维护时核对 [API Standard 文本费率](https://developers.openai.com/api/docs/pricing)、[Codex Standard credits](https://learn.chatgpt.com/docs/pricing) 和 [Codex Fast 规则](https://learn.chatgpt.com/docs/agent-configuration/speed)。三套规则分别核对，不相互换算。只更新官方来源能证实的值；只有真实变化才更新对应快照日期、执行测试并提交。个人 skill `update-codex-pricing` 记录完整核对与直接推送流程；项目本身只拥有费率事实与估算行为。
