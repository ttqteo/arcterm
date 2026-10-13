// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package arctools

type ToolStatus struct {
	Tool
	Found bool   `json:"found"`
	Path  string `json:"path,omitempty"`
}

// Status resolves each tool's command with lookPath (exec.LookPath in production; a fake in tests). The result keeps
// the order of tools and is never nil, so the RPC returns [] rather than null.
func Status(tools []Tool, lookPath func(string) (string, error)) []ToolStatus {
	out := make([]ToolStatus, 0, len(tools))
	for _, t := range tools {
		st := ToolStatus{Tool: t}
		if p, err := lookPath(t.Command); err == nil {
			st.Found = true
			st.Path = p
		}
		out = append(out, st)
	}
	return out
}
