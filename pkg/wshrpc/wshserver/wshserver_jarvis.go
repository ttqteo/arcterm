// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshserver

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/harness"
	"github.com/wavetermdev/waveterm/pkg/harnessupdate"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/jarvisattrib"
	"github.com/wavetermdev/waveterm/pkg/jarvisdossier"
	"github.com/wavetermdev/waveterm/pkg/jarvisstate"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/runroute"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wavevault"
	"github.com/wavetermdev/waveterm/pkg/wcore"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

// probeHarnesses and validateHarness are seams for tests so handler behavior is decidable without
// local PATH state; production wiring is the shared harness catalog.
var (
	probeHarnesses  = harness.ProbeAll
	validateHarness = harness.ValidateInstalled
)

func (ws *WshServer) GetJarvisProfileCommand(ctx context.Context, data wshrpc.CommandGetJarvisProfileData) (*wshrpc.CommandGetJarvisProfileRtnData, error) {
	if data.ChannelId == "" {
		return nil, fmt.Errorf("channelid is required")
	}
	ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
	if err != nil {
		return nil, fmt.Errorf("loading channel: %w", err)
	}
	global := jarvis.LoadGlobalProfile()
	override := jarvis.OverrideFromMeta(ch)
	resolved, diagnostics := jarvis.ResolveProfileWithDiagnostics(global, override)
	// surface the override as a structured patch view (a legacy string becomes disable-all + one
	// legacy-project addition) so the FE never has to reason about the legacy marker.
	if override != nil && override.Principles != nil {
		normalized := *override
		normalized.Principles = jarvis.NormalizePrinciplePatch(global.Principles, override.Principles)
		override = &normalized
	}
	return &wshrpc.CommandGetJarvisProfileRtnData{
		Global:               global,
		Override:             override,
		Resolved:             resolved,
		PrincipleDiagnostics: diagnostics,
	}, nil
}

func (ws *WshServer) GetGlobalProfileCommand(ctx context.Context) (*waveobj.JarvisProfile, error) {
	profile := jarvis.LoadGlobalProfile()
	return &profile, nil
}

func (ws *WshServer) SetGlobalProfileCommand(ctx context.Context, data wshrpc.CommandSetGlobalProfileData) error {
	if err := validateGlobalEngineDefaults(data.Profile); err != nil {
		return fmt.Errorf("validating engine defaults: %w", err)
	}
	return jarvis.SaveGlobalProfile(data.Profile)
}

func (ws *WshServer) RefreshRouteCatalogCommand(ctx context.Context) error {
	runroute.RefreshRouteCatalog()
	return nil
}

const consultTimeout = 120 * time.Second

// postConsultReply persists a consult-reply message and live-updates the pinned channel atom. Mirrors
// PostChannelMessageCommand's post+update pattern for the fire-and-forget consult goroutine. It runs on
// a fresh context, not the RPC request ctx: the request ctx is routinely already cancelled/expired by
// the time a slow consult finishes, and the persisted reply is exactly what lets the FE card resolve,
// so the write must not be tied to the request lifecycle.
func postConsultReply(data wshrpc.CommandConsultData, text string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	msg := wstore.NewChannelMessage("consult-reply", data.Runtime, text, "consult:"+data.ConsultId, time.Now().UnixMilli())
	if _, err := wstore.PostChannelMessage(ctx, data.ChannelId, msg); err != nil {
		log.Printf("consult: failed to post reply: %v", err)
		return
	}
	wcore.SendWaveObjUpdate(waveobj.MakeORef(waveobj.OType_Channel, data.ChannelId))
}

