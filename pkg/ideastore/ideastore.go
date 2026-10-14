// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package ideastore keeps the ideas, decisions and open questions of a brainstorm as one JSON file per
// agent session, <data dir>/ideas/<sessionid>.json. They are one session's working notes, not memory, so
// they stay out of the vault and its git sync. Only wavesrv writes them (wsh goes through RPC), so an
// in-process lock suffices.
package ideastore

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

const (
	// IdeasDir holds one <sessionid>.json file per session, under the data dir.
	IdeasDir = "ideas"

	KindDecision = "decision"
	KindIdea     = "idea"
	KindQuestion = "question"

	ByAgent = "agent"
	ByYou   = "you"

	OpEdit    = "edit"
	OpKind    = "kind"
	OpTopic   = "topic"
	OpDrop    = "drop"
	OpRestore = "restore"
	OpMerge   = "merge"
	OpSeen    = "seen"

	idPrefix   = "i"
	mergeJoin  = "; "
	nudgeAfter = 3  // prompts without a new idea, and between two nudges
	topicMax   = 40 // runes: a topic is a few words, a heading on the rail
)

var (
	// a session id is the agent session's uuid; the pattern also keeps it inside ideas/
	sessionRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

	// ponytail: one lock for every session; per-session locks if ideas are ever written concurrently in bulk
	mu           sync.Mutex
	rootOverride string
	now          = time.Now

	// pending counts the prompts of a session that has no ideas file yet (Tick leaves no file for a session
	// with no ideas), so its first idea's Turn is right. It is lost on restart, which only loses that Turn.
	// ponytail: one int per session that never gets an idea, for the life of the process
	pending = map[string]int{}
)

type Idea struct {
	ID      string `json:"id"` // "i1", "i2"… unique within the session
	Text    string `json:"text"`
	Kind    string `json:"kind"`            // KindDecision | KindIdea | KindQuestion
	By      string `json:"by"`              // ByAgent | ByYou
	Topic   string `json:"topic,omitempty"` // a few words grouping it on the rail; "" = none
	Turn    int    `json:"turn,omitempty"`  // prompts submitted when it was added; 0 = not known
	Ts      int64  `json:"ts"`              // epoch ms
	Dropped bool   `json:"dropped,omitempty"`
}

type SessionIdeas struct {
	SessionId      string `json:"sessionid"`
	SeenAt         int64  `json:"seenat"`
	Prompts        int    `json:"prompts"`        // UserPromptSubmit count, from Tick
	LastIdeaPrompt int    `json:"lastideaprompt"` // Prompts when the last idea was added
	NudgedAt       int    `json:"nudgedat"`       // Prompts when the last nudge went out
	NextId         int    `json:"nextid"`
	Ideas          []Idea `json:"ideas"`
}

// Op is one change to a session's ideas. Edit takes one id and Text; Kind takes ids and NewKind; Topic takes ids
// and Topic ("" clears it); Drop and Restore take ids; Merge takes two or more ids; Seen takes none.
type Op struct {
	Kind    string   `json:"kind"`
	Ids     []string `json:"ids,omitempty"`
	Text    string   `json:"text,omitempty"`
	NewKind string   `json:"newkind,omitempty"`
	Topic   string   `json:"topic,omitempty"`
}

// UseRootForTest points the store at a temp data dir and returns the restore func.
func UseRootForTest(root string) (restore func()) {
	mu.Lock()
	defer mu.Unlock()
	prev := rootOverride
	rootOverride = root
	return func() {
		mu.Lock()
		defer mu.Unlock()
		rootOverride = prev
	}
}

// callers hold mu
func ideasDir() string {
	if rootOverride != "" {
		return filepath.Join(rootOverride, IdeasDir)
	}
	return filepath.Join(wavebase.GetWaveDataDir(), IdeasDir)
}

func sessionPath(sessionId string) (string, error) {
	if !sessionRe.MatchString(sessionId) {
		return "", fmt.Errorf("invalid session id %q", sessionId)
	}
	return filepath.Join(ideasDir(), sessionId+".json"), nil
}

