// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package boardstore

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

const (
	boardExt         = ".excalidraw"
	answerExt        = ".json"
	talkExt          = ".talk.json"
	answersExt       = ".answers"
	idLen            = 8
	namePrefixBytes  = 4096
	fileMode         = 0o644
	dirMode          = 0o755
	unsafeNameChars  = `<>:"/\|?*`
	unsafeNameFiller = "_"

	typeText = "text"
)

// The turn states a list row is worked out from (BoardTurn.State). "failed" is also the row's own state.
const (
	stateAnswering = "answering"
	stateWaiting   = "waiting"
	stateAnswered  = "answered"
	stateFailed    = "failed"
)

var (
	idRe = regexp.MustCompile(`^[0-9a-f]{8}$`)
	// the arc record is the file's first key, so a file damaged further down still names itself
	nameRe = regexp.MustCompile(`"name"\s*:\s*("(?:[^"\\]|\\.)*")`)

	dirLocksMu sync.Mutex
	dirLocks   = map[string]*sync.Mutex{}
)

// boardFile is the part of a board file this package reads: the arc record, and of each element enough to count it.
type boardFile struct {
	Arc      *wshrpc.BoardArcRecord `json:"arc"`
	Elements []element              `json:"elements"`
}

type element struct {
	Id          string `json:"id"`
	Type        string `json:"type"`
	ContainerId string `json:"containerId"`
	IsDeleted   bool   `json:"isDeleted"`
}

// shapes counts the board's live elements as its header does: a deleted element is gone, and bound text is part of
// its container. The drawer counts the same way.
func (f boardFile) shapes() int {
	n := 0
	for _, e := range f.Elements {
		if e.IsDeleted || e.Id == "" || (e.Type == typeText && e.ContainerId != "") {
			continue
		}
		n++
	}
	return n
}

// Root is the folder every project's boards live under.
func Root() string {
	return filepath.Join(wavebase.GetWaveDataDir(), "boards")
}

// ProjectDir is a project's board folder: the project name with characters a path cannot hold, and trailing
// dots and spaces, replaced by "_".
func ProjectDir(project string) string {
	name := []rune(project)
	for i, r := range name {
		if strings.ContainsRune(unsafeNameChars, r) || r < ' ' {
			name[i] = '_'
		}
	}
	for i := len(name) - 1; i >= 0 && (name[i] == '.' || name[i] == ' '); i-- {
		name[i] = '_'
	}
	if len(name) == 0 {
		name = []rune(unsafeNameFiller)
	}
	return filepath.Join(Root(), string(name))
}

// ProjectDirs is every project folder under Root, for the list of every project's boards. A folder's name is its
// project's made safe for a path, so the project itself is read off its boards (List with no project).
func ProjectDirs() ([]string, error) {
	root := Root()
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	dirs := []string{}
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, filepath.Join(root, e.Name()))
		}
	}
	return dirs, nil
}

func ValidID(id string) bool {
	return idRe.MatchString(id)
}

func checkID(id string) error {
	if !ValidID(id) {
		return fmt.Errorf("invalid board id %q", id)
	}
	return nil
}

func checkAnswerID(id string) error {
	if _, err := uuid.Parse(id); err != nil {
		return fmt.Errorf("invalid answer id %q", id)
	}
	return nil
}

func boardPath(dir, id string) string { return filepath.Join(dir, id+boardExt) }
func talkPath(dir, id string) string  { return filepath.Join(dir, id+talkExt) }
func answersDir(dir, id string) string {
	return filepath.Join(dir, id+answersExt)
}

func dirLock(dir string) *sync.Mutex {
	dirLocksMu.Lock()
	defer dirLocksMu.Unlock()
	l, ok := dirLocks[dir]
	if !ok {
		l = &sync.Mutex{}
		dirLocks[dir] = l
	}
	return l
}

