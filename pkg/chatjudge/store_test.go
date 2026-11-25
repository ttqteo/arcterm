// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package chatjudge

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// sampleRecord is a turn that ends in "A hay B?", kept under key with timestamp ts.
func sampleRecord(key string, ts int64) wshrpc.ChatJudgeRecord {
	rec := NewRecord(key, "blk-1", "A hay B?", []string{"làm đi"},
		[]string{"A, sửa parseFrame", "B, gom byte ở readLoop"},
		[]string{"đổi ba nơi gọi parseFrame", "gom byte một lần ở readLoop"},
		"A, sửa parseFrame", "light reason, read the reply only")
	rec.Ts = ts
	return rec
}

func TestQualifies(t *testing.T) {
	cases := []struct {
		choice  bool
		replies []string
		want    bool
	}{
		{true, []string{"A", "B"}, true},
		{true, []string{"A", "B", "C"}, true},
		{true, []string{"A"}, false},
		{true, nil, false},
		{false, []string{"A", "B"}, false},
	}
	for _, c := range cases {
		if got := Qualifies(c.choice, c.replies); got != c.want {
			t.Errorf("Qualifies(%v, %v) = %v, want %v", c.choice, c.replies, got, c.want)
		}
	}
}

func TestNewRecord(t *testing.T) {
	rec := NewRecord("a1:10:abc", "blk", "A hay B?", []string{"x"}, []string{"A", "B"}, []string{"does a"}, "B", "because")
	want := []wshrpc.ChatJudgeOption{{Text: "A", Desc: "does a"}, {Text: "B"}}
	if !reflect.DeepEqual(rec.Options, want) {
		t.Errorf("options %+v, want %+v (a missing description stays empty)", rec.Options, want)
	}
	if rec.Key != "a1:10:abc" || rec.BlockId != "blk" || rec.Question != "A hay B?" || rec.Pick != "B" || rec.Reason != "because" {
		t.Errorf("record %+v", rec)
	}
	if rec.Ts <= 0 {
		t.Errorf("Ts %d, want Unix milliseconds", rec.Ts)
	}
	if rec.Deep != nil {
		t.Errorf("a new record has no deep result: %+v", rec.Deep)
	}
	if rec := NewRecord("k:1:a", "", "Q?", nil, nil, nil, "", ""); rec.Options == nil {
		t.Error("options is nil: the wire carries null, the frontend expects []")
	}
}

func TestStoreRoundTripAndCap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "chatjudge.json")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatalf("a missing file is an empty store: %v", err)
	}
	if got := s.List("a1"); got == nil || len(got) != 0 {
		t.Fatalf("empty store lists %#v, want an empty non-nil slice", got)
	}
	r1 := sampleRecord("a1:10:aaa", 100)
	r2 := sampleRecord("a1:20:bbb", 300)
	r3 := sampleRecord("a1:30:ccc", 200)
	other := sampleRecord("a10:5:ddd", 50) // agent a10 is not agent a1
	for _, r := range []wshrpc.ChatJudgeRecord{r1, r2, r3, other} {
		if err := s.Put(r); err != nil {
			t.Fatalf("Put %s: %v", r.Key, err)
		}
	}
	if got, ok := s.Get(r2.Key); !ok || !reflect.DeepEqual(got, r2) {
		t.Errorf("Get = %+v, %v; want %+v", got, ok, r2)
	}
	if _, ok := s.Get("a1:99:none"); ok {
		t.Error("Get of an unknown key found a record")
	}
	if got, want := keysOf(s.List("a1")), []string{r1.Key, r3.Key, r2.Key}; !reflect.DeepEqual(got, want) {
		t.Errorf("List(a1) = %v, want %v (oldest first, only agent a1)", got, want)
	}
	if got, want := keysOf(s.List("a10")), []string{other.Key}; !reflect.DeepEqual(got, want) {
		t.Errorf("List(a10) = %v, want %v", got, want)
	}
	if got := s.List(""); len(got) != 0 {
		t.Errorf("List of no agent = %v, want none", got)
	}

	// a second store over the same file reads the records back
	again, err := OpenStore(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if got, ok := again.Get(r3.Key); !ok || !reflect.DeepEqual(got, r3) {
		t.Errorf("after reopen Get = %+v, %v; want %+v", got, ok, r3)
	}
	if got, want := keysOf(again.List("a1")), []string{r1.Key, r3.Key, r2.Key}; !reflect.DeepEqual(got, want) {
		t.Errorf("after reopen List(a1) = %v, want %v", got, want)
	}

	// a put with an existing key replaces the record
	r1b := r1
	r1b.Reason = "changed"
	if err := s.Put(r1b); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Get(r1.Key); got.Reason != "changed" {
		t.Errorf("Put of an existing key kept %q", got.Reason)
	}
	if err := s.Put(wshrpc.ChatJudgeRecord{}); err == nil {
		t.Error("a record with no key was stored")
	}

	// the cap: the 501st record drops the oldest by Ts
	capPath := filepath.Join(t.TempDir(), "cap.json")
	capped, err := OpenStore(capPath)
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= MaxRecords+1; i++ {
		rec := wshrpc.ChatJudgeRecord{Key: fmt.Sprintf("cap:%d:x", i), Ts: int64(i)}
		if err := capped.Put(rec); err != nil {
			t.Fatalf("Put %d: %v", i, err)
		}
	}
	list := capped.List("cap")
	if len(list) != MaxRecords {
		t.Fatalf("kept %d records, want %d", len(list), MaxRecords)
	}
	if _, ok := capped.Get("cap:1:x"); ok {
		t.Error("the oldest record survived the cap")
	}
	if list[0].Key != "cap:2:x" || list[len(list)-1].Key != fmt.Sprintf("cap:%d:x", MaxRecords+1) {
		t.Errorf("kept %s … %s", list[0].Key, list[len(list)-1].Key)
	}
	reread, err := OpenStore(capPath)
	if err != nil {
		t.Fatalf("reopen the capped file: %v", err)
	}
	if n := len(reread.List("cap")); n != MaxRecords {
		t.Errorf("the file holds %d records, want %d", n, MaxRecords)
	}
	if _, ok := reread.Get("cap:1:x"); ok {
		t.Error("the file kept the dropped record")
	}
}

