// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"time"

	"github.com/wavetermdev/waveterm/pkg/council"
	"github.com/wavetermdev/waveterm/pkg/projectactivity"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// GetProjectActivityCommand answers the Overview's Activity card: the project's per-day tokens from the daily
// tally, and its runs and councils as History lists them, so the card's counts and History's rows agree.
func (ws *WshServer) GetProjectActivityCommand(ctx context.Context, data wshrpc.CommandGetProjectActivityData) (*wshrpc.CommandGetProjectActivityRtnData, error) {
	now := time.Now()
	from := projectactivity.WindowStart(now, data.Weeks).Format("2006-01-02")
	rows, err := wstore.QuerySessionDays(ctx, data.Path, from)
	if err != nil {
		return nil, fmt.Errorf("reading the daily tally: %w", err)
	}
	firstDay, err := wstore.FirstSessionDay(ctx)
	if err != nil {
		return nil, fmt.Errorf("reading the first tallied day: %w", err)
	}
	chans, err := wstore.GetChannels(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing channels: %w", err)
	}
	var runs []*waveobj.Run
	project := wstore.NormSessionCwd(data.Path)
	for _, ch := range chans {
		if project == "" || wstore.NormSessionCwd(ch.ProjectPath) != project {
			continue
		}
		chRuns, err := wstore.GetChannelRuns(ctx, ch.OID)
		if err != nil {
			return nil, fmt.Errorf("getting the runs of channel %s: %w", ch.OID, err)
		}
		chRuns, _ = withoutBrainstormSessions(chRuns)
		runs = append(runs, chRuns...)
	}
	councils, err := council.List(data.Path)
	if err != nil {
		return nil, fmt.Errorf("listing councils: %w", err)
	}
	days, sessions := projectactivity.Aggregate(rows, runs, councils, now, data.Weeks)
	return &wshrpc.CommandGetProjectActivityRtnData{Days: days, FirstDay: firstDay, Sessions: sessions}, nil
}
