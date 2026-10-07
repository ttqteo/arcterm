// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func NewChannelMessage(kind, author, text, refORef string, ts int64) waveobj.ChannelMessage {
	return waveobj.ChannelMessage{
		ID:      uuid.NewString(),
		Kind:    kind,
		Author:  author,
		Text:    text,
		RefORef: refORef,
		Ts:      ts,
	}
}

// stampMessageIdentity sets the object identity and parent link on a message before it is written as a
// row. OID == the message's own UUID.
func stampMessageIdentity(channelId string, msg *waveobj.ChannelMessage) {
	msg.OID = msg.ID
	msg.ChannelOID = channelId
}

// stampRunIdentity does the same for a run.
func stampRunIdentity(channelId string, run *waveobj.Run) {
	run.OID = run.ID
	run.ChannelOID = channelId
}

// normProjectPath is the comparison key for a project path. A channel stores what the user registered
// (backslashes on Windows) while a radar report stores it canonPath'd, so two spellings of one project
// must land on one key. Mirrors the frontend's normProjectPath in channelderive.ts.
func normProjectPath(p string) string {
	return strings.TrimRight(strings.ReplaceAll(p, "\\", "/"), "/")
}

// ChannelAtPath returns the channel bound to projectPath, or (nil, nil) if there is none. An empty path
// matches nothing rather than matching every pathless channel — "this channel has no project" is not an
// answer to "which channel is this project's". Reads through GetChannels, which sorts newest-first, so a
// pre-collapse project with duplicates resolves to the same one the frontend's resolveTargetChannel picks.
func ChannelAtPath(ctx context.Context, projectPath string) (*waveobj.Channel, error) {
	if normProjectPath(projectPath) == "" {
		return nil, nil
	}
	chans, err := GetChannels(ctx)
	if err != nil {
		return nil, err
	}
	return MatchChannelAtPath(chans, projectPath), nil
}

// MatchChannelAtPath is ChannelAtPath over a channel list the caller already holds (wsh reads it over
// RPC), so both sides agree on what "this project's channel" means. First match wins.
func MatchChannelAtPath(chans []*waveobj.Channel, projectPath string) *waveobj.Channel {
	want := normProjectPath(projectPath)
	if want == "" {
		return nil
	}
	for _, ch := range chans {
		if normProjectPath(ch.ProjectPath) == want {
			return ch
		}
	}
	return nil
}

func CreateChannel(ctx context.Context, name, projectPath string) (*waveobj.Channel, error) {
	ch := &waveobj.Channel{
		OID:         uuid.NewString(),
		Name:        name,
		ProjectPath: projectPath,
		CreatedTs:   time.Now().UnixMilli(),
		Meta:        make(waveobj.MetaMapType),
	}
	if err := DBInsert(ctx, ch); err != nil {
		return nil, err
	}
	return ch, nil
}

// EnsureChannelAtPath returns projectPath's channel, creating it if there is none. The lookup and the insert
// share one write transaction and writes serialize on one connection, so callers racing for a new project's
// channel (a launch and the registry sync) end up with the same one rather than two.
func EnsureChannelAtPath(ctx context.Context, name, projectPath string) (*waveobj.Channel, error) {
	if normProjectPath(projectPath) == "" {
		return nil, fmt.Errorf("a project channel needs a project path")
	}
	return WithTxRtn(ctx, func(tx *TxWrap) (*waveobj.Channel, error) {
		existing, err := ChannelAtPath(tx.Context(), projectPath)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			return existing, nil
		}
		return CreateChannel(tx.Context(), name, projectPath)
	})
}

// DeleteChannel deletes the channel with the rows that belong to it: its runs, their events and dags, and
// its messages.
func DeleteChannel(ctx context.Context, channelId string) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		tx.Exec(`DELETE FROM db_run WHERE json_extract(data, '$.channeloid') = ?`, channelId)
		tx.Exec(`DELETE FROM db_channelmessage WHERE json_extract(data, '$.channeloid') = ?`, channelId)
		tx.Exec(`DELETE FROM db_runevent WHERE channelid = ?`, channelId)
		tx.Exec(`DELETE FROM db_dag WHERE json_extract(data, '$.channelid') = ?`, channelId)
		return DBDelete(tx.Context(), waveobj.OType_Channel, channelId)
	})
}

