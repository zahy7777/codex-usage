# Dashboard

Owns the loopback application and presentation. `app/` runs CLI and service lifecycle, `server/` exposes local APIs, `web/` renders the UI, and `config/`, `platform/`, `updater/`, `cliui/` support that complete operator-facing capability. Dashboard uses Conversation for usage and transcript facts and Pricing for estimates; JSONL decoding stays in Conversation.
