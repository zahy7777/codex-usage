# Project boundaries

This fork extends Codex Usage with a local three-level ledger: thread, turn, and model response.

## Concepts

- **Conversation** owns rollout discovery, immutable thread/turn/response identity, token accounting, fork deduplication, and on-demand access to visible user, assistant, and tool content. It stores only derived usage and metadata. It never stores transcript bodies in SQLite or exports them with usage data.
- **Pricing** owns model rate schedules and estimates. API-equivalent USD and Codex-credit estimates are separate; neither is an actual bill. Unknown model or rate yields an unknown estimate.
- **Dashboard** owns loopback API, web UI, CLI operation, service lifecycle, and Stop-hook notification. It gets conversation and pricing facts through their public operations, and never interprets rollout JSONL itself.
- **cmd** assembles these capabilities for the executable and hook entry.

## Dependencies

Dashboard -> Conversation, Pricing. Pricing -> Conversation's public token usage type. Conversation has no Dashboard or Pricing dependency. Entry points assemble concrete implementations.

## Verification

Go unit tests and vet, Playwright E2E, and a running isolated-state server using real local rollouts. The final independent audit must compare displayed values with raw JSONL and identify fields the logs cannot prove.

Keep the upstream MIT license, existing analytics, exports, install and update flows. Delete obsolete top-level technical packages after migration, with no forwarding shims. Historical `token_count` support is a real input contract, not a compatibility shim.
