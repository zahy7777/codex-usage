package server

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/zJay26/codex-usage/internal/conversation"
	"github.com/zJay26/codex-usage/internal/conversation/model"
	"github.com/zJay26/codex-usage/internal/pricing"
)

type ledgerView struct {
	conversation.Ledger
	Turns   []turnView          `json:"turns"`
	API     pricing.Estimate    `json:"api_equivalent"`
	Credits pricing.CreditQuote `json:"codex_credits"`
}
type turnView struct {
	conversation.Turn
	Calls   []callView          `json:"calls"`
	API     pricing.Estimate    `json:"api_equivalent"`
	Credits pricing.CreditQuote `json:"codex_credits"`
}
type callView struct {
	conversation.Call
	API     pricing.Estimate    `json:"api_equivalent"`
	Credits pricing.CreditQuote `json:"codex_credits"`
}

func quoteAPI(events []model.UsageEvent, overrides map[string]pricing.Override) (pricing.Estimate, error) {
	builder, err := pricing.NewBuilderForBasis(overrides, pricing.Basis)
	if err != nil {
		return pricing.Estimate{}, err
	}
	for _, event := range events {
		if err := builder.Add(event); err != nil {
			return pricing.Estimate{}, err
		}
	}
	return builder.Report().Summary, nil
}

func (s *Server) handleLedger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	q := r.URL.Query()
	offset, _ := strconv.Atoi(q.Get("offset"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	result, err := conversation.ReadLedger(r.Context(), s.Store, q.Get("thread_id"), q.Get("turn_id"), offset, limit)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, sql.ErrNoRows) {
			status = http.StatusNotFound
		}
		http.Error(w, err.Error(), status)
		return
	}
	apiOverrides, err := s.pricingOverrides()
	if err != nil {
		writeError(w, err)
		return
	}
	creditOverrides, err := s.creditRates()
	if err != nil {
		writeError(w, err)
		return
	}
	view := ledgerView{Ledger: result, Turns: make([]turnView, 0, len(result.Turns)), Credits: pricing.QuoteCredits(result.Events, creditOverrides)}
	view.API, err = quoteAPI(result.Events, apiOverrides)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, turn := range result.Turns {
		v := turnView{Turn: turn, Calls: make([]callView, 0, len(turn.Calls)), Credits: pricing.QuoteCredits(turn.Events, creditOverrides)}
		v.API, err = quoteAPI(turn.Events, apiOverrides)
		if err != nil {
			writeError(w, err)
			return
		}
		for _, call := range turn.Calls {
			priceEvent := call.Event
			priceEvent.Usage = call.Usage
			c := callView{Call: call, Credits: pricing.QuoteCredits([]model.UsageEvent{priceEvent}, creditOverrides)}
			c.API, err = quoteAPI([]model.UsageEvent{priceEvent}, apiOverrides)
			if err != nil {
				writeError(w, err)
				return
			}
			v.Calls = append(v.Calls, c)
		}
		view.Turns = append(view.Turns, v)
	}
	writeJSON(w, http.StatusOK, view)
}