func validKind(kind string) bool {
	return kind == KindDecision || kind == KindIdea || kind == KindQuestion
}

// load reads a session's file; a missing file reads as an empty session (and reports it did not exist).
// Callers hold mu.
func load(sessionId string) (s SessionIdeas, exists bool, err error) {
	path, err := sessionPath(sessionId)
	if err != nil {
		return SessionIdeas{}, false, err
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return SessionIdeas{SessionId: sessionId, Prompts: pending[sessionId], Ideas: []Idea{}}, false, nil
	}
	if err != nil {
		return SessionIdeas{}, false, fmt.Errorf("read ideas %s: %w", path, err)
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return SessionIdeas{}, false, fmt.Errorf("parse ideas %s: %w", path, err)
	}
	s.SessionId = sessionId
	if s.Ideas == nil {
		s.Ideas = []Idea{}
	}
	return s, true, nil
}

// save writes the session's file, making the ideas dir first. Callers hold mu.
func save(s *SessionIdeas) error {
	path, err := sessionPath(s.SessionId)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("encode ideas %s: %w", path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
	}
	if err := fileutil.AtomicWriteFile(path, append(b, '\n'), 0o644); err != nil {
		return fmt.Errorf("write ideas %s: %w", path, err)
	}
	return nil
}

// idNum is the number in an id ("i12" is 12), 0 for an id of another shape.
func idNum(id string) int {
	rest, ok := strings.CutPrefix(id, idPrefix)
	if !ok {
		return 0
	}
	n, err := strconv.Atoi(rest)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// nextID hands out the next id and records it. It goes past the highest id on file too, in case a hand
// edit left NextId behind.
func nextID(s *SessionIdeas) string {
	n := s.NextId
	for _, idea := range s.Ideas {
		n = max(n, idNum(idea.ID))
	}
	n++
	s.NextId = n
	return idPrefix + strconv.Itoa(n)
}

func hasLiveIdea(s *SessionIdeas) bool {
	return slices.ContainsFunc(s.Ideas, func(i Idea) bool { return !i.Dropped })
}

// cleanTopic folds a topic's whitespace to single spaces; a topic longer than topicMax is an error, not cut.
func cleanTopic(topic string) (string, error) {
	topic = strings.Join(strings.Fields(topic), " ")
	if utf8.RuneCountInString(topic) > topicMax {
		return "", fmt.Errorf("topic %q is longer than %d characters: name it in a few words", topic, topicMax)
	}
	return topic, nil
}

// Add files a new idea. Its Turn is the session's prompt count, and it restarts the nudge gap.
func Add(sessionId, text, kind, by, topic string) (Idea, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return Idea{}, errors.New("idea text cannot be empty")
	}
	topic, err := cleanTopic(topic)
	if err != nil {
		return Idea{}, err
	}
	if !validKind(kind) {
		return Idea{}, fmt.Errorf("invalid idea kind %q (want %s, %s or %s)", kind, KindDecision, KindIdea, KindQuestion)
	}
	if by != ByAgent && by != ByYou {
		return Idea{}, fmt.Errorf("invalid idea author %q (want %s or %s)", by, ByAgent, ByYou)
	}
	mu.Lock()
	defer mu.Unlock()
	s, _, err := load(sessionId)
	if err != nil {
		return Idea{}, err
	}
	idea := Idea{ID: nextID(&s), Text: text, Kind: kind, By: by, Topic: topic, Turn: s.Prompts, Ts: now().UnixMilli()}
	s.Ideas = append(s.Ideas, idea)
	s.LastIdeaPrompt = s.Prompts
	if err := save(&s); err != nil {
		return Idea{}, err
	}
	delete(pending, sessionId)
	return idea, nil
}

// List returns a session's ideas; a session with none reads as an empty list.
func List(sessionId string) (SessionIdeas, error) {
	mu.Lock()
	defer mu.Unlock()
	s, _, err := load(sessionId)
	return s, err
}