func (ws *WshServer) ConsultCommand(ctx context.Context, data wshrpc.CommandConsultData) chan wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk] {
	rtn := make(chan wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk])
	go func() {
		defer func() {
			panichandler.PanicHandler("ConsultCommand", recover())
		}()
		defer close(rtn)
		if _, err := validateHarness(data.Runtime, harness.OperationConsult); err != nil {
			postConsultReply(data, "consult is not supported for @"+data.Runtime)
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk]{Error: err}
			return
		}
		ch, err := wstore.DBMustGet[*waveobj.Channel](ctx, data.ChannelId)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk]{Error: fmt.Errorf("channel not found: %w", err)}
			return
		}
		spec, ok := consult.SpecFor(data.Runtime)
		if !ok {
			postConsultReply(data, "consult is not supported for @"+data.Runtime)
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk]{Error: fmt.Errorf("unsupported runtime: %s", data.Runtime)}
			return
		}
		// claude discovers ~/.claude/CLAUDE.md itself (it runs with cwd = project path); other runtimes
		// don't, so inject the operator's global principles for them. a read failure must not fail the
		// consult — log and continue with none.
		var principles string
		if data.Runtime != "claude" {
			p, perr := consult.OperatorPrinciples()
			if perr != nil {
				log.Printf("consult: reading operator principles: %v", perr)
			}
			principles = p
		}
		// BuildPrompt keeps only the newest MaxContextMessages, so that is all there is to fetch
		recent, err := wstore.GetChannelMessages(ctx, ch.OID, 0, consult.MaxContextMessages)
		if err != nil {
			rtn <- wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk]{Error: fmt.Errorf("reading channel messages: %w", err)}
			return
		}
		history := make([]waveobj.ChannelMessage, len(recent))
		for i, m := range recent {
			history[i] = *m
		}
		prompt := consult.BuildPrompt(history, data.Prompt, principles)
		runCtx, cancel := context.WithTimeout(ctx, consultTimeout)
		defer cancel()
		full, runErr := consult.Run(runCtx, spec, ch.ProjectPath, prompt, func(chunk string) {
			// live streaming is best-effort: never let a stalled/absent stream consumer wedge Run
			// (the persisted consult-reply below is the reliable path the FE resolves on).
			select {
			case rtn <- wshrpc.RespOrErrorUnion[wshrpc.ConsultChunk]{Response: wshrpc.ConsultChunk{Text: chunk}}:
			case <-runCtx.Done():
			}
		})
		reply := strings.TrimSpace(full)
		if runErr != nil {
			if reply != "" {
				reply += "\n\n"
			}
			reply += "consult failed: " + runErr.Error()
		}
		postConsultReply(data, reply)
	}()
	return rtn
}

func routeCapabilitiesForProbe(result harness.ProbeResult) []runroute.Capability {
	if !result.Installed || !result.Spec.RunWorkerCapable {
		return nil
	}
	return runroute.Capabilities(result.Spec.Runtime)
}

// catalogModelsForProbe returns the harness-sourced model catalog for installed, run-worker-capable
// probes.
func catalogModelsForProbe(ctx context.Context, result harness.ProbeResult) []runroute.ModelEntry {
	if !result.Installed || !result.Spec.RunWorkerCapable {
		return nil
	}
	return runroute.ModelsForRuntime(ctx, result.Spec.Runtime)
}

func (ws *WshServer) ListHarnessesCommand(ctx context.Context) (*wshrpc.CommandListHarnessesRtnData, error) {
	results := probeHarnesses(ctx)
	infos := make([]wshrpc.HarnessInfo, len(results))
	for i, r := range results {
		capabilities := []wshrpc.RouteCapabilityInfo{}
		for _, capability := range routeCapabilitiesForProbe(r) {
			capabilities = append(capabilities, wshrpc.RouteCapabilityInfo{
				Runtime:       capability.Runtime,
				ResolvedModel: capability.ResolvedModel,
			})
		}
		for _, entry := range catalogModelsForProbe(ctx, r) {
			capabilities = append(capabilities, wshrpc.RouteCapabilityInfo{
				Runtime:       entry.Runtime,
				Model:         entry.Model,
				ResolvedModel: entry.Model,
				Provider:      entry.Provider,
				ContextHint:   entry.ContextHint,
				Default:       entry.Default,
			})
		}
		infos[i] = wshrpc.HarnessInfo{
			Runtime:           r.Spec.Runtime,
			Label:             r.Spec.Label,
			Installed:         r.Installed,
			Version:           r.Version,
			LatestVersion:     harnessupdate.Latest(r.Spec.Runtime),
			ConsultCapable:    r.Spec.ConsultCapable,
			RunWorkerCapable:  r.Spec.RunWorkerCapable,
			LeadCapable:       r.Spec.LeadCapable,
			RouteCapabilities: capabilities,
		}
	}
	return &wshrpc.CommandListHarnessesRtnData{Harnesses: infos}, nil
}