func TestStoreOpenTurnsReadingIntoFailed(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chatjudge.json")
	s, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range []wshrpc.ChatJudgeRecord{sampleRecord("a1:1:r", 1), sampleRecord("a1:2:d", 2), sampleRecord("a1:3:n", 3)} {
		if err := s.Put(r); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.SetDeep("a1:1:r", wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Reading, StartTs: 1000}); err != nil {
		t.Fatal(err)
	}
	done := wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Done, StartTs: 10, EndTs: 20, Pick: "B, gom byte ở readLoop", Reason: "conn.go:212", Model: "sonnet", Tokens: 5, Files: 2}
	if _, err := s.SetDeep("a1:2:d", done); err != nil {
		t.Fatal(err)
	}

	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := reopened.Get("a1:1:r")
	if got.Deep == nil || got.Deep.State != wshrpc.ChatJudgeState_Failed || got.Deep.Error != "Arc restarted while the judge read" || got.Deep.StartTs != 1000 {
		t.Errorf("a record left reading came back as %+v", got.Deep)
	}
	if got, _ := reopened.Get("a1:2:d"); !reflect.DeepEqual(got.Deep, &done) {
		t.Errorf("a done record changed: %+v", got.Deep)
	}
	if got, _ := reopened.Get("a1:3:n"); got.Deep != nil {
		t.Errorf("a record with no deep result gained %+v", got.Deep)
	}
}

func TestStoreOpenUnreadableStartsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "chatjudge.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := OpenStore(path)
	if err == nil {
		t.Error("an unreadable file gave no error for the caller to log")
	}
	if s == nil {
		t.Fatal("no store: wavesrv would fail to start")
	}
	if got := s.List("a1"); len(got) != 0 {
		t.Errorf("an unreadable file listed %v", got)
	}
	if err := s.Put(sampleRecord("a1:1:x", 1)); err != nil {
		t.Fatalf("the empty store should work: %v", err)
	}
	if again, err := OpenStore(path); err != nil || len(again.List("a1")) != 1 {
		t.Errorf("after a Put the file reads back: %v, %d records", err, len(again.List("a1")))
	}
}

func TestStoreSetDeep(t *testing.T) {
	s, err := OpenStore(filepath.Join(t.TempDir(), "chatjudge.json"))
	if err != nil {
		t.Fatal(err)
	}
	rec := sampleRecord("a1:1:x", 1)
	if err := s.Put(rec); err != nil {
		t.Fatal(err)
	}
	deep := wshrpc.ChatJudgeDeep{State: wshrpc.ChatJudgeState_Reading, StartTs: 5}
	got, err := s.SetDeep(rec.Key, deep)
	if err != nil {
		t.Fatal(err)
	}
	if got.Deep == nil || got.Deep.State != wshrpc.ChatJudgeState_Reading || got.Pick != rec.Pick || len(got.Options) != 2 {
		t.Errorf("SetDeep returned %+v", got)
	}
	if stored, _ := s.Get(rec.Key); !reflect.DeepEqual(stored, got) {
		t.Errorf("stored %+v differs from the returned %+v", stored, got)
	}
	if _, err := s.SetDeep("a1:9:none", deep); err == nil {
		t.Error("SetDeep of an unknown key succeeded")
	}
}

func keysOf(recs []wshrpc.ChatJudgeRecord) []string {
	keys := []string{}
	for _, r := range recs {
		keys = append(keys, r.Key)
	}
	return keys
}
