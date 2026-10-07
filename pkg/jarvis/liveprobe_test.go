// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build liveprobe

// Live probe comparing the two candidate backends for the gatekeeper classifier over the REAL corpus
// of past gatekeeper decisions: today's haiku-via-claude-CLI path (pkg/consult) against TypeSafe's Jev
// System One API. Not part of the normal suite — it needs the live object store and a provider key, so
// it sits behind the `liveprobe` build tag and reads its profile from the environment.
//
//	TYPESAFE_API_KEY=<key> go test -tags liveprobe -run TestGatekeeperBackendProbe -v -timeout 30m ./pkg/jarvis/
//
// Environment:
//
//	TYPESAFE_API_KEY    required — https://console.typesafe.ai/keys
//	ARC_DB              object store holding the corpus (default: the packaged profile's waveterm.db)
//	PROBE_SKIP_BASELINE non-empty skips re-running the haiku leg (it costs quota and minutes; the
//	                    recorded verdicts are still the comparison baseline, only latency is lost)
//	PROBE_LIMIT         cap the number of cases
//
// The store is opened read-only and never written.
//
// Three fidelity gaps, all applied to BOTH legs so the comparison stays fair. The worker task is not
// persisted on the card, so every case replays with "(unknown task)". Principles are passed empty rather
// than re-resolved, which reproduces the pre-Piece-4 prompt. And most channels that produced this corpus
// have since been deleted — db_channelmessage outlives db_channel — so their name resolves to
// "(unknown)". What the probe measures is the two backends against each other and against what
// production actually decided; nothing here records ground truth, so a disagreement is a question for a
// human, not a score.
package jarvis

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/consult"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const (
	jevEndpoint = "https://api.typesafe.ai/v1/systemone"
	jevModel    = "jev-latest"
	jevTimeout  = 30 * time.Second

	// prefilterReason is the retired multi-question prefilter's verdict, still on cards written before
	// it went. Those escalations never reached a model, so replaying them would compare two backends
	// on a decision neither one made.
	prefilterReason = "needs a human (multiple or multi-select questions)"

	// Published rates. Jev 1.13 bills input only. The baseline rate is whatever the configured cheap
	// tier resolves to — deepseek-v4-flash over OpenRouter in this profile — so the probe prints the
	// model it actually called rather than silently pricing a model it didn't.
	jevInputPerMTok     = 0.042
	baselineInPerMTok   = 0.088606
	baselineOutPerMTok  = 0.177212
	baselinePricedModel = "deepseek/deepseek-v4-flash"
)

// probeCase is one replayable gatekeeper decision recovered from the store, with the verdict
// production actually reached. recordedChoice is nil for an escalation.
type probeCase struct {
	channelName    string
	question       baseds.AgentAskQuestion
	timeline       []*waveobj.ChannelMessage
	recordedChoice *int
	recordedReason string
}

func (c probeCase) escalated() bool { return c.recordedChoice == nil }

// legResult is one backend's verdict on one case, plus what it cost to get it.
type legResult struct {
	choice  *int // nil == escalate
	latency time.Duration
	inTok   int
	outTok  int
	routine float64            // jev only
	confid  float64            // jev only
	model   string             // as the runtime reported it
	reason  string             // baseline only; jev returns no explanation by design
	probs   map[string]float64 // jev only: the full option distribution
	err     error
}