func (ws *WshServer) UpdateHarnessCommand(ctx context.Context, data wshrpc.CommandUpdateHarnessData) (*wshrpc.CommandUpdateHarnessRtnData, error) {
	res, err := harnessupdate.Update(ctx, data.Runtime)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandUpdateHarnessRtnData{Version: res.Version}, nil
}

func (ws *WshServer) ListDossiersCommand(ctx context.Context) (*wshrpc.CommandListDossiersRtnData, error) {
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	return listDossiers(v)
}

// collectDossiers projects the tasks collection to SpaceSummaries, keeping those whose status passes
// keep, newest-updated first. The shared core behind ListDossiers (U1, active|paused) and
// ListTaskDossiers (U2, all statuses).
func collectDossiers(v *wavevault.Vault, keep func(status string) bool) ([]wshrpc.SpaceSummary, error) {
	r := v.Retriever(wavevault.Scope{Collections: []string{wavevault.CollTasks}})
	nodes, err := r.Query(wavevault.Filter{})
	if err != nil {
		return nil, fmt.Errorf("querying tasks: %w", err)
	}
	out := []wshrpc.SpaceSummary{}
	for _, n := range nodes {
		d, err := jarvisdossier.LoadDossier(r, n.ID)
		if err != nil {
			continue // tolerant: skip an unreadable/foreign node
		}
		if !keep(d.Status) {
			continue
		}
		out = append(out, wshrpc.SpaceSummary{Id: d.ID, Objective: d.Objective, Ticket: d.Ticket, Status: d.Status, Updated: d.Updated})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Updated > out[j].Updated })
	return out, nil
}

// listDossiers is U1's focusable-task core (active|paused only), unchanged in behavior.
func listDossiers(v *wavevault.Vault) (*wshrpc.CommandListDossiersRtnData, error) {
	spaces, err := collectDossiers(v, func(s string) bool { return s == "active" || s == "paused" })
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListDossiersRtnData{Spaces: spaces}, nil
}

// listTaskDossiers is U2's all-statuses core (the Tasks surface groups them Active/Paused/Done).
func listTaskDossiers(v *wavevault.Vault) (*wshrpc.CommandListTaskDossiersRtnData, error) {
	dossiers, err := collectDossiers(v, func(string) bool { return true })
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandListTaskDossiersRtnData{Dossiers: dossiers}, nil
}

// getDossier assembles a dossier's read view-model: its machine fields/blocks, the human ## Notes
// prose, and its decisions (resolved by the decisions that [[link]] back to it), newest-first.
func getDossier(v *wavevault.Vault, id string) (*wshrpc.DossierDetail, error) {
	r := v.Retriever(wavevault.AllScope())
	d, err := jarvisdossier.LoadDossier(r, id)
	if err != nil {
		return nil, fmt.Errorf("loading dossier: %w", err)
	}
	cards, err := dossierDecisions(v, id)
	if err != nil {
		return nil, err
	}
	return &wshrpc.DossierDetail{
		Id: d.ID, Ticket: d.Ticket, Objective: d.Objective, Acceptance: d.Acceptance,
		Confidence: d.Confidence, Status: d.Status, Created: d.Created, Updated: d.Updated,
		State: d.State, Blockers: d.Blockers, Refs: d.Refs, Notes: d.Notes, Decisions: cards,
	}, nil
}

// dossierDecisions resolves the decision records linking back to dossierID, projected to cards,
// newest-created first. A decisions-scoped HasLink query (robust vs. parsing the mixed refs block).
func dossierDecisions(v *wavevault.Vault, dossierID string) ([]wshrpc.DecisionCard, error) {
	r := v.Retriever(wavevault.Scope{Collections: []string{wavevault.CollDecisions}})
	nodes, err := r.Query(wavevault.Filter{HasLink: dossierID})
	if err != nil {
		return nil, fmt.Errorf("querying decisions: %w", err)
	}
	cards := []wshrpc.DecisionCard{}
	for _, n := range nodes {
		dec, err := jarvisdossier.LoadDecision(r, n.ID)
		if err != nil {
			continue
		}
		cards = append(cards, wshrpc.DecisionCard{
			Id: dec.ID, Created: dec.Created, Actor: dec.Actor, Provenance: dec.Provenance,
			Status: dec.Status, Links: dec.Links, Rationale: dec.Rationale,
		})
	}
	sort.SliceStable(cards, func(i, j int) bool { return cards[i].Created > cards[j].Created })
	return cards, nil
}

