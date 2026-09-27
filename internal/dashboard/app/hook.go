package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/zJay26/codex-usage/internal/dashboard/config"
)

// hookStop deliberately exits successfully when the local service is absent.
// Its only effect is notifying the dashboard; it never changes Codex output.
func (c CLI) hookStop(args []string) error {
	// Codex expects a JSON object on stdout from a successful Stop hook.
	defer fmt.Fprintln(os.Stdout, "{}")
	if len(args) == 2 && args[0] == "--state-dir" {
		if err := os.Setenv("CODEX_USAGE_HOME", args[1]); err != nil {
			return nil
		}
	} else if len(args) != 0 {
		return nil
	}
	var input struct {
		SessionID string `json:"session_id"`
		TurnID    string `json:"turn_id"`
	}
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
	if err != nil {
		return nil
	}
	if json.Unmarshal(raw, &input) != nil || input.SessionID == "" || input.TurnID == "" {
		return nil
	}
	paths, err := config.ResolvePaths()
	if err != nil {
		return nil
	}
	cfg, err := config.Load(paths)
	if err != nil {
		return nil
	}
	body, _ := json.Marshal(input)
	url := "http://" + net.JoinHostPort("127.0.0.1", strconv.Itoa(cfg.Port)) + "/api/v1/hook/stop"
	client := http.Client{Timeout: 5 * time.Second}
	response, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err == nil {
		response.Body.Close()
	}
	return nil
}
