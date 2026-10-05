package pricing

import (
	"fmt"
	"math/big"
	"sort"
	"strings"
	"time"

	"github.com/zJay26/codex-usage/internal/conversation/model"
)

const CreditCatalogAsOf = "2026-10-05"
const CreditCatalogSource = "https://learn.chatgpt.com/docs/pricing"

// CreditRate is a Standard-speed Codex rate in credits per million tokens.
// Cache writes are included in ordinary input, with no separate credit charge.
type CreditRate struct {
	EffectiveFrom string `json:"effective_from"`
	Input         string `json:"input"`
	CachedInput   string `json:"cached_input"`
	Output        string `json:"output"`
}
type CreditQuote struct {
	Credits        string `json:"credits,omitempty"`
	PricedTokens   int64  `json:"priced_tokens"`
	UnpricedTokens int64  `json:"unpriced_tokens"`
	Note           string `json:"note,omitempty"`
}

var standardCreditRates = map[string]CreditRate{
	"gpt-6-astra":   {Input: "250", CachedInput: "25", Output: "1250"},
	"gpt-6.1-sol":   {Input: "50", CachedInput: "2.5", Output: "250"},
	"gpt-6-sol":     {Input: "50", CachedInput: "5", Output: "250"},
	"gpt-6-luna":    {Input: "2.5", CachedInput: "0.25", Output: "12.5"},
	"gpt-5.6-sol":   {Input: "100", CachedInput: "10", Output: "500"},
	"gpt-5.6-terra": {Input: "50", CachedInput: "5", Output: "300"},
	"gpt-5.6-luna":  {Input: "5", CachedInput: "0.5", Output: "30"},
	"gpt-5.5":       {Input: "125", CachedInput: "12.5", Output: "750"},
	"gpt-5.4":       {Input: "62.5", CachedInput: "6.25", Output: "375"},
	"gpt-5.4-mini":  {Input: "18.75", CachedInput: "1.875", Output: "113"},
}

func CreditCatalog() map[string]CreditRate {
	out := make(map[string]CreditRate, len(standardCreditRates))
	for k, v := range standardCreditRates {
		out[k] = v
	}
	return out
}

func NormalizeCreditRates(input map[string][]CreditRate) (map[string][]CreditRate, error) {
	if len(input) == 0 {
		return nil, nil
	}
	out := make(map[string][]CreditRate, len(input))
	for modelName, entries := range input {
		name := strings.TrimSpace(modelName)
		if name == "" || len(entries) == 0 {
			return nil, fmt.Errorf("credit rate model and entries are required")
		}
		copyEntries := append([]CreditRate(nil), entries...)
		for _, r := range copyEntries {
			if _, err := time.Parse("2006-01-02", r.EffectiveFrom); err != nil {
				return nil, fmt.Errorf("%s: invalid effective_from: %w", name, err)
			}
			for _, v := range []string{r.Input, r.CachedInput, r.Output} {
				n, ok := new(big.Rat).SetString(v)
				if !ok || n.Sign() < 0 {
					return nil, fmt.Errorf("%s: invalid credit rate %q", name, v)
				}
			}
		}
		sort.Slice(copyEntries, func(i, j int) bool { return copyEntries[i].EffectiveFrom < copyEntries[j].EffectiveFrom })
		for i := 1; i < len(copyEntries); i++ {
			if copyEntries[i].EffectiveFrom == copyEntries[i-1].EffectiveFrom {
				return nil, fmt.Errorf("%s: duplicate effective date", name)
			}
		}
		out[name] = copyEntries
	}
	return out, nil
}

func QuoteCredits(events []model.UsageEvent, overrides map[string][]CreditRate) CreditQuote {
	total := new(big.Rat)
	result := CreditQuote{}
	for _, event := range events {
		rate, ok := creditRateFor(event, overrides)
		if !ok {
			result.UnpricedTokens += event.Usage.Total
			continue
		}
		u := event.Usage
		if u.CachedInput < 0 || u.CachedInput > u.Input {
			result.UnpricedTokens += u.Total
			continue
		}
		input, _ := new(big.Rat).SetString(rate.Input)
		cached, _ := new(big.Rat).SetString(rate.CachedInput)
		output, _ := new(big.Rat).SetString(rate.Output)
		value := new(big.Rat).Mul(input, big.NewRat(u.Input-u.CachedInput, 1))
		value.Add(value, new(big.Rat).Mul(cached, big.NewRat(u.CachedInput, 1)))
		value.Add(value, new(big.Rat).Mul(output, big.NewRat(u.Output, 1)))
		value.Quo(value, big.NewRat(1_000_000, 1))
		if event.ServiceMode.ServiceMode == model.ModeFast {
			n, d, found := FastCreditMultiplier(event.Model)
			if !found {
				result.UnpricedTokens += u.Total
				continue
			}
			value.Mul(value, big.NewRat(n, d))
		} else if event.ServiceMode.ServiceMode != model.ModeStandard {
			result.Note = "Some service modes were unconfirmed; Standard credit rates were assumed."
		}
		total.Add(total, value)
		result.PricedTokens += u.Total
	}
	if result.PricedTokens > 0 {
		result.Credits = total.FloatString(6)
	}
	if result.UnpricedTokens > 0 {
		result.Note = "Some models or rates could not be confirmed; the credit estimate is partial."
	}
	return result
}

func creditRateFor(event model.UsageEvent, overrides map[string][]CreditRate) (CreditRate, bool) {
	canonical := event.Model
	if resolved, found, err := Resolve(event.Model, nil); err == nil && found {
		canonical = resolved.CanonicalModel
	}
	entries := overrides[event.Model]
	if len(entries) == 0 {
		entries = overrides[canonical]
	}
	if len(entries) > 0 {
		day := event.Timestamp.UTC().Format("2006-01-02")
		for i := len(entries) - 1; i >= 0; i-- {
			if entries[i].EffectiveFrom <= day {
				return entries[i], true
			}
		}
		return CreditRate{}, false
	}
	rate, ok := standardCreditRates[canonical]
	return rate, ok
}
