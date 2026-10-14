// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentsync"
	"github.com/wavetermdev/waveterm/pkg/learn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// learnHome gives the test its own home with a Claude config dir, so a reconcile projects into it and a learned
// memory lands in it. The notes store, muted list and vault are the package's; a test uses keys of its own.
func learnHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	// the handlers resolve the home the way this does; a test that wrote into the real one would be a bug to find
	if got := wavebase.GetHomeDir(); got != home {
		t.Fatalf("the test's home is not in force: %s", got)
	}
	if err := os.MkdirAll(filepath.Join(home, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	return home
}

// vaultSkill makes a skill in the test vault and removes it when the test ends.
func vaultSkill(t *testing.T, name string) {
	t.Helper()
	dir := filepath.Join(agentsync.DefaultPaths().SkillsRoot, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: "+name+"\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
}

func learnNote(t *testing.T, skill, cwd, key, text, session string) *wshrpc.CommandLearnNoteRtnData {
	t.Helper()
	rtn, err := (&WshServer{}).LearnNoteCommand(context.Background(), wshrpc.CommandLearnNoteData{
		Key: key, Skill: skill, Cwd: cwd, Text: text, Quote: "q " + session, Session: session,
	})
	if err != nil {
		t.Fatalf("note %s: %v", key, err)
	}
	return rtn
}

// proposeLearn notes key from two sessions, which makes it a proposal, and returns the proposal's id.
func proposeLearn(t *testing.T, skill, cwd, key, text string) string {
	t.Helper()
	learnNote(t, skill, cwd, key, text, "a:2026-10-01")
	if rtn := learnNote(t, skill, cwd, key, text, "b:2026-10-02"); !rtn.Proposed {
		t.Fatalf("%s: two sessions did not make a proposal", key)
	}
	target := "skill:" + skill
	if skill == "" {
		target = "memory:" + cwd
	}
	return learn.ID(target, key)
}

func decideLearn(id string, accept bool, text string) error {
	return (&WshServer{}).LearnDecideCommand(context.Background(), wshrpc.CommandLearnDecideData{ID: id, Accept: accept, Text: text})
}

func stillProposed(t *testing.T, id string) bool {
	t.Helper()
	_, err := learn.Default().Peek(id)
	if err != nil && !errors.Is(err, learn.ErrNoProposal) {
		t.Fatal(err)
	}
	return err == nil
}

func TestLearnNoteRefusesATargetThatIsNotThere(t *testing.T) {
	learnHome(t)
	vaultSkill(t, "learn-real-skill")
	ws := &WshServer{}
	_, err := ws.LearnNoteCommand(context.Background(), wshrpc.CommandLearnNoteData{Key: "k", Skill: "learn-ghost", Text: "t", Session: "a:2026-10-01"})
	if err == nil || !strings.Contains(err.Error(), `"learn-ghost" is not a skill in the vault`) ||
		!strings.Contains(err.Error(), "learn-real-skill") || !strings.Contains(err.Error(), "--memory") {
		t.Fatalf("a missing skill: %v", err)
	}
	if _, err := ws.LearnNoteCommand(context.Background(), wshrpc.CommandLearnNoteData{Key: "k", Text: "t", Session: "a:2026-10-01"}); err == nil {
		t.Fatal("a note with neither a skill nor a project is an error")
	}
	if _, err := ws.LearnNoteCommand(context.Background(), wshrpc.CommandLearnNoteData{Key: "k", Skill: "../x", Text: "t", Session: "a:2026-10-01"}); err == nil {
		t.Fatal("a skill name that leaves the vault is an error")
	}
}

func TestLearnNoteProposesFromTheSecondSession(t *testing.T) {
	learnHome(t)
	vaultSkill(t, "learn-prop-skill")
	if rtn := learnNote(t, "learn-prop-skill", "", "prop-key", "Be brief.", "a:2026-10-01"); rtn.Proposed || rtn.Muted {
		t.Fatalf("the first note: %+v", rtn)
	}
	if rtn := learnNote(t, "learn-prop-skill", "", "prop-key", "Be brief.", "a:2026-10-01"); rtn.Proposed {
		t.Fatalf("two notes in one session are one correction: %+v", rtn)
	}
	if rtn := learnNote(t, "learn-prop-skill", "", "prop-key", "Be brief.", "b:2026-10-02"); !rtn.Proposed {
		t.Fatalf("the second session: %+v", rtn)
	}
	keys, err := (&WshServer{}).LearnKeysCommand(context.Background(), wshrpc.CommandLearnKeysData{Skill: "learn-prop-skill"})
	if err != nil || len(keys) != 1 || keys[0] != (wshrpc.LearnKey{Key: "prop-key", Text: "Be brief.", Notes: 3}) {
		t.Fatalf("keys: %+v, %v", keys, err)
	}
}

func TestLearnDismissMutesTheKey(t *testing.T) {
	learnHome(t)
	vaultSkill(t, "learn-mute-skill")
	id := proposeLearn(t, "learn-mute-skill", "", "mute-key", "Be brief.")
	if err := decideLearn(id, false, ""); err != nil {
		t.Fatal(err)
	}
	if stillProposed(t, id) {
		t.Fatal("a dismissed proposal is gone")
	}
	if rtn := learnNote(t, "learn-mute-skill", "", "mute-key", "Be brief.", "c:2026-10-03"); !rtn.Muted || rtn.Proposed {
		t.Fatalf("a dismissed key is muted: %+v", rtn)
	}
	if err := decideLearn(id, false, ""); err == nil || !errors.Is(err, learn.ErrNoProposal) {
		t.Fatalf("deciding a proposal twice: %v", err)
	}
}

func TestLearnAcceptWritesTheSkillAdditionAndSyncsTheHarness(t *testing.T) {
	home := learnHome(t)
	vaultSkill(t, "learn-acc-skill")
	id := proposeLearn(t, "learn-acc-skill", "", "acc-key", "Be brief.")
	if err := decideLearn(id, true, "  Be very brief.  "); err != nil {
		t.Fatal(err)
	}
	root := agentsync.DefaultPaths().SkillsRoot
	got, err := agentsync.ReadAdditions(root, "learn-acc-skill")
	want := []agentsync.Addition{{Key: "acc-key", Text: "Be very brief.", Learned: time.Now().Format("2006-01-02"), Count: 2}}
	if err != nil || fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("additions %+v, %v; want %+v", got, err, want)
	}
	if stillProposed(t, id) {
		t.Fatal("an accepted proposal is cleared")
	}
	md, err := os.ReadFile(filepath.Join(home, ".claude", "skills", "learn-acc-skill", "SKILL.md"))
	if err != nil || !strings.Contains(string(md), "## Your additions") || !strings.Contains(string(md), "- Be very brief. (learned ") {
		t.Fatalf("the harness copy was not synced: %v\n%s", err, md)
	}
}

func TestLearnAcceptKeepsTheProposalWhenTheTargetCannotTakeIt(t *testing.T) {
	learnHome(t)

	vaultSkill(t, "learn-gone-skill")
	goneID := proposeLearn(t, "learn-gone-skill", "", "gone-key", "Be brief.")
	if err := os.RemoveAll(filepath.Join(agentsync.DefaultPaths().SkillsRoot, "learn-gone-skill")); err != nil {
		t.Fatal(err)
	}
	err := decideLearn(goneID, true, "")
	if err == nil || err.Error() != "the skill learn-gone-skill is no longer in the vault; dismiss this card" {
		t.Fatalf("a skill that left the vault: %v", err)
	}
	if !stillProposed(t, goneID) {
		t.Fatal("the card stays for the user to dismiss")
	}

	vaultSkill(t, "learn-full-skill")
	root := agentsync.DefaultPaths().SkillsRoot
	for i := 0; i < agentsync.MaxAdditions; i++ {
		a := agentsync.Addition{Key: fmt.Sprintf("full-%d", i), Text: "t", Learned: "2026-10-01", Count: 1}
		if err := agentsync.UpsertAddition(root, "learn-full-skill", a); err != nil {
			t.Fatal(err)
		}
	}
	fullID := proposeLearn(t, "learn-full-skill", "", "full-new", "Be brief.")
	if err := decideLearn(fullID, true, ""); !errors.Is(err, agentsync.ErrAdditionsFull) {
		t.Fatalf("a skill at the cap: %v", err)
	}
	if !stillProposed(t, fullID) {
		t.Fatal("the card stays when the skill is full")
	}
}

func TestLearnAcceptRefusesAnEditedLineThatBreaksTheRule(t *testing.T) {
	learnHome(t)
	vaultSkill(t, "learn-edit-skill")
	id := proposeLearn(t, "learn-edit-skill", "", "edit-key", "Be brief.")
	for _, text := range []string{"two\nlines", strings.Repeat("x", 201)} {
		if err := decideLearn(id, true, text); err == nil {
			t.Fatalf("edited text %q was accepted", text)
		}
	}
	if !stillProposed(t, id) {
		t.Fatal("a refused edit leaves the card")
	}
}

func TestLearnAcceptWritesAClaudeMemory(t *testing.T) {
	home := learnHome(t)
	cwd := filepath.Join(t.TempDir(), "proj")
	id := proposeLearn(t, "", cwd, "mem-key", "Use tabs.")
	if err := decideLearn(id, true, ""); err != nil {
		t.Fatal(err)
	}
	if stillProposed(t, id) {
		t.Fatal("an accepted proposal is cleared")
	}
	memories, err := learn.ListMemories(home)
	if err != nil || len(memories) != 1 {
		t.Fatalf("learned memories: %+v, %v", memories, err)
	}
	m := memories[0]
	if m.Cwd != cwd || m.Key != "mem-key" || m.Text != "Use tabs." || m.Count != 2 || m.Learned != time.Now().Format("2006-01-02") {
		t.Fatalf("memory: %+v", m)
	}
	body, err := os.ReadFile(filepath.Join(m.Dir, "learned_mem-key.md"))
	if err != nil || !strings.Contains(string(body), "q a:2026-10-01") || !strings.Contains(string(body), "q b:2026-10-02") {
		t.Fatalf("the memory file lacks the user's words: %v\n%s", err, body)
	}
}

func TestLearnAcceptedListsEverySkillLineAndMemory(t *testing.T) {
	home := learnHome(t)
	vaultSkill(t, "learn-list-skill")
	root := agentsync.DefaultPaths().SkillsRoot
	if err := agentsync.UpsertAddition(root, "learn-list-skill", agentsync.Addition{Key: "list-key", Text: "Be brief.", Learned: "2026-10-10", Count: 3}); err != nil {
		t.Fatal(err)
	}
	cwd := filepath.Join(t.TempDir(), "proj")
	if err := learn.UpsertMemory(home, learn.Memory{Cwd: cwd, Key: "list-mem", Text: "Use tabs.", Learned: "2026-10-11", Count: 2}, nil); err != nil {
		t.Fatal(err)
	}
	rtn, err := (&WshServer{}).LearnAcceptedCommand(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if rtn.Skills == nil || rtn.Memories == nil {
		t.Fatal("empty lists are slices, never nil")
	}
	var skill *wshrpc.LearnedSkillLine
	for i, s := range rtn.Skills {
		if s.Skill == "learn-list-skill" {
			skill = &rtn.Skills[i]
		}
	}
	if skill == nil || skill.LearnAddition != (wshrpc.LearnAddition{Key: "list-key", Text: "Be brief.", Learned: "2026-10-10", Count: 3}) {
		t.Fatalf("skills: %+v", rtn.Skills)
	}
	if len(rtn.Memories) != 1 || rtn.Memories[0].Cwd != cwd || rtn.Memories[0].Key != "list-mem" || rtn.Memories[0].Count != 2 {
		t.Fatalf("memories: %+v", rtn.Memories)
	}
}

func TestLearnAmendEditsAndRemovesASkillLine(t *testing.T) {
	home := learnHome(t)
	vaultSkill(t, "learn-amend-skill")
	root := agentsync.DefaultPaths().SkillsRoot
	if err := agentsync.UpsertAddition(root, "learn-amend-skill", agentsync.Addition{Key: "amend-key", Text: "Be brief.", Learned: "2026-10-10", Count: 3}); err != nil {
		t.Fatal(err)
	}
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Skill: "learn-amend-skill", Key: "amend-key", Text: "Be terse."}); err != nil {
		t.Fatal(err)
	}
	got, _ := agentsync.ReadAdditions(root, "learn-amend-skill")
	if fmt.Sprint(got) != fmt.Sprint([]agentsync.Addition{{Key: "amend-key", Text: "Be terse.", Learned: "2026-10-10", Count: 3}}) {
		t.Fatalf("an edit keeps the date and the count: %+v", got)
	}
	md, err := os.ReadFile(filepath.Join(home, ".claude", "skills", "learn-amend-skill", "SKILL.md"))
	if err != nil || !strings.Contains(string(md), "- Be terse. (learned 2026-10-10, 3×)") {
		t.Fatalf("the harness copy was not synced: %v\n%s", err, md)
	}
	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Skill: "learn-amend-skill", Key: "no-such", Text: "x"}); err == nil {
		t.Fatal("editing a line the skill does not hold is an error")
	}

	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Skill: "learn-amend-skill", Key: "amend-key", Remove: true}); err != nil {
		t.Fatal(err)
	}
	if got, _ := agentsync.ReadAdditions(root, "learn-amend-skill"); len(got) != 0 {
		t.Fatalf("the line is removed: %+v", got)
	}
	md, _ = os.ReadFile(filepath.Join(home, ".claude", "skills", "learn-amend-skill", "SKILL.md"))
	if strings.Contains(string(md), "Your additions") {
		t.Fatalf("the harness copy still has the block:\n%s", md)
	}
	if rtn := learnNote(t, "learn-amend-skill", "", "amend-key", "Be brief.", "a:2026-10-05"); !rtn.Muted {
		t.Fatalf("a removed line is muted: %+v", rtn)
	}
}

