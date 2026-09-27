package conversation

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/zJay26/codex-usage/internal/conversation/model"
	"github.com/zJay26/codex-usage/internal/conversation/store"
)

// Ledger is an on-demand view over canonical usage and its original rollout.
// Transcript text never passes through the statistics database.
type Ledger struct {
	ThreadID string             `json:"thread_id"`
	URL      string             `json:"url"`
	Usage    model.TokenUsage   `json:"usage"`
	Turns    []Turn             `json:"turns"`
	Events   []model.UsageEvent `json:"-"`
}
type Turn struct {
	ID              string             `json:"id"`
	StartedAt       time.Time          `json:"started_at"`
	Model           string             `json:"model,omitempty"`
	Models          []string           `json:"models,omitempty"`
	Usage           model.TokenUsage   `json:"usage"`
	Calls           []Call             `json:"calls"`
	Messages        []Message          `json:"messages,omitempty"`
	MessageCount    int                `json:"message_count,omitempty"`
	DetailAvailable bool               `json:"detail_available"`
	Events          []model.UsageEvent `json:"-"`
}
type Call struct {
	ID         string           `json:"id"`
	Model      string           `json:"model,omitempty"`
	Usage      model.TokenUsage `json:"usage"`
	Confidence string           `json:"confidence"`
	Event      model.UsageEvent `json:"-"`
}
type Message struct {
	Kind       string `json:"kind"`
	Text       string `json:"text,omitempty"`
	CallID     string `json:"call_id,omitempty"`
	ResponseID string `json:"response_id,omitempty"`
	Name       string `json:"name,omitempty"`
}

