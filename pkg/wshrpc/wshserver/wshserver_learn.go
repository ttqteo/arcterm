// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/agentsync"
	"github.com/wavetermdev/waveterm/pkg/learn"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	learnDateLayout   = "2006-01-02"
	learnMaxTextRunes = 200
)

// learnTarget is the target a note, or a key listing, is about: a skill, else the project at cwd.
func learnTarget(skill, cwd string) (string, error) {
	switch {
	case skill != "":
		if err := checkSkillName(skill); err != nil {
			return "", err
		}
		return "skill:" + skill, nil
	case cwd != "":
		return "memory:" + cwd, nil
	}
	return "", errors.New("name a skill (--skill) or the project's directory (--memory)")
}

// checkSkillName refuses a name that would leave the skills directory.
func checkSkillName(name string) error {
	if name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("%q is not a skill name", name)
	}
	return nil
}

// checkLearnText trims a line the user edited and holds it to the rule a note's text follows.
func checkLearnText(text string) (string, error) {
	text = strings.TrimSpace(text)
	if c := utf8.RuneCountInString(text); c == 0 || c > learnMaxTextRunes {
		return "", fmt.Errorf("text must be 1-%d characters, got %d", learnMaxTextRunes, c)
	}
	if strings.ContainsAny(text, "\r\n") {
		return "", errors.New("text must be one line")
	}
	return text, nil
}

// vaultSkillNames lists the skills in the vault: the directories holding a SKILL.md.
func vaultSkillNames(skillsRoot string) ([]string, error) {
	entries, err := os.ReadDir(skillsRoot)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading the vault's skills: %w", err)
	}
	var names []string
	for _, e := range entries {
		if _, err := os.Stat(filepath.Join(skillsRoot, e.Name(), "SKILL.md")); err == nil {
			names = append(names, e.Name())
		}
	}
	return names, nil
}

// requireVaultSkill is the check a skill note passes: a plugin skill, or a misspelt name, is not one the
// additions can be written to, so the error names the ones that are.
func requireVaultSkill(skillsRoot, skill string) error {
	_, err := os.Stat(filepath.Join(skillsRoot, skill, "SKILL.md"))
	if err == nil {
		return nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("reading skill %s: %w", skill, err)
	}
	msg := fmt.Sprintf("%q is not a skill in the vault", skill)
	if names, err := vaultSkillNames(skillsRoot); err != nil {
		return err
	} else if len(names) > 0 {
		msg += "; the vault's skills are " + strings.Join(names, ", ")
	}
	return errors.New(msg + "; use --memory to note it for this project")
}

// syncHarnessSkills re-runs the reconcile so every harness's SKILL.md gets a change to additions.md now.
func syncHarnessSkills(p agentsync.Paths) error {
	if _, err := agentsync.Apply(p, false); err != nil {
		return fmt.Errorf("saved to the vault, but syncing the harnesses' skills failed: %w", err)
	}
	return nil
}

func (ws *WshServer) LearnNoteCommand(ctx context.Context, data wshrpc.CommandLearnNoteData) (*wshrpc.CommandLearnNoteRtnData, error) {
	target, err := learnTarget(data.Skill, data.Cwd)
	if err != nil {
		return nil, err
	}
	if data.Skill != "" {
		if err := requireVaultSkill(agentsync.DefaultPaths().SkillsRoot, data.Skill); err != nil {
			return nil, err
		}
	}
	store := learn.Default()
	err = store.Add(learn.Note{Key: data.Key, Target: target, Text: data.Text, Quote: data.Quote, Session: data.Session})
	if errors.Is(err, learn.ErrMuted) {
		return &wshrpc.CommandLearnNoteRtnData{Muted: true}, nil
	}
	if err != nil {
		return nil, err
	}
	pending, err := store.Pending()
	if err != nil {
		return nil, err
	}
	id := learn.ID(target, data.Key)
	return &wshrpc.CommandLearnNoteRtnData{
		Proposed: slices.ContainsFunc(pending, func(p learn.Proposal) bool { return p.ID == id }),
	}, nil
}

func (ws *WshServer) LearnKeysCommand(ctx context.Context, data wshrpc.CommandLearnKeysData) ([]wshrpc.LearnKey, error) {
	target, err := learnTarget(data.Skill, data.Cwd)
	if err != nil {
		return nil, err
	}
	keys, err := learn.Default().Keys(target)
	if err != nil {
		return nil, err
	}
	out := make([]wshrpc.LearnKey, 0, len(keys))
	for _, k := range keys {
		out = append(out, wshrpc.LearnKey{Key: k.Key, Text: k.Text, Notes: k.Notes})
	}
	return out, nil
}

