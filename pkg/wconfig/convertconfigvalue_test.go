// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"encoding/json"
	"reflect"
	"testing"
)

// converted is what SetBaseConfigValue writes into the settings file.
func converted(t *testing.T, num string, ctype reflect.Type) (string, error) {
	t.Helper()
	got, err := convertConfigValue("k", json.Number(num), ctype)
	if err != nil {
		return "", err
	}
	out, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal %#v: %v", got, err)
	}
	return string(out), nil
}

// A settings field declared *int (jobs:slots, debug:pprofport) must take a JSON number: SetConfig decodes the patch
// with UseNumber, so convertJsonNumber is the only way in.
func TestConvertConfigValueInt(t *testing.T) {
	got, err := converted(t, "3", reflect.TypeFor[*int]())
	if err != nil || got != "3" {
		t.Fatalf("got %q, %v; want 3", got, err)
	}
}

func TestConvertConfigValueIntRejectsFraction(t *testing.T) {
	if got, err := converted(t, "2.5", reflect.TypeFor[*int]()); err == nil {
		t.Fatalf("2.5 converted to an int setting: %q", got)
	}
}

func TestConvertConfigValueKeepsInt64AndFloat(t *testing.T) {
	if got, err := converted(t, "7", reflect.TypeFor[*int64]()); err != nil || got != "7" {
		t.Fatalf("int64: %q, %v", got, err)
	}
	if got, err := converted(t, "0.5", reflect.TypeFor[*float64]()); err != nil || got != "0.5" {
		t.Fatalf("float64: %q, %v", got, err)
	}
}
