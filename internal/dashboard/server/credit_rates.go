package server

import (
	"encoding/json"
	"net/http"

	"github.com/zJay26/codex-usage/internal/pricing"
)

func (s *Server) creditRates() (map[string][]pricing.CreditRate, error) {
	if s.LoadCreditRates == nil {
		return nil, nil
	}
	s.pricingMu.Lock()
	defer s.pricingMu.Unlock()
	return s.LoadCreditRates()
}

func (s *Server) handleCreditRates(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		overrides, err := s.creditRates()
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"catalog_as_of": pricing.CreditCatalogAsOf, "source": pricing.CreditCatalogSource, "catalog": pricing.CreditCatalog(), "overrides": overrides})
	case http.MethodPut:
		if s.SaveCreditRates == nil {
			http.Error(w, "credit rate configuration unavailable", http.StatusNotImplemented)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var payload struct {
			Overrides map[string][]pricing.CreditRate `json:"overrides"`
		}
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := ensureJSONEOF(decoder); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		normalized, err := pricing.NormalizeCreditRates(payload.Overrides)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		s.pricingMu.Lock()
		err = s.SaveCreditRates(normalized)
		s.pricingMu.Unlock()
		if err != nil {
			writeError(w, err)
			return
		}
		s.pricingRevision.Add(1)
		writeJSON(w, http.StatusOK, map[string]any{"catalog_as_of": pricing.CreditCatalogAsOf, "source": pricing.CreditCatalogSource, "catalog": pricing.CreditCatalog(), "overrides": normalized})
	default:
		methodNotAllowed(w, http.MethodGet, http.MethodPut)
	}
}
