// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

// MetaKey_ChannelsContracted marks (on the MainServer singleton) that every channel blob has had its
// embedded messages and runs moved to rows and removed, so the pass runs at most once per data dir.
const MetaKey_ChannelsContracted = "channel:contracted"

// its own budget, not InitWStore's 2s: a store that skipped the row backfill inserts every row here
const contractChannelsTimeout = 30 * time.Second

// legacyChannelArrays is the part of a pre-contract channel blob that waveobj.Channel no longer has.
type legacyChannelArrays struct {
	Messages json.RawMessage `json:"messages"`
	Runs     json.RawMessage `json:"runs"`
}

type contractStats struct {
	channels, inserted, bytesBefore, bytesAfter int
}

// ContractChannels moves what is left in the channel blobs' embedded arrays into rows and strips the
// arrays. It must finish before anything writes a channel: a DBUpdate of the contracted struct drops a
// blob's arrays without copying them, so an error here has to fail startup. Channels already done stay
// done and the next start resumes with the rest; the marker is set only once none is left.
func ContractChannels() error {
	ctx, cancel := context.WithTimeout(context.Background(), contractChannelsTimeout)
	defer cancel()
	done, err := SingletonMetaBool(ctx, MetaKey_ChannelsContracted)
	if err != nil {
		return err
	}
	if done {
		return nil
	}
	oids, err := WithTxRtn(ctx, func(tx *TxWrap) ([]string, error) {
		return tx.SelectStrings(`SELECT oid FROM db_channel ORDER BY oid`), nil
	})
	if err != nil {
		return fmt.Errorf("contracting channels: listing: %w", err)
	}
	var stats contractStats
	for _, oid := range oids {
		if err := contractChannel(ctx, oid, &stats); err != nil {
			return fmt.Errorf("contracting channel %s: %w", oid, err)
		}
	}
	log.Printf("channel contract: %d channels, %d rows inserted, %d -> %d bytes\n", stats.channels, stats.inserted, stats.bytesBefore, stats.bytesAfter)
	return MarkSingletonMetaBool(ctx, MetaKey_ChannelsContracted)
}

// contractChannel does one channel in one write transaction: insert the embedded items that have no row,
// then remove the arrays. A row that exists is never touched: it is the newer copy.
func contractChannel(ctx context.Context, channelId string, stats *contractStats) error {
	inserted := 0
	var before, after int
	err := WithTx(ctx, func(tx *TxWrap) error {
		raw := tx.GetByteArr(`SELECT data FROM db_channel WHERE oid = ?`, channelId)
		before = len(raw)
		after = before
		var legacy legacyChannelArrays
		if err := json.Unmarshal(raw, &legacy); err != nil {
			return fmt.Errorf("decoding blob: %w", err)
		}
		if legacy.Messages == nil && legacy.Runs == nil {
			return nil
		}
		msgs, err := legacyItems(legacy.Messages, waveobj.OType_ChannelMessage)
		if err != nil {
			return fmt.Errorf("decoding messages: %w", err)
		}
		runs, err := legacyItems(legacy.Runs, waveobj.OType_Run)
		if err != nil {
			return fmt.Errorf("decoding runs: %w", err)
		}
		for _, item := range append(msgs, runs...) {
			switch v := item.(type) {
			case *waveobj.ChannelMessage:
				stampMessageIdentity(channelId, v)
			case *waveobj.Run:
				stampRunIdentity(channelId, v)
			}
			added, err := insertIfNoRow(tx, item)
			if err != nil {
				return err
			}
			inserted += added
		}
		tx.Exec(`UPDATE db_channel SET data = json_remove(data, '$.messages', '$.runs') WHERE oid = ?`, channelId)
		after = tx.GetInt(`SELECT length(CAST(data AS BLOB)) FROM db_channel WHERE oid = ?`, channelId)
		return nil
	})
	if err != nil {
		return err
	}
	stats.channels++
	stats.inserted += inserted
	stats.bytesBefore += before
	stats.bytesAfter += after
	return nil
}

// legacyItems decodes one embedded array the way a row is read (FromJsonMap), so an item in an older
// field form loads here exactly as it did while it was part of the channel.
func legacyItems(raw json.RawMessage, otype string) ([]waveobj.WaveObj, error) {
	if raw == nil {
		return nil, nil
	}
	var maps []map[string]any
	if err := json.Unmarshal(raw, &maps); err != nil {
		return nil, err
	}
	items := make([]waveobj.WaveObj, 0, len(maps))
	for i, m := range maps {
		if m == nil {
			return nil, fmt.Errorf("item %d is null", i)
		}
		m[waveobj.OTypeKeyName] = otype
		item, err := waveobj.FromJsonMap(m)
		if err != nil {
			return nil, fmt.Errorf("item %d: %w", i, err)
		}
		items = append(items, item)
	}
	return items, nil
}

// insertIfNoRow inserts val unless a row with its oid exists, and reports how many rows it added.
func insertIfNoRow(tx *TxWrap, val waveobj.WaveObj) (int, error) {
	oid := waveobj.GetOID(val)
	if oid == "" {
		return 0, fmt.Errorf("embedded %s has no id", val.GetOType())
	}
	if tx.Exists(fmt.Sprintf("SELECT 1 FROM %s WHERE oid = ?", waveObjTableName(val)), oid) {
		return 0, nil
	}
	if err := DBInsert(tx.Context(), val); err != nil {
		return 0, err
	}
	return 1, nil
}

// SingletonMetaBool reads a boolean flag off the MainServer singleton meta. A fresh store with no
// MainServer row yet reports false (not done). Used to gate a one-shot startup pass.
func SingletonMetaBool(ctx context.Context, key string) (bool, error) {
	ms, err := DBGetSingleton[*waveobj.MainServer](ctx)
	if err != nil || ms == nil {
		// no MainServer yet (fresh store) → not set
		return false, nil
	}
	return ms.Meta.GetBool(key, false), nil
}

// MarkSingletonMetaBool sets a boolean flag on the MainServer singleton meta.
func MarkSingletonMetaBool(ctx context.Context, key string) error {
	ms, err := DBGetSingleton[*waveobj.MainServer](ctx)
	if err != nil || ms == nil {
		// no MainServer row yet: the mark will be set by whoever creates it, and the pass is
		// idempotent, so a re-run on next boot is harmless. Skip marking rather than racing wcore's
		// lazy create.
		return nil
	}
	if ms.Meta == nil {
		ms.Meta = waveobj.MetaMapType{}
	}
	ms.Meta[key] = true
	return DBUpdate(ctx, ms)
}
