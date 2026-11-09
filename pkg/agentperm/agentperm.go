// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package agentperm

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// ErrNotPending is the refusal of an answer whose request is not the head of the queue (or is gone): the TUI has
// moved past the card the person clicked, so nothing is typed.
var ErrNotPending = errors.New("that request is no longer waiting")

// summaryMax caps the fallback summary (the tool name and its input as compact JSON), in runes.
const summaryMax = 300

// answerable is the tools whose permission prompt is the plain three-choice one, where `1` is Allow and Esc is
// Deny. Anything else (ExitPlanMode's plan menu, an MCP tool, AskUserQuestion) has other choices, so the chat only
// points at the terminal. The table lives here alone and rides each request as a field.
var answerable = map[string]bool{
	"Bash":         true,
	"Edit":         true,
	"Write":        true,
	"MultiEdit":    true,
	"NotebookEdit": true,
	"WebFetch":     true,
	"WebSearch":    true,
}

// Answerable reports whether the chat may answer toolName's permission prompt with Allow.
func Answerable(toolName string) bool {
	return answerable[toolName]
}

// ToolKey identifies one tool call by its name and input, for matching a PostToolUse report to the permission
// request that granted it (the PermissionRequest payload has no tool_use_id). The input is unmarshalled and
// re-marshalled, which sorts every object's keys, so key order and whitespace do not change the key; an input that
// does not parse is hashed as it came. `wsh agent-hook` calls this for both events, so the two sides cannot drift.
func ToolKey(toolName string, toolInput json.RawMessage) string {
	canon := []byte(toolInput)
	if len(bytes.TrimSpace(toolInput)) == 0 {
		// no input at all is null once it has crossed the wire (a nil RawMessage marshals as null), so the raise
		// and the PostToolUse report of the same call key alike
		canon = []byte("null")
	}
	var v any
	if json.Unmarshal(canon, &v) == nil {
		if b, err := json.Marshal(v); err == nil {
			canon = b
		}
	}
	sum := sha256.Sum256(canon)
	return toolName + ":" + hex.EncodeToString(sum[:])
}

// Summary is the one line the chat card shows for a request: Bash its command, the file tools their path,
// WebFetch its URL, WebSearch its query; anything else (or a missing field) the tool name and its input as compact
// JSON, cut at summaryMax runes.
func Summary(toolName string, toolInput json.RawMessage) string {
	field := ""
	switch toolName {
	case "Bash":
		field = "command"
	case "Edit", "Write", "MultiEdit":
		field = "file_path"
	case "NotebookEdit":
		field = "notebook_path"
	case "WebFetch":
		field = "url"
	case "WebSearch":
		field = "query"
	}
	if field != "" {
		var fields map[string]any
		if json.Unmarshal(toolInput, &fields) == nil {
			if s, ok := fields[field].(string); ok && s != "" {
				return s
			}
		}
	}
	out := toolName
	if compact := compactJSON(toolInput); compact != "" {
		out += " " + compact
	}
	if r := []rune(out); len(r) > summaryMax {
		out = string(r[:summaryMax])
	}
	return out
}

// compactJSON is raw without insignificant whitespace; a missing input or a null one is "".
func compactJSON(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var buf bytes.Buffer
	if json.Compact(&buf, raw) == nil {
		return buf.String()
	}
	return string(raw)
}

// entry is one pending request and the tool key it will be matched on.
type entry struct {
	req baseds.AgentPermissionRequest
	key string
}

// Registry holds each agent block's pending queue and its answered keys, in memory, keyed by oref. Every mutating
// method reports whether the queue changed, so a caller publishes the snapshot only then.
type Registry struct {
	lock   sync.Mutex
	queues map[string][]entry
	// answered counts, per oref and tool key, the requests answered without their PostToolUse having reported yet.
	// A count and not a set: three identical parallel calls answered one by one each leave a note, and each of their
	// PostToolUse reports has to consume one.
	answered map[string]map[string]int
}

func MakeRegistry() *Registry {
	return &Registry{
		queues:   make(map[string][]entry),
		answered: make(map[string]map[string]int),
	}
}

// GlobalRegistry is the process-wide queue the wsh server handlers use.
var GlobalRegistry = MakeRegistry()

// Raise appends one request to oref's queue, behind those already waiting: two identical parallel calls are two
// prompts, so nothing is deduplicated. It returns the request as queued.
func (r *Registry) Raise(oref, toolName string, toolInput json.RawMessage, ts int64) baseds.AgentPermissionRequest {
	req := baseds.AgentPermissionRequest{
		Id:         uuid.NewString(),
		ToolName:   toolName,
		Summary:    Summary(toolName, toolInput),
		Answerable: Answerable(toolName),
		Ts:         ts,
	}
	r.lock.Lock()
	defer r.lock.Unlock()
	r.queues[oref] = append(r.queues[oref], entry{req: req, key: ToolKey(toolName, toolInput)})
	return req
}