func TestLearnAmendEditsAndRemovesAMemory(t *testing.T) {
	home := learnHome(t)
	cwd := filepath.Join(t.TempDir(), "proj")
	if err := learn.UpsertMemory(home, learn.Memory{Cwd: cwd, Key: "amend-mem", Text: "Use tabs.", Learned: "2026-10-11", Count: 2}, []string{"use tabs"}); err != nil {
		t.Fatal(err)
	}
	dir := learn.MemoryDir(home, cwd)
	ws := &WshServer{}
	ctx := context.Background()
	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Dir: filepath.Join(dir, "..", "nowhere"), Key: "amend-mem", Remove: true}); err == nil {
		t.Fatal("a dir that holds no learned memory is refused")
	}
	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Dir: dir, Cwd: cwd, Key: "amend-mem", Text: "Use spaces."}); err != nil {
		t.Fatal(err)
	}
	memories, _ := learn.ListMemories(home)
	if len(memories) != 1 || memories[0].Text != "Use spaces." || memories[0].Learned != "2026-10-11" || memories[0].Count != 2 {
		t.Fatalf("an edit keeps the date and the count: %+v", memories)
	}
	if err := ws.LearnAmendCommand(ctx, wshrpc.CommandLearnAmendData{Dir: dir, Cwd: cwd, Key: "amend-mem", Remove: true}); err != nil {
		t.Fatal(err)
	}
	if memories, _ := learn.ListMemories(home); len(memories) != 0 {
		t.Fatalf("the memory is removed: %+v", memories)
	}
	if rtn := learnNote(t, "", cwd, "amend-mem", "Use tabs.", "a:2026-10-05"); !rtn.Muted {
		t.Fatalf("a removed memory is muted: %+v", rtn)
	}
}