func TestGatekeeperBackendProbe(t *testing.T) {
	key := os.Getenv("TYPESAFE_API_KEY")
	if key == "" {
		t.Skip("TYPESAFE_API_KEY not set")
	}
	useRealConfig(t)
	db := openStore(t)
	defer db.Close()

	cases := loadCorpus(t, db)
	if len(cases) == 0 {
		t.Fatal("no replayable gatekeeper decisions in the store")
	}
	if lim := envInt("PROBE_LIMIT"); lim > 0 && lim < len(cases) {
		cases = limitKeepingAnswers(cases, lim)
	}
	escalations := 0
	for _, c := range cases {
		if c.escalated() {
			escalations++
		}
	}
	t.Logf("corpus: %d replayable cases — %d escalations, %d answers", len(cases), escalations, len(cases)-escalations)

	skipBaseline := os.Getenv("PROBE_SKIP_BASELINE") != ""
	var spec consult.RuntimeSpec
	if !skipBaseline {
		var ok bool
		spec, ok = consult.HeadlessSpecForTier(consult.TierCheap)
		if !ok {
			t.Fatal("no headless runtime configured for the cheap tier")
		}
	}

	baseline := make([]legResult, len(cases))
	jev := make([]legResult, len(cases))
	for i, c := range cases {
		if !skipBaseline {
			baseline[i] = runBaselineLeg(spec, c)
		}
		jev[i] = runJevLeg(t, key, c)
		t.Logf("[%2d/%d] %-9s recorded=%s jev=%s(routine %.2f conf %.2f %s) base=%s(%s)",
			i+1, len(cases), truncate(c.channelName, 9),
			verdictLabel(c.recordedChoice), verdictLabel(jev[i].choiceAt(0.5, 0.0)),
			jev[i].routine, jev[i].confid, jev[i].latency.Round(time.Millisecond),
			verdictLabel(baseline[i].choice), baseline[i].latency.Round(time.Millisecond))
	}

	reportLatency(t, "baseline ("+baselineLabel(baseline)+")", baseline, skipBaseline)
	reportLatency(t, "jev (HTTP)", jev, false)
	reportCost(t, baseline, jev, skipBaseline)
	if !skipBaseline {
		reportAgreement(t, "baseline re-run vs recorded", cases, baseline)
	}
	reportThresholdSweep(t, cases, jev)
	dump := envInt("PROBE_DUMP")
	if dump == 0 {
		dump = 8
	}
	reportCaseDetail(t, cases, baseline, jev, dump)
}

// choiceAt composes the two Jev judgments into a verdict: answer only when the ask reads as routine
// AND the option distribution is concentrated. Either knob alone is the wrong gate — a confident pick
// among options that all need a human is still an escalation.
func (r legResult) choiceAt(routineMin, confMin float64) *int {
	if r.err != nil || r.choice == nil {
		return nil
	}
	if r.routine < routineMin || r.confid < confMin {
		return nil
	}
	return r.choice
}

// limitKeepingAnswers trims the corpus without throwing away its rare class. Answers are ~1 in 5 here,
// and a chronological prefix can easily contain none — which would leave the threshold sweep with
// nothing to lose, and make every setting look free.
func limitKeepingAnswers(cases []probeCase, lim int) []probeCase {
	var answers, escalations []probeCase
	for _, c := range cases {
		if c.escalated() {
			escalations = append(escalations, c)
		} else {
			answers = append(answers, c)
		}
	}
	out := answers
	if len(out) > lim {
		out = out[:lim]
	}
	for _, c := range escalations {
		if len(out) >= lim {
			break
		}
		out = append(out, c)
	}
	return out
}

// useRealConfig points wavebase at the real config dir. The package TestMain only overrides the data
// home, leaving ConfigHome_VarCache empty — which makes secretstore look for secrets.enc at "" and the
// settings watcher read nothing, so the cheap tier silently falls back to defaults instead of the
// runtime and model this profile actually uses. Read-only: the probe never calls SetSecret.
func useRealConfig(t *testing.T) {
	if wavebase.ConfigHome_VarCache != "" {
		return
	}
	dir := os.Getenv("ARC_CONFIG")
	if dir == "" {
		dir = filepath.Join(os.Getenv("LOCALAPPDATA"), "dev.arc.app", "config")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("config dir not found at %s (set ARC_CONFIG): %v", dir, err)
	}
	wavebase.ConfigHome_VarCache = dir
}

// ---- corpus ----

func openStore(t *testing.T) *sql.DB {
	path := os.Getenv("ARC_DB")
	if path == "" {
		path = filepath.Join(os.Getenv("LOCALAPPDATA"), "dev.arc.app", "data", "db", "waveterm.db")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("object store not found at %s (set ARC_DB): %v", path, err)
	}
	// read-only, and a busy timeout so a running wavesrv holding the write lock doesn't fail the probe
	db, err := sql.Open("sqlite3", "file:"+filepath.ToSlash(path)+"?mode=ro&_busy_timeout=5000")
	if err != nil {
		t.Fatalf("opening %s: %v", path, err)
	}
	return db
}