// Snapshot is oref's queue, head first, as a copy; an empty queue is an empty non-nil slice, which serializes as
// [] (the event that clears the card must not carry null).
func (r *Registry) Snapshot(oref string) []baseds.AgentPermissionRequest {
	r.lock.Lock()
	defer r.lock.Unlock()
	q := r.queues[oref]
	out := make([]baseds.AgentPermissionRequest, len(q))
	for i, e := range q {
		out[i] = e.req
	}
	return out
}

// ClaimHead returns the head of oref's queue when its id is id, and (_, false) otherwise: only the request the TUI
// is showing may be answered. The request stays queued; AnswerHead or DropAll removes it once its key is typed.
func (r *Registry) ClaimHead(oref, id string) (baseds.AgentPermissionRequest, bool) {
	r.lock.Lock()
	defer r.lock.Unlock()
	q := r.queues[oref]
	if len(q) == 0 || q[0].req.Id != id {
		return baseds.AgentPermissionRequest{}, false
	}
	return q[0].req, true
}

// AnswerHead drops the head of oref's queue and notes its key as answered, so its PostToolUse does not take
// another pending request with the same key. It reports whether there was a head.
func (r *Registry) AnswerHead(oref string) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	q := r.queues[oref]
	if len(q) == 0 {
		return false
	}
	head := q[0]
	r.setQueueLocked(oref, q[1:])
	if r.answered[oref] == nil {
		r.answered[oref] = make(map[string]int)
	}
	r.answered[oref][head.key]++
	return true
}

// DropAll empties oref's queue and forgets its answered keys, and reports whether any request was waiting.
func (r *Registry) DropAll(oref string) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	changed := len(r.queues[oref]) > 0
	delete(r.queues, oref)
	delete(r.answered, oref)
	return changed
}

// NoteToolDone handles the PostToolUse of the tool with key. A matching answered note is consumed and nothing
// changes (the request it names was already dropped); otherwise the first pending request with that key is the one
// the tool granted, and is dropped. It reports whether the queue changed.
func (r *Registry) NoteToolDone(oref, key string) bool {
	r.lock.Lock()
	defer r.lock.Unlock()
	if n := r.answered[oref][key]; n > 0 {
		if n == 1 {
			delete(r.answered[oref], key)
			if len(r.answered[oref]) == 0 {
				delete(r.answered, oref)
			}
		} else {
			r.answered[oref][key] = n - 1
		}
		return false
	}
	q := r.queues[oref]
	for i, e := range q {
		if e.key != key {
			continue
		}
		rest := make([]entry, 0, len(q)-1)
		rest = append(rest, q[:i]...)
		rest = append(rest, q[i+1:]...)
		r.setQueueLocked(oref, rest)
		return true
	}
	return false
}

func (r *Registry) setQueueLocked(oref string, q []entry) {
	if len(q) == 0 {
		delete(r.queues, oref)
		return
	}
	r.queues[oref] = q
}

// NoteStatus applies one agent status report to the global queue: a Stop, UserPromptSubmit or SessionStart drops
// everything (the turn the prompts belonged to is over or replaced), and a report carrying a tool key retires the
// request of the tool that just ran. It reports whether the queue changed.
func NoteStatus(data *baseds.AgentStatusData) bool {
	if data == nil || data.ORef == "" {
		return false
	}
	switch data.Hook {
	case baseds.AgentHook_Stop, baseds.AgentHook_UserPromptSubmit, baseds.AgentHook_SessionStart:
		return GlobalRegistry.DropAll(data.ORef)
	}
	if data.ToolKey != "" {
		return GlobalRegistry.NoteToolDone(data.ORef, data.ToolKey)
	}
	return false
}

// NoteKey applies one input typed into an agent's terminal to the global queue: a single 1-9 or Enter answers the
// head of the prompt on screen, a lone Esc rejects it and ends the turn. Anything else (an arrow moving the
// selection, text, a mouse report) answers nothing. It reports whether the queue changed.
func NoteKey(oref string, input []byte) bool {
	if oref == "" || len(input) != 1 {
		return false
	}
	switch c := input[0]; {
	case c == '\r' || (c >= '1' && c <= '9'):
		return GlobalRegistry.AnswerHead(oref)
	case c == '\x1b':
		return GlobalRegistry.DropAll(oref)
	}
	return false
}
