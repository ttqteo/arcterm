// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package shellutil

import (
	"log"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"
)

const (
	MaxQuoteSize = 10000000 // 10MB
)

var (
	safePattern       = regexp.MustCompile(`^[a-zA-Z0-9_@:,+=/.-]+$`)
	envVarNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
)

func IsValidEnvVarName(name string) bool {
	return envVarNamePattern.MatchString(name)
}

func HardQuote(s string) string {
	if s == "" {
		return "\"\""
	}

	if safePattern.MatchString(s) {
		return s
	}

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"', '\\', '$', '`':
			buf = append(buf, '\\', s[i])
		default:
			buf = append(buf, s[i])
		}
	}

	buf = append(buf, '"')
	return string(buf)
}

// does not encode newlines or backticks
func HardQuoteFish(s string) string {
	if s == "" {
		return "\"\""
	}

	if safePattern.MatchString(s) {
		return s
	}

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '"', '\\', '$':
			buf = append(buf, '\\', s[i])
		default:
			buf = append(buf, s[i])
		}
	}

	buf = append(buf, '"')
	return string(buf)
}

func HardQuotePowerShell(s string) string {
	if s == "" {
		return "\"\""
	}

	if !checkQuoteSize(s) {
		return ""
	}

	buf := make([]byte, 0, len(s)+5)
	buf = append(buf, '"')

	for i := 0; i < len(s); i++ {
		c := s[i]
		// In PowerShell, backtick (`) is the escape character
		switch c {
		case '"', '`', '$':
			buf = append(buf, '`', c)
		case '\n':
			buf = append(buf, '`', 'n') // PowerShell uses `n for newline
		default:
			buf = append(buf, c)
		}
	}

	buf = append(buf, '"')
	return string(buf)
}

// IsWindowsPowerShell reports whether shellPath is Windows PowerShell (powershell.exe, 5.1) rather than
// PowerShell 7 (pwsh): the two hand a native program its arguments differently (HardQuoteWindowsPowerShellArg).
func IsWindowsPowerShell(shellPath string) bool {
	return strings.HasPrefix(strings.ToLower(filepath.Base(shellPath)), "powershell")
}

// HardQuoteWindowsPowerShellArg quotes s as one argument of a native program that Windows PowerShell 5.1 runs.
// 5.1 builds the program's command line without escaping the double quotes inside an argument, so the program's
// argv parser ended the argument at the first one: every run lead's prompt was cut off at
// `dag forward <task> "<what`. s is first escaped the way that parser reads it back.
func HardQuoteWindowsPowerShellArg(s string) string {
	return HardQuotePowerShell(escapeNativeArg(s))
}

// escapeNativeArg escapes s for the Windows argv parser (CommandLineToArgvW): a quote becomes \" and the
// backslashes before it double. 5.1 wraps the argument in quotes when windowsPowerShellWraps says so, and then
// trailing backslashes double too, or they would escape the closing quote. An argument whose every whitespace
// follows an odd number of quotes is not wrapped, and no escaping keeps it whole: it still splits at the
// whitespace, which a prompt, with words before its first quote, never does.
func escapeNativeArg(s string) string {
	var b strings.Builder
	backslashes := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == '\\' {
			backslashes++
			continue
		}
		if c == '"' {
			b.WriteString(strings.Repeat(`\`, 2*backslashes+1))
		} else {
			b.WriteString(strings.Repeat(`\`, backslashes))
		}
		b.WriteByte(c)
		backslashes = 0
	}
	b.WriteString(strings.Repeat(`\`, backslashes))
	escaped := b.String()
	if windowsPowerShellWraps(escaped) {
		escaped += strings.Repeat(`\`, backslashes)
	}
	return escaped
}

// windowsPowerShellWraps is 5.1's rule for wrapping a native argument in quotes: some whitespace follows an even
// number of double quotes, escaped or not.
func windowsPowerShellWraps(arg string) bool {
	quotes := 0
	for _, r := range arg {
		if r == '"' {
			quotes++
		} else if unicode.IsSpace(r) && quotes%2 == 0 {
			return true
		}
	}
	return false
}

func checkQuoteSize(s string) bool {
	if len(s) > MaxQuoteSize {
		log.Printf("string too long to quote: %s", s)
		return false
	}
	return true
}