func loadCorpus(t *testing.T, db *sql.DB) []probeCase {
	rows, err := db.Query(`select data from db_channelmessage
		where json_extract(data,'$.kind') in ('jarvis-escalation','jarvis-answered')
		order by json_extract(data,'$.ts')`)
	if err != nil {
		t.Fatalf("querying corpus: %v", err)
	}
	defer rows.Close()

	names := map[string]string{}
	var out []probeCase
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scanning corpus row: %v", err)
		}
		var msg waveobj.ChannelMessage
		if err := json.Unmarshal(raw, &msg); err != nil || msg.Data == "" {
			continue
		}
		var card JarvisCardData
		if err := json.Unmarshal([]byte(msg.Data), &card); err != nil {
			continue
		}
		if card.Reason == prefilterReason || len(card.Options) == 0 {
			continue // the prefilter rejected it; no model ran
		}
		opts := make([]baseds.AgentAskOption, 0, len(card.Options))
		for _, o := range card.Options {
			opts = append(opts, baseds.AgentAskOption{Label: o.Label, Description: o.Sub})
		}
		if _, seen := names[msg.ChannelOID]; !seen {
			names[msg.ChannelOID] = channelName(db, msg.ChannelOID)
		}
		out = append(out, probeCase{
			channelName:    names[msg.ChannelOID],
			question:       baseds.AgentAskQuestion{Question: card.Question, Options: opts},
			timeline:       loadTimeline(db, msg.ChannelOID, msg.Ts),
			recordedChoice: card.Choice,
			recordedReason: card.Reason,
		})
	}
	return out
}

func channelName(db *sql.DB, oid string) string {
	var name sql.NullString
	if err := db.QueryRow(`select json_extract(data,'$.name') from db_channel where oid = ?`, oid).Scan(&name); err != nil {
		return "(deleted channel)"
	}
	if !name.Valid || name.String == "" {
		return "(deleted channel)"
	}
	return name.String
}

