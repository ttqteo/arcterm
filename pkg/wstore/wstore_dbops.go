// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

var ErrNotFound = fmt.Errorf("not found")

func waveObjTableName(w waveobj.WaveObj) string {
	return "db_" + w.GetOType()
}

func tableNameFromOType(otype string) string {
	return "db_" + otype
}

func getOTypeGen[T waveobj.WaveObj]() string {
	var zeroObj T
	return zeroObj.GetOType()
}

var viewRe = regexp.MustCompile(`^[a-z0-9]{1,20}$`)

type idDataType struct {
	OId     string
	Version int
	Data    []byte
}

func genericCastWithErr[T any](v any, err error) (T, error) {
	if err != nil {
		var zeroVal T
		return zeroVal, err
	}
	if v == nil {
		var zeroVal T
		return zeroVal, nil
	}
	return v.(T), err
}

func DBGetSingleton[T waveobj.WaveObj](ctx context.Context) (T, error) {
	rtn, err := DBGetSingletonByType(ctx, getOTypeGen[T]())
	return genericCastWithErr[T](rtn, err)
}

func DBGetSingletonByType(ctx context.Context, otype string) (waveobj.WaveObj, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s LIMIT 1", table)
		var row idDataType
		found := tx.Get(&row, query)
		if !found {
			return nil, ErrNotFound
		}
		rtn, err := waveobj.FromJson(row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBExistsORef(ctx context.Context, oref waveobj.ORef) (bool, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (bool, error) {
		table := tableNameFromOType(oref.OType)
		query := fmt.Sprintf("SELECT oid FROM %s WHERE oid = ?", table)
		return tx.Exists(query, oref.OID), nil
	})
}

func DBGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	rtn, err := DBGetORef(ctx, waveobj.ORef{OType: getOTypeGen[T](), OID: id})
	return genericCastWithErr[T](rtn, err)
}

func DBMustGet[T waveobj.WaveObj](ctx context.Context, id string) (T, error) {
	rtn, err := DBGetORef(ctx, waveobj.ORef{OType: getOTypeGen[T](), OID: id})
	if err != nil {
		var zeroVal T
		return zeroVal, err
	}
	if rtn == nil {
		var zeroVal T
		return zeroVal, ErrNotFound
	}
	return rtn.(T), nil
}

func DBGetORef(ctx context.Context, oref waveobj.ORef) (waveobj.WaveObj, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (waveobj.WaveObj, error) {
		table := tableNameFromOType(oref.OType)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid = ?", table)
		var row idDataType
		found := tx.Get(&row, query, oref.OID)
		if !found {
			return nil, nil
		}
		rtn, err := waveobj.FromJson(row.Data)
		if err != nil {
			return rtn, err
		}
		waveobj.SetVersion(rtn, row.Version)
		return rtn, nil
	})
}

func DBGetAllObjsByType[T waveobj.WaveObj](ctx context.Context, otype string) ([]T, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]T, error) {
		rtn := make([]T, 0)
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("SELECT oid, version, data FROM %s", table)
		var rows []idDataType
		tx.Select(&rows, query)
		for _, row := range rows {
			waveObj, err := waveobj.FromJson(row.Data)
			if err != nil {
				return nil, err
			}
			waveobj.SetVersion(waveObj, row.Version)

			rtn = append(rtn, waveObj.(T))
		}
		return rtn, nil
	})
}

// sharedObjs holds the objects the Shared readers have decoded, each at the version it was read.
// ponytail: a deleted row's entry stays until wavesrv exits; drop it in DBDelete if deletes ever add up.
var sharedObjs = struct {
	sync.Mutex
	byORef map[waveobj.ORef]waveobj.WaveObj
}{byORef: map[waveobj.ORef]waveobj.WaveObj{}}

// sharedFetchChunk keeps one IN list under sqlite's bound-parameter limit.
const sharedFetchChunk = 500