// LearnDecideCommand accepts a proposal into its target, or dismisses it. An accept clears the proposal only after
// the target is written, so a failed write leaves the card for the user to retry or dismiss.
func (ws *WshServer) LearnDecideCommand(ctx context.Context, data wshrpc.CommandLearnDecideData) error {
	store := learn.Default()
	p, err := store.Peek(data.ID)
	if err != nil {
		return fmt.Errorf("%w: %s", err, data.ID)
	}
	if !data.Accept {
		return store.Mute(p.ID)
	}
	text := p.Text
	if edited := strings.TrimSpace(data.Text); edited != "" {
		if text, err = checkLearnText(edited); err != nil {
			return err
		}
	}
	today := time.Now().Format(learnDateLayout)

	if name, ok := strings.CutPrefix(p.Target, "skill:"); ok {
		paths := agentsync.DefaultPaths()
		err := agentsync.UpsertAddition(paths.SkillsRoot, name, agentsync.Addition{Key: p.Key, Text: text, Learned: today, Count: p.Sessions})
		if errors.Is(err, agentsync.ErrNoSkill) {
			return fmt.Errorf("the skill %s is no longer in the vault; dismiss this card", name)
		}
		if err != nil {
			return err
		}
		if _, err := store.Take(p.ID); err != nil {
			return err
		}
		return syncHarnessSkills(paths)
	}

	quotes := make([]string, 0, len(p.Quotes))
	for _, q := range p.Quotes {
		quotes = append(quotes, q.Quote)
	}
	m := learn.Memory{Cwd: strings.TrimPrefix(p.Target, "memory:"), Key: p.Key, Text: text, Learned: today, Count: p.Sessions}
	if err := learn.UpsertMemory(wavebase.GetHomeDir(), m, quotes); err != nil {
		return err
	}
	_, err = store.Take(p.ID)
	return err
}

func (ws *WshServer) LearnAcceptedCommand(ctx context.Context) (*wshrpc.CommandLearnAcceptedRtnData, error) {
	root := agentsync.DefaultPaths().SkillsRoot
	names, err := vaultSkillNames(root)
	if err != nil {
		return nil, err
	}
	out := &wshrpc.CommandLearnAcceptedRtnData{Skills: []wshrpc.LearnedSkillLine{}, Memories: []wshrpc.LearnedMemoryLine{}}
	for _, name := range names {
		additions, err := agentsync.ReadAdditions(root, name)
		if err != nil {
			return nil, err
		}
		for _, a := range additions {
			out.Skills = append(out.Skills, wshrpc.LearnedSkillLine{Skill: name, LearnAddition: learnAddition(a.Key, a.Text, a.Learned, a.Count)})
		}
	}
	memories, err := learn.ListMemories(wavebase.GetHomeDir())
	if err != nil {
		return nil, err
	}
	for _, m := range memories {
		out.Memories = append(out.Memories, wshrpc.LearnedMemoryLine{Cwd: m.Cwd, Dir: m.Dir, LearnAddition: learnAddition(m.Key, m.Text, m.Learned, m.Count)})
	}
	return out, nil
}

func learnAddition(key, text, learned string, count int) wshrpc.LearnAddition {
	return wshrpc.LearnAddition{Key: key, Text: text, Learned: learned, Count: count}
}

// LearnAmendCommand edits or removes a line the user accepted. A removal mutes the key: the user has said
// no to this rule, so it is not proposed again.
func (ws *WshServer) LearnAmendCommand(ctx context.Context, data wshrpc.CommandLearnAmendData) error {
	switch {
	case data.Skill != "":
		return amendSkillLine(data)
	case data.Dir != "":
		return amendMemory(data)
	}
	return errors.New("name the skill, or the memory dir, of the line to change")
}

func amendSkillLine(data wshrpc.CommandLearnAmendData) error {
	if err := checkSkillName(data.Skill); err != nil {
		return err
	}
	paths := agentsync.DefaultPaths()
	if data.Remove {
		if err := agentsync.RemoveAddition(paths.SkillsRoot, data.Skill, data.Key); err != nil {
			return err
		}
		if err := learn.Default().Mute(learn.ID("skill:"+data.Skill, data.Key)); err != nil {
			return err
		}
		return syncHarnessSkills(paths)
	}
	text, err := checkLearnText(data.Text)
	if err != nil {
		return err
	}
	list, err := agentsync.ReadAdditions(paths.SkillsRoot, data.Skill)
	if err != nil {
		return err
	}
	i := slices.IndexFunc(list, func(a agentsync.Addition) bool { return a.Key == data.Key })
	if i < 0 {
		return fmt.Errorf("the skill %s has no addition %q", data.Skill, data.Key)
	}
	// Count 0: an edit adds no evidence; the line keeps its date and its count
	if err := agentsync.UpsertAddition(paths.SkillsRoot, data.Skill, agentsync.Addition{Key: data.Key, Text: text, Learned: list[i].Learned}); err != nil {
		return err
	}
	return syncHarnessSkills(paths)
}

// amendMemory finds the memory among the learned ones, so a caller cannot point it at a file Claude wrote.
func amendMemory(data wshrpc.CommandLearnAmendData) error {
	home := wavebase.GetHomeDir()
	memories, err := learn.ListMemories(home)
	if err != nil {
		return err
	}
	dir := filepath.Clean(data.Dir)
	i := slices.IndexFunc(memories, func(m learn.Memory) bool { return filepath.Clean(m.Dir) == dir && m.Key == data.Key })
	if i < 0 {
		return fmt.Errorf("no learned memory %q in %s", data.Key, data.Dir)
	}
	m := memories[i]
	if data.Remove {
		if err := learn.RemoveMemory(m.Dir, m.Key); err != nil {
			return err
		}
		return learn.Default().Mute(learn.ID("memory:"+m.Cwd, m.Key))
	}
	text, err := checkLearnText(data.Text)
	if err != nil {
		return err
	}
	// Count 0 and no quotes: the file keeps its count and its Why block
	return learn.UpsertMemory(home, learn.Memory{Cwd: m.Cwd, Key: m.Key, Text: text, Learned: m.Learned}, nil)
}