type rolloutLine struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}
type itemPayload struct {
	Type    string `json:"type"`
	Role    string `json:"role"`
	Phase   string `json:"phase"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Output    string `json:"output"`
	CallID    string `json:"call_id"`
	Metadata  struct {
		TurnID string `json:"turn_id"`
	} `json:"internal_chat_message_metadata_passthrough"`
}

func ReadLedger(ctx context.Context, db *store.Store, threadID, detailTurn string, offset, limit int) (Ledger, error) {
	if threadID == "" {
		return Ledger{}, errors.New("thread_id is required")
	}
	session, err := db.Session(ctx, threadID)
	if err != nil {
		return Ledger{}, err
	}
	out := Ledger{ThreadID: threadID, URL: "codex://threads/" + threadID, Turns: []Turn{}}
	byTurn := map[string]*Turn{}
	eventByID := map[string]model.UsageEvent{}
	err = db.WalkEvents(ctx, model.Filter{SessionID: threadID}, func(e model.UsageEvent) error {
		out.Usage = out.Usage.Add(e.Usage)
		out.Events = append(out.Events, e)
		id := e.TurnID
		if id == "" {
			id = "unconfirmed"
		}
		turn := byTurn[id]
		if turn == nil {
			turn = &Turn{ID: id, Calls: []Call{}, Messages: []Message{}}
			byTurn[id] = turn
		}
		turn.Usage = turn.Usage.Add(e.Usage)
		if turn.StartedAt.IsZero() || e.Timestamp.Before(turn.StartedAt) {
			turn.StartedAt = e.Timestamp
		}
		turn.Events = append(turn.Events, e)
		if e.Model != "" && !contains(turn.Models, e.Model) {
			turn.Models = append(turn.Models, e.Model)
		}
		eventByID[e.ID] = e
		return nil
	})
	if err != nil {
		return Ledger{}, err
	}
	responses, err := db.LedgerResponses(ctx, threadID)
	if err != nil {
		return Ledger{}, err
	}
	for _, r := range responses {
		turn := byTurn[r.TurnID]
		if turn == nil {
			continue
		}
		id := fmt.Sprintf("jsonl-response:%x", sha256.Sum256([]byte(threadID+"\x00"+r.ResponseID)))
		event, ok := eventByID[id]
		if !ok {
			continue
		} // Legacy overlap or fork replay is not a new charged call.
		turn.Calls = append(turn.Calls, Call{ID: r.ResponseID, Model: event.Model, Usage: r.Usage, Confidence: event.Confidence, Event: event})
	}
	for _, turn := range byTurn {
		if len(turn.Models) == 1 {
			turn.Model = turn.Models[0]
		}
		turn.DetailAvailable = len(turn.Calls) > 0
		out.Turns = append(out.Turns, *turn)
	}
	sort.SliceStable(out.Turns, func(i, j int) bool { return out.Turns[i].StartedAt.Before(out.Turns[j].StartedAt) })
	if detailTurn != "" {
		for i := range out.Turns {
			if out.Turns[i].ID == detailTurn {
				if err := readVisible(session.RolloutPath, detailTurn, &out.Turns[i], offset, limit); err != nil {
					return Ledger{}, err
				}
				break
			}
		}
	}
	return out, nil
}

func contains(items []string, s string) bool {
	for _, v := range items {
		if v == s {
			return true
		}
	}
	return false
}

func readVisible(path, turnID string, turn *Turn, offset, limit int) error {
	if path == "" {
		return nil
	}
	if !filepath.IsAbs(path) {
		return errors.New("rollout path is not absolute")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	if limit <= 0 || limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	calls := map[string]bool{}
	for i := range turn.Calls {
		calls[turn.Calls[i].ID] = true
	}
	pending := []int{}
	callForTool := map[string]string{}
	currentTurn := ""
	visible := []Message{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 64*1024*1024)
	for scanner.Scan() {
		var line rolloutLine
		if json.Unmarshal(scanner.Bytes(), &line) != nil {
			continue
		}
		switch line.Type {
		case "turn_context":
			var x struct {
				TurnID string `json:"turn_id"`
				Model  string `json:"model"`
			}
			if json.Unmarshal(line.Payload, &x) == nil {
				currentTurn = x.TurnID
				if x.TurnID == turnID && x.Model != "" && !contains(turn.Models, x.Model) {
					turn.Models = append(turn.Models, x.Model)
				}
			}
		case "event_msg":
			var x struct {
				Type   string `json:"type"`
				TurnID string `json:"turn_id"`
			}
			if json.Unmarshal(line.Payload, &x) == nil && x.Type == "task_started" {
				currentTurn = x.TurnID
			}
		case "response_item":
			var x itemPayload
			if json.Unmarshal(line.Payload, &x) != nil {
				continue
			}
			owner := x.Metadata.TurnID
			if owner == "" {
				owner = currentTurn
			}
			if owner != turnID {
				continue
			}
			msg, ok := visibleItem(x)
			if !ok {
				continue
			}
			if x.Type == "custom_tool_call_output" || x.Type == "function_call_output" {
				if id := callForTool[x.CallID]; id != "" {
					msg.ResponseID = id
				}
				visible = append(visible, msg)
				continue
			}
			if x.Role == "user" {
				visible = append(visible, msg)
				continue
			}
			pending = append(pending, len(visible))
			visible = append(visible, msg)
		case "token_usage_record":
			var x struct {
				TurnID     string `json:"turn_id"`
				ResponseID string `json:"response_id"`
			}
			if json.Unmarshal(line.Payload, &x) != nil || x.TurnID != turnID {
				continue
			}
			if calls[x.ResponseID] {
				for _, index := range pending {
					visible[index].ResponseID = x.ResponseID
					m := visible[index]
					if m.CallID != "" && m.Kind == "tool_call" {
						callForTool[m.CallID] = x.ResponseID
					}
				}
			}
			pending = nil
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	// 工具结果可能先于该次调用的用量记录写入；归属在完整扫描后确认。
	for i := range visible {
		if visible[i].Kind == "tool_result" {
			visible[i].ResponseID = callForTool[visible[i].CallID]
		}
	}
	if len(turn.Models) == 1 {
		turn.Model = turn.Models[0]
	} else {
		turn.Model = ""
	}
	turn.MessageCount = len(visible)
	if offset < len(visible) {
		end := offset + limit
		if end > len(visible) {
			end = len(visible)
		}
		turn.Messages = visible[offset:end]
	} else {
		turn.Messages = []Message{}
	}
	return nil
}

func visibleItem(x itemPayload) (Message, bool) {
	switch x.Type {
	case "message":
		if x.Role != "user" && !(x.Role == "assistant" && (x.Phase == "commentary" || x.Phase == "final")) {
			return Message{}, false
		}
		parts := []string{}
		for _, c := range x.Content {
			if c.Type == "input_text" || c.Type == "output_text" || c.Type == "text" {
				parts = append(parts, c.Text)
			}
		}
		kind := x.Role
		if x.Role == "assistant" {
			kind = "assistant_" + x.Phase
		}
		return Message{Kind: kind, Text: clamp(strings.Join(parts, "\n"))}, true
	case "custom_tool_call", "function_call":
		return Message{Kind: "tool_call", CallID: x.CallID, Name: x.Name, Text: clamp(x.Arguments)}, true
	case "custom_tool_call_output", "function_call_output":
		return Message{Kind: "tool_result", CallID: x.CallID, Text: clamp(x.Output)}, true
	}
	return Message{}, false
}
func clamp(s string) string {
	const max = 20000
	if len(s) > max {
		return s[:max] + "\n[truncated]"
	}
	return s
}