// selectShared returns the T rows that query selects, in its order. query yields oid and version only:
// a row's data is read and decoded just when its version is not the one already held, so a poll over
// rows that seldom change stops re-decoding all of them. The objects are shared between callers and
// must not be modified.
func selectShared[T waveobj.WaveObj](ctx context.Context, query string, args ...any) ([]T, error) {
	otype := getOTypeGen[T]()
	return WithReadTxRtn(ctx, func(tx *TxWrap) ([]T, error) {
		var rows []idDataType
		tx.Select(&rows, query, args...)
		rtn := make([]T, len(rows))
		staleIdx := map[string]int{}
		var stale []any
		sharedObjs.Lock()
		for i, row := range rows {
			held, ok := sharedObjs.byORef[waveobj.ORef{OType: otype, OID: row.OId}]
			if ok && waveobj.GetVersion(held) == row.Version {
				rtn[i] = held.(T)
				continue
			}
			staleIdx[row.OId] = i
			stale = append(stale, row.OId)
		}
		sharedObjs.Unlock()
		for start := 0; start < len(stale); start += sharedFetchChunk {
			chunk := stale[start:min(start+sharedFetchChunk, len(stale))]
			marks := strings.TrimSuffix(strings.Repeat("?,", len(chunk)), ",")
			var fresh []idDataType
			tx.Select(&fresh, fmt.Sprintf("SELECT oid, version, data FROM %s WHERE oid IN (%s)", tableNameFromOType(otype), marks), chunk...)
			for _, row := range fresh {
				obj, err := waveobj.FromJson(row.Data)
				if err != nil {
					return nil, err
				}
				waveobj.SetVersion(obj, row.Version)
				rtn[staleIdx[row.OId]] = obj.(T)
				sharedObjs.Lock()
				sharedObjs.byORef[waveobj.ORef{OType: otype, OID: row.OId}] = obj
				sharedObjs.Unlock()
			}
		}
		return rtn, nil
	})
}

func DBResolveEasyOID(ctx context.Context, oid string) (*waveobj.ORef, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (*waveobj.ORef, error) {
		for _, rtype := range waveobj.AllWaveObjTypes() {
			otype := reflect.Zero(rtype).Interface().(waveobj.WaveObj).GetOType()
			table := tableNameFromOType(otype)
			var fullOID string
			if len(oid) == 8 {
				query := fmt.Sprintf("SELECT oid FROM %s WHERE oid LIKE ?", table)
				fullOID = tx.GetString(query, oid+"%")
			} else {
				query := fmt.Sprintf("SELECT oid FROM %s WHERE oid = ?", table)
				fullOID = tx.GetString(query, oid)
			}
			if fullOID != "" {
				oref := waveobj.MakeORef(otype, fullOID)
				return &oref, nil
			}
		}
		return nil, ErrNotFound
	})
}

func DBDelete(ctx context.Context, otype string, id string) error {
	err := WithTx(ctx, func(tx *TxWrap) error {
		table := tableNameFromOType(otype)
		query := fmt.Sprintf("DELETE FROM %s WHERE oid = ?", table)
		tx.Exec(query, id)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Delete, OType: otype, OID: id})
		return nil
	})
	if err != nil {
		return err
	}
	go func() {
		defer func() {
			panichandler.PanicHandler("DBDelete:filestore.DeleteZone", recover())
		}()
		// we spawn a go routine here because we don't want to reuse the DB connection
		// since DBDelete is called in a transaction from DeleteTab
		deleteCtx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelFn()
		err := filestore.WFS.DeleteZone(deleteCtx, id)
		if err != nil {
			log.Printf("error deleting filestore zone (after deleting block): %v", err)
		}
	}()
	return nil
}