// resolve finds the ideas an op names, each once, in the order named. One unknown id fails the whole op.
func resolve(s *SessionIdeas, ids []string) ([]*Idea, error) {
	var found []*Idea
	for _, id := range ids {
		i := slices.IndexFunc(s.Ideas, func(idea Idea) bool { return idea.ID == id })
		if i < 0 {
			return nil, fmt.Errorf("no idea %q in this session", id)
		}
		if !slices.Contains(found, &s.Ideas[i]) {
			found = append(found, &s.Ideas[i])
		}
	}
	return found, nil
}

// Update applies one op to a session's ideas. An op that fails changes nothing.
func Update(sessionId string, op Op) error {
	mu.Lock()
	defer mu.Unlock()
	s, exists, err := load(sessionId)
	if err != nil {
		return err
	}
	if op.Kind == OpSeen {
		if !exists {
			return nil // a session with no ideas leaves no file
		}
		s.SeenAt = now().UnixMilli()
		return save(&s)
	}
	targets, err := resolve(&s, op.Ids)
	if err != nil {
		return err
	}
	switch op.Kind {
	case OpEdit:
		text := strings.TrimSpace(op.Text)
		if len(targets) != 1 || text == "" {
			return errors.New("edit takes one idea id and its new text")
		}
		targets[0].Text = text
	case OpKind:
		if len(targets) == 0 || !validKind(op.NewKind) {
			return fmt.Errorf("kind takes idea ids and a kind (%s, %s or %s)", KindDecision, KindIdea, KindQuestion)
		}
		for _, t := range targets {
			t.Kind = op.NewKind
		}
	case OpTopic:
		if len(targets) == 0 {
			return errors.New("topic takes idea ids")
		}
		topic, err := cleanTopic(op.Topic)
		if err != nil {
			return err
		}
		for _, t := range targets {
			t.Topic = topic
		}
	case OpDrop, OpRestore:
		if len(targets) == 0 {
			return fmt.Errorf("%s takes idea ids", op.Kind)
		}
		for _, t := range targets {
			t.Dropped = op.Kind == OpDrop
		}
	case OpMerge:
		if len(targets) < 2 {
			return errors.New("merge takes two or more idea ids")
		}
		merge(targets)
	default:
		return fmt.Errorf("unknown idea op %q", op.Kind)
	}
	return save(&s)
}

// merge folds the ideas into the oldest: it keeps its kind and its topic (else the first topic among the rest), takes
// every text oldest first, and the rest drop.
func merge(ideas []*Idea) {
	slices.SortFunc(ideas, func(a, b *Idea) int {
		if a.Ts != b.Ts {
			if a.Ts < b.Ts {
				return -1
			}
			return 1
		}
		return idNum(a.ID) - idNum(b.ID)
	})
	texts := make([]string, len(ideas))
	for i, idea := range ideas {
		texts[i] = idea.Text
		idea.Dropped = i > 0
		if ideas[0].Topic == "" {
			ideas[0].Topic = idea.Topic
		}
	}
	ideas[0].Text = strings.Join(texts, mergeJoin)
}

// Tick counts one more prompt in the session and returns the nudge line when it is time for one: the
// session has an idea not dropped, and nudgeAfter prompts have passed since both the last idea and the
// last nudge. A session with no ideas file only counts, in memory, and gets no file.
func Tick(sessionId string) (nudge string, err error) {
	mu.Lock()
	defer mu.Unlock()
	s, exists, err := load(sessionId)
	if err != nil {
		return "", err
	}
	s.Prompts++
	if !exists {
		pending[sessionId] = s.Prompts
		return "", nil
	}
	gap := s.Prompts - s.LastIdeaPrompt
	if gap >= nudgeAfter && s.Prompts-s.NudgedAt >= nudgeAfter && hasLiveIdea(&s) {
		nudge = fmt.Sprintf("%d turns since the last idea was recorded. If a decision, idea or open question came up that the list does not hold yet, record it with wsh idea add; otherwise record nothing.", gap)
		s.NudgedAt = s.Prompts
	}
	if err := save(&s); err != nil {
		return "", err
	}
	return nudge, nil
}
