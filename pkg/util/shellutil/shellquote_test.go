// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
package shellutil

import "testing"

func TestQuote(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantHard string
	}{
		{
			name:     "simple strings",
			input:    "simple",
			wantHard: "simple",
		},
		{
			name:     "safe path",
			input:    "path/to/file.txt",
			wantHard: "path/to/file.txt",
		},
		{
			name:     "empty string",
			input:    "",
			wantHard: `""`,
		},
		{
			name:     "tilde alone",
			input:    "~",
			wantHard: `"~"`,
		},
		{
			name:     "tilde with safe path",
			input:    "~/foo",
			wantHard: `"~/foo"`,
		},
		{
			name:     "tilde with spaces",
			input:    "~/foo bar",
			wantHard: `"~/foo bar"`,
		},
		{
			name:     "tilde with variable",
			input:    "~/foo$bar",
			wantHard: `"~/foo\$bar"`,
		},
		{
			name:     "invalid tilde path",
			input:    "~foo",
			wantHard: `"~foo"`,
		},
		{
			name:     "variable at start",
			input:    "$HOME/.config",
			wantHard: `"\$HOME/.config"`,
		},
		{
			name:     "variable in middle",
			input:    "prefix$HOME",
			wantHard: `"prefix\$HOME"`,
		},
		{
			name:     "double quotes",
			input:    `has "quotes"`,
			wantHard: `"has \"quotes\""`,
		},
		{
			name:     "backslash",
			input:    `back\slash`,
			wantHard: `"back\\slash"`,
		},
		{
			name:     "backtick",
			input:    "`cmd`",
			wantHard: "\"\\`cmd\\`\"",
		},
		{
			name:     "spaces",
			input:    "spaces here",
			wantHard: `"spaces here"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HardQuote(tt.input); got != tt.wantHard {
				t.Errorf("HardQuote(%q) = %q, want %q", tt.input, got, tt.wantHard)
			}
		})
	}
}

func TestHardQuotePowerShell(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		// an apostrophe is literal inside a PowerShell double-quoted string — it must pass
		// through untouched (the POSIX quoter split the arg here, breaking run-worker prompts).
		{name: "apostrophe passthrough", input: "the phase's deliverable", want: `"the phase's deliverable"`},
		// newline -> `n exactly once (regression: the raw newline used to also be appended).
		{name: "newline to backtick-n", input: "a\nb", want: "\"a`nb\""},
		{name: "dollar escaped", input: "$HOME", want: "\"`$HOME\""},
		{name: "double quote escaped", input: `say "hi"`, want: "\"say `\"hi`\"\""},
		{name: "backtick escaped", input: "a`b", want: "\"a``b\""},
		{name: "empty", input: "", want: `""`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := HardQuotePowerShell(tt.input); got != tt.want {
				t.Errorf("HardQuotePowerShell(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestIsWindowsPowerShell(t *testing.T) {
	cases := map[string]bool{
		`C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`: true,
		"powershell":                             true,
		`C:\Program Files\PowerShell\7\pwsh.exe`: false,
		"/usr/bin/bash":                          false,
		"":                                       false,
	}
	for path, want := range cases {
		if got := IsWindowsPowerShell(path); got != want {
			t.Errorf("IsWindowsPowerShell(%q) = %v, want %v", path, got, want)
		}
	}
}

func TestEscapeNativeArg(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "a quote becomes backslash-quote", input: `forward <task> "<what>"`, want: `forward <task> \"<what>\"`},
		{name: "backslashes before a quote double", input: `a\"b c`, want: `a\\\"b c`},
		{name: "trailing backslashes double when 5.1 wraps", input: `C:\a dir\`, want: `C:\a dir\\`},
		{name: "trailing backslashes stay when it does not wrap", input: `C:\nospace\`, want: `C:\nospace\`},
		{name: "no quote and no backslash is untouched", input: "plain text\nnext line", want: "plain text\nnext line"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := escapeNativeArg(tt.input); got != tt.want {
				t.Errorf("escapeNativeArg(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
