# Pricing

Pricing 拥有模型费率和估算规则。`catalog.go` 与 `pricing.go` 计算 API 等价美元；`credits.go` 用独立价目表及按生效日期配置的覆盖值估算 Codex credits；`fast.go` 定义已证实支持的倍率。缓存读取单独计价，API 缓存写入使用专属费率，credits 将缓存写入计入普通输入。Fast 的订阅内额度倍率与购入 credits 计费倍率分别处理。推理 token 已包含在输出中。未知模型或缺少对应历史费率时维持“未定价”。两种估算都不是实际账单或账户余额。

## 费率维护

每周维护时核对 [API Standard 文本费率](https://developers.openai.com/api/docs/pricing)、[Codex Standard credits](https://learn.chatgpt.com/docs/pricing) 和 [Codex Fast 规则](https://learn.chatgpt.com/docs/agent-configuration/speed)。三套规则分别核对，不相互换算。只更新官方来源能证实的值；只有真实变化才更新对应快照日期、执行测试并提交。个人 skill `update-codex-pricing` 记录完整核对与直接推送流程；项目本身只拥有费率事实与估算行为。

2026-09-28 核对：API Standard 短上下文文本表与 [GPT-5.6 Sol 模型页](https://developers.openai.com/api/docs/models/gpt-5.6-sol) 一致，Sol 输入／缓存读取／缓存写入／输出从 5／0.5／6.25／30 调整为 4／0.4／5／20 USD / 1M token。模型页确认 `gpt-5.6` 别名指向 Sol，缓存写入为普通输入的 1.25 倍，并说明优惠至少持续到 2026-11-21；未提供明确生效日，因此 API 快照记录核对日期，不推断历史改价。其余内置 API 费率、Codex Standard credits 与 Fast 倍率均未变，保留各自快照日期和用户覆盖能力。

2026-10-05 核对：新增 [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 的明确模型 ID `gpt-6.1-sol`；官方尚未列出日期快照名，因此只识别此 ID。其 [API Standard 短上下文文本价格](https://developers.openai.com/api/docs/pricing)为输入／缓存读取／缓存写入／输出 2／0.1／2.5／10 USD / 1M token；[Codex Standard](https://learn.chatgpt.com/docs/pricing) 为输入／缓存读取／输出 50／2.5／250 credits / 1M token；[Codex Fast](https://learn.chatgpt.com/docs/agent-configuration/speed) 对购入 credits 按 Standard 的 2 倍计费，对订阅内额度按 2.5 倍消耗。因此纠正 Fast 的 credits 估算，旧代码误用了订阅内额度倍率。原有已发布单价未见数值变化。当前 Codex 表未列 GPT-5.4 与 GPT-5.4 mini 的 credits，也未明确 GPT-5.4 Fast 是否仍可用；仅凭缺席不改旧快照或历史估算。

2026-10-26 核对：API Standard 短上下文文本费率未变；GPT-5.5 模型页仍为输入／缓存读取／输出 5／0.5／30 USD / 1M token，且 API 不受 Codex 退休影响，因此保留 API 目录。ChatGPT 定价页明确 GPT-5.5 已于 2026-10-14 19:00 UTC 从 ChatGPT 登录的 Codex 退休，当前 Codex Standard 表也不再列出该模型；据此移除 Codex Standard credits 默认费率和 Fast 支持，用户可用覆盖费率继续处理历史或内部映射。当前表新增 Daybreak Blue/Red 与 GPT-Rosalind-Research，但没有项目身份映射，不自动加入。[Fast 规则](https://learn.chatgpt.com/docs/agent-configuration/speed)仍为订阅内额度 2.5 倍、购入 credits 2 倍；GPT-5.6 仍支持 Fast，页面所述 1.5 倍是速度提升而非计费倍率。快照日期更新为核对日。