func revOf(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func lineAt(data []byte, offset int64) int {
	offset = max(0, min(offset, int64(len(data))))
	return 1 + bytes.Count(data[:offset], []byte{'\n'})
}

// parseBoard returns the board's file, or the text of why it cannot be used.
func parseBoard(data []byte) (boardFile, string) {
	var f boardFile
	if err := json.Unmarshal(data, &f); err != nil {
		var offset int64
		var syn *json.SyntaxError
		var typ *json.UnmarshalTypeError
		switch {
		case errors.As(err, &syn):
			offset = syn.Offset
		case errors.As(err, &typ):
			offset = typ.Offset
		}
		return boardFile{}, fmt.Sprintf("its file is not valid Excalidraw JSON (%s, at line %d)", err.Error(), lineAt(data, offset))
	}
	if f.Arc == nil {
		return boardFile{}, "its file is not valid Excalidraw JSON (no arc record, at line 1)"
	}
	return f, ""
}

func fallbackName(data []byte, id string) string {
	prefix := data[:min(len(data), namePrefixBytes)]
	if m := nameRe.FindSubmatch(prefix); m != nil {
		var name string
		if json.Unmarshal(m[1], &name) == nil && strings.TrimSpace(name) != "" {
			return name
		}
	}
	return id
}

// infoFromFile is a board's row as its file tells it: name, path, created time and shapes. A file that will not
// parse keeps the name its arc prefix gives (else its id), the file's mod time and the LoadError. The talk's facts
// are applyTalkFacts's.
func infoFromFile(dir, project, id string, data []byte, modTs int64, state func(string) string) wshrpc.BoardInfo {
	abs, err := filepath.Abs(boardPath(dir, id))
	if err != nil {
		abs = boardPath(dir, id)
	}
	info := wshrpc.BoardInfo{ID: id, Project: project, Path: abs}
	file, loadErr := parseBoard(data)
	if loadErr != "" {
		info.Name = fallbackName(data, id)
		info.CreatedTs = modTs
		info.LoadError = loadErr
	} else {
		info.Name = file.Arc.Name
		info.CreatedTs = file.Arc.CreatedTs
		info.Shapes = file.shapes()
	}
	info.ActiveTs = info.CreatedTs
	if state != nil {
		info.State = state(id)
	}
	return info
}

// applyTalkFacts fills a row's facts from the board's talk. A state the caller already set (the drawer is busy on
// it) wins; otherwise the last turn says: a failed one failed, and one left answering or waiting, which nothing
// runs, failed too. A drawing turn is one that changed shapes: an answer that changed nothing is not drawn.
func applyTalkFacts(info *wshrpc.BoardInfo, talk wshrpc.BoardTalk) {
	if talk.Agent != nil {
		info.AgentTabId = talk.Agent.TabId
		info.AgentTitle = talk.Agent.Title
	}
	info.Turns = len(talk.Turns)
	for _, t := range talk.Turns {
		if t.State == stateAnswered && t.Added+t.Changed+t.Removed > 0 {
			info.DrawnTs = max(info.DrawnTs, t.AnsweredTs)
		}
		info.ActiveTs = max(info.ActiveTs, t.Ts, t.AnsweredTs)
	}
	if info.State != "" || len(talk.Turns) == 0 {
		return
	}
	switch talk.Turns[len(talk.Turns)-1].State {
	case stateFailed, stateAnswering, stateWaiting:
		info.State = stateFailed
	}
}

// List returns the boards in a project's folder, the most recently active first (a turn, an answer, else created),
// then by id. Each row carries project; given "" it reads each row's project off its talk, which is how a folder
// found by ProjectDirs lists. A missing folder is no boards. A talk that will not read leaves its board listed
// without talk facts.
func List(dir, project string, state func(boardId string) string) ([]wshrpc.BoardInfo, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []wshrpc.BoardInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	boards := []wshrpc.BoardInfo{}
	for _, e := range entries {
		id, ok := strings.CutSuffix(e.Name(), boardExt)
		if !ok || e.IsDir() || !ValidID(id) {
			continue
		}
		data, err := os.ReadFile(boardPath(dir, id))
		if err != nil {
			return nil, err
		}
		var modTs int64
		if st, err := e.Info(); err == nil {
			modTs = st.ModTime().UnixMilli()
		}
		info := infoFromFile(dir, project, id, data, modTs, state)
		if talk, err := ReadTalk(dir, id); err != nil {
			log.Printf("boardstore: listing board %s without its talk: %v\n", id, err)
		} else {
			if info.Project == "" {
				info.Project = talk.Project
			}
			applyTalkFacts(&info, talk)
		}
		boards = append(boards, info)
	}
	sort.SliceStable(boards, func(i, j int) bool {
		a, b := boards[i], boards[j]
		if a.ActiveTs != b.ActiveTs {
			return a.ActiveTs > b.ActiveTs
		}
		return a.ID < b.ID
	})
	return boards, nil
}

// FindByName is the board of a project named name: trimmed, in any case, the most recently active when several share
// it. A board whose file is damaged is found too, with its LoadError, so a request for it names the problem rather
// than starting a twin. A blank name finds nothing.
func FindByName(dir, project, name string) (wshrpc.BoardInfo, bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return wshrpc.BoardInfo{}, false, nil
	}
	boards, err := List(dir, project, nil)
	if err != nil {
		return wshrpc.BoardInfo{}, false, err
	}
	for _, b := range boards { // most recently active first
		if strings.EqualFold(strings.TrimSpace(b.Name), name) {
			return b, true, nil
		}
	}
	return wshrpc.BoardInfo{}, false, nil
}