func GetChannels(ctx context.Context) ([]*waveobj.Channel, error) {
	chans, err := DBGetAllObjsByType[*waveobj.Channel](ctx, waveobj.OType_Channel)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(chans, func(i, j int) bool {
		return chans[i].CreatedTs > chans[j].CreatedTs
	})
	return chans, nil
}

// stampDispatchOwner is the concierge/gatekeeper analog of spawnRunWorkers' run stamp: when a dispatch or
// directive message links a worker tab to a channel, record the channel oref on that worker's meta so the
// worker→channel lookup (handleAsk/OnWorkerExit) is a direct read, not a search of the rows. Best-effort.
func stampDispatchOwner(ctx context.Context, channelId string, msg *waveobj.ChannelMessage) {
	if msg.Kind != "dispatch" && msg.Kind != "directive" {
		return
	}
	oref, err := waveobj.ParseORef(msg.RefORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return
	}
	channelORef := waveobj.MakeORef(waveobj.OType_Channel, channelId).String()
	if serr := StampWorkerOwner(ctx, msg.RefORef, "", channelORef); serr != nil {
		log.Printf("stampDispatchOwner: %v", serr)
	}
}

// bumpChannel raises the channel's version. The channel holds no messages or runs, so the bump is the only
// thing that tells the frontend one of its lists changed: the active channel refetches them on it. Errors
// when the channel is gone.
func bumpChannel(ctx context.Context, channelId string) error {
	return DBUpdateFn(ctx, channelId, func(*waveobj.Channel) {})
}

func PostChannelMessage(ctx context.Context, channelId string, msg waveobj.ChannelMessage) (*waveobj.ChannelMessage, error) {
	stampMessageIdentity(channelId, &msg)
	err := WithTx(ctx, func(tx *TxWrap) error {
		if err := bumpChannel(tx.Context(), channelId); err != nil {
			return err
		}
		return dbUpsertObjTx(tx.Context(), &msg)
	})
	if err != nil {
		return nil, err
	}
	stampDispatchOwner(ctx, channelId, &msg)
	return &msg, nil
}

// PostChannelMessageIf posts msg to the channel only if cond reports true inside the write transaction.
// cond gets the transaction's context and must read with it: such a read stays on the write connection.
// Because wstore serializes on a single write connection, two concurrent posters cannot both pass cond:
// the second transaction reads the first's committed message, so cond sees it. Returns true if the
// message was posted.
func PostChannelMessageIf(ctx context.Context, channelId string, msg waveobj.ChannelMessage, cond func(txCtx context.Context) (bool, error)) (bool, error) {
	var posted bool
	err := WithTx(ctx, func(tx *TxWrap) error {
		ch, err := DBMustGet[*waveobj.Channel](tx.Context(), channelId)
		if err != nil {
			return err
		}
		ok, err := cond(tx.Context())
		if err != nil {
			return err
		}
		if !ok {
			return nil
		}
		stampMessageIdentity(channelId, &msg)
		posted = true
		if err := DBUpdate(tx.Context(), ch); err != nil {
			return err
		}
		return dbUpsertObjTx(tx.Context(), &msg)
	})
	if posted {
		stampDispatchOwner(ctx, channelId, &msg)
	}
	return posted, err
}

// AppendRun adds a run to the channel as its db_run row.
func AppendRun(ctx context.Context, channelId string, run waveobj.Run) error {
	stampRunIdentity(channelId, &run)
	return WithTx(ctx, func(tx *TxWrap) error {
		if err := bumpChannel(tx.Context(), channelId); err != nil {
			return err
		}
		return dbUpsertObjTx(tx.Context(), &run)
	})
}

// UpdateRun applies fn to the channel's run and writes its row. The read, fn and the write share one
// write transaction.
func UpdateRun(ctx context.Context, channelId, runId string, fn func(*waveobj.Run) error) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		if err := bumpChannel(tx.Context(), channelId); err != nil {
			return err
		}
		run, err := DBGet[*waveobj.Run](tx.Context(), runId)
		if err != nil {
			return err
		}
		if run == nil || run.ChannelOID != channelId {
			return fmt.Errorf("run %q not found in channel", runId)
		}
		if err := fn(run); err != nil {
			return err
		}
		// fn may replace the run wholesale
		stampRunIdentity(channelId, run)
		return dbUpsertObjTx(tx.Context(), run)
	})
}

