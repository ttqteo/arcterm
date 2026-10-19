// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package jarvisstate

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/agentsessions"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// emptyLegs returns seams whose every leg reads nothing. Tests override the legs they exercise;
// the home-dir legs (sessions, attention) must never read the operator's real data.
func emptyLegs() fetchSeams {
	return fetchSeams{
		getChannels:     func(ctx context.Context) ([]*waveobj.Channel, error) { return nil, nil },
		getChannelRuns:  func(ctx context.Context, id string) ([]*waveobj.Run, error) { return nil, nil },
		scanSessions:    func(days, limit int) ([]agentsessions.SessionInfo, error) { return nil, nil },
		gatherAttention: func(ctx context.Context, chans []*waveobj.Channel, runsByChannel map[string][]*waveobj.Run) ([]wshrpc.AttentionItem, error) {
			return nil, nil
		},
		openVault:       func(ctx context.Context) (*wavevault.Vault, error) { return nil, errors.New("no vault") },
		loadDossier:     jarvisdossier.LoadDossier,
		loadDecision:    jarvisdossier.LoadDecision,
		getEfforts:      func(ctx context.Context) ([]*waveobj.Effort, error) { return nil, nil },
	}
}

// seedStore writes one channel with two done+sealed runs and one in-flight run.
func seedStore(t *testing.T, ctx context.Context) {
	t.Helper()
	ch, err := wstore.CreateChannel(ctx, "rpc", "/p/one")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	seedRun := func(id string, status string, created, completed int64) {
		t.Helper()
		if err := wstore.AppendRun(ctx, ch.OID, waveobj.Run{OID: id, ID: id, Goal: "goal-" + id, Status: status, ProjectPath: "/p/one", CreatedTs: created}); err != nil {
			t.Fatalf("append run %s: %v", id, err)
		}
		if status == "done" {
			if err := wstore.UpdateRun(ctx, ch.OID, id, func(r *waveobj.Run) error {
				r.CompletedTs = completed
				r.Evidence = &waveobj.RunEvidence{Summary: "shipped " + id}
				return nil
			}); err != nil {
				t.Fatalf("seal run %s: %v", id, err)
			}
		}
	}
	seedRun("r-old", "done", 100, 500)
	seedRun("r-new", "done", 100, 900)
	seedRun("r-live", "executing", 300, 0)
}

func TestFetchWorkStateWindowsShippedTimelineAndDelta(t *testing.T) {
	ctx := context.Background()
	seedStore(t, ctx)
	seams := emptyLegs()
	seams.getChannels = defaultSeams.getChannels
	seams.getChannelRuns = defaultSeams.getChannelRuns
	restore := SetFetchSeamsForTest(seams)
	defer restore()
	st, err := FetchWorkState(ctx, "", 600)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	var shipped, events, delta int
	for _, p := range st.Projects {
		shipped += len(p.Shipped)
		events += len(p.Events)
		delta += len(p.Delta)
	}
	// window 600: r-old (created 100, done 500) and r-live (created 300) fall outside; r-new's
	// run-done at 900 is the only event inside. Delta adds nothing beyond Timeline (no attention).
	if shipped != 1 || events != 1 || delta != 1 {
		t.Fatalf("windowed: shipped=%d events=%d delta=%d want 1/1/1", shipped, events, delta)
	}
	// unbounded stays unbounded for existing callers.
	all, err := FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	var shippedAll int
	for _, p := range all.Projects {
		shippedAll += len(p.Shipped)
	}
	if shippedAll != 2 {
		t.Fatalf("shipped=%d want both sealed runs unbounded", shippedAll)
	}
}

func TestFetchWorkStateMarksRunsUnhealthyOnChannelReadFailure(t *testing.T) {
	ctx := context.Background()
	seedStore(t, ctx)
	ch2, err := wstore.CreateChannel(ctx, "rpc2", "/p/two")
	if err != nil {
		t.Fatalf("create second channel: %v", err)
	}
	seams := emptyLegs()
	seams.getChannels = wstore.GetChannels
	seams.getChannelRuns = func(ctx context.Context, id string) ([]*waveobj.Run, error) {
		if id == ch2.OID {
			return nil, errors.New("simulated channel read failure")
		}
		return wstore.GetChannelRuns(ctx, id)
	}
	restore := SetFetchSeamsForTest(seams)
	defer restore()
	st, err := FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if st.Sources.Runs {
		t.Fatalf("sources=%+v want Runs unhealthy", st.Sources)
	}
	// the seeded channel's sealed run must survive the second channel's failure.
	var shippedFound bool
	for _, p := range st.Projects {
		for _, s := range p.Shipped {
			if s.RunOID == "r-new" {
				shippedFound = true
			}
		}
	}
	if !shippedFound {
		t.Fatalf("state=%+v want partial run data kept despite the failed channel read", st)
	}
}

