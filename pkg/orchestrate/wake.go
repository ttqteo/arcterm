// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/agentask"
	"github.com/wavetermdev/waveterm/pkg/agentctl"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/blockcontroller"
	"github.com/wavetermdev/waveterm/pkg/jarvis"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	// LeadAskDeadline is how long the lead owns a child's question before it moves to the human: above
	// the 155s worst compaction plus a Read/Grep answer, below the 15m stall threshold.
	LeadAskDeadline = 10 * time.Minute
	// WakeConfirmTimeout is how long a typed wake may go without the lead turning working.
	WakeConfirmTimeout = 30 * time.Second
)

// why a lead stopped getting wakes; each lands on the lead-wake-failed row and on every ask it hands over.
const (
	leadNotRunningNote   = "lead process is not running"
	wakeUnconfirmedNote  = "lead did not respond to a wake"
	leadDeadNote         = "lead is not taking wakes"
	leadLaunchFailedNote = "lead could not be started"
)

// handoffInstructions is what a lead's compaction keeps once its plan is handed over (spec §7): what the
// spec does not already hold.
const handoffInstructions = "Keep: what the human said that the spec does not record, and the reason behind each decision. Drop: code you read, drafts, tool output."

// HandoffCompact is the handoff as typed into a lead: the compaction lands at the natural boundary
// instead of mid-wake. A session with a stream is asked to compact instead (streamMsg).
const HandoffCompact = "/compact " + handoffInstructions

type leadState struct {
	BlockId string
	TabId   string
	Alive   bool
	State   string
	// NoLead is a dag-holding run that has never had a lead worker, as opposed to one whose lead exited.
	NoLead bool
	// Starting is a lead whose process has not run yet: its controller is absent or still initializing.
	Starting bool
}

// leadStateFn reads the lead's block, whether its process runs and its latest agent state. A var so
// tests can script the lead without a live block.
var leadStateFn = readLeadState

// sendWakeFn hands a wake to the lead's block; text "" presses Enter alone. A var for tests.
var sendWakeFn = sendWake

// typeWakeFn types into the lead's terminal whether or not its mod holds a stream. A var for tests.
var typeWakeFn = typeWake

var wakeNow = func() int64 { return time.Now().UnixMilli() }

// LaunchLeadHook spawns runId's lead with prompt. Wired to wshserver at startup; the default refuses,
// because wsh and the tests link this package without the server.
var LaunchLeadHook = func(ctx context.Context, channelId, runId, prompt string) error {
	return fmt.Errorf("no lead launcher in this process")
}

// launchLeadFn starts runId's first lead with wake as its first message. The spawn creates a tab and starts
// a process, so it runs off the waker lock and settles through leadLaunched. A var for tests.
var launchLeadFn = func(ctx context.Context, channelId, runId, wake string) {
	go func() {
		lctx := context.WithoutCancel(ctx)
		leadLaunched(lctx, channelId, runId, startLead(lctx, channelId, runId, wake))
	}()
}

// SetLaunchLeadForTest replaces the lead launch for tests in other packages and returns the restore.
func SetLaunchLeadForTest(fn func(ctx context.Context, channelId, runId, wake string)) func() {
	old := launchLeadFn
	launchLeadFn = fn
	return func() { launchLeadFn = old }
}

type runWake struct {
	channelId string
	lines     []string
	// quiet is what the lead should read that needs no judgment (a task passed review); it rides on the next
	// wake, after its own lines, and never starts one
	quiet []string
	// caveats is what a passed review could not verify; it rides like quiet but reads ahead of the recaps.
	caveats []string
	blockId string
	tabId   string
	// sentAt is the UnixMilli of the unconfirmed wake, 0 when none is outstanding.
	sentAt int64
	// sent is the unconfirmed wake's text, kept for its retry.
	sent    string
	retried bool
	dead    bool
	told    map[string]bool
	// handoff is a handoff compaction not yet typed.
	handoff bool
	// launching is a first lead still starting; launchLines are the events it was started with.
	launching   bool
	launchLines []string
	// launchedAt is the UnixMilli its first lead's spawn returned, 0 for a lead the run started with.
	launchedAt int64
	// missed is the judgment a dead lead left unread, kept so a relaunched lead can be told what it missed.
	missed []string
}