// GetRun reads a single run by id from its db_run row (runId == oid), verifying it belongs to channelId.
func GetRun(ctx context.Context, channelId, runId string) (*waveobj.Run, error) {
	run, err := DBGet[*waveobj.Run](ctx, runId)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, fmt.Errorf("run %q not found", runId)
	}
	if run.ChannelOID != channelId {
		return nil, fmt.Errorf("run %q not in channel %q", runId, channelId)
	}
	return run, nil
}

// GetChannelRuns returns the db_run rows for a channel (indexed on channeloid), in createdts order.
// Pure read (read pool).
func GetChannelRuns(ctx context.Context, channelId string) ([]*waveobj.Run, error) {
	return selectRuns(ctx, `SELECT oid, version, data FROM db_run
		WHERE json_extract(data, '$.channeloid') = ?
		ORDER BY json_extract(data, '$.createdts') ASC`, channelId)
}

// GetChannelsShared is GetChannels for a caller that only reads: the channels are shared, not copies
// (see selectShared).
func GetChannelsShared(ctx context.Context) ([]*waveobj.Channel, error) {
	chans, err := selectShared[*waveobj.Channel](ctx, `SELECT oid, version FROM db_channel`)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(chans, func(i, j int) bool {
		return chans[i].CreatedTs > chans[j].CreatedTs
	})
	return chans, nil
}

// GetChannelRunsShared is GetChannelRuns for a caller that only reads: the runs are shared, not copies
// (see selectShared). It sorts here, not in SQL, so the query never touches a row's data.
func GetChannelRunsShared(ctx context.Context, channelId string) ([]*waveobj.Run, error) {
	runs, err := selectShared[*waveobj.Run](ctx, `SELECT oid, version FROM db_run WHERE json_extract(data, '$.channeloid') = ?`, channelId)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(runs, func(i, j int) bool {
		return runs[i].CreatedTs < runs[j].CreatedTs
	})
	return runs, nil
}

// GetChannelRunChanges returns the id of every run in the channel, and the rows of only those whose version
// is not the one the caller holds in known. A caller that keeps a channel's run list refreshes it with this
// instead of re-reading every row: the id-and-version pass never touches a row's data. Pure read (read pool).
func GetChannelRunChanges(ctx context.Context, channelId string, known map[string]int) ([]string, []*waveobj.Run, error) {
	versions, err := WithReadTxRtn(ctx, func(tx *TxWrap) ([]idDataType, error) {
		var rows []idDataType
		tx.Select(&rows, `SELECT oid, version FROM db_run WHERE json_extract(data, '$.channeloid') = ?`, channelId)
		return rows, nil
	})
	if err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(versions))
	var stale []any
	for _, row := range versions {
		ids = append(ids, row.OId)
		if v, ok := known[row.OId]; !ok || v != row.Version {
			stale = append(stale, row.OId)
		}
	}
	if len(stale) == 0 {
		return ids, nil, nil
	}
	if len(stale) == len(ids) {
		runs, err := GetChannelRuns(ctx, channelId)
		return ids, runs, err
	}
	// ponytail: one bound parameter per stale run, and sqlite caps a statement's parameters (32766); a
	// caller that far behind without being wholly behind would need this chunked
	marks := strings.TrimSuffix(strings.Repeat("?,", len(stale)), ",")
	runs, err := selectRuns(ctx, `SELECT oid, version, data FROM db_run
		WHERE json_extract(data, '$.channeloid') = ? AND oid IN (`+marks+`)
		ORDER BY json_extract(data, '$.createdts') ASC`, append([]any{channelId}, stale...)...)
	return ids, runs, err
}

// selectRuns decodes the db_run rows a query selects (oid, version, data). Pure read (read pool).
func selectRuns(ctx context.Context, query string, args ...any) ([]*waveobj.Run, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]*waveobj.Run, error) {
		var rows []idDataType
		tx.Select(&rows, query, args...)
		rtn := make([]*waveobj.Run, 0, len(rows))
		for _, row := range rows {
			obj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(obj, row.Version)
			rtn = append(rtn, obj.(*waveobj.Run))
		}
		return rtn, nil
	})
}

