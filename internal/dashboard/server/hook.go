package server

import (
	"encoding/json"
	"net/http"

	"github.com/zJay26/codex-usage/internal/conversation/usage"
)

func (s *Server) handleStopHook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	var notice struct {
		SessionID string `json:"session_id"`
		TurnID    string `json:"turn_id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := json.NewDecoder(r.Body).Decode(&notice); err != nil || notice.SessionID == "" || notice.TurnID == "" {
		http.Error(w, "invalid Stop notification", http.StatusBadRequest)
		return
	}
	if !s.scanMu.TryLock() {
		writeJSON(w, http.StatusAccepted, map[string]any{"queued": false, "busy": true})
		return
	}
	defer s.scanMu.Unlock()
	if s.Scanner.Busy() {
		writeJSON(w, http.StatusAccepted, map[string]any{"queued": false, "busy": true})
		return
	}
	homes, err := s.Homes()
	if err != nil {
		writeError(w, err)
		return
	}
	result, err := s.Scanner.Scan(r.Context(), homes, false)
	if err != nil {
		if _, ok := err.(*usage.RebuildRequiredError); ok {
			writeJSON(w, http.StatusConflict, map[string]any{"error": err.Error()})
			return
		}
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"thread_id": notice.SessionID, "turn_id": notice.TurnID, "events_inserted": result.EventsInserted})
}
