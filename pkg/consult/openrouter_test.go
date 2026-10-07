// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package consult

import (
	"strings"
	"testing"
)

func TestOpenrouterModelDefaults(t *testing.T) {
	if m := "deepseek/deepseek-v4-flash"; OpenrouterCheapModel() != m {
		t.Logf("OpenrouterCheapModel: got %q, expected %q (when no config set)", OpenrouterCheapModel(), m)
	}
}

func TestDecodeOpenrouterStreamReadsUsage(t *testing.T) {
	stream := "data: {\"model\":\"deepseek/deepseek-v4-pro\",\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n" +
		"data: {\"model\":\"deepseek/deepseek-v4-pro\",\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n" +
		"data: {\"model\":\"deepseek/deepseek-v4-pro\",\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"total_tokens\":15}}\n\n" +
		"data: [DONE]\n\n"
	var emitted strings.Builder
	full, usage, err := decodeOpenrouterStream(strings.NewReader(stream), func(s string) { emitted.WriteString(s) })
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if full != "hello" || emitted.String() != "hello" {
		t.Fatalf("reply: got full=%q emitted=%q, want hello", full, emitted.String())
	}
	if usage.Model != "deepseek/deepseek-v4-pro" || usage.TotalTokens != 15 {
		t.Fatalf("usage: got %+v, want model deepseek/deepseek-v4-pro and 15 tokens", usage)
	}
}

func TestDecodeOpenrouterStreamWithoutUsage(t *testing.T) {
	stream := "data: {\"choices\":[{\"delta\":{\"content\":\"x\"}}]}\n\n"
	full, usage, err := decodeOpenrouterStream(strings.NewReader(stream), func(string) {})
	if err != nil || full != "x" {
		t.Fatalf("decode: got %q, %v", full, err)
	}
	if usage != (Usage{}) {
		t.Fatalf("a stream without usage must report none, got %+v", usage)
	}
}
