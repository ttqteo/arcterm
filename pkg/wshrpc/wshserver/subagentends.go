// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// A background subagent cut off mid-tool (its claude process exited at a session boundary, or it was killed) writes
// no ending of its own, so its transcript alone reads live forever. Its parent says how it ended, in a
// <task-notification> whose <task-id> is the child's agent id: a completion carries a <tool-use-id> too, but a resumed
// session's "didn't finish before the previous session ended" notice names the task id alone. The notice can sit far
// behind any tail a reader keeps (on 2026-11-25 an orphan's sat at line 856 of 5059), so the whole parent transcript is
// read, once, and then only what was appended since.

// endResumeSlack is how long after its notification a child may still have written and count as ended by it: a child
// that wrote later than this was resumed (SendMessage) and is live again.
const endResumeSlack = 5 * time.Second

var (
	notificationBlockRe = regexp.MustCompile(`(?s)<task-notification>.*?</task-notification>`)
	notifiedTaskIdRe    = regexp.MustCompile(`<task-id>([^<]+)</task-id>`)
	notifiedStatusRe    = regexp.MustCompile(`<status>([^<]+)</status>`)
	notificationTag     = []byte("task-notification") // bare: a writer that escapes HTML writes "<" and ">" as <, >
)

type subagentEnd struct {
	status string
	tsMs   int64 // when the parent recorded it; 0 when its record has no timestamp
}

type parentEndsScan struct {
	offset int64 // bytes read so far, always at a line start
	ends   map[string]subagentEnd
}

var (
	parentEndsMu    sync.Mutex
	parentEndsCache = map[string]*parentEndsScan{}
)

// parentSubagentEnds maps each task id the parent's notifications end to its latest end. It reads only what the
// parent appended since the last call; a file that shrank (rewritten) is read again from the start.
func parentSubagentEnds(parentPath string) map[string]subagentEnd {
	parentEndsMu.Lock()
	defer parentEndsMu.Unlock()
	scan := parentEndsCache[parentPath]
	f, err := os.Open(parentPath)
	if err != nil {
		delete(parentEndsCache, parentPath)
		return nil
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil
	}
	if scan == nil || st.Size() < scan.offset {
		scan = &parentEndsScan{ends: map[string]subagentEnd{}}
		parentEndsCache[parentPath] = scan
	}
	if st.Size() == scan.offset {
		return scan.ends
	}
	if _, err := f.Seek(scan.offset, io.SeekStart); err != nil {
		return scan.ends
	}
	r := bufio.NewReaderSize(f, 256*1024)
	for {
		line, err := r.ReadBytes('\n')
		if err != nil {
			break // EOF: a last line without its newline is still being written, and is read next time
		}
		scan.offset += int64(len(line))
		if bytes.Contains(line, notificationTag) {
			readNotificationEnds(line, scan.ends)
		}
	}
	return scan.ends
}

// readNotificationEnds records the ends the <task-notification>s in one transcript record name. A notification
// arrives as a user message, a queue-operation's content or a queued-command attachment; an assistant turn or a copy
// of a request can only quote one, so those are passed over. A "running" status, or none (a Monitor's event), ends
// nothing.
func readNotificationEnds(line []byte, ends map[string]subagentEnd) {
	var rec map[string]any
	if json.Unmarshal(line, &rec) != nil {
		return
	}
	switch rec["type"] {
	case "user", "queue-operation", "attachment":
	default:
		return
	}
	var tsMs int64
	if s, ok := rec["timestamp"].(string); ok {
		if tm, err := time.Parse(time.RFC3339Nano, s); err == nil {
			tsMs = tm.UnixMilli()
		}
	}
	for _, text := range notificationStrings(rec, 0, nil) {
		for _, note := range notificationBlockRe.FindAllString(text, -1) {
			m := notifiedStatusRe.FindStringSubmatch(note)
			if m == nil {
				continue
			}
			status := strings.TrimSpace(m[1])
			if status == "" || status == "running" {
				continue
			}
			for _, id := range notifiedTaskIdRe.FindAllStringSubmatch(note, -1) {
				ends[strings.TrimSpace(id[1])] = subagentEnd{status: status, tsMs: tsMs}
			}
		}
	}
}

// notificationStrings collects the strings in v that carry a <task-notification>.
func notificationStrings(v any, depth int, out []string) []string {
	switch x := v.(type) {
	case string:
		if strings.Contains(x, "<task-notification>") {
			out = append(out, x)
		}
	case map[string]any:
		if depth < 5 {
			for _, c := range x {
				out = notificationStrings(c, depth+1, out)
			}
		}
	case []any:
		if depth < 5 {
			for _, c := range x {
				out = notificationStrings(c, depth+1, out)
			}
		}
	}
	return out
}

// endedByParent is the status a parent notification ended the child with, or "" when none did or the child wrote
// after it (resumed).
func endedByParent(ends map[string]subagentEnd, agentId string, childModMs int64) string {
	end, ok := ends[agentId]
	if !ok {
		return ""
	}
	if end.tsMs > 0 && childModMs > end.tsMs+endResumeSlack.Milliseconds() {
		return ""
	}
	return end.status
}
