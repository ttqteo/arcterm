// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wavevault

import (
	"encoding/json"
	"reflect"
	"testing"
)

func decodeRoles(t *testing.T, b []byte) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode %s: %v", b, err)
	}
	return m
}

func TestMergeCouncilRoles(t *testing.T) {
	cases := []struct {
		name               string
		base, ours, theirs string
		want               string
	}{
		{
			name:   "a role edited on each side keeps both edits",
			base:   `{"roles":[{"id":"ux","model":"haiku"},{"id":"ram","model":"haiku"}]}`,
			ours:   `{"roles":[{"id":"ux","model":"sonnet"},{"id":"ram","model":"haiku"}]}`,
			theirs: `{"roles":[{"id":"ux","model":"haiku"},{"id":"ram","model":"opus"}]}`,
			want:   `{"roles":[{"id":"ux","model":"sonnet"},{"id":"ram","model":"opus"}]}`,
		},
		{
			name:   "the same role edited on both sides keeps ours",
			base:   `{"roles":[{"id":"ux","model":"haiku"}]}`,
			ours:   `{"roles":[{"id":"ux","model":"sonnet"}]}`,
			theirs: `{"roles":[{"id":"ux","model":"opus"}]}`,
			want:   `{"roles":[{"id":"ux","model":"sonnet"}]}`,
		},
		{
			name:   "a role added on each side keeps both, ours first",
			base:   `{"roles":[]}`,
			ours:   `{"roles":[{"id":"a11y"}]}`,
			theirs: `{"roles":[{"id":"thesis"}]}`,
			want:   `{"roles":[{"id":"a11y"},{"id":"thesis"}]}`,
		},
		{
			name:   "a role deleted on one side and untouched on the other is gone",
			base:   `{"roles":[{"id":"ux"},{"id":"ram"}]}`,
			ours:   `{"roles":[{"id":"ux"}]}`,
			theirs: `{"roles":[{"id":"ux"},{"id":"ram"}]}`,
			want:   `{"roles":[{"id":"ux"}]}`,
		},
		{
			name:   "an edit outlives a concurrent delete",
			base:   `{"roles":[{"id":"ux","model":"haiku"}]}`,
			ours:   `{"roles":[]}`,
			theirs: `{"roles":[{"id":"ux","model":"opus"}]}`,
			want:   `{"roles":[{"id":"ux","model":"opus"}]}`,
		},
		{
			name:   "groups merge by id beside roles",
			base:   `{"roles":[{"id":"ux"}],"groups":[{"id":"g","roles":["ux"]}]}`,
			ours:   `{"roles":[{"id":"ux"},{"id":"a11y"}],"groups":[{"id":"g","roles":["ux"]}]}`,
			theirs: `{"roles":[{"id":"ux"}],"groups":[{"id":"g","roles":["ux","ram"]}]}`,
			want:   `{"roles":[{"id":"ux"},{"id":"a11y"}],"groups":[{"id":"g","roles":["ux","ram"]}]}`,
		},
		{
			name:   "no base: both files added on each machine join",
			ours:   `{"roles":[{"id":"ux","model":"sonnet"}]}`,
			theirs: `{"roles":[{"id":"ux","model":"opus"}],"groups":[{"id":"g","roles":["ux"]}]}`,
			want:   `{"roles":[{"id":"ux","model":"sonnet"}],"groups":[{"id":"g","roles":["ux"]}]}`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var base []byte
			if c.base != "" {
				base = []byte(c.base)
			}
			got, err := MergeCouncilRoles(base, []byte(c.ours), []byte(c.theirs))
			if err != nil {
				t.Fatalf("MergeCouncilRoles: %v", err)
			}
			if g, w := decodeRoles(t, got), decodeRoles(t, []byte(c.want)); !reflect.DeepEqual(g, w) {
				t.Errorf("merged = %s, want %s", got, c.want)
			}
		})
	}
}

func TestMergeCouncilRolesRejectsEntriesWithoutIds(t *testing.T) {
	for _, theirs := range []string{
		`{"roles":[{"name":"no id"}]}`,
		`{"roles":{"id":"ux"}}`,
		`{"roles":[{"id":"ux"},{"id":"ux"}]}`,
	} {
		if _, err := MergeCouncilRoles(nil, []byte(`{"roles":[]}`), []byte(theirs)); err == nil {
			t.Errorf("theirs %s: want an error, so sync keeps both copies", theirs)
		}
	}
}

func TestMergeConflictContentDispatchesCouncilRoles(t *testing.T) {
	blobs := map[int][]byte{
		stageBase:   []byte(`{"roles":[{"id":"ux"},{"id":"ram"}]}`),
		stageOurs:   []byte(`{"roles":[{"id":"ux","model":"sonnet"},{"id":"ram"}]}`),
		stageTheirs: []byte(`{"roles":[{"id":"ux"},{"id":"ram","model":"opus"}]}`),
	}
	got, ok := mergeConflictContent(CouncilRolesSyncPath, blobs)
	if !ok {
		t.Fatal("sync must merge config/councilroles.json, not keep a conflict copy")
	}
	want := `{"roles":[{"id":"ux","model":"sonnet"},{"id":"ram","model":"opus"}]}`
	if !reflect.DeepEqual(decodeRoles(t, got), decodeRoles(t, []byte(want))) {
		t.Errorf("merged = %s, want %s", got, want)
	}
}