func TestFetchWorkStateMarksDossiersUnhealthyOnDossierLoadFailure(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	poisonID, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Objective: "poison record"})
	if err != nil {
		t.Fatalf("create poison dossier: %v", err)
	}
	healthyID, healthyHash, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Objective: "healthy record"})
	if err != nil {
		t.Fatalf("create healthy dossier: %v", err)
	}
	if _, err := jarvisdossier.SetBlockers(v, healthyID, []string{"needs decision on X"}, healthyHash); err != nil {
		t.Fatalf("set blockers: %v", err)
	}
	if _, err := jarvisdossier.AppendDecision(v, jarvisdossier.DecisionFacts{TaskID: healthyID, Summary: "chose sqlite"}); err != nil {
		t.Fatalf("append decision: %v", err)
	}
	seams := emptyLegs()
	seams.openVault = func(ctx context.Context) (*wavevault.Vault, error) { return v, nil }
	seams.loadDossier = func(r *wavevault.Retriever, id string) (*jarvisdossier.Dossier, error) {
		d, err := jarvisdossier.LoadDossier(r, id)
		if id == poisonID {
			return nil, errors.New("simulated dossier load failure")
		}
		return d, err
	}
	restore := SetFetchSeamsForTest(seams)
	defer restore()
	st, err := FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if st.Sources.Dossiers {
		t.Fatalf("sources=%+v want Dossiers unhealthy", st.Sources)
	}
	var blockerFound bool
	for _, p := range st.Projects {
		for _, a := range p.Active {
			if a.Kind == "blocker" {
				blockerFound = true
			}
		}
	}
	if !blockerFound {
		t.Fatalf("state=%+v want the healthy dossier's blocker kept despite the failed load", st)
	}
}

func TestFetchWorkStateHealthyLegsReportHealthy(t *testing.T) {
	ctx := context.Background()
	v, err := wavevault.OpenVaultAtForTest(ctx, t.TempDir())
	if err != nil {
		t.Fatalf("open vault: %v", err)
	}
	id, _, err := jarvisdossier.CreateDossier(v, jarvisdossier.DossierFacts{Objective: "healthy record"})
	if err != nil {
		t.Fatalf("create dossier: %v", err)
	}
	if _, err := jarvisdossier.AppendDecision(v, jarvisdossier.DecisionFacts{TaskID: id, Summary: "chose sqlite"}); err != nil {
		t.Fatalf("append decision: %v", err)
	}
	seams := emptyLegs()
	seams.openVault = func(ctx context.Context) (*wavevault.Vault, error) { return v, nil }
	restore := SetFetchSeamsForTest(seams)
	defer restore()
	st, err := FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	want := wshrpc.SourceHealth{Runs: true, Sessions: true, Dossiers: true, Efforts: true, Attention: "volatile"}
	if st.Sources != want {
		t.Fatalf("sources = %+v, want %+v", st.Sources, want)
	}
}

// projects are keyed by their slash-normalized path, a run with none under "(none)"; a filter keeps only the
// filtered project's work
func TestFetchWorkStateKeysAndFiltersProjects(t *testing.T) {
	ctx := context.Background()
	sealed := func(oid, project string) *waveobj.Run {
		return &waveobj.Run{OID: oid, ID: oid, Status: "done", ProjectPath: project, CreatedTs: 100, CompletedTs: 900,
			Evidence: &waveobj.RunEvidence{Summary: "shipped " + oid}}
	}
	seams := emptyLegs()
	seams.getChannels = func(ctx context.Context) ([]*waveobj.Channel, error) {
		return []*waveobj.Channel{{OID: "c1"}}, nil
	}
	seams.getChannelRuns = func(ctx context.Context, id string) ([]*waveobj.Run, error) {
		return []*waveobj.Run{sealed("r0", ""), sealed("r1", "/p/one"), sealed("r2", `C:\p\two\`)}, nil
	}
	restore := SetFetchSeamsForTest(seams)
	defer restore()
	shippedBy := func(st wshrpc.WorkState) map[string][]string {
		out := map[string][]string{}
		for _, p := range st.Projects {
			for _, s := range p.Shipped {
				out[p.Project] = append(out[p.Project], s.RunOID)
			}
		}
		return out
	}

	st, err := FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	want := map[string][]string{"(none)": {"r0"}, "/p/one": {"r1"}, "C:/p/two": {"r2"}}
	if got := shippedBy(st); !reflect.DeepEqual(got, want) {
		t.Fatalf("shipped by project = %v, want %v", got, want)
	}

	st, err = FetchWorkState(ctx, `\p\one\`, 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	want = map[string][]string{"/p/one": {"r1"}}
	if got := shippedBy(st); !reflect.DeepEqual(got, want) {
		t.Fatalf("filtered shipped by project = %v, want %v", got, want)
	}
	for _, p := range st.Projects {
		if p.Project != "/p/one" && (len(p.Active)+len(p.Shipped)+len(p.Events)+len(p.Delta)) > 0 {
			t.Fatalf("filtered state holds work of %q: %+v", p.Project, p)
		}
	}
}

func TestFetchWorkStateAttentionErrorAndVolatile(t *testing.T) {
	ctx := context.Background()
	seamsErr := emptyLegs()
	seamsErr.gatherAttention = func(ctx context.Context, chans []*waveobj.Channel, runsByChannel map[string][]*waveobj.Run) ([]wshrpc.AttentionItem, error) { return nil, errors.New("attention broke") }
	restoreErr := SetFetchSeamsForTest(seamsErr)
	st, err := FetchWorkState(ctx, "", 0)
	restoreErr()
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if st.Sources.Attention != "error" {
		t.Fatalf("attention=%q want error after GatherAttention failure", st.Sources.Attention)
	}
	seamsOK := emptyLegs()
	restoreOK := SetFetchSeamsForTest(seamsOK)
	defer restoreOK()
	st, err = FetchWorkState(ctx, "", 0)
	if err != nil {
		t.Fatalf("FetchWorkState: %v", err)
	}
	if st.Sources.Attention != "volatile" {
		t.Fatalf("attention=%q want volatile on a successful (empty) read", st.Sources.Attention)
	}
}
