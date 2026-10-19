// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package arctools

type ToolStatus struct {
	Tool
	Found bool   `json:"found"`
	Path  string `json:"path,omitempty"`
}

// Status resolves each tool's command (its Needs, when it has one) with lookPath (exec.LookPath in production; a fake in tests). The result keeps
// the order of tools and is never nil, so the RPC returns [] rather than null. A Detected tool the user has not added
// is left out unless it is found: the library suggests only what is on this machine.
func Status(tools []Tool, lookPath func(string) (string, error)) []ToolStatus {
	out := make([]ToolStatus, 0, len(tools))
	for _, t := range tools {
		st := ToolStatus{Tool: t}
		name := t.Command
		if t.Needs != "" {
			name = t.Needs
		}
		if p, err := lookPath(name); err == nil {
			st.Found = true
			st.Path = p
		}
		if t.Detected && !t.User && !st.Found {
			continue
		}
		out = append(out, st)
	}
	return out
}