type waker struct {
	lock sync.Mutex
	// runs is keyed by the dag's owning run id.
	runs map[string]*runWake
}

func newWaker() *waker {
	return &waker{runs: make(map[string]*runWake)}
}

var wakes = newWaker()

func (w *waker) runLocked(channelId, runId string) *runWake {
	rw := w.runs[runId]
	if rw == nil {
		rw = &runWake{channelId: channelId, told: make(map[string]bool)}
		w.runs[runId] = rw
	}
	return rw
}

// PostWake hands a judgment event to runId's lead: typed now if the lead can take it, held and joined
// with later events if it is busy.
func PostWake(ctx context.Context, channelId, runId, line string) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	if rw.dead {
		rw.missed = append(rw.missed, line)
		appendRunEvent(ctx, channelId, runId, waveobj.RunEventKindLeadWakeFailed, nil, map[string]any{"reason": leadDeadNote, "lines": []string{line}})
		return
	}
	rw.lines = append(rw.lines, line)
	wakes.flushLocked(ctx, runId, rw)
}

// PostQuiet queues a line the lead should read but that needs no judgment: it rides on the next wake instead of
// costing the lead a turn of its own. A dead lead's are dropped; its replacement reads `dag status`.
func PostQuiet(ctx context.Context, channelId, runId, line string) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	if rw.dead {
		return
	}
	rw.quiet = append(rw.quiet, line)
}

// PostCaveat queues what a passed review could not verify. Like a quiet line it never starts a wake, and a dead
// lead's are dropped.
func PostCaveat(ctx context.Context, channelId, runId, line string) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	if rw.dead {
		return
	}
	rw.caveats = append(rw.caveats, line)
}

// composeWake orders a wake by what the lead must act on: its own lines, then the questions, then what passed
// unverified, and the recaps last, where a long run of them cannot push the action out of sight.
func composeWake(lines []string, questions string, caveats, quiet []string) string {
	out := append([]string{}, lines...)
	if questions != "" {
		out = append(out, questions)
	}
	if len(caveats) > 0 {
		out = append(append(out, "Unverified:"), caveats...)
	}
	if len(quiet) > 0 {
		out = append(append(out, "Since your last wake:"), quiet...)
	}
	return strings.Join(out, "\n")
}

// PokeWake re-checks runId's question queue after an ask was raised or came back. A lead given up on
// cannot own a new question, so it goes to the human (G8).
func PokeWake(ctx context.Context, channelId, runId string) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	if rw.dead {
		for oref, p := range leadAsks(runId) {
			forwardAskToUser(ctx, oref, p, leadDeadNote)
		}
		return
	}
	wakes.flushLocked(ctx, runId, rw)
}

// PostHandoff queues runId's handoff compaction, typed the next time the lead is at its prompt. It is
// delivered like a wake: the compaction's working report confirms it on both harnesses.
func PostHandoff(ctx context.Context, channelId, runId string) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	if rw.dead {
		return
	}
	rw.handoff = true
	wakes.flushLocked(ctx, runId, rw)
}

// NoteLeadStatus feeds agent status events to the adapter. working confirms the outstanding wake and
// revives a lead given up on; a lead back at its prompt gets what was held while it was busy.
func NoteLeadStatus(ctx context.Context, ev *wps.WaveEvent) {
	var data baseds.AgentStatusData
	if ev == nil || utilfn.ReUnmarshal(&data, ev.Data) != nil || data.ORef == "" {
		return
	}
	oref, err := waveobj.ParseORef(data.ORef)
	if err != nil {
		return
	}
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	for runId, rw := range wakes.runs {
		if oref.OID != rw.blockId && oref.OID != rw.tabId {
			continue
		}
		if data.State == baseds.AgentState_Working {
			if rw.dead {
				wakes.reviveLocked(ctx, runId, rw)
			}
			rw.sentAt, rw.retried = 0, false
			continue
		}
		if atPrompt(data.State) {
			wakes.flushLocked(ctx, runId, rw)
		}
	}
}