// GetRunCandidatesByWorker returns, oldest first, the runs whose row text contains workerORef. That is a
// substring match made without decoding any row, so it also hits a run that only quotes the oref (in its
// goal, say): the caller confirms the oref is one of a phase's workers. Pure read (read pool).
func GetRunCandidatesByWorker(ctx context.Context, workerORef string) ([]*waveobj.Run, error) {
	if workerORef == "" {
		return nil, nil
	}
	return selectRuns(ctx, `SELECT oid, version, data FROM db_run
		WHERE instr(data, ?) > 0
		ORDER BY json_extract(data, '$.createdts') ASC`, workerORef)
}

// GetRunsBySessionIds returns the runs launched under any of sessionIds (Run.SessionId), across channels.
// Pure read (read pool).
func GetRunsBySessionIds(ctx context.Context, sessionIds []string) ([]*waveobj.Run, error) {
	if len(sessionIds) == 0 {
		return nil, nil
	}
	return selectRunsWhereIn(ctx, "sessionid", sessionIds)
}

// GetRunsByStatus returns the runs whose status is any of statuses, across channels. Pure read (read pool).
func GetRunsByStatus(ctx context.Context, statuses ...string) ([]*waveobj.Run, error) {
	if len(statuses) == 0 {
		return nil, nil
	}
	return selectRunsWhereIn(ctx, "status", statuses)
}

// selectRunsWhereIn selects the runs whose top-level json field is any of values.
func selectRunsWhereIn(ctx context.Context, field string, values []string) ([]*waveobj.Run, error) {
	marks := strings.TrimSuffix(strings.Repeat("?,", len(values)), ",")
	args := make([]any, len(values))
	for i, v := range values {
		args[i] = v
	}
	return selectRuns(ctx, `SELECT oid, version, data FROM db_run WHERE json_extract(data, '$.`+field+`') IN (`+marks+`)`, args...)
}

// DefaultChannelMessageLimit bounds a message-window fetch. Generous default per the design (true
// lazy "load older" UI is a follow-on); callers pass an explicit limit to paginate.
const DefaultChannelMessageLimit = 500

// GetChannelMessages returns a chronological (ts-ascending) window of a channel's messages from
// db_channelmessage. It selects newest-first (hitting idx_channelmessage_channeloid_ts) then reverses to
// ascending. before==0 means latest; before>0 returns only messages strictly older than that ts
// (load-older). Pure read.
func GetChannelMessages(ctx context.Context, channelId string, before int64, limit int) ([]*waveobj.ChannelMessage, error) {
	if limit <= 0 {
		limit = DefaultChannelMessageLimit
	}
	var rtn []*waveobj.ChannelMessage
	var err error
	if before > 0 {
		rtn, err = selectMessages(ctx, `SELECT oid, version, data FROM db_channelmessage
			WHERE json_extract(data, '$.channeloid') = ? AND json_extract(data, '$.ts') < ?
			ORDER BY json_extract(data, '$.ts') DESC, rowid DESC LIMIT ?`, channelId, before, limit)
	} else {
		rtn, err = selectMessages(ctx, `SELECT oid, version, data FROM db_channelmessage
			WHERE json_extract(data, '$.channeloid') = ?
			ORDER BY json_extract(data, '$.ts') DESC, rowid DESC LIMIT ?`, channelId, limit)
	}
	if err != nil {
		return nil, err
	}
	// reverse to chronological ascending (the order the FE renders)
	for i, j := 0, len(rtn)-1; i < j; i, j = i+1, j-1 {
		rtn[i], rtn[j] = rtn[j], rtn[i]
	}
	return rtn, nil
}

// GetMessagesByRef returns every message whose RefORef is refORef, across channels, oldest first
// (idx_channelmessage_reforef). It is how a worker's dispatch, directive and outcome messages are found
// without walking any channel's history. Inside a write transaction, pass that transaction's context.
func GetMessagesByRef(ctx context.Context, refORef string) ([]*waveobj.ChannelMessage, error) {
	if refORef == "" {
		return nil, nil
	}
	return selectMessages(ctx, `SELECT oid, version, data FROM db_channelmessage
		WHERE json_extract(data, '$.reforef') = ?
		ORDER BY json_extract(data, '$.ts') ASC, rowid ASC`, refORef)
}