// Create writes a new, empty board named name, tied to agent, and its talk. The arc record is the file's first key.
// It does not look for a board of that name: the caller asks FindByName first. The talk is written first, so a
// failure leaves at worst a sidecar no list shows, never a board with no agent.
func Create(dir, project, name string, agent wshrpc.BoardAgent, now int64) (wshrpc.BoardInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return wshrpc.BoardInfo{}, errors.New("a board needs a name")
	}
	if agent.TabId == "" {
		return wshrpc.BoardInfo{}, errors.New("a board needs the agent it is tied to")
	}
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return wshrpc.BoardInfo{}, err
	}
	arc, err := json.Marshal(wshrpc.BoardArcRecord{Name: name, CreatedTs: now})
	if err != nil {
		return wshrpc.BoardInfo{}, err
	}
	body := []byte(`{"arc":` + string(arc) + `,"type":"excalidraw","version":2,"source":"arc","elements":[],"appState":{},"files":{}}`)

	l := dirLock(dir)
	l.Lock()
	defer l.Unlock()
	var id string
	for {
		id = uuid.NewString()[:idLen]
		if _, err := os.Stat(boardPath(dir, id)); errors.Is(err, os.ErrNotExist) {
			break
		}
	}
	talk := wshrpc.BoardTalk{Project: project, BoardId: id, Agent: &agent, Turns: []wshrpc.BoardTurn{}}
	if err := writeTalk(dir, id, talk); err != nil {
		return wshrpc.BoardInfo{}, err
	}
	if err := fileutil.AtomicWriteFile(boardPath(dir, id), body, fileMode); err != nil {
		if rmErr := os.Remove(talkPath(dir, id)); rmErr != nil && !errors.Is(rmErr, os.ErrNotExist) {
			err = errors.Join(err, rmErr)
		}
		return wshrpc.BoardInfo{}, err
	}
	info := infoFromFile(dir, project, id, body, now, nil)
	applyTalkFacts(&info, talk)
	return info, nil
}

// Read returns a board: its row (name, path, created time, shapes; the talk's facts are List's) and the file's text
// with its rev. A file that will not parse comes back as its error text, with Info (name, path and LoadError)
// filled so a caller can still show the board.
func Read(dir, project, id string) (wshrpc.BoardReadRtnData, error) {
	if err := checkID(id); err != nil {
		return wshrpc.BoardReadRtnData{}, err
	}
	data, err := os.ReadFile(boardPath(dir, id))
	if errors.Is(err, os.ErrNotExist) {
		return wshrpc.BoardReadRtnData{}, fmt.Errorf("board %s not found", id)
	}
	if err != nil {
		return wshrpc.BoardReadRtnData{}, err
	}
	var modTs int64
	if st, err := os.Stat(boardPath(dir, id)); err == nil {
		modTs = st.ModTime().UnixMilli()
	}
	info := infoFromFile(dir, project, id, data, modTs, nil)
	if info.LoadError != "" {
		return wshrpc.BoardReadRtnData{Info: info}, errors.New(info.LoadError)
	}
	return wshrpc.BoardReadRtnData{Info: info, Data: string(data), Rev: revOf(data)}, nil
}

// Save replaces a board's file with data when baseRev is the file's current rev; otherwise nothing is written
// and Conflict is set. A file that will not parse is never overwritten, and data that will not parse, or whose
// arc record has no name, is never written.
func Save(dir, id, data, baseRev string) (wshrpc.BoardSaveRtnData, error) {
	if err := checkID(id); err != nil {
		return wshrpc.BoardSaveRtnData{}, err
	}
	file, loadErr := parseBoard([]byte(data))
	if loadErr != "" {
		return wshrpc.BoardSaveRtnData{}, fmt.Errorf("refusing to save: %s", loadErr)
	}
	if strings.TrimSpace(file.Arc.Name) == "" {
		return wshrpc.BoardSaveRtnData{}, errors.New("refusing to save: its arc record has no name")
	}

	l := dirLock(dir)
	l.Lock()
	defer l.Unlock()
	path := boardPath(dir, id)
	current, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return wshrpc.BoardSaveRtnData{}, fmt.Errorf("board %s not found", id)
	}
	if err != nil {
		return wshrpc.BoardSaveRtnData{}, err
	}
	if _, loadErr := parseBoard(current); loadErr != "" {
		return wshrpc.BoardSaveRtnData{}, fmt.Errorf("refusing to overwrite board %s: %s", id, loadErr)
	}
	if revOf(current) != baseRev {
		return wshrpc.BoardSaveRtnData{Conflict: true}, nil
	}
	if err := fileutil.AtomicWriteFile(path, []byte(data), fileMode); err != nil {
		return wshrpc.BoardSaveRtnData{}, err
	}
	return wshrpc.BoardSaveRtnData{Rev: revOf([]byte(data))}, nil
}