// tickWakes retries an unconfirmed wake once and then gives up on the lead. It also flushes anything
// held, which covers an idle status that arrived before the adapter knew the lead's block.
func tickWakes(ctx context.Context) {
	now := wakeNow()
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	for runId, rw := range wakes.runs {
		if rw.sentAt == 0 {
			wakes.flushLocked(ctx, runId, rw)
			continue
		}
		if now-rw.sentAt < WakeConfirmTimeout.Milliseconds() {
			continue
		}
		if rw.retried {
			if rw.sent == HandoffCompact {
				// the compaction is housekeeping: a lead that never ran it still takes its wakes
				log.Printf("wake: run %s's lead never ran its handoff compaction; dropped", runId)
				rw.sentAt, rw.retried = 0, false
				wakes.flushLocked(ctx, runId, rw)
				continue
			}
			wakes.leadDiedLocked(ctx, runId, rw, wakeUnconfirmedNote)
			continue
		}
		rw.retried, rw.sentAt = true, now
		typeWakeFn(rw.blockId, retryText(rw.blockId, rw.sent))
	}
}

// retryText is what an unconfirmed wake's retry types. Typed text is still in the lead's input, so only
// Enter is repeated. A wake the lead's mod was handed left nothing there and may never have run, so it is
// typed whole: a wake read twice beats one never read.
func retryText(blockId, sent string) string {
	if agentctl.Has(blockId) {
		return sent
	}
	return ""
}

// atPrompt reports a lead that can take typed input. A Claude lead left at its prompt reports waiting
// through the idle Notification hook, and run workers skip permission prompts. asking is the lead's own
// question to the human, which typed text would answer; the status alone cannot be trusted to still say
// so, which is why flushLocked also checks leadAsking.
func atPrompt(state string) bool {
	return state == baseds.AgentState_Idle || state == baseds.AgentState_Waiting
}

// leadAsking reports the lead's own question still open in its terminal. Claude Code fires a Notification
// a few seconds into the dialog, and agent-hook reports it as waiting over asking; a wake typed then has
// its Enter pick the dialog's preselected option. The registry entry lasts until the ask is cleared or the
// lead resumes work, whatever order the hook statuses arrive in.
func leadAsking(blockId string) bool {
	_, asking := agentask.GlobalRegistry.Get(waveobj.MakeORef(waveobj.OType_Block, blockId).String())
	return asking
}

func (w *waker) flushLocked(ctx context.Context, runId string, rw *runWake) {
	if rw.sentAt != 0 || rw.dead || rw.launching {
		return
	}
	asks := leadAsks(runId)
	untold := false
	for _, p := range asks {
		if !rw.told[askTold(p)] {
			untold = true
		}
	}
	if len(rw.lines) == 0 && !untold && !rw.handoff {
		return
	}
	st := leadStateFn(ctx, rw.channelId, runId)
	rw.blockId, rw.tabId = st.BlockId, st.TabId
	if st.NoLead {
		w.launchLocked(ctx, runId, rw, asks, untold)
		return
	}
	if !st.Alive {
		// the spawn returns before the process runs, so a just-launched lead gets a wake-confirm timeout
		// to start; the next tick looks again
		if st.Starting && wakeNow()-rw.launchedAt < WakeConfirmTimeout.Milliseconds() {
			return
		}
		w.leadDiedLocked(ctx, runId, rw, leadNotRunningNote)
		return
	}
	if !atPrompt(st.State) || leadAsking(st.BlockId) {
		return
	}
	if rw.handoff {
		// alone and first: a wake joined to it would be summarized away before the lead read it, so held
		// lines wait for the idle report that ends the compaction
		sendWakeFn(st.BlockId, HandoffCompact)
		rw.handoff, rw.sentAt, rw.sent, rw.retried = false, wakeNow(), HandoffCompact, false
		appendRunEvent(ctx, rw.channelId, runId, waveobj.RunEventKindLeadWoken, nil, map[string]any{"text": HandoffCompact})
		return
	}
	questions := ""
	if untold {
		questions = questionsLine(asks)
	}
	text := composeWake(rw.lines, questions, rw.caveats, rw.quiet)
	sendWakeFn(st.BlockId, text)
	rw.lines, rw.quiet, rw.caveats, rw.sentAt, rw.sent, rw.retried = nil, nil, nil, wakeNow(), text, false
	for _, p := range asks {
		rw.told[askTold(p)] = true
	}
	appendRunEvent(ctx, rw.channelId, runId, waveobj.RunEventKindLeadWoken, nil, map[string]any{"text": text})
}

