// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Package harnessupdate notices a newer release of an installed coding-agent harness (the npm registry's dist-tags),
// announces each new version once, and runs the harness's own update command on request.

package harnessupdate

import (
	"regexp"
	"strconv"
)

var versionRe = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)

// ParseVersion reads the first x.y.z in s: "2.1.292 (Claude Code)", "v0.3.10".
func ParseVersion(s string) ([3]int, bool) {
	m := versionRe.FindStringSubmatch(s)
	if m == nil {
		return [3]int{}, false
	}
	var v [3]int
	for i := range v {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return [3]int{}, false
		}
		v[i] = n
	}
	return v, true
}

// Newer reports whether latest is a higher x.y.z than installed; false when either does not parse.
func Newer(latest, installed string) bool {
	l, ok1 := ParseVersion(latest)
	i, ok2 := ParseVersion(installed)
	if !ok1 || !ok2 {
		return false
	}
	for k := range l {
		if l[k] != i[k] {
			return l[k] > i[k]
		}
	}
	return false
}
