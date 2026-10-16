// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package memhygiene

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func settingsRoundTrip(t *testing.T, before, value string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	writeFile(t, path, before)
	if err := SetAutoMemoryDirectory(path, value); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestSettingsInsert(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", ".claude", "settings.local.json")
	if err := SetAutoMemoryDirectory(path, `C:\mem\own`); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if want := "{\n  \"autoMemoryDirectory\": \"C:\\\\mem\\\\own\"\n}\n"; string(data) != want {
		t.Errorf("missing file:\n got %q\nwant %q", data, want)
	}

	for _, tc := range []struct{ before, want string }{
		{"{\n  \"a\": 1,\n  \"b\": [1, 2]\n}\n", "{\n  \"a\": 1,\n  \"b\": [1, 2],\n  \"autoMemoryDirectory\": \"/m\"\n}\n"},
		{`{"a":1}`, `{"a":1,"autoMemoryDirectory": "/m"}`},
		{"{}\n", "{\n  \"autoMemoryDirectory\": \"/m\"\n}\n"},
		// a nested key of the same name is not the top-level one
		{`{"x": {"autoMemoryDirectory": "keep"}}`, `{"x": {"autoMemoryDirectory": "keep"},"autoMemoryDirectory": "/m"}`},
	} {
		if got := settingsRoundTrip(t, tc.before, "/m"); got != tc.want {
			t.Errorf("insert into %q:\n got %q\nwant %q", tc.before, got, tc.want)
		}
	}
}

func TestSettingsReplace(t *testing.T) {
	for _, tc := range []struct{ before, want string }{
		{`{"autoMemoryDirectory":"old","z":true}`, `{"autoMemoryDirectory":"/new","z":true}`},
		{"{\n  \"a\": 1,\n  \"autoMemoryDirectory\" :  \"old\" ,\n  \"b\": 2\n}\n", "{\n  \"a\": 1,\n  \"autoMemoryDirectory\" :  \"/new\" ,\n  \"b\": 2\n}\n"},
		{`{"autoMemoryDirectory": null}`, `{"autoMemoryDirectory": "/new"}`},
	} {
		if got := settingsRoundTrip(t, tc.before, "/new"); got != tc.want {
			t.Errorf("replace in %q:\n got %q\nwant %q", tc.before, got, tc.want)
		}
	}
}

func TestSettingsOtherBytesUnchanged(t *testing.T) {
	before := "\ufeff{\r\n\t\"hooks\" :  {\"x\": [ 1,2 ]},\r\n\t\"model\": \"opus\"   \r\n}\r\n"
	want := "\ufeff{\r\n\t\"hooks\" :  {\"x\": [ 1,2 ]},\r\n\t\"model\": \"opus\",\r\n\t\"autoMemoryDirectory\": \"/m\"   \r\n}\r\n"
	if got := settingsRoundTrip(t, before, "/m"); got != want {
		t.Errorf("insert:\n got %q\nwant %q", got, want)
	}
	again := strings.Replace(want, `"/m"`, `"/n"`, 1)
	if got := settingsRoundTrip(t, want, "/n"); got != again {
		t.Errorf("replace:\n got %q\nwant %q", got, again)
	}
}

func TestSettingsRefusesNonObject(t *testing.T) {
	for _, before := range []string{`[1, 2]`, `"x"`, `null`, `{"a": `, ``} {
		path := filepath.Join(t.TempDir(), "settings.json")
		writeFile(t, path, before)
		err := SetAutoMemoryDirectory(path, "/m")
		if err == nil || !strings.Contains(err.Error(), path) {
			t.Errorf("%q: err = %v, want an error naming %s", before, err, path)
		}
		if data, _ := os.ReadFile(path); string(data) != before {
			t.Errorf("%q: the file changed to %q", before, data)
		}
	}
}
