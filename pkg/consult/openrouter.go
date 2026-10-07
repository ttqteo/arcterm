// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package consult

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/launchdarkly/eventsource"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
)

const (
	openRouterChatEndpoint = "https://openrouter.ai/api/v1/chat/completions"
	// named for the embedding lane that first stored it (retired 2026-09-23); kept because renaming it
	// would orphan every key already stored. Settings → Headless AI writes it.
	openRouterSecretName = "jarvis_embedapikey"
	openRouterTimeout    = 5 * time.Minute
)

type openrouterBackend struct{}

func (b *openrouterBackend) Run(ctx context.Context, spec RuntimeSpec, prompt string, emit func(string)) (string, error) {
	full, _, err := b.RunWithUsage(ctx, spec, prompt, emit)
	return full, err
}

func (b *openrouterBackend) RunWithUsage(ctx context.Context, spec RuntimeSpec, prompt string, emit func(string)) (string, Usage, error) {
	key, exists, err := secretstore.GetSecret(openRouterSecretName)
	if err != nil {
		return "", Usage{}, fmt.Errorf("reading OPENROUTER_KEY: %w", err)
	}
	if !exists || key == "" {
		return "", Usage{}, fmt.Errorf("OpenRouter API key not configured (set OPENROUTER_KEY)")
	}

	model := spec.Model
	if model == "" {
		model = OpenrouterCheapModel()
	}

	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"stream": true,
		// usage accounting rides in the stream's final chunk only when requested
		"usage": map[string]bool{"include": true},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return "", Usage{}, fmt.Errorf("marshaling request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openRouterChatEndpoint, bytes.NewReader(payload))
	if err != nil {
		return "", Usage{}, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+key)

	client := &http.Client{Timeout: openRouterTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return "", Usage{}, fmt.Errorf("OpenRouter request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", Usage{}, fmt.Errorf("OpenRouter API error %d: %s", resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return decodeOpenrouterStream(resp.Body, emit)
}

// decodeOpenrouterStream accumulates a streamed reply, emitting each fragment, and reads the resolved
// model and token usage the stream carries.
func decodeOpenrouterStream(r io.Reader, emit func(string)) (string, Usage, error) {
	decoder := eventsource.NewDecoder(r)
	var full strings.Builder
	var usage Usage
	for {
		ev, derr := decoder.Decode()
		if derr != nil {
			if derr == io.EOF {
				break
			}
			return full.String(), usage, fmt.Errorf("SSE decode error: %w", derr)
		}
		data := strings.TrimSpace(ev.Data())
		if data == "" || data == "[DONE]" {
			continue
		}
		var chunk struct {
			Model   string `json:"model"`
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Usage *struct {
				TotalTokens int `json:"total_tokens"`
			} `json:"usage"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Model != "" {
			usage.Model = chunk.Model
		}
		if chunk.Usage != nil {
			usage.TotalTokens = chunk.Usage.TotalTokens
		}
		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				full.WriteString(choice.Delta.Content)
				emit(choice.Delta.Content)
			}
		}
	}
	return full.String(), usage, nil
}

// OpenrouterCheapModel returns the configured cheap model or the default.
func OpenrouterCheapModel() string {
	if cfg := wconfig.GetWatcher().GetFullConfig(); cfg.Settings.HeadlessOpenRouterCheapModel != "" {
		return cfg.Settings.HeadlessOpenRouterCheapModel
	}
	return "deepseek/deepseek-v4-flash"
}
