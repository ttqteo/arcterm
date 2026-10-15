// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"strings"
	"testing"
)

func TestRedactSecrets(t *testing.T) {
	cases := []string{
		"key = sk-ABCDEF0123456789ABCDEF0123456789",           // sk- token
		"AWS=AKIAIOSFODNN7EXAMPLE",                             // aws access key id
		"ghp_0123456789abcdef0123456789abcdef0123",            // github token
		"password: hunter2secretlongvalue0987654321XZ",        // high-entropy assignment
		"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def", // jwt-ish
	}
	for _, in := range cases {
		out := Redact(in)
		if strings.Contains(out, "sk-ABCDEF") || strings.Contains(out, "AKIAIOSFODNN7EXAMPLE") ||
			strings.Contains(out, "ghp_0123456789abcdef") || strings.Contains(out, "hunter2secretlongvalue") {
			t.Fatalf("secret leaked: %q -> %q", in, out)
		}
		if !strings.Contains(out, "[REDACTED]") {
			t.Fatalf("expected redaction marker in %q", out)
		}
	}
	// plain text is untouched
	if Redact("just a normal sentence about coupons") != "just a normal sentence about coupons" {
		t.Fatal("plain text must be untouched")
	}
}

func TestRedactKeepsCodeReferences(t *testing.T) {
	cases := []string{
		"The 2.5s sleep ends before the new page has set `window.__wavePetStore`.",
		"`redirectTarget` and `resolvePath` in `frontend/app/view/agents/agentshellread.ts`: the tree applies",
		"server validation in pkg/wshrpc/wshserver/wshserver-runsettings.go:58, :96 and :144",
		"see frontend/app/view/jarvis/runsheet.tsx:992 (no guard)",
		"the only caller is TranscriptTailCommandHandler() in the server",
	}
	for _, in := range cases {
		if out := Redact(in); out != in {
			t.Errorf("code reference redacted:\n in: %q\nout: %q", in, out)
		}
	}
}

func TestRedactStandaloneHighEntropyToken(t *testing.T) {
	cases := []string{
		"the value Xk9mQ2vL7pR4tW8zB3nF6hJ1cD5gY0aE was logged",  // base62 with digits
		"token AbCdEfGh/IjKlMnOp+QrStUvWx0123456789== in a file", // base64 with / and =
	}
	for _, in := range cases {
		if out := Redact(in); !strings.Contains(out, "[REDACTED]") {
			t.Errorf("high-entropy token kept: %q -> %q", in, out)
		}
	}
}