func readTalkFile(dir, boardId string) (wshrpc.BoardTalk, error) {
	talk := wshrpc.BoardTalk{BoardId: boardId}
	data, err := os.ReadFile(talkPath(dir, boardId))
	switch {
	case errors.Is(err, os.ErrNotExist):
	case err != nil:
		return wshrpc.BoardTalk{}, err
	default:
		if err := json.Unmarshal(data, &talk); err != nil {
			return wshrpc.BoardTalk{}, fmt.Errorf("the talk of board %s is damaged: %w", boardId, err)
		}
	}
	if talk.Turns == nil {
		talk.Turns = []wshrpc.BoardTurn{}
	}
	return talk, nil
}

// writeTalk writes the talk's sidecar; the caller holds the dir lock.
func writeTalk(dir, boardId string, talk wshrpc.BoardTalk) error {
	data, err := json.Marshal(talk)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, dirMode); err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(talkPath(dir, boardId), data, fileMode)
}

// ReadTalk returns a board's talk; a board with no talk file has an empty one. A talk that will not parse is an
// error, never an empty talk, so an update cannot write over it.
func ReadTalk(dir, boardId string) (wshrpc.BoardTalk, error) {
	if err := checkID(boardId); err != nil {
		return wshrpc.BoardTalk{}, err
	}
	l := dirLock(dir)
	l.Lock()
	defer l.Unlock()
	return readTalkFile(dir, boardId)
}

// UpdateTalk reads the board's talk, lets fn change it and writes it back, all under the dir lock, so concurrent
// updates serialize. An error from fn writes nothing. Only wavesrv writes the talk: the frontend owns the board file.
func UpdateTalk(dir, boardId string, fn func(*wshrpc.BoardTalk) error) (wshrpc.BoardTalk, error) {
	if err := checkID(boardId); err != nil {
		return wshrpc.BoardTalk{}, err
	}
	l := dirLock(dir)
	l.Lock()
	defer l.Unlock()
	talk, err := readTalkFile(dir, boardId)
	if err != nil {
		return wshrpc.BoardTalk{}, err
	}
	if err := fn(&talk); err != nil {
		return wshrpc.BoardTalk{}, err
	}
	if talk.Turns == nil {
		talk.Turns = []wshrpc.BoardTurn{}
	}
	if err := writeTalk(dir, boardId, talk); err != nil {
		return wshrpc.BoardTalk{}, err
	}
	return talk, nil
}

// PutAnswer files a drawer answer in the board's inbox, where it waits until the frontend applies and acks it.
func PutAnswer(dir string, a wshrpc.BoardAnswer) error {
	if err := checkID(a.BoardId); err != nil {
		return err
	}
	if err := checkAnswerID(a.ID); err != nil {
		return err
	}
	data, err := json.Marshal(a)
	if err != nil {
		return err
	}
	inbox := answersDir(dir, a.BoardId)
	if err := os.MkdirAll(inbox, dirMode); err != nil {
		return err
	}
	return fileutil.AtomicWriteFile(filepath.Join(inbox, a.ID+answerExt), data, fileMode)
}

// Answers returns a board's waiting answers, oldest first. One that will not read is logged and left out, so it
// cannot hide the rest of the inbox.
func Answers(dir, boardId string) ([]wshrpc.BoardAnswer, error) {
	if err := checkID(boardId); err != nil {
		return nil, err
	}
	files, err := os.ReadDir(answersDir(dir, boardId))
	if errors.Is(err, os.ErrNotExist) {
		return []wshrpc.BoardAnswer{}, nil
	}
	if err != nil {
		return nil, err
	}
	answers := []wshrpc.BoardAnswer{}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), answerExt) {
			continue
		}
		path := filepath.Join(answersDir(dir, boardId), f.Name())
		data, err := os.ReadFile(path)
		var a wshrpc.BoardAnswer
		if err == nil {
			err = json.Unmarshal(data, &a)
		}
		if err != nil {
			log.Printf("boardstore: skipping unreadable answer %s: %v\n", path, err)
			continue
		}
		answers = append(answers, a)
	}
	sort.SliceStable(answers, func(i, j int) bool {
		if answers[i].Ts != answers[j].Ts {
			return answers[i].Ts < answers[j].Ts
		}
		return answers[i].ID < answers[j].ID
	})
	return answers, nil
}

// AckAnswer removes an applied answer from the inbox. An answer that is already gone is not an error.
func AckAnswer(dir, boardId, answerId string) error {
	if err := checkID(boardId); err != nil {
		return err
	}
	if err := checkAnswerID(answerId); err != nil {
		return err
	}
	err := os.Remove(filepath.Join(answersDir(dir, boardId), answerId+answerExt))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