// loadTimeline rebuilds what recentTimeline would have seen: the maxTimeline messages immediately
// preceding the decision, oldest first.
func loadTimeline(db *sql.DB, channelOID string, before int64) []*waveobj.ChannelMessage {
	rows, err := db.Query(`select data from db_channelmessage
		where json_extract(data,'$.channeloid') = ? and json_extract(data,'$.ts') < ?
		order by json_extract(data,'$.ts') desc limit ?`, channelOID, before, maxTimeline)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var msgs []*waveobj.ChannelMessage
	for rows.Next() {
		var raw []byte
		if rows.Scan(&raw) != nil {
			continue
		}
		var m waveobj.ChannelMessage
		if json.Unmarshal(raw, &m) == nil {
			msgs = append(msgs, &m)
		}
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs
}

// ---- leg A: the configured cheap tier (today's gatekeeper) ----

func runBaselineLeg(spec consult.RuntimeSpec, c probeCase) legResult {
	questions := []baseds.AgentAskQuestion{c.question}
	prompt := BuildClassifyPrompt(questions, "", &waveobj.Channel{Name: c.channelName}, c.timeline, nil)
	ctx, cancel := context.WithTimeout(context.Background(), classifyTimeout)
	defer cancel()
	start := time.Now()
	reply, usage, err := consult.RunWithUsage(ctx, spec, "", prompt, func(string) {})
	elapsed := time.Since(start)
	if err != nil {
		return legResult{latency: elapsed, err: err}
	}
	d := ParseDecision(reply)
	// TotalTokens is reported; the in/out split is not, so derive input from prompt length (~4
	// chars/token) and treat the remainder as output.
	inTok := len(prompt) / 4
	outTok := usage.TotalTokens - inTok
	if usage.TotalTokens == 0 {
		inTok, outTok = len(prompt)/4, len(reply)/4 // CLI runtimes report nothing
	} else if outTok < 0 {
		inTok, outTok = usage.TotalTokens, 0
	}
	res := legResult{latency: elapsed, inTok: inTok, outTok: outTok, model: usage.Model, reason: d.Reason}
	// the corpus is single single-select questions, so a valid answer is one pick or a line of text
	if d.Action == "answer" && agentask.ValidateAnswers(questions, d.Answers, false) == nil && len(d.Answers[0].SelectedIndexes) == 1 {
		res.choice = &d.Answers[0].SelectedIndexes[0]
	}
	return res
}

// ---- leg B: jev ----

type jevRequest struct {
	State     any                    `json:"state"`
	Model     string                 `json:"model"`
	Questions map[string]jevQuestion `json:"questions"`
}

type jevQuestion struct {
	Type         string `json:"type"`
	Instructions any    `json:"instructions"`
	Criteria     any    `json:"criteria,omitempty"`
}

type jevResponse struct {
	Model   string `json:"model"`
	Answers map[string]struct {
		Type          string             `json:"type"`
		Noul          float64            `json:"noul"`
		Choice        string             `json:"choice"`
		Probabilities map[string]float64 `json:"probabilities"`
		Confidence    float64            `json:"confidence"`
	} `json:"answers"`
	Usage struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

// buildJevRequest mirrors BuildClassifyPrompt's inputs as structured state plus two independent
// judgments. They are asked together because neither needs the other's answer — Jev evaluates the
// state once and runs both against it.
func buildJevRequest(c probeCase) (jevRequest, []string) {
	type optView struct {
		Index       int    `json:"index"`
		Label       string `json:"label"`
		Description string `json:"description,omitempty"`
	}
	opts := make([]optView, 0, len(c.question.Options))
	criteria := map[string]any{}
	keys := make([]string, 0, len(c.question.Options))
	for i, o := range c.question.Options {
		opts = append(opts, optView{Index: i, Label: o.Label, Description: o.Description})
		key := dedupeKey(truncate(o.Label, 90), keys)
		keys = append(keys, key)
		if o.Description != "" {
			criteria[key] = o.Description
		} else {
			criteria[key] = nil
		}
	}
	timeline := make([]string, 0, len(c.timeline))
	for _, m := range c.timeline {
		timeline = append(timeline, m.Author+": "+truncateLine(m.Text))
	}

	state := map[string]any{
		"channel":         c.channelName,
		"worker_task":     "(unknown task)",
		"question":        c.question.Question,
		"options":         opts,
		"recent_messages": timeline,
	}
	return jevRequest{
		State: state,
		Model: jevModel,
		Questions: map[string]jevQuestion{
			// mirrors the escalate rule the current prompt states in prose
			"routine": {
				Type: "noul",
				Instructions: "A coding agent paused to ask the human this multiple-choice question. " +
					"Is it ROUTINE — safe for an assistant to answer on the human's behalf without asking?",
				Criteria: map[string]any{
					"true": "Mechanical or already-implied by the task: the answer follows from what the human " +
						"already asked for, and picking wrong would be cheap and reversible.",
					"false": "The choice is irreversible, changes product scope or user-facing behavior, trades off " +
						"design or quality, coordinates with shared resources or another person's work, or is " +
						"otherwise a genuine judgment call.",
				},
			},
			"pick": {
				Type:         "choice",
				Instructions: "If this were answered on the human's behalf, which option would they choose?",
				Criteria:     criteria,
			},
		},
	}, keys
}

func runJevLeg(t *testing.T, key string, c probeCase) legResult {
	req, keys := buildJevRequest(c)
	payload, err := json.Marshal(req)
	if err != nil {
		return legResult{err: err}
	}
	ctx, cancel := context.WithTimeout(context.Background(), jevTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, jevEndpoint, bytes.NewReader(payload))
	if err != nil {
		return legResult{err: err}
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key)

	start := time.Now()
	resp, err := http.DefaultClient.Do(httpReq)
	elapsed := time.Since(start)
	if err != nil {
		return legResult{latency: elapsed, err: err}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 400 {
		return legResult{latency: elapsed, err: fmt.Errorf("jev %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))}
	}
	var jr jevResponse
	if err := json.Unmarshal(body, &jr); err != nil {
		return legResult{latency: elapsed, err: fmt.Errorf("decoding jev reply: %w", err)}
	}

	res := legResult{latency: elapsed, inTok: jr.Usage.InputTokens, outTok: jr.Usage.OutputTokens}
	res.routine = jr.Answers["routine"].Noul
	pick := jr.Answers["pick"]
	res.confid = pick.Confidence
	res.probs = pick.Probabilities
	for i, k := range keys {
		if k == pick.Choice {
			idx := i
			res.choice = &idx
			break
		}
	}
	return res
}

// ---- reporting ----

func reportLatency(t *testing.T, label string, results []legResult, skipped bool) {
	if skipped {
		t.Logf("%-20s skipped (PROBE_SKIP_BASELINE)", label)
		return
	}
	var ms []float64
	var failures int
	var total time.Duration
	for _, r := range results {
		if r.err != nil {
			failures++
			continue
		}
		ms = append(ms, float64(r.latency.Milliseconds()))
		total += r.latency
	}
	if len(ms) == 0 {
		t.Logf("%-20s every call failed (%d)", label, failures)
		for i, r := range results {
			if r.err != nil {
				t.Logf("  case %d: %v", i+1, r.err)
				break
			}
		}
		return
	}
	sort.Float64s(ms)
	t.Logf("%-20s n=%d p50=%.0fms p95=%.0fms max=%.0fms total=%s failures=%d",
		label, len(ms), pct(ms, 0.50), pct(ms, 0.95), ms[len(ms)-1], total.Round(time.Second), failures)
}

func reportCost(t *testing.T, baseline, jev []legResult, skipBaseline bool) {
	var jevIn int
	for _, r := range jev {
		jevIn += r.inTok
	}
	jevCost := float64(jevIn) / 1e6 * jevInputPerMTok
	t.Logf("cost  jev   %6d input tok (output free) = $%.5f  [reported]", jevIn, jevCost)
	if skipBaseline {
		return
	}
	var bIn, bOut int
	for _, r := range baseline {
		bIn += r.inTok
		bOut += r.outTok
	}
	bCost := float64(bIn)/1e6*baselineInPerMTok + float64(bOut)/1e6*baselineOutPerMTok
	model := baselineLabel(baseline)
	t.Logf("cost  base  %6d in / %d out tok = $%.5f  [total reported; in/out split derived]", bIn, bOut, bCost)
	if model != baselinePricedModel && model != "(unreported)" {
		t.Logf("cost  WARNING: priced as %s but the runtime reported %s — rate is wrong", baselinePricedModel, model)
	}
	if jevCost > 0 {
		t.Logf("cost  ratio %.1fx cheaper on this corpus", bCost/jevCost)
	}
}

func reportAgreement(t *testing.T, label string, cases []probeCase, results []legResult) {
	var agree, n int
	for i, c := range cases {
		if results[i].err != nil {
			continue
		}
		n++
		if sameVerdict(c.recordedChoice, results[i].choice) {
			agree++
		}
	}
	if n > 0 {
		t.Logf("%s: %d/%d agree (%.0f%%)", label, agree, n, 100*float64(agree)/float64(n))
	}
}

// reportThresholdSweep is the point of the probe: today's gate is a binary the model decides in prose,
// so it has no knob. These two are knobs. Each row is what the gatekeeper would have done at that
// setting, measured against what production actually did.
func reportThresholdSweep(t *testing.T, cases []probeCase, jev []legResult) {
	t.Log("")
	t.Log("threshold sweep — 'overreach' auto-answered something production escalated; 'kept' matched a")
	t.Log("recorded answer; 'mispicked' auto-answered a recorded answer with a different option.")
	t.Logf("%-8s %-6s | %-9s %-9s %-6s %-8s", "routine", "conf", "answered", "overreach", "kept", "mispicked")
	for _, rt := range []float64{0.0, 0.25, 0.5, 0.6, 0.7} {
		for _, cf := range []float64{0.0, 0.5, 0.7, 0.8, 0.9, 0.95} {
			var answered, overreach, kept, mispicked int
			for i, c := range cases {
				ch := jev[i].choiceAt(rt, cf)
				if ch == nil {
					continue
				}
				answered++
				switch {
				case c.escalated():
					overreach++
				case *c.recordedChoice == *ch:
					kept++
				default:
					mispicked++
				}
			}
			t.Logf("%-8.2f %-6.2f | %-9d %-9d %-6d %-8d", rt, cf, answered, overreach, kept, mispicked)
		}
	}
}

// reportCaseDetail prints the cases worth a human's eyes side by side: any case where the three
// verdicts aren't unanimous, plus every case production auto-answered (the rare class a migration
// would have to preserve). Verdict-only tables can't tell you whether a disagreement is one backend
// being wrong or the other being needlessly timid — the question text and the stated reasons can.
func reportCaseDetail(t *testing.T, cases []probeCase, baseline, jev []legResult, limit int) {
	for i, c := range cases {
		jevChoice := jev[i].choiceAt(0.5, 0.0)
		unanimous := sameVerdict(c.recordedChoice, baseline[i].choice) && sameVerdict(c.recordedChoice, jevChoice)
		if unanimous && c.escalated() {
			continue
		}
		if limit <= 0 {
			t.Logf("(more cases suppressed; raise PROBE_DUMP)")
			return
		}
		limit--

		t.Log("")
		t.Logf("──── case %d — %s ────", i+1, c.channelName)
		t.Logf("Q: %s", truncate(c.question.Question, 600))
		for oi, o := range c.question.Options {
			line := fmt.Sprintf("   %d) %s", oi, o.Label)
			if o.Description != "" {
				line += " — " + truncate(o.Description, 200)
			}
			t.Log(line)
		}
		t.Logf("PRODUCTION  %s — %s", verdictLabel(c.recordedChoice), truncate(c.recordedReason, 400))
		if baseline[i].err != nil {
			t.Logf("BASELINE    error: %v", baseline[i].err)
		} else {
			t.Logf("BASELINE    %s (%s) — %s", verdictLabel(baseline[i].choice),
				baseline[i].latency.Round(time.Millisecond), truncate(baseline[i].reason, 400))
		}
		if jev[i].err != nil {
			t.Logf("JEV         error: %v", jev[i].err)
		} else {
			t.Logf("JEV         %s (%s) routine=%.2f conf=%.2f  %s", verdictLabel(jevChoice),
				jev[i].latency.Round(time.Millisecond), jev[i].routine, jev[i].confid, formatProbs(jev[i].probs))
		}
	}
}

// formatProbs renders the option distribution highest-first — the thing the current classifier cannot
// report at all, and the reason a threshold is possible.
func formatProbs(probs map[string]float64) string {
	if len(probs) == 0 {
		return ""
	}
	type kv struct {
		k string
		v float64
	}
	pairs := make([]kv, 0, len(probs))
	for k, v := range probs {
		pairs = append(pairs, kv{k, v})
	}
	sort.Slice(pairs, func(a, b int) bool { return pairs[a].v > pairs[b].v })
	var b strings.Builder
	b.WriteString("p=[")
	for i, p := range pairs {
		if i > 0 {
			b.WriteString(" ")
		}
		fmt.Fprintf(&b, "%s:%.2f", truncate(p.k, 28), p.v)
	}
	b.WriteString("]")
	return b.String()
}

// baselineLabel reports the model the runtime actually resolved, so the cost line can't quietly price
// a model that never ran.
func baselineLabel(results []legResult) string {
	for _, r := range results {
		if r.model != "" {
			return r.model
		}
	}
	return "(unreported)"
}

// ---- helpers ----

func sameVerdict(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func verdictLabel(c *int) string {
	if c == nil {
		return "escalate"
	}
	return "answer:" + strconv.Itoa(*c)
}

func pct(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	i := int(p * float64(len(sorted)-1))
	return sorted[i]
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func dedupeKey(key string, taken []string) string {
	seen := false
	for _, k := range taken {
		if k == key {
			seen = true
			break
		}
	}
	if !seen {
		return key
	}
	return key + " [" + strconv.Itoa(len(taken)) + "]"
}

func envInt(name string) int {
	n, err := strconv.Atoi(os.Getenv(name))
	if err != nil {
		return 0
	}
	return n
}
