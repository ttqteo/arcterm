// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package reporadar

import (
	"math"
	"regexp"
	"strings"
)

// redactMarker replaces any detected secret.
const redactMarker = "[REDACTED]"

// well-known secret shapes. Ordered; each is replaced whole.
var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`sk-[A-Za-z0-9_\-]{16,}`),                                // openai/anthropic-style
	regexp.MustCompile(`AKIA[0-9A-Z]{16}`),                                      // aws access key id
	regexp.MustCompile(`gh[pousr]_[A-Za-z0-9]{20,}`),                            // github tokens
	regexp.MustCompile(`eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+`), // jwt
	regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----`),                    // pem
}

// assignRe matches "key = value" / "key: value" so a high-entropy value can be redacted.
var assignRe = regexp.MustCompile(`(?i)((?:pass(?:word)?|secret|token|api[_-]?key|auth)\s*[:=]\s*)(\S+)`)

// findings cite code, whose long paths and identifiers score as high-entropy. A file path (optionally :line) or a
// digit-free identifier chain is not a credential shape: base64/base62 secrets carry digits and no file extension.
var codeRefPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^[\w.\-]*/[\w.\-/]*\.[A-Za-z]{1,6}(?::\d+(?:[-:]\d+)?)?$`),
	regexp.MustCompile(`^[A-Za-z_$]+(?:\??\.[A-Za-z_$]+)*$`),
}

func isCodeReference(s string) bool {
	for _, re := range codeRefPatterns {
		if re.MatchString(s) {
			return true
		}
	}
	return false
}

// Redact removes common secret formats and high-entropy credential values from text before it is
// sent to the model or persisted. Best-effort; conservative on plain prose.
func Redact(s string) string {
	for _, re := range secretPatterns {
		s = re.ReplaceAllString(s, redactMarker)
	}
	s = assignRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := assignRe.FindStringSubmatch(m)
		return sub[1] + redactMarker
	})
	// standalone high-entropy tokens (length >= 20, entropy high)
	return redactHighEntropyTokens(s)
}

func redactHighEntropyTokens(s string) string {
	fields := strings.Fields(s)
	changed := false
	for i, f := range fields {
		trimmed := strings.Trim(f, "\"'.,;:()[]{}`")
		if len(trimmed) >= 24 && shannonEntropy(trimmed) >= 4.0 && !isCodeReference(trimmed) {
			fields[i] = strings.Replace(f, trimmed, redactMarker, 1)
			changed = true
		}
	}
	if !changed {
		return s
	}
	return strings.Join(fields, " ")
}

func shannonEntropy(s string) float64 {
	if s == "" {
		return 0
	}
	freq := map[rune]float64{}
	for _, r := range s {
		freq[r]++
	}
	n := float64(len(s))
	var e float64
	for _, c := range freq {
		p := c / n
		e -= p * math.Log2(p)
	}
	return e
}
