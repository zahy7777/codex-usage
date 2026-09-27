package conversation

import (
	"os"
	"path/filepath"
	"testing"
)

func TestVisibleMessageOwnershipSurvivesPagination(t *testing.T) {
	path := filepath.Join(t.TempDir(), "rollout.jsonl")
	log := `{"type":"turn_context","payload":{"turn_id":"turn"}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"question"}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"reply"}]}}
{"type":"response_item","payload":{"type":"function_call","name":"exec","call_id":"tool","arguments":"{}"}}
{"type":"response_item","payload":{"type":"function_call_output","call_id":"tool","output":"result"}}
{"type":"token_usage_record","payload":{"turn_id":"turn","response_id":"response"}}
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final","content":[{"type":"output_text","text":"unconfirmed"}]}}
`
	if err := os.WriteFile(path, []byte(log), 0600); err != nil {
		t.Fatal(err)
	}
	turn := Turn{Calls: []Call{{ID: "response"}}}
	if err := readVisible(path, "turn", &turn, 0, 2); err != nil {
		t.Fatal(err)
	}
	if turn.MessageCount != 5 || len(turn.Messages) != 2 || turn.Messages[0].ResponseID != "" || turn.Messages[1].ResponseID != "response" {
		t.Fatalf("unexpected first page: %+v", turn)
	}
	if err := readVisible(path, "turn", &turn, 2, 3); err != nil {
		t.Fatal(err)
	}
	if len(turn.Messages) != 3 || turn.Messages[0].ResponseID != "response" || turn.Messages[1].ResponseID != "response" || turn.Messages[2].ResponseID != "" {
		t.Fatalf("unexpected second page: %+v", turn.Messages)
	}
}
