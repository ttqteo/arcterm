// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package consult

import (
	"errors"
	"strings"
	"testing"
)

func TestOpenRouterKeyConfigured(t *testing.T) {
	old := getSecretFn
	t.Cleanup(func() { getSecretFn = old })
	cases := []struct {
		name    string
		key     string
		exists  bool
		readErr error
		want    bool
		wantErr string
	}{
		{name: "present", key: "sk-or-x", exists: true, want: true},
		{name: "absent", exists: false, want: false},
		{name: "empty", key: "", exists: true, want: false},
		{name: "read error", readErr: errors.New("keychain locked"), wantErr: "keychain locked"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var asked string
			getSecretFn = func(name string) (string, bool, error) {
				asked = name
				return tc.key, tc.exists, tc.readErr
			}
			got, err := OpenRouterKeyConfigured()
			if asked != openRouterSecretName {
				t.Fatalf("read secret %q, want %q", asked, openRouterSecretName)
			}
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("err = %v, want %q", err, tc.wantErr)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %v, %v; want %v", got, err, tc.want)
			}
		})
	}
}
