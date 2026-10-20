// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package envutil

import (
	"os"
	"strings"
	"testing"
)

func joinPath(parts ...string) string {
	return strings.Join(parts, string(os.PathListSeparator))
}

func TestMergePathListsAddsNewOSEntries(t *testing.T) {
	cur := joinPath(`C:\Windows`, `C:\Go\bin`)
	fresh := joinPath(`C:\Windows`, `C:\Go\bin`, `C:\Users\u\AppData\Local\Programs\mole-cli`)
	if got := mergePathLists(fresh, cur); got != fresh {
		t.Fatalf("got %q, want %q", got, fresh)
	}
}

func TestMergePathListsKeepsCurrentOnlyEntriesAfterOS(t *testing.T) {
	cur := joinPath(`D:\dev\tools`, `C:\Windows`)
	fresh := joinPath(`C:\Windows`, `C:\new`)
	want := joinPath(`C:\Windows`, `C:\new`, `D:\dev\tools`)
	if got := mergePathLists(fresh, cur); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestMergePathListsDedupesCaseAndTrailingSlash(t *testing.T) {
	cur := joinPath(`c:\windows\`, `C:\Go\bin`, ``)
	fresh := joinPath(`C:\Windows`, ``, `C:\GO\BIN\`)
	want := joinPath(`C:\Windows`, `C:\GO\BIN\`)
	if got := mergePathLists(fresh, cur); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestMergePathListsIsStableOnRepeat(t *testing.T) {
	fresh := joinPath(`C:\Windows`, `C:\new`)
	once := mergePathLists(fresh, joinPath(`D:\x`))
	if twice := mergePathLists(fresh, once); twice != once {
		t.Fatalf("second refresh changed PATH: %q -> %q", once, twice)
	}
}
