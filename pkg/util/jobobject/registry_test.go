// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jobobject

import (
	"context"
	"testing"
)

func TestOwnerContextRoundTrip(t *testing.T) {
	if _, ok := OwnerFrom(context.Background()); ok {
		t.Fatal("OwnerFrom on a bare context reported an owner")
	}
	want := Owner{Kind: OwnerKind_RunCmd, Id: "run-1", Cmd: "Verify", Task: "3"}
	got, ok := OwnerFrom(WithOwner(context.Background(), want))
	if !ok || got != want {
		t.Fatalf("OwnerFrom = %+v, %v; want %+v, true", got, ok, want)
	}
}
