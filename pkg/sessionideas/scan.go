// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package sessionideas

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// Marker opens the first prompt of an agent Session ideas starts to decide an idea (Discuss, Go through). A scan skips
// the session of a prompt that starts with it, so the talk about an idea is not proposed as a new one.
const Marker = "[arc:session-ideas]"

const (
	// quietFor is how long a transcript must stand unwritten before a scan reads it: a younger one is still being written.
	quietFor = 48 * time.Hour

	// transcriptKeptFor is how long Claude keeps a transcript after its last write, until the schedule reads the real
	// cleanupPeriodDays from ~/.claude/settings.json.
	transcriptKeptFor = 90 * 24 * time.Hour

	maxQuotes   = 3
	maxErrorLen = 200
)

// Deps is what a scan reaches outside the package for: the model, the project's initiatives, the sessions on disk and
// the clock. The wshserver builds it, because what it reads needs pkg/jarvis and pkg/effortstore.
type Deps struct {
	// Run is one model call: the prompt in, the reply and the tokens the call used out.
	Run func(ctx context.Context, prompt string) (reply string, tokens int64, err error)
	// ProjectContext is what the project of a session's folder already holds. It may return a partial context with an
	// error; the scan goes on with what it got.
	ProjectContext func(ctx context.Context, projectPath string) (ProjectContext, error)
	// Candidates lists the transcripts on disk: their own fields, no turns.
	Candidates func() []agentsessions.DigestSession
	// Read is one transcript's digest, with its session and turns.
	Read func(path string) (agentsessions.DigestSession, error)
	// Now is the clock (nil is time.Now).
	Now func() time.Time
}

