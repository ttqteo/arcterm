// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package cmd

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// outside an agent's terminal there is no block to report for: every subcommand says so, before it connects
func TestVerifyNeedsABlock(t *testing.T) {
	t.Setenv("WAVETERM_BLOCKID", "")
	if _, err := verifyBlockId(); err == nil || err.Error() != "not in an arcterm agent's terminal" {
		t.Fatalf("err = %v, want %q", err, "not in an arcterm agent's terminal")
	}
	// no JWT either: a PreRunE that read the block first answers with the block error, not the connection's
	t.Setenv("WAVETERM_JWT", "")
	for _, name := range []string{"report", "status", "gate"} {
		sub, _, err := verifyCmd.Find([]string{name})
		if err != nil || sub == verifyCmd {
			t.Fatalf("wsh verify %s is not a subcommand: %v", name, err)
		}
		if err := sub.PreRunE(sub, nil); err == nil || err.Error() != "not in an arcterm agent's terminal" {
			t.Fatalf("wsh verify %s outside a block: %v", name, err)
		}
	}
	t.Setenv("WAVETERM_BLOCKID", "b-1")
	if id, err := verifyBlockId(); err != nil || id != "b-1" {
		t.Fatalf("id %q err %v", id, err)
	}
}

func TestVerifyReportReadsOneDocumentAndFillsTheBlock(t *testing.T) {
	doc := `{"runid":"r1","phase":"end","pid":42,"cwd":"/w","command":"task verify:ui -- a","shotsdir":"/s",` +
		`"scenarios":[{"name":"a","files":["1.png"],"steps":[{"step":"1. x","state":"pass"},{"step":"2. y","state":"fail","detail":"nope"}],"done":true}]}`
	got, err := verifyReportFromReader(strings.NewReader(doc), "blk")
	if err != nil {
		t.Fatal(err)
	}
	if got.BlockId != "blk" || got.RunId != "r1" || got.Phase != "end" || got.Pid != 42 || got.Cwd != "/w" ||
		got.Command != "task verify:ui -- a" || got.ShotsDir != "/s" {
		t.Fatalf("report %+v", got)
	}
	if len(got.Scenarios) != 1 || got.Scenarios[0].Name != "a" || !got.Scenarios[0].Done ||
		len(got.Scenarios[0].Steps) != 2 || got.Scenarios[0].Steps[1].Detail != "nope" {
		t.Fatalf("scenarios %+v", got.Scenarios)
	}
}

// the block comes from where wsh runs, never from the document: a harness cannot report into another agent's tile
func TestVerifyReportBlockIsTheEnvironmentsNotTheDocuments(t *testing.T) {
	got, err := verifyReportFromReader(strings.NewReader(`{"blockid":"someone-else","runid":"r","phase":"start"}`), "mine")
	if err != nil {
		t.Fatal(err)
	}
	if got.BlockId != "mine" {
		t.Fatalf("block %q, want mine", got.BlockId)
	}
}

func TestVerifyReportRejectsWhatIsNotOneDocument(t *testing.T) {
	cases := map[string]string{
		"empty stdin":   "",
		"only spaces":   "  \n",
		"not json":      "{not json",
		"a json array":  `[{"runid":"r"}]`,
		"two documents": `{"runid":"r","phase":"start"}{"runid":"r","phase":"end"}`,
	}
	for name, in := range cases {
		if _, err := verifyReportFromReader(strings.NewReader(in), "blk"); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestVerifyStatusAndGateFlagsAreNamedAsTheSpecSays(t *testing.T) {
	status, _, _ := verifyCmd.Find([]string{"status"})
	if status.Flags().Lookup("cwd") == nil {
		t.Fatal("wsh verify status has no --cwd")
	}
	gate, _, _ := verifyCmd.Find([]string{"gate"})
	for _, name := range []string{"cwd", "command"} {
		if gate.Flags().Lookup(name) == nil {
			t.Fatalf("wsh verify gate has no --%s", name)
		}
	}
	if report, _, _ := verifyCmd.Find([]string{"report"}); report.Flags().Lookup("cwd") != nil {
		t.Fatal("wsh verify report reads its document from stdin and takes no --cwd")
	}
}

func TestVerifyStatusCwdDefaultsToTheWorkingDirectory(t *testing.T) {
	want, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	got, err := verifyCwd("")
	if err != nil || got != want {
		t.Fatalf("cwd %q err %v, want %q", got, err, want)
	}
	dir := t.TempDir()
	if got, err := verifyCwd(dir); err != nil || got != dir {
		t.Fatalf("an explicit --cwd: %q %v", got, err)
	}
}

func TestVerifyGateDataNeedsCwdAndCommand(t *testing.T) {
	data, err := verifyGateData("b", filepath.Join("D:", "repo"), "git merge x")
	if err != nil {
		t.Fatal(err)
	}
	if data.BlockId != "b" || data.Cwd != filepath.Join("D:", "repo") || data.Command != "git merge x" {
		t.Fatalf("data %+v", data)
	}
	if _, err := verifyGateData("b", "", "git merge x"); err == nil {
		t.Error("no --cwd: want an error")
	}
	if _, err := verifyGateData("b", "/w", ""); err == nil {
		t.Error("no --command: want an error")
	}
}

// the mod reads this line: both keys, always
func TestVerifyGateLineAlwaysHasBothKeys(t *testing.T) {
	cases := []struct {
		in   wshrpc.VerifyGateData
		want string
	}{
		{wshrpc.VerifyGateData{}, `{"ask":false,"reason":""}`},
		{wshrpc.VerifyGateData{Ask: true, Reason: "Verify: a failed step 2. Merge anyway?"}, `{"ask":true,"reason":"Verify: a failed step 2. Merge anyway?"}`},
	}
	for _, c := range cases {
		got, err := verifyGateLine(c.in)
		if err != nil || got != c.want {
			t.Errorf("line %q err %v, want %q", got, err, c.want)
		}
		var back struct {
			Ask    bool   `json:"ask"`
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal([]byte(got), &back); err != nil || back.Ask != c.in.Ask || back.Reason != c.in.Reason {
			t.Errorf("line %q does not read back: %+v %v", got, back, err)
		}
	}
}