func DBUpdate(ctx context.Context, val waveobj.WaveObj) error {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot update %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := waveObjTableName(val)
		query := fmt.Sprintf("UPDATE %s SET data = ?, version = version+1 WHERE oid = ? RETURNING version", table)
		newVersion := tx.GetInt(query, jsonData, oid)
		waveobj.SetVersion(val, newVersion)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

func DBUpdateFn[T waveobj.WaveObj](ctx context.Context, id string, updateFn func(T)) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		val, err := DBMustGet[T](tx.Context(), id)
		if err != nil {
			return err
		}
		updateFn(val)
		return DBUpdate(tx.Context(), val)
	})
}

func DBUpdateFnErr[T waveobj.WaveObj](ctx context.Context, id string, updateFn func(T) error) error {
	return WithTx(ctx, func(tx *TxWrap) error {
		val, err := DBMustGet[T](tx.Context(), id)
		if err != nil {
			return err
		}
		err = updateFn(val)
		if err != nil {
			return err
		}
		return DBUpdate(tx.Context(), val)
	})
}

func DBInsert(ctx context.Context, val waveobj.WaveObj) error {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot insert %T value with empty id", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := waveObjTableName(val)
		waveobj.SetVersion(val, 1)
		query := fmt.Sprintf("INSERT INTO %s (oid, version, data) VALUES (?, ?, ?)", table)
		tx.Exec(query, oid, 1, jsonData)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

// dbUpsertObjTx writes val as a row AND queues a waveobj:update for its oref (published on the enclosing
// WithTx commit) so FE per-object (run:) subscriptions get live deltas. Call with a tx.Context() already
// inside a WithTx on the write handle; txwrap reuses that transaction, keeping the row write atomic with
// the channel's version bump.
func dbUpsertObjTx(ctx context.Context, val waveobj.WaveObj) error {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return fmt.Errorf("cannot upsert %T with empty oid", val)
	}
	jsonData, err := waveobj.ToJson(val)
	if err != nil {
		return err
	}
	return WithTx(ctx, func(tx *TxWrap) error {
		table := waveObjTableName(val)
		query := fmt.Sprintf(
			"INSERT INTO %s (oid, version, data) VALUES (?, 1, ?) "+
				"ON CONFLICT(oid) DO UPDATE SET data = excluded.data, version = version + 1",
			table)
		tx.Exec(query, oid, jsonData)
		waveobj.ContextAddUpdate(ctx, waveobj.WaveObjUpdate{UpdateType: waveobj.UpdateType_Update, OType: val.GetOType(), OID: oid, Obj: val})
		return nil
	})
}

func DBFindTabForBlockId(ctx context.Context, blockId string) (string, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		iterNum := 1
		for {
			if iterNum > 5 {
				return "", fmt.Errorf("too many iterations looking for tab in block parents")
			}
			query := `
			SELECT json_extract(b.data, '$.parentoref') AS parentoref
			FROM db_block b
			WHERE b.oid = ?;`
			parentORef := tx.GetString(query, blockId)
			oref, err := waveobj.ParseORef(parentORef)
			if err != nil {
				return "", fmt.Errorf("bad block parent oref: %v", err)
			}
			if oref.OType == "tab" {
				return oref.OID, nil
			}
			if oref.OType == "block" {
				blockId = oref.OID
				iterNum++
				continue
			}
			return "", fmt.Errorf("bad parent oref type: %v", oref.OType)
		}
	})
}

func DBFindWorkspaceForTabId(ctx context.Context, tabId string) (string, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		query := `
			WITH variable(value) AS (
				SELECT ?
			)
			SELECT w.oid
			FROM db_workspace w, variable
			WHERE EXISTS (
				SELECT 1
				FROM json_each(w.data, '$.tabids') AS je
				WHERE je.value = variable.value
			);
			`
		wsId := tx.GetString(query, tabId)
		return wsId, nil
	})
}

func DBFindWindowForWorkspaceId(ctx context.Context, workspaceId string) (string, error) {
	return WithReadTxRtn(ctx, func(tx *TxWrap) (string, error) {
		query := `
			SELECT w.oid
			FROM db_window w WHERE json_extract(data, '$.workspaceid') = ?`
		return tx.GetString(query, workspaceId), nil
	})
}