func (d Deps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// ScanOpts says what a scan reads. Paths is the transcripts to read; empty is every quiet session not yet scanned (no
// mark, or a mark whose size or mtime changed). Forced says the schedule started it, not the person.
type ScanOpts struct {
	Forced bool
	Paths  []string
}

// Eligible says whether a scan may read a transcript, from what a candidate carries: it is not in the archive (arcterm's
// own folder), it has not been written for 2 days, and no mark holds its size and mtime.
func Eligible(s agentsessions.DigestSession, marks []wshrpc.SessionIdeaMark, now time.Time) bool {
	if s.Archived || now.Sub(s.Mtime) < quietFor {
		return false
	}
	for _, m := range marks {
		if m.TranscriptPath == s.Path && m.Size == s.Size && m.MtimeMs == s.Mtime.UnixMilli() {
			return false
		}
	}
	return true
}

// SkipContent says whether a digest is passed over without a model call, and why: its first prompt carries Marker (an
// agent Session ideas opened), or it holds no prompt of the person's.
func SkipContent(d agentsessions.DigestSession) (bool, string) {
	for _, t := range d.Turns {
		if t.Speaker != speakerUser {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(t.Text), Marker) {
			return true, "an agent Session ideas opened"
		}
		return false, ""
	}
	return true, "no prompt of the person's"
}

// ScanNow reads the sessions opts names and stores the ideas it finds. The sessions go nearest deletion first; the store
// holds the scan's progress after each one, and each ends with a mark. A model error, or a cancelled ctx, stops the scan:
// the store keeps what was found and the scan's Error and StoppedAt, and the next scan goes on from there. ScanNow
// returns the error that stopped it.
func ScanNow(ctx context.Context, s *Store, deps Deps, opts ScanOpts) error {
	started := deps.now()
	cur, err := s.Load()
	if err != nil {
		return err // a scan that went on from an empty store would write over what it could not read
	}
	work := pickWork(deps.Candidates(), cur.Marks, opts, started)
	marks := map[string]wshrpc.SessionIdeaMark{}
	for _, m := range cur.Marks {
		marks[m.TranscriptPath] = m
	}

	scan := wshrpc.SessionIdeasScan{Total: len(work), StartedTs: started.UnixMilli(), Forced: opts.Forced}
	save := func(fn func(d *wshrpc.SessionIdeasData)) error {
		return s.Update(func(d *wshrpc.SessionIdeasData) error {
			if fn != nil {
				fn(d)
			}
			c := scan
			d.Scan = &c
			return nil
		})
	}
	if err := save(nil); err != nil {
		return err
	}

	projects := map[string]ProjectContext{}
	var stop error
	for _, c := range work {
		if stop = ctx.Err(); stop != nil {
			break
		}
		res, err := scanSession(ctx, s, deps, c, marks, projects)
		scan.Tokens += res.tokens
		if err != nil {
			stop = err
			break
		}
		scan.Done++
		saveErr := save(func(d *wshrpc.SessionIdeasData) {
			added := addIdeas(d, res.ideas)
			scan.NewIdeas += added
			if res.mark != nil {
				res.mark.Ideas = added
				if added > 0 {
					res.mark.Outcome = wshrpc.SessionIdeaOutcome_Ideas
				}
				upsertMark(d, *res.mark)
			}
		})
		if saveErr != nil {
			return fmt.Errorf("saving the scan after %s: %w", c.Path, saveErr)
		}
	}

	ended := deps.now()
	scan.EndedTs = ended.UnixMilli()
	if stop != nil {
		scan.StoppedAt = scan.Done
		scan.Error = stopText(ctx, stop)
	}
	if err := save(func(d *wshrpc.SessionIdeasData) {
		d.LastScanTs = scan.EndedTs
		if !opts.Forced {
			d.FirstScanDone = true
		}
	}); err != nil {
		return errors.Join(stop, fmt.Errorf("saving the end of the scan: %w", err))
	}
	return stop
}

// stopText is what the scan's Error says: a stop by the person is "stopped", a model error is its own text, cut short.
func stopText(ctx context.Context, err error) string {
	if ctx.Err() != nil {
		return "stopped"
	}
	return truncateRunes(oneLine(err.Error()), maxErrorLen)
}

// pickWork is the sessions a scan reads, oldest write first (nearest deletion): opts.Paths when given, each resolved
// through the candidates and passed through Eligible, else every eligible candidate.
func pickWork(cands []agentsessions.DigestSession, marks []wshrpc.SessionIdeaMark, opts ScanOpts, now time.Time) []agentsessions.DigestSession {
	var work []agentsessions.DigestSession
	if len(opts.Paths) == 0 {
		for _, c := range cands {
			if Eligible(c, marks, now) {
				work = append(work, c)
			}
		}
	} else {
		byPath := map[string]agentsessions.DigestSession{}
		for _, c := range cands {
			byPath[c.Path] = c
		}
		seen := map[string]bool{}
		for _, p := range opts.Paths {
			c, ok := byPath[p]
			if !ok {
				c, ok = byPath[filepath.Clean(p)]
			}
			switch {
			case !ok:
				log.Printf("sessionideas: scan skips %s: not a candidate", p)
			case seen[c.Path]:
			case !Eligible(c, marks, now):
				log.Printf("sessionideas: scan skips %s: archived, written within 2 days, or already scanned", p)
			default:
				seen[c.Path] = true
				work = append(work, c)
			}
		}
	}
	sort.SliceStable(work, func(i, j int) bool {
		if !work[i].Mtime.Equal(work[j].Mtime) {
			return work[i].Mtime.Before(work[j].Mtime)
		}
		return work[i].Path < work[j].Path
	})
	return work
}

// sessionResult is what one session gave: its mark (nil when the session was left unread or unanswered, so the next scan
// tries it again), the ideas the model listed and the tokens the call used.
type sessionResult struct {
	mark   *wshrpc.SessionIdeaMark
	ideas  []wshrpc.SessionIdea
	tokens int64
}

// scanSession reads one session. The error it returns stops the scan: a model error, a cancelled ctx or a store that
// cannot be read. A session that cannot be read, or whose reply is not a list, is logged and left unmarked instead, so
// one bad transcript does not hold up the rest.
func scanSession(ctx context.Context, s *Store, deps Deps, c agentsessions.DigestSession, marks map[string]wshrpc.SessionIdeaMark, projects map[string]ProjectContext) (sessionResult, error) {
	dg, err := deps.Read(c.Path)
	if err != nil {
		log.Printf("sessionideas: reading %s: %v; not scanned", c.Path, err)
		return sessionResult{}, nil
	}
	now := deps.now()
	mark := wshrpc.SessionIdeaMark{
		TranscriptPath: c.Path, SessionID: c.Stem, Size: c.Size, MtimeMs: c.Mtime.UnixMilli(), ScannedTs: now.UnixMilli(),
		Outcome: wshrpc.SessionIdeaOutcome_Nothing,
	}
	var info agentsessions.SessionInfo
	if dg.Session != nil {
		info = *dg.Session
		if info.ID != "" {
			mark.SessionID = info.ID
		}
		mark.SessionTitle, mark.Project = info.Task, info.ProjectName
	}
	if skip, why := SkipContent(dg); skip {
		log.Printf("sessionideas: %s passed over: %s", c.Path, why)
		mark.Outcome = wshrpc.SessionIdeaOutcome_Skipped
		return sessionResult{mark: &mark}, nil
	}

	turns := dg.Turns
	prev, grown := marks[c.Path]
	grown = grown && prev.LastTurnTs > 0
	if grown {
		turns = turnsAfter(turns, prev.LastTurnTs)
	}
	mark.LastTurnTs = dg.Turns[len(dg.Turns)-1].Ts
	if len(turns) == 0 {
		return sessionResult{mark: &mark}, nil // it grew by nothing a person reads
	}

	pc, ok := projects[info.ProjectPath]
	if !ok {
		if pc, err = deps.ProjectContext(ctx, info.ProjectPath); err != nil {
			log.Printf("sessionideas: the project context of %s is partial, going on without the rest: %v", info.ProjectPath, err)
		}
		projects[info.ProjectPath] = pc
	}
	project, projectPath := firstNonEmpty(pc.Name, info.ProjectName), firstNonEmpty(pc.Root, info.ProjectPath)
	mark.Project = project
	stored, err := s.Load()
	if err != nil {
		return sessionResult{}, err
	}
	pc.Known = KnownGists(stored.Ideas, projectPath)

	reply, tokens, err := deps.Run(ctx, Prompt(info.Task, turns, grown, pc))
	res := sessionResult{tokens: tokens}
	if err != nil {
		return res, err
	}
	raws, err := ParseReply(reply)
	if err != nil {
		log.Printf("sessionideas: the reply for %s is unusable, not scanned: %v", c.Path, err)
		return res, nil
	}
	res.mark = &mark
	for _, r := range raws {
		gist := oneLine(r.Gist)
		if gist == "" {
			continue
		}
		quotes := cleanQuotes(r.Quotes)
		idea := wshrpc.SessionIdea{
			ID: uuid.NewString(), Gist: gist, Project: project, ProjectPath: projectPath, Quotes: quotes, Why: oneLine(r.Why),
			SessionID: mark.SessionID, SessionTitle: mark.SessionTitle, TranscriptPath: c.Path,
			SaidTs: saidTs(quotes, turns), DeletesTs: c.Mtime.Add(transcriptKeptFor).UnixMilli(), FoundTs: now.UnixMilli(),
			State: wshrpc.SessionIdeaState_Review,
		}
		for _, in := range pc.Initiatives {
			if in.OID == strings.TrimSpace(r.Effort) {
				idea.EffortOID, idea.EffortTitle = in.OID, in.Title
				break
			}
		}
		res.ideas = append(res.ideas, idea)
	}
	return res, nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// turnsAfter is the turns written after ts.
func turnsAfter(turns []agentsessions.Turn, ts int64) []agentsessions.Turn {
	var out []agentsessions.Turn
	for _, t := range turns {
		if t.Ts > ts {
			out = append(out, t)
		}
	}
	return out
}

// cleanQuotes keeps at most three quotes, each with a text and a speaker of "you" or "agent".
func cleanQuotes(raw []RawQuote) []wshrpc.SessionIdeaQuote {
	out := []wshrpc.SessionIdeaQuote{}
	for _, q := range raw {
		text := strings.TrimSpace(q.Text)
		if text == "" {
			continue
		}
		who := "agent"
		if w := strings.ToLower(strings.TrimSpace(q.Who)); w == "you" || w == "user" {
			who = "you"
		}
		out = append(out, wshrpc.SessionIdeaQuote{Who: who, Text: text})
		if len(out) == maxQuotes {
			break
		}
	}
	return out
}

// saidTs is when the idea was floated: the turn that holds its first quote, else the last turn read.
func saidTs(quotes []wshrpc.SessionIdeaQuote, turns []agentsessions.Turn) int64 {
	if len(quotes) > 0 {
		for _, t := range turns {
			if strings.Contains(t.Text, quotes[0].Text) {
				return t.Ts
			}
		}
	}
	if len(turns) > 0 {
		return turns[len(turns)-1].Ts
	}
	return 0
}

// addIdeas appends the ideas the store does not hold yet for their project, in any state, and returns how many it added.
func addIdeas(d *wshrpc.SessionIdeasData, ideas []wshrpc.SessionIdea) int {
	added := 0
	for _, idea := range ideas {
		key := gistKey(idea.Gist)
		dup := key == ""
		for _, have := range d.Ideas {
			if gistKey(have.Gist) == key && samePath(have.ProjectPath, idea.ProjectPath) {
				dup = true
				break
			}
		}
		if dup {
			continue
		}
		d.Ideas = append(d.Ideas, idea)
		added++
	}
	return added
}

// upsertMark puts a session's mark in the store: the one of the same transcript is replaced.
func upsertMark(d *wshrpc.SessionIdeasData, m wshrpc.SessionIdeaMark) {
	for i := range d.Marks {
		if d.Marks[i].TranscriptPath == m.TranscriptPath {
			d.Marks[i] = m
			return
		}
	}
	d.Marks = append(d.Marks, m)
}