var validDossierStatuses = map[string]bool{"active": true, "paused": true, "completed": true, "archived": true}

// appendDossierDecision writes a human-attributed decision and commits at the boundary. Returns the
// decision id even on a commit error so the caller can surface a partial success.
func appendDossierDecision(ctx context.Context, v *wavevault.Vault, data wshrpc.CommandAppendDossierDecisionData) (string, error) {
	decID, err := jarvisdossier.AppendHumanDecision(v, jarvisdossier.DecisionFacts{
		TaskID:    data.DossierId,
		Links:     data.Links,
		Rationale: data.Rationale,
		Summary:   data.Summary,
	})
	if err != nil {
		return "", fmt.Errorf("appending decision: %w", err)
	}
	if err := v.Commit(ctx, "human: decision added — "+data.DossierId); err != nil {
		return decID, fmt.Errorf("committing decision: %w", err)
	}
	return decID, nil
}

// setDossierStatus validates and writes the machine-owned status, retrying once on a concurrent
// external edit (baseHash mismatch), then commits.
func setDossierStatus(ctx context.Context, v *wavevault.Vault, id, status string) error {
	if !validDossierStatuses[status] {
		return fmt.Errorf("invalid status %q", status)
	}
	d, err := jarvisdossier.LoadDossier(v.Retriever(wavevault.AllScope()), id)
	if err != nil {
		return fmt.Errorf("loading dossier: %w", err)
	}
	res, err := jarvisdossier.SetStatus(v, id, status, d.Hash)
	if err != nil {
		return fmt.Errorf("setting status: %w", err)
	}
	if res.Conflict {
		d2, err := jarvisdossier.LoadDossier(v.Retriever(wavevault.AllScope()), id)
		if err != nil {
			return fmt.Errorf("reloading after conflict: %w", err)
		}
		if _, err := jarvisdossier.SetStatus(v, id, status, d2.Hash); err != nil {
			return fmt.Errorf("retry after conflict: %w", err)
		}
	}
	return v.Commit(ctx, id+" → "+status)
}

func (ws *WshServer) ResolveFocusScopeCommand(ctx context.Context, data wshrpc.CommandResolveFocusScopeData) (*wshrpc.SpaceScope, error) {
	if data.Id == "" {
		return nil, fmt.Errorf("id is required")
	}
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return nil, fmt.Errorf("loading runs: %w", err)
	}
	switch data.Kind {
	case "task":
		v, err := wavevault.OpenVault(ctx)
		if err != nil {
			return nil, fmt.Errorf("opening vault: %w", err)
		}
		edges, err := jarvisattrib.EdgesFor(ctx, v, data.Id)
		if err != nil {
			return nil, fmt.Errorf("resolving edges: %w", err)
		}
		byORef := make(map[string]*waveobj.Run, len(runs))
		for _, run := range runs {
			byORef["run:"+run.OID] = run
		}
		scope := buildSpaceScope(edges, byORef)
		return &scope, nil
	default:
		// an unknown kind must not return an empty bundle: empty is indistinguishable from a real
		// record with no runs attributed to it
		return nil, fmt.Errorf("unknown scope kind %q", data.Kind)
	}
}

