# Conversation

Owns Codex rollout facts. `usage/` scans and attributes JSONL records; `store/` persists derived usage and metadata; `model/` defines public usage facts; `timezone/` fixes accounting day boundaries. Future transcript reads belong here and must remain on demand. Other concepts may request thread, turn, response, and visible-message facts, but may not read `store/` internals or parse raw JSONL.
