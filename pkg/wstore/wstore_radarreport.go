// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

func CreateRadarReport(ctx context.Context, projectName, projectPath string) (*waveobj.RadarReport, error) {
	rpt := &waveobj.RadarReport{
		OID:         uuid.NewString(),
		ProjectName: projectName,
		ProjectPath: projectPath,
		Status:      "collecting",
		Phase:       "collecting",
		StartedTs:   time.Now().UnixMilli(),
		Meta:        make(waveobj.MetaMapType),
	}
	if err := DBInsert(ctx, rpt); err != nil {
		return nil, err
	}
	return rpt, nil
}

func GetRadarReport(ctx context.Context, reportId string) (*waveobj.RadarReport, error) {
	return DBMustGet[*waveobj.RadarReport](ctx, reportId)
}

// GetRadarReportsShared returns every report, newest-first, for a caller that only reads: the reports
// are shared, not copies (see selectShared).
func GetRadarReportsShared(ctx context.Context) ([]*waveobj.RadarReport, error) {
	reports, err := selectShared[*waveobj.RadarReport](ctx, `SELECT oid, version FROM db_radarreport`)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(reports, func(i, j int) bool { return reports[i].StartedTs > reports[j].StartedTs })
	return reports, nil
}

// GetRadarReports returns reports for projectPath (all reports when projectPath == ""), newest-first.
func GetRadarReports(ctx context.Context, projectPath string) ([]*waveobj.RadarReport, error) {
	all, err := DBGetAllObjsByType[*waveobj.RadarReport](ctx, waveobj.OType_RadarReport)
	if err != nil {
		return nil, err
	}
	var out []*waveobj.RadarReport
	for _, r := range all {
		if projectPath == "" || r.ProjectPath == projectPath {
			out = append(out, r)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartedTs > out[j].StartedTs })
	return out, nil
}

func UpdateRadarReport(ctx context.Context, reportId string, fn func(*waveobj.RadarReport)) error {
	return DBUpdateFn(ctx, reportId, fn)
}

func DeleteRadarReport(ctx context.Context, reportId string) error {
	return DBDelete(ctx, waveobj.OType_RadarReport, reportId)
}