func (ws *WshServer) GetDossierCommand(ctx context.Context, data wshrpc.CommandGetDossierData) (*wshrpc.DossierDetail, error) {
	if data.DossierId == "" {
		return nil, fmt.Errorf("dossierid is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	return getDossier(v, data.DossierId)
}

func (ws *WshServer) ListTaskDossiersCommand(ctx context.Context) (*wshrpc.CommandListTaskDossiersRtnData, error) {
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	return listTaskDossiers(v)
}

func (ws *WshServer) AppendDossierDecisionCommand(ctx context.Context, data wshrpc.CommandAppendDossierDecisionData) (*wshrpc.CommandAppendDossierDecisionRtnData, error) {
	if data.DossierId == "" {
		return nil, fmt.Errorf("dossierid is required")
	}
	if strings.TrimSpace(data.Rationale) == "" {
		return nil, fmt.Errorf("rationale is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	decID, err := appendDossierDecision(ctx, v, data)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandAppendDossierDecisionRtnData{DecisionId: decID}, nil
}

func (ws *WshServer) SetDossierStatusCommand(ctx context.Context, data wshrpc.CommandSetDossierStatusData) error {
	if data.DossierId == "" {
		return fmt.Errorf("dossierid is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return fmt.Errorf("opening vault: %w", err)
	}
	return setDossierStatus(ctx, v, data.DossierId, data.Status)
}

func (ws *WshServer) DetachDossierEdgeCommand(ctx context.Context, data wshrpc.CommandDossierEdgeData) error {
	if data.DossierId == "" || data.RunORef == "" {
		return fmt.Errorf("dossierid and runoref are both required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return fmt.Errorf("opening vault: %w", err)
	}
	return jarvisattrib.Detach(ctx, v, data.DossierId, data.RunORef)
}

func (ws *WshServer) AcceptDossierEdgeCommand(ctx context.Context, data wshrpc.CommandDossierEdgeData) error {
	if data.DossierId == "" || data.RunORef == "" {
		return fmt.Errorf("dossierid and runoref are both required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return fmt.Errorf("opening vault: %w", err)
	}
	return jarvisattrib.Accept(ctx, v, data.DossierId, data.RunORef)
}

func (ws *WshServer) ListDetachedEdgesCommand(ctx context.Context, data wshrpc.CommandListDetachedEdgesData) (*wshrpc.CommandListDetachedEdgesRtnData, error) {
	if data.DossierId == "" && data.RunORef == "" {
		return nil, fmt.Errorf("one of dossierid or runoref is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	edges, err := jarvisattrib.DetachedEdges(ctx, v, data.DossierId, data.RunORef)
	if err != nil {
		return nil, fmt.Errorf("reading detached edges: %w", err)
	}
	out := wshrpc.CommandListDetachedEdgesRtnData{Tasks: []wshrpc.AmbientTask{}, Edges: []wshrpc.AmbientEdge{}}
	labelled := map[string]bool{}
	for _, e := range edges {
		// BucketFor yields "" for an edge with no layers, which is the point here: Detach strips the
		// ref, so the signal behind a detached layer-1 edge is gone and any bucket would assert a
		// strength this row does not have.
		bucket := jarvisattrib.BucketFor(e.Layers)
		out.Edges = append(out.Edges, wshrpc.AmbientEdge{
			ORef:       e.RunORef,
			DossierId:  e.DossierID,
			Provenance: e.Provenance,
			Bucket:     bucket,
			State:      string(e.State),
		})
		if labelled[e.DossierID] {
			continue
		}
		labelled[e.DossierID] = true
		label := e.DossierID
		if d, err := jarvisdossier.LoadDossier(v.Retriever(wavevault.AllScope()), e.DossierID); err == nil && d.Objective != "" {
			label = d.Objective
		}
		out.Tasks = append(out.Tasks, wshrpc.AmbientTask{Id: e.DossierID, Label: label})
	}
	return &out, nil
}

// buildSpaceScope is the pure edge->bundle core: dedup the attributed run orefs, their channel oids, and
// the worker tab ids (tab: prefix stripped) from each run's phases. Order-stable by first appearance; an
// edge to a run missing from byORef still contributes its run oref (surfaced, not dropped).
func buildSpaceScope(edges []jarvisattrib.AttributedEdge, byORef map[string]*waveobj.Run) wshrpc.SpaceScope {
	scope := wshrpc.SpaceScope{RunORefs: []string{}, ChannelOids: []string{}, TabIds: []string{}}
	seenRun := map[string]bool{}
	seenChan := map[string]bool{}
	seenTab := map[string]bool{}
	for _, e := range edges {
		if seenRun[e.RunORef] {
			continue
		}
		seenRun[e.RunORef] = true
		scope.RunORefs = append(scope.RunORefs, e.RunORef)
		run := byORef[e.RunORef]
		if run == nil {
			continue
		}
		if run.ChannelOID != "" && !seenChan[run.ChannelOID] {
			seenChan[run.ChannelOID] = true
			scope.ChannelOids = append(scope.ChannelOids, run.ChannelOID)
		}
		for _, ph := range run.Phases {
			for _, wo := range ph.WorkerOrefs {
				if !strings.HasPrefix(wo, "tab:") {
					continue
				}
				tabID := strings.TrimPrefix(wo, "tab:")
				if tabID == "" || seenTab[tabID] {
					continue
				}
				seenTab[tabID] = true
				scope.TabIds = append(scope.TabIds, tabID)
			}
		}
	}
	return scope
}

func runHasWorkerTab(run *waveobj.Run, tabID string) bool {
	for _, ph := range run.Phases {
		for _, wo := range ph.WorkerOrefs {
			if strings.HasPrefix(wo, "tab:") && strings.TrimPrefix(wo, "tab:") == tabID {
				return true
			}
		}
	}
	return false
}

func (ws *WshServer) VaultGraphCommand(ctx context.Context) (*wshrpc.CommandVaultGraphRtnData, error) {
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	return vaultGraph(v)
}

// vaultGraph is the vault-backed core (testable with an explicit vault): every vault node projected to
// a GraphNode plus the resolved wikilink edges. No runs, no attribution — those bloom via ResolveDossierEdges.
func vaultGraph(v *wavevault.Vault) (*wshrpc.CommandVaultGraphRtnData, error) {
	sg, err := v.Retriever(wavevault.AllScope()).Graph()
	if err != nil {
		return nil, fmt.Errorf("reading vault graph: %w", err)
	}
	out := &wshrpc.CommandVaultGraphRtnData{Nodes: []wshrpc.GraphNode{}, Links: []wshrpc.GraphLink{}}
	for _, n := range sg.Nodes {
		out.Nodes = append(out.Nodes, vaultNodeToGraphNode(n))
	}
	for _, e := range sg.Edges {
		out.Links = append(out.Links, wshrpc.GraphLink{From: e.From, To: e.To, Kind: "wikilink"})
	}
	return out, nil
}

func (ws *WshServer) ReadVaultNoteCommand(ctx context.Context, data wshrpc.CommandReadVaultNoteData) (*wshrpc.CommandReadVaultNoteRtnData, error) {
	if data.Id == "" {
		return nil, fmt.Errorf("id is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	return readVaultNote(v, data.Id)
}

// readVaultNote is the vault-backed core (testable with an explicit vault).
func readVaultNote(v *wavevault.Vault, id string) (*wshrpc.CommandReadVaultNoteRtnData, error) {
	nb, err := v.Retriever(wavevault.AllScope()).Read(id)
	if err != nil {
		return nil, fmt.Errorf("reading note %q: %w", id, err)
	}
	n := nb.Node
	title := n.ID
	if s, ok := n.Frontmatter["title"].(string); ok && s != "" {
		title = s
	}
	out := &wshrpc.CommandReadVaultNoteRtnData{Id: n.ID, Title: title, Body: nb.Body, Updated: n.UpdatedTs}
	if n.Scope != "shared" {
		out.Project = n.Scope
	}
	return out, nil
}

func nodeKind(collection string) string {
	switch collection {
	case wavevault.CollTasks:
		return "task"
	case wavevault.CollDecisions:
		return "decision"
	default:
		return "memory"
	}
}

// nodeLabel is the human label: a task's objective, else a frontmatter title, else the id.
func nodeLabel(n wavevault.Node, kind string) string {
	if kind == "task" {
		if s, ok := n.Frontmatter["objective"].(string); ok && s != "" {
			return s
		}
	}
	if s, ok := n.Frontmatter["title"].(string); ok && s != "" {
		return s
	}
	return n.ID
}

func vaultNodeToGraphNode(n wavevault.Node) wshrpc.GraphNode {
	kind := nodeKind(n.Collection)
	gn := wshrpc.GraphNode{Id: n.ID, Kind: kind, Label: nodeLabel(n, kind), Updated: n.UpdatedTs}
	if s, ok := n.Frontmatter["status"].(string); ok {
		gn.Status = s
	}
	return gn
}

func (ws *WshServer) ResolveDossierEdgesCommand(ctx context.Context, data wshrpc.CommandResolveDossierEdgesData) (*wshrpc.CommandResolveDossierEdgesRtnData, error) {
	if data.DossierId == "" {
		return nil, fmt.Errorf("dossierid is required")
	}
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	edges, err := jarvisattrib.EdgesFor(ctx, v, data.DossierId)
	if err != nil {
		return nil, fmt.Errorf("resolving edges: %w", err)
	}
	runs, err := wstore.DBGetAllObjsByType[*waveobj.Run](ctx, waveobj.OType_Run)
	if err != nil {
		return nil, fmt.Errorf("loading runs: %w", err)
	}
	byORef := make(map[string]*waveobj.Run, len(runs))
	for _, run := range runs {
		byORef["run:"+run.OID] = run
	}
	out := buildDossierGraph(data.DossierId, edges, byORef)
	return &out, nil
}

// buildDossierGraph is the pure edge->graph core: one run node per attributed run (skipping a run
// missing from byORef, but still surfacing its edge) and one typed attribution link per edge carrying
// provenance + confidence bucket + state. Order-stable by edge order; dedups run nodes by oref.
func buildDossierGraph(dossierID string, edges []jarvisattrib.AttributedEdge, byORef map[string]*waveobj.Run) wshrpc.CommandResolveDossierEdgesRtnData {
	out := wshrpc.CommandResolveDossierEdgesRtnData{Runs: []wshrpc.GraphNode{}, Links: []wshrpc.GraphLink{}}
	seenRun := map[string]bool{}
	for _, e := range edges {
		out.Links = append(out.Links, wshrpc.GraphLink{
			From:       dossierID,
			To:         e.RunORef,
			Kind:       "attribution",
			Provenance: e.Provenance,
			Bucket:     jarvisattrib.BucketFor(e.Layers),
			State:      string(e.State),
		})
		if seenRun[e.RunORef] {
			continue
		}
		seenRun[e.RunORef] = true
		run := byORef[e.RunORef]
		if run == nil {
			continue // missing run: edge surfaced, node skipped (mirrors buildSpaceScope)
		}
		out.Runs = append(out.Runs, wshrpc.GraphNode{
			Id:      e.RunORef,
			Kind:    "run",
			Label:   run.Goal,
			Status:  run.Status,
			Updated: run.CreatedTs,
		})
	}
	return out
}

func (ws *WshServer) ResolveAmbientCommand(ctx context.Context) (*wshrpc.CommandResolveAmbientRtnData, error) {
	v, err := wavevault.OpenVault(ctx)
	if err != nil {
		return nil, fmt.Errorf("opening vault: %w", err)
	}
	dossiers, err := collectDossiers(v, func(string) bool { return true })
	if err != nil {
		return nil, err
	}
	byDossier, err := jarvisattrib.AllEdges(ctx, v)
	if err != nil {
		return nil, fmt.Errorf("resolving edges: %w", err)
	}
	decisions, err := allDecisions(v)
	if err != nil {
		return nil, err
	}
	out := buildAmbient(dossiers, byDossier, decisions)
	return &out, nil
}

// allDecisions reads every decision record once. The ambient layer needs them grouped by dossier, and
// dossierDecisions' per-dossier HasLink query would re-scan the collection for each one.
func allDecisions(v *wavevault.Vault) ([]wshrpc.DecisionCard, error) {
	r := v.Retriever(wavevault.Scope{Collections: []string{wavevault.CollDecisions}})
	nodes, err := r.Query(wavevault.Filter{})
	if err != nil {
		return nil, fmt.Errorf("querying decisions: %w", err)
	}
	cards := []wshrpc.DecisionCard{}
	for _, n := range nodes {
		dec, err := jarvisdossier.LoadDecision(r, n.ID)
		if err != nil {
			continue
		}
		cards = append(cards, wshrpc.DecisionCard{
			Id: dec.ID, Created: dec.Created, Actor: dec.Actor, Provenance: dec.Provenance,
			Status: dec.Status, Links: dec.Links, Rationale: dec.Rationale,
		})
	}
	return cards, nil
}

// Ambient text bounds — a tag sits inline on a dense row and a card title on one line.
const (
	ambientLabelMax = 40
	ambientTitleMax = 80
)

// boundRunes truncates on a rune boundary (a byte slice would split a multi-byte character).
func boundRunes(s string, n int) string {
	rs := []rune(strings.TrimSpace(s))
	if len(rs) <= n {
		return string(rs)
	}
	return strings.TrimSpace(string(rs[:n])) + "…"
}

// ambientLabel is a dossier's tag text: its ticket when it has one (short and scannable), else the
// objective bounded so a long one cannot blow out a row.
func ambientLabel(d wshrpc.SpaceSummary) string {
	if d.Ticket != "" {
		return d.Ticket
	}
	return boundRunes(d.Objective, ambientLabelMax)
}

// decisionTitle is a decision's ambient card line: the first non-empty line of the human rationale,
// stripped of markdown lead-ins and bounded. Decisions have no title field — the rationale is the record.
func decisionTitle(rationale string) string {
	for _, line := range strings.Split(rationale, "\n") {
		s := strings.TrimSpace(strings.TrimLeft(line, "#>-*+ \t"))
		if s == "" {
			continue
		}
		return boundRunes(s, ambientTitleMax)
	}
	return ""
}

// buildAmbient is the pure projection behind ResolveAmbient: every dossier as a labelled tag target, its
// attributed object edges, and the decisions that link back to it. Dossier order drives output order
// (the edge map alone would iterate nondeterministically); a decision linking an unknown id is dropped.
func buildAmbient(dossiers []wshrpc.SpaceSummary, byDossier map[string][]jarvisattrib.AttributedEdge, decisions []wshrpc.DecisionCard) wshrpc.CommandResolveAmbientRtnData {
	out := wshrpc.CommandResolveAmbientRtnData{
		Tasks: []wshrpc.AmbientTask{}, Edges: []wshrpc.AmbientEdge{}, Decisions: []wshrpc.AmbientDecision{},
	}
	known := make(map[string]bool, len(dossiers))
	for _, d := range dossiers {
		known[d.Id] = true
		out.Tasks = append(out.Tasks, wshrpc.AmbientTask{Id: d.Id, Label: ambientLabel(d)})
		for _, e := range byDossier[d.Id] {
			out.Edges = append(out.Edges, wshrpc.AmbientEdge{
				ORef:       e.RunORef,
				DossierId:  d.Id,
				Provenance: e.Provenance,
				Bucket:     jarvisattrib.BucketFor(e.Layers),
				State:      string(e.State),
			})
		}
	}
	for _, dec := range decisions {
		for _, link := range dec.Links {
			if !known[link] {
				continue
			}
			out.Decisions = append(out.Decisions, wshrpc.AmbientDecision{
				DossierId: link, Id: dec.Id, Title: decisionTitle(dec.Rationale), Created: dec.Created,
			})
		}
	}
	sort.SliceStable(out.Decisions, func(i, j int) bool { return out.Decisions[i].Created > out.Decisions[j].Created })
	return out
}

// JarvisStateCommand is the work-ledger query: per-project active/shipped/timeline/delta plus
// per-leg source health. Stateless and read-only.
func (ws *WshServer) JarvisStateCommand(ctx context.Context, data wshrpc.CommandJarvisStateData) (*wshrpc.CommandJarvisStateRtnData, error) {
	state, err := jarvisstate.FetchWorkState(ctx, data.Project, data.SinceMs)
	if err != nil {
		return nil, fmt.Errorf("fetching work state: %w", err)
	}
	return &wshrpc.CommandJarvisStateRtnData{State: state}, nil
}

// JarvisStatusCommand is the capture accounting: vault note counts, index availability, distill
// queue state. Every section degrades to "unavailable" inside FetchCaptureStatus.
func (ws *WshServer) JarvisStatusCommand(ctx context.Context, data wshrpc.CommandJarvisStatusData) (*wshrpc.CommandJarvisStatusRtnData, error) {
	st, err := jarvisstate.FetchCaptureStatus(ctx)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandJarvisStatusRtnData{Status: st}, nil
}

// JarvisRunEventsCommand lists a run's lifecycle events newest-first, for the run-card timeline.
// Bounded read; the channel scoping keeps a stray caller from reading another channel's run log.
func (ws *WshServer) JarvisRunEventsCommand(ctx context.Context, data wshrpc.CommandJarvisRunEventsData) (*wshrpc.CommandJarvisRunEventsRtnData, error) {
	if data.ChannelId == "" || data.RunId == "" {
		return nil, fmt.Errorf("channelid and runid are required")
	}
	events, err := wstore.QueryRunEvents(ctx, data.ChannelId, data.RunId, data.Limit)
	if err != nil {
		return nil, err
	}
	return &wshrpc.CommandJarvisRunEventsRtnData{Events: events}, nil
}
