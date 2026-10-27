// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package projectactivity

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/usagestats"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// startDelay keeps the first scan, which walks every transcript still on disk, off the app's startup.
	startDelay = 2 * time.Minute
	// scanInterval is the pause between scans while wavesrv runs.
	scanInterval = 30 * time.Minute
)

// TallyRows folds the usage buckets into one row per (day, harness, session): a session that used two
// models on a day has two buckets. A bucket's tokens are the total the usage panel shows. The cwd is the
// session's own; a session with no cwd on its meta belongs to no project and is left out.
func TallyRows(buckets []usagestats.Bucket, metas []usagestats.SessionMeta) []wstore.SessionDay {
	type sessionKey struct{ harness, session string }
	cwds := map[sessionKey]string{}
	for _, m := range metas {
		if m.Cwd != "" {
			cwds[sessionKey{m.Harness, m.Session}] = wstore.NormSessionCwd(m.Cwd)
		}
	}
	type rowKey struct{ day, harness, session string }
	index := map[rowKey]int{}
	var rows []wstore.SessionDay
	for _, b := range buckets {
		cwd, ok := cwds[sessionKey{b.Harness, b.Session}]
		if !ok {
			continue
		}
		k := rowKey{b.Day, b.Harness, b.Session}
		i, seen := index[k]
		if !seen {
			i = len(rows)
			index[k] = i
			rows = append(rows, wstore.SessionDay{Day: b.Day, Harness: b.Harness, Session: b.Session, Cwd: cwd})
		}
		rows[i].Tokens += int64(b.Input + b.Output + b.Reasoning + b.CacheRead + b.CacheCreate)
	}
	return rows
}

// ScanWindowDays is how many local days the next scan reads: from the newest tallied day to today, both
// included, so the days arcterm was closed are tallied once it runs again and the newest day, whose tokens
// may have grown, is read again. 0 (every transcript on disk) when the tally is empty.
func ScanWindowDays(lastDay string, now time.Time) int {
	if lastDay == "" {
		return 0
	}
	last, err := time.ParseInLocation("2006-01-02", lastDay, now.Location())
	if err != nil {
		return 0
	}
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	// whole local days between two local midnights; rounding absorbs a daylight-saving hour
	days := int((today.Sub(last).Hours() + 12) / 24)
	if days < 0 {
		days = 0
	}
	return days + 1
}

// scanOnce tallies the days since the newest one. It returns the window it read and the rows it wrote.
func scanOnce(ctx context.Context) (windowDays, rows int, err error) {
	last, err := wstore.LastSessionDay(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("reading the newest tallied day: %w", err)
	}
	windowDays = ScanWindowDays(last, time.Now())
	buckets, metas, err := usagestats.ScanUsage(windowDays)
	if err != nil {
		return windowDays, 0, fmt.Errorf("scanning usage: %w", err)
	}
	tally := TallyRows(buckets, metas)
	if err := wstore.UpsertSessionDays(ctx, tally); err != nil {
		return windowDays, 0, fmt.Errorf("writing the daily tally: %w", err)
	}
	return windowDays, len(tally), nil
}

// StartLoop keeps the daily tally current: a scan after startDelay, then one every scanInterval, until ctx
// ends. A failed scan is logged and tried again at the next tick.
func StartLoop(ctx context.Context) {
	go func() {
		defer func() {
			panichandler.PanicHandler("projectactivity.StartLoop", recover())
		}()
		first := true
		wait := startDelay
		for {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
			wait = scanInterval
			start := time.Now()
			days, rows, err := scanOnce(ctx)
			if err != nil {
				log.Printf("error tallying daily usage: %v\n", err)
				continue
			}
			if first {
				first = false
				span := "every transcript on disk"
				if days > 0 {
					span = fmt.Sprintf("%d days", days)
				}
				log.Printf("daily usage tally: first scan read %s, wrote %d rows in %s\n", span, rows, time.Since(start).Round(time.Millisecond))
			}
		}
	}()
}
