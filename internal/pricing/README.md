# Pricing

Owns rate definitions and estimates. `pricing.go` and the embedded catalog calculate API-equivalent USD; `credits.go` calculates Codex credits from a separate current catalog or effective-date overrides. Cache reads have their own rate; API cache writes use the API rule, while credits treat them as input. Reasoning output is already included in output. Unrecognized models or missing historical overrides remain unpriced. Neither estimate is an actual bill or account quota.
