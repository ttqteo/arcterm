// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build liveprobe

// Live probe of the corpus over a real store: every run in the window whose signal fields the probe's P2 regex
// matches must have a block that still holds the match. It is evidence toward the spec's Acceptance check, which
// needs a real scan. Not part of the normal suite; it reads a snapshot, never the live store:
//
//	node -e "new (require('node:sqlite').DatabaseSync)(process.env.LOCALAPPDATA+'/dev.arc.app/data/db/waveterm.db',{readOnly:true}).exec(\"VACUUM INTO 'C:/tmp/snap.db'\")"
//	WORKFLOWSCAN_STORE=C:/tmp/snap.db go test -tags liveprobe -run TestLiveProbeP2 -v ./pkg/workflowscan/
package workflowscan

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// the regex verifyprobe.mjs recounted P2 with
var p2Re = regexp.MustCompile(`(?i)(see|watch|saw) (it|them|the tests?) fail|red (run|step)|step \d+[^.\n]{0,30}fail first|run the tests? to see`)

// the spec's signal list, field by field, written apart from eventPicks so the probe checks the port
var signalFields = map[string][]string{
	"plan-reviewed":      {"findings"},
	"task-review-failed": {"note"},
	"task-review-passed": {"unverified"},
	"child-ask":          {"question"},
	"task-told":          {"text"},
	"land-held":          {"reason"},
	"task-failed":        {"lastfailurekind", "detail"},
	"task-verify-failed": {"detail"},
	"lead-wake-failed":   {"lines"},
	"task-retried":       nil, // the whole data
	"review-overruled":   nil,
}

func TestLiveProbeP2(t *testing.T) {
	path := os.Getenv("WORKFLOWSCAN_STORE")
	if path == "" {
		t.Skip("WORKFLOWSCAN_STORE is not set")
	}
	db, err := sql.Open("sqlite3", "file:"+filepath.ToSlash(path)+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	channels := map[string]string{}
	eachRow(t, db, "select data from db_channel", func(data string) {
		var ch waveobj.Channel
		if json.Unmarshal([]byte(data), &ch) == nil {
			channels[ch.OID] = ch.Name
		}
	})
	var runs []RunInfo
	byId := map[string]*waveobj.Run{}
	eachRow(t, db, "select data from db_run", func(data string) {
		var r waveobj.Run
		if json.Unmarshal([]byte(data), &r) != nil {
			return
		}
		project := channels[r.ChannelOID]
		if project == "" {
			project = filepath.Base(r.ProjectPath)
		}
		runs = append(runs, RunInfo{Run: &r, Project: project})
		byId[r.OID] = &r
	})

	rows, err := db.Query("select oid, runid, channelid, ts, kind, data from db_runevent where kind in ('" + strings.Join(EventKinds, "','") + "')")
	if err != nil {
		t.Fatal(err)
	}
	var events []waveobj.RunEvent
	raw := map[string][]string{} // run id -> its signal field values
	for rows.Next() {
		var e waveobj.RunEvent
		var data string
		if err := rows.Scan(&e.ID, &e.RunID, &e.ChannelID, &e.Ts, &e.Kind, &data); err != nil {
			t.Fatal(err)
		}
		e.Detail = json.RawMessage(data)
		events = append(events, e)
		raw[e.RunID] = append(raw[e.RunID], fieldValues(e.Kind, data)...)
	}
	rows.Close()

	now := time.Now()
	c := BuildCorpus(runs, events, now, 14)
	blocks := map[string]Block{}
	for _, b := range c.Blocks {
		blocks[b.RunId] = b
	}

	since := now.Add(-14 * 24 * time.Hour).UnixMilli()
	matched, cutOff := 0, 0
	byProject := map[string]int{}
	for _, ri := range runs {
		r := ri.Run
		if r.CreatedTs < since || skipped(r) {
			continue
		}
		texts := append(raw[r.OID], evidenceValues(r)...)
		if !p2Re.MatchString(strings.Join(texts, "\n")) {
			continue
		}
		matched++
		byProject[ri.Project]++
		b, ok := blocks[r.OID]
		if !ok {
			t.Errorf("run %s (%s) matches P2 but has no block", r.OID, ri.Project)
			continue
		}
		if !p2Re.MatchString(strings.Join(b.Lines, "\n")) {
			// the match sits past a field's cut
			cutOff++
			t.Logf("run %s matches P2 only past the %d-char cut", r.OID[:8], MaxField)
		}
		t.Logf("P2 run %s · %s · %s", b.Short, b.Date, b.Project)
	}
	t.Logf("corpus: %d runs, %d projects, %d dropped, %d chars", c.Runs, c.Projects, c.Dropped, len([]rune(c.Text)))
	t.Logf("P2: %d runs in the window, %d past the cut, by project %v", matched, cutOff, byProject)
}

func eachRow(t *testing.T, db *sql.DB, query string, fn func(data string)) {
	t.Helper()
	rows, err := db.Query(query)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			t.Fatal(err)
		}
		fn(data)
	}
}

func fieldValues(kind, data string) []string {
	fields, ok := signalFields[kind]
	if !ok {
		return nil
	}
	if fields == nil {
		return []string{data}
	}
	var d map[string]any
	if json.Unmarshal([]byte(data), &d) != nil {
		return nil
	}
	var out []string
	for _, f := range fields {
		switch v := d[f].(type) {
		case string:
			out = append(out, v)
		case []any:
			for _, x := range v {
				if s, ok := x.(string); ok {
					out = append(out, s)
				}
			}
		}
	}
	return out
}

func evidenceValues(r *waveobj.Run) []string {
	var out []string
	if r.Evidence == nil {
		return nil
	}
	if dag := r.Evidence.Dag; dag != nil {
		for _, t := range dag.Tasks {
			out = append(out, t.Differs, t.FoundNotFixed, t.NotVerified)
		}
		out = append(out, dag.Told...)
	}
	if v := r.Evidence.Verification; v != nil {
		out = append(out, v.Reasons...)
	}
	return out
}