// reviveLocked takes back a lead given up on: what it missed is its next wake, and the row tells the
// cockpit it is no longer down. Questions already moved to the human stay with the human.
func (w *waker) reviveLocked(ctx context.Context, runId string, rw *runWake) {
	rw.lines = append(rw.missed, rw.lines...)
	rw.missed, rw.sentAt, rw.retried, rw.dead = nil, 0, false, false
	appendRunEvent(ctx, rw.channelId, runId, waveobj.RunEventKindLeadRevived, nil, map[string]any{})
}

// reviveLive takes back runId's lead if it was given up on, wakes it with what it missed, and reports
// whether it did.
func (w *waker) reviveLive(ctx context.Context, channelId, runId string) bool {
	w.lock.Lock()
	defer w.lock.Unlock()
	rw := w.runLocked(channelId, runId)
	if !rw.dead {
		return false
	}
	w.reviveLocked(ctx, runId, rw)
	w.flushLocked(ctx, runId, rw)
	return true
}

// launchLocked starts the first lead of a run submitted with no lead, with the pending events as its first
// message (spec §1, G5). A clean finish is not a judgment: the engine closes a run nobody has to judge
// (MaybeCompleteLeadFreeRun), so run finished alone starts nothing.
func (w *waker) launchLocked(ctx context.Context, runId string, rw *runWake, asks map[string]agentask.PendingAsk, untold bool) {
	if !untold && onlyRunFinished(rw.lines) {
		rw.lines, rw.quiet, rw.caveats, rw.handoff = nil, nil, nil, false
		return
	}
	questions := ""
	if untold {
		questions = questionsLine(asks)
	}
	text := composeWake(rw.lines, questions, rw.caveats, rw.quiet)
	rw.quiet, rw.caveats = nil, nil
	rw.launching, rw.launchLines, rw.lines = true, rw.lines, nil
	for _, p := range asks {
		rw.told[askTold(p)] = true
	}
	appendRunEvent(ctx, rw.channelId, runId, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": text})
	launchLeadFn(ctx, rw.channelId, runId, text)
}

// onlyRunFinished reports held lines that say nothing but that the run finished, whatever outcome follows on
// the finished line's later lines. A failed final stage is its own wake, so it still launches a lead.
func onlyRunFinished(lines []string) bool {
	for _, l := range lines {
		if first, _, _ := strings.Cut(l, "\n"); first != runFinishedWake {
			return false
		}
	}
	return true
}

// leadLaunched settles a launch. A started lead took its first wake as its launch prompt, and events held
// meanwhile are typed once it reports it is at its prompt. A lead that could not be started hands its
// judgment to the human (G8).
func leadLaunched(ctx context.Context, channelId, runId string, err error) {
	wakes.lock.Lock()
	defer wakes.lock.Unlock()
	rw := wakes.runLocked(channelId, runId)
	rw.launching = false
	if err != nil {
		rw.lines = append(rw.launchLines, rw.lines...)
		wakes.leadDiedLocked(ctx, runId, rw, leadLaunchFailedNote+": "+err.Error())
	} else {
		rw.launchedAt = wakeNow()
	}
	rw.launchLines = nil
}

// startLead builds a plan-input lead's launch prompt from its run and dag and hands it to the spawner.
func startLead(ctx context.Context, channelId, runId, wake string) error {
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	g, err := wstore.GetDag(ctx, run.DagORef)
	if err != nil {
		return fmt.Errorf("loading dag: %w", err)
	}
	// the lead reads its own live copy in the landing tree, not a snapshot in some lane
	land := jarvis.LandPath(run)
	return LaunchLeadHook(ctx, channelId, runId, jarvis.PlanLeadPrompt(run.Principles, runId, DocPath(g, land, g.SpecPath), DocPath(g, land, g.PlanPath), wake))
}

// RelaunchLead brings back a lead that died after its plan was submitted. The replacement is told the
// dag is mid-flight and given what the dead lead missed, not the run's first prompt: a lead that thinks it
// is starting over re-dispatches work. A lead whose process still runs is not replaced: one given up on
// is taken back and woken with what it missed, and any other is refused. A failed spawn leaves the lead
// marked dead, so its judgment keeps going to the human.
func RelaunchLead(ctx context.Context, channelId, runId string) error {
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil {
		return fmt.Errorf("loading run: %w", err)
	}
	if run.DagORef == "" || jarvis.RunningPhaseIndex(*run) < 0 {
		return fmt.Errorf("run %s has no running plan to hand to a lead", runId)
	}
	if leadStateFn(ctx, channelId, runId).Alive {
		if wakes.reviveLive(ctx, channelId, runId) {
			return nil
		}
		return fmt.Errorf("run %s's lead is still running", runId)
	}
	missed, err := wakes.beginRelaunch(channelId, runId)
	if err != nil {
		return err
	}
	wake := replacementLeadWake(missed)
	// a phase that still names the dead lead's tab is skipped by EnsureWorkers, which is what spawns the new one
	err = clearLeadTab(ctx, channelId, runId)
	if err == nil {
		err = startLead(ctx, channelId, runId, wake)
	}
	wakes.endRelaunch(ctx, channelId, runId, wake, err)
	return err
}

func (w *waker) beginRelaunch(channelId, runId string) ([]string, error) {
	w.lock.Lock()
	defer w.lock.Unlock()
	rw := w.runLocked(channelId, runId)
	if rw.launching {
		return nil, fmt.Errorf("run %s's lead is already being started", runId)
	}
	rw.launching = true
	return append([]string{}, rw.missed...), nil
}

func (w *waker) endRelaunch(ctx context.Context, channelId, runId, wake string, err error) {
	w.lock.Lock()
	defer w.lock.Unlock()
	rw := w.runLocked(channelId, runId)
	rw.launching = false
	if err != nil {
		return
	}
	rw.dead, rw.missed, rw.sentAt, rw.retried, rw.launchedAt = false, nil, 0, false, wakeNow()
	appendRunEvent(ctx, channelId, runId, waveobj.RunEventKindLeadLaunched, nil, map[string]any{"text": wake})
}

// leadRestarted gives a lead the engine just restarted a wake-confirm timeout to come up, as a launched one
// gets: the restart returns before the process runs.
func (w *waker) leadRestarted(channelId, runId string) {
	w.lock.Lock()
	defer w.lock.Unlock()
	w.runLocked(channelId, runId).launchedAt = wakeNow()
}

func replacementLeadWake(missed []string) string {
	var b strings.Builder
	b.WriteString("You are a replacement lead: the lead before you exited while the run was still going. The dag is already running, so do not resubmit the plan or redispatch tasks. Start with `wsh jarvis dag status`.")
	if len(missed) > 0 {
		b.WriteString("\nEvents that arrived while no lead was running:\n")
		b.WriteString(strings.Join(missed, "\n"))
	}
	return b.String()
}

// clearLeadTab drops the run's stale lead tab oref, leaving the tab itself for the human to read.
func clearLeadTab(ctx context.Context, channelId, runId string) error {
	return wstore.UpdateRun(ctx, channelId, runId, func(r *waveobj.Run) error {
		for i := range r.Phases {
			kept := r.Phases[i].WorkerOrefs[:0]
			for _, oref := range r.Phases[i].WorkerOrefs {
				if !strings.HasPrefix(oref, "tab:") {
					kept = append(kept, oref)
				}
			}
			r.Phases[i].WorkerOrefs = kept
		}
		return nil
	})
}

// leadDiedLocked hands the lead's judgment to the human (G8): held events go on the lead-wake-failed
// row, and every question the lead owns moves to the user.
func (w *waker) leadDiedLocked(ctx context.Context, runId string, rw *runWake, reason string) {
	lines := rw.lines
	rw.missed = append(rw.missed, lines...)
	rw.lines, rw.sentAt, rw.retried, rw.dead, rw.handoff = nil, 0, false, true, false
	appendRunEvent(ctx, rw.channelId, runId, waveobj.RunEventKindLeadWakeFailed, nil, map[string]any{"reason": reason, "lines": lines})
	for oref, p := range leadAsks(runId) {
		forwardAskToUser(ctx, oref, p, reason)
	}
}

// leadAsks is runId's lead-owned questions, keyed by the oref each child waits on.
func leadAsks(runId string) map[string]agentask.PendingAsk {
	out := make(map[string]agentask.PendingAsk)
	for oref, p := range agentask.GlobalRegistry.List() {
		if p.RunId == runId && p.Owner == agentask.AskOwner_Lead {
			out[oref] = p
		}
	}
	return out
}

// askTold keys an announcement by miss count too, so an ask back from a failed delivery is news again.
func askTold(p agentask.PendingAsk) string {
	return fmt.Sprintf("%s/%d", p.AskId, p.Misses)
}

func questionsLine(asks map[string]agentask.PendingAsk) string {
	n := 0
	for _, p := range asks {
		n += len(p.Questions)
	}
	noun := "questions"
	if n == 1 {
		noun = "question"
	}
	return fmt.Sprintf("wake: %d %s waiting. wsh jarvis dag asks", n, noun)
}

// forwardAskToUser moves a dag child's question to the human with why, and reports whether it moved.
// An ask answered or replaced in the meantime moves nothing. The identity is written too, because
// `dag forward` can move an ask that never went through the raise (one restored after a restart), and
// an answer that never lands needs its run to come back to.
func forwardAskToUser(ctx context.Context, oref string, p agentask.PendingAsk, note string) bool {
	return moveAskToUser(ctx, oref, p, note, "")
}

// moveAskToUser is forwardAskToUser with who moved it on the row: ForwardedByHuman for a take-over, empty
// when the lead or the engine handed it on, which the note already says.
func moveAskToUser(ctx context.Context, oref string, p agentask.PendingAsk, note, by string) bool {
	moved := agentask.GlobalRegistry.Update(oref, p.AskId, func(cur *agentask.PendingAsk) {
		cur.Owner, cur.Note = agentask.AskOwner_User, note
		cur.ChannelId, cur.RunId, cur.TaskId, cur.DagOID = p.ChannelId, p.RunId, p.TaskId, p.DagOID
	})
	if !moved {
		return false
	}
	publishChildAsk(p)
	detail := map[string]any{
		"taskid": p.TaskId,
		"askid":  p.AskId,
		"note":   truncateText(note, MaxAskSummaryLen),
	}
	if by != "" {
		detail["by"] = by
	}
	appendRunEvent(ctx, p.ChannelId, p.RunId, waveobj.RunEventKindTaskForwarded, nil, detail)
	return true
}

// publishChildAsk tells the run's cockpit that its question queue changed; the card re-reads `dag asks`.
func publishChildAsk(p agentask.PendingAsk) {
	detail, _ := json.Marshal(map[string]string{"taskid": p.TaskId, "askid": p.AskId})
	publishDagEvent(DagEventChildAsk, &waveobj.TaskGroup{OID: p.DagOID, RunID: p.RunId}, string(detail))
}

func readLeadState(ctx context.Context, channelId, runId string) leadState {
	run, err := wstore.GetRun(ctx, channelId, runId)
	if err != nil || run == nil {
		return leadState{}
	}
	tabId := runTabID(run)
	if tabId == "" {
		// a run submitted with a plan and no lead has never had one: its first judgment event starts it
		return leadState{NoLead: run.DagORef != ""}
	}
	tab, err := wstore.DBGet[*waveobj.Tab](ctx, tabId)
	if err != nil || tab == nil || len(tab.BlockIds) == 0 {
		return leadState{TabId: tabId}
	}
	st := leadState{BlockId: tab.BlockIds[0], TabId: tabId}
	rs := blockcontroller.GetBlockControllerRuntimeStatus(st.BlockId)
	st.Starting = rs == nil || rs.ShellProcStatus == blockcontroller.Status_Init
	st.Alive = blockRunning(st.BlockId)
	st.State = latestAgentState(st.BlockId, tabId)
	return st
}

// latestAgentState is the newest state reported for the lead. Hooks report on the block, but a reporter
// may use the tab, so both scopes are read and the later report wins.
func latestAgentState(blockId, tabId string) string {
	return LatestAgentStatus(blockId, tabId).State
}

// LatestAgentStatus is the newest status reported for a block or its tab, zero when there is none.
func LatestAgentStatus(blockId, tabId string) baseds.AgentStatusData {
	var best baseds.AgentStatusData
	scopes := []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String(), waveobj.MakeORef(waveobj.OType_Tab, tabId).String()}
	for _, scope := range scopes {
		// an empty id's oref is "", the scope the broker keeps every event under
		if scope == "" {
			continue
		}
		for _, ev := range wps.Broker.ReadEventHistory(wps.Event_AgentStatus, scope, 1) {
			var d baseds.AgentStatusData
			if utilfn.ReUnmarshal(&d, ev.Data) == nil && d.State != "" && d.Ts >= best.Ts {
				best = d
			}
		}
	}
	return best
}