// selectMessages decodes the db_channelmessage rows a query selects (oid, version, data). A read: on the
// read pool, or on the caller's transaction when ctx carries one.
func selectMessages(ctx context.Context, query string, args ...any) ([]*waveobj.ChannelMessage, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]*waveobj.ChannelMessage, error) {
		var rows []idDataType
		tx.Select(&rows, query, args...)
		rtn := make([]*waveobj.ChannelMessage, 0, len(rows))
		for _, row := range rows {
			obj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(obj, row.Version)
			rtn = append(rtn, obj.(*waveobj.ChannelMessage))
		}
		return rtn, nil
	})
}

// GetChannelProjectPaths returns channelOID -> projectpath for every channel via a scalar json_extract
// query — no blob deserialize. Used by radar collect to pick matching channels without loading history.
func GetChannelProjectPaths(ctx context.Context) (map[string]string, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (map[string]string, error) {
		type row struct {
			OId         string `db:"oid"`
			ProjectPath string `db:"projectpath"`
		}
		var rows []row
		tx.Select(&rows, `SELECT oid, COALESCE(json_extract(data, '$.projectpath'), '') AS projectpath FROM db_channel`)
		m := make(map[string]string, len(rows))
		for _, r := range rows {
			m[r.OId] = r.ProjectPath
		}
		return m, nil
	})
}

// MetaKey_ReadTs stores the per-channel last-read timestamp (ms) used to derive unread counts.
const MetaKey_ReadTs = "read:ts"

// MetaKey_Archived hides a channel from the active rail list. Reversible; the channel is kept, not deleted.
const MetaKey_Archived = "archived"

// MetaKey_JarvisRunORef / MetaKey_JarvisChannelORef stamp the owning run: and channel: oref onto a
// worker tab's meta at spawn, so the worker-oref → run lookup is a direct field read instead of a full
// channel scan (channel-scaling design call 1).
const MetaKey_JarvisRunORef = "jarvis:runoref"
const MetaKey_JarvisChannelORef = "jarvis:channeloref"

// StampWorkerOwner records the owning run/channel oref on a worker tab's meta (only the non-empty ones —
// concierge workers pass runORef=="" and get channeloref only). Best-effort: a non-tab oref or a gone
// tab returns an error for the caller to log-and-continue; never mutates unrelated state.
func StampWorkerOwner(ctx context.Context, workerTabORef, runORef, channelORef string) error {
	oref, err := waveobj.ParseORef(workerTabORef)
	if err != nil || oref.OType != waveobj.OType_Tab {
		return fmt.Errorf("bad worker oref %q: %w", workerTabORef, err)
	}
	meta := waveobj.MetaMapType{}
	if runORef != "" {
		meta[MetaKey_JarvisRunORef] = runORef
	}
	if channelORef != "" {
		meta[MetaKey_JarvisChannelORef] = channelORef
	}
	if len(meta) == 0 {
		return nil
	}
	_, err = UpdateObjectMeta(ctx, oref, meta, false)
	return err
}

// GetWorkerOwner reads the owning run:/channel: orefs stamped on a worker tab's meta.
// Empty strings when a key is absent. Errors only for a non-tab oref or a missing tab.
func GetWorkerOwner(ctx context.Context, workerTabORef string) (runORef string, channelORef string, err error) {
	oref, perr := waveobj.ParseORef(workerTabORef)
	if perr != nil || oref.OType != waveobj.OType_Tab {
		return "", "", fmt.Errorf("bad worker oref %q: %w", workerTabORef, perr)
	}
	tab, gerr := DBMustGet[*waveobj.Tab](ctx, oref.OID)
	if gerr != nil {
		return "", "", gerr
	}
	return tab.Meta.GetString(MetaKey_JarvisRunORef, ""), tab.Meta.GetString(MetaKey_JarvisChannelORef, ""), nil
}

// SetChannelRead stamps the channel's last-read timestamp.
func SetChannelRead(ctx context.Context, channelId string, ts int64) error {
	return DBUpdateFn(ctx, channelId, func(ch *waveobj.Channel) {
		if ch.Meta == nil {
			ch.Meta = make(waveobj.MetaMapType)
		}
		ch.Meta[MetaKey_ReadTs] = float64(ts)
	})
}
