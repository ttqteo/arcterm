// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// A settings.json written before the embedding lane was retired still carries its three keys; loading it
// must neither fail nor lose the OpenRouter values beside them.
func TestRetiredEmbedKeysStillLoad(t *testing.T) {
	part := waveobj.MetaMapType{
		"jarvis:embedenabled":           true,
		"jarvis:embedbaseurl":           "https://openrouter.ai/api/v1",
		"jarvis:embedmodel":             "openai/text-embedding-3-small",
		"headless:openroutercheapmodel": "deepseek/deepseek-v4-flash",
	}
	var s SettingsType
	if err := utilfn.ReUnmarshal(&s, part); err != nil {
		t.Fatalf("settings with retired keys failed to load: %v", err)
	}
	if s.HeadlessOpenRouterCheapModel != "deepseek/deepseek-v4-flash" {
		t.Fatalf("cheap model = %q, want deepseek/deepseek-v4-flash", s.HeadlessOpenRouterCheapModel)
	}
}

// A settings.json written before Radar was retired still carries its three keys; loading it must neither
// fail nor lose the settings beside them.
func TestRetiredRadarKeysStillLoad(t *testing.T) {
	part := waveobj.MetaMapType{
		"radar:auditruntime":  "pi",
		"radar:auditmodel":    "x",
		"radar:classifymodel": "haiku",
		"term:fontsize":       13.0,
	}
	var s SettingsType
	if err := utilfn.ReUnmarshal(&s, part); err != nil {
		t.Fatalf("settings with retired radar keys failed to load: %v", err)
	}
	if s.TermFontSize != 13 {
		t.Fatalf("term:fontsize = %v, want 13", s.TermFontSize)
	}
}