// SendToSession delivers text to an agent session the way a wake is: over its mod's stream when it holds
// one, typed and submitted otherwise.
func SendToSession(blockId, text string) {
	sendWakeFn(blockId, text)
}

// sendWake delivers a wake: a session whose mod holds a control stream is not typed into at all.
func sendWake(blockId, text string) {
	if overStream(blockId, text, latestAgentState(blockId, "")) {
		return
	}
	typeWake(blockId, text)
}

// typeWake pastes the wake and then presses Enter. Bracketed paste keeps a multi-line wake one message
// instead of relying on how each harness's editor treats a typed newline; the pause mirrors agentask's
// keystroke pacing, since one combined write races the editor. It runs async so the waker lock is
// never held across the pause.
func typeWake(blockId, text string) {
	go func() {
		if text != "" {
			if err := sendBlockInput(blockId, "\x1b[200~"+text+"\x1b[201~"); err != nil {
				log.Printf("wake: typing into block %s: %v", blockId, err)
				return
			}
			time.Sleep(agentask.KeystrokeDelay)
		}
		if err := sendBlockInput(blockId, "\r"); err != nil {
			log.Printf("wake: submitting in block %s: %v", blockId, err)
		}
	}()
}

// overStream hands text to a session whose mod takes it itself, leaving the composer and whatever the
// human is typing in it alone, and reports whether nothing is left to type. A session at its prompt runs
// it as a prompt of its own. One at work has it joined to the running turn, which is what a tell to a
// busy worker is for; a mod older than MidTurn runs it as a prompt once that turn ends.
func overStream(blockId, text, state string) bool {
	if !agentctl.Has(blockId) {
		return false
	}
	if text == "" {
		// the retry's Enter alone: a prompt sent over the stream left nothing in the composer to submit
		return true
	}
	msg := streamMsg(text)
	msg.MidTurn = !atPrompt(state)
	return agentctl.Send(blockId, msg)
}

// streamMsg is text as a session's mod is asked for it: the handoff is a compaction of the session's own,
// which echoes no command into its transcript, and anything else a prompt. The handoff keeps its typed
// text too: the mods are installed per machine, and one older than this message reads only that.
func streamMsg(text string) agentctl.Msg {
	if text == HandoffCompact {
		return agentctl.Msg{Text: text, Compact: handoffInstructions}
	}
	return agentctl.Msg{Text: text}
}

func sendBlockInput(blockId, s string) error {
	return blockcontroller.SendInput(blockId, &blockcontroller.BlockInputUnion{InputData: []byte(s)})
}
