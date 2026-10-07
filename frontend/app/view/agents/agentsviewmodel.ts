// Pure view-model logic for the Agents view. No React, no Wave runtime imports.

import { modelLabel } from "@/app/view/agents/session-models/sessionviewmodel";
import { sessionIdFromTranscript } from "./launch";
import { projectNameFromTranscriptPath } from "./projectname";

export type AgentState = "asking" | "working" | "idle";

// Detail captured from a tool call's result / input (Wave-transcript-feed.dc.html). All optional:
// absent detail renders exactly as today (bare verb + target line).
export interface GrepMatch {
    loc: string;
    code: string;
}
export interface DiffLine {
    sign: "+" | "-" | "";
    text: string;
}
export interface EditFile {
    path: string;
    badge: "M" | "A";
    adds: number;
    dels: number;
    lines: DiffLine[];
}

export type ActionDetail =
    | { kind: "grep"; matches: GrepMatch[]; more?: string }
    | { kind: "read"; snippet: string; truncated?: boolean }
    | { kind: "bash"; command?: string; output: string; exit: number }
    | { kind: "skill"; name: string; args?: string }
    | { kind: "edit"; files: EditFile[] };

// One item of "previous info": something the agent said, or something it did.
export type AgentEntry =
    | { kind: "message"; text: string }
    | { kind: "user"; text: string; images?: string[] } // images: what was pasted with it, as data URLs
    | { kind: "command"; name: string; args?: string; isSkill?: boolean }
    | { kind: "compaction"; trigger?: string; preTokens?: number; postTokens?: number; summary?: string }
    // a background Task/subagent finished (Claude's <task-notification>): summary + optional full result
    | { kind: "notification"; summary: string; status?: string; result?: string }
    // the human interrupted the agent mid-turn ([Request interrupted by user])
    | { kind: "interrupted" }
    | {
          kind: "action";
          verb: string;
          target: string;
          path?: string; // the file the tool touched, in full, when it names one; target keeps the base name
          outcome?: "ok" | "fail";
          note?: string;
          summary?: string; // e.g. "14 matches", "80 lines", "24 passing"
          durationMs?: number; // tool_use → tool_result wall time, when timestamps present
          detail?: ActionDetail; // rich, expandable detail; absent = bare line
      };

export interface AgentAskOption {
    label: string;
    description?: string;
    preview?: string;
}

export interface AgentAskQuestion {
    question: string;
    header?: string;
    multiSelect?: boolean;
    options?: AgentAskOption[];
}

export interface AgentAsk {
    questions: AgentAskQuestion[];
    askId?: string;
    oref?: string;
    replySuggestions?: string[]; // free-form quick-replies (populated by test-data scenarios; undefined on the live path)
    prose?: boolean; // projected prose question (pi bridge): chips submit as text answers
    note?: string; // why the ask is back in front of the human (e.g. a typed answer that never cleared)
}

export interface AgentVM {
    id: string; // tabId — stable key + open/answer target
    name: string; // e.g. "loom"
    task: string; // e.g. "Fix duplicate-session race"
    state: AgentState;
    agent?: string; // coding-agent identity (claude | codex | …) — selects the transcript projector
    model?: string; // short family label (e.g. "opus")
    project?: string; // explicit project name; preferred over the lossy transcript-path derivation
    activity?: string; // working: live activity line; idle: reason
    blockedMs?: number; // asking: how long blocked (sort + age)
    activeMs?: number; // working: elapsed (sort)
    previousInfo?: AgentEntry[]; // asking: messages + actions leading to the question
    ask?: AgentAsk; // present iff state === "asking"
    transcriptPath?: string; // source for on-demand previous-info (not rendered directly)
    blockId?: string; // terminal block OID — target for ControllerInputCommand
    idleSince?: number; // idle: when it went idle (UnixMilli) — drives the keep-as-panel grace window
    usage?: AgentUsage; // latest context %, cost, and plan rate-limit snapshot (from the statusLine reporter)
    kind?: "agent" | "terminal" | "background"; // undefined = agent (roster); "terminal" = plain shell; "background" = detached claude agent
    needsInput?: boolean; // background agent parked on input (claude state "blocked") — drives the needs-input badge
    cwd?: string; // background agent working dir — the resume target for Attach
    sessionId?: string; // pi control-channel session id (agentstatus --session-id)
    runId?: string; // the run this agent works for, when a run spawned it: a lead's own run, a worker's child run
    effortId?: string; // the initiative this agent works on: launched from it, or last read or wrote through `wsh effort`
    atPrompt?: boolean; // the raw status was waiting or idle, whatever state it folds to: a lead between wakes
    step?: string; // idle: the "n/m" part its last message stopped on ("1/3"), until you reply
}

const STATE_RANK: Record<AgentState, number> = { asking: 0, working: 1, idle: 2 };

/** Pure: asking -> working -> idle; within asking, longest-blocked first;
 *  within working, longest-running first; idle keeps input order. Never mutates input. */
export function sortAgents(agents: AgentVM[]): AgentVM[] {
    return [...agents].sort((a, b) => {
        const rank = STATE_RANK[a.state] - STATE_RANK[b.state];
        if (rank !== 0) {
            return rank;
        }
        if (a.state === "asking") {
            return (b.blockedMs ?? 0) - (a.blockedMs ?? 0);
        }
        if (a.state === "working") {
            return (b.activeMs ?? 0) - (a.activeMs ?? 0);
        }
        return 0;
    });
}

/** Pure: number of agents currently asking (drives the sidebar badge). */
export function askingCount(agents: AgentVM[]): number {
    return agents.filter((a) => a.state === "asking").length;
}

// within this many px of the end, a scroll region counts as "stuck to bottom": new lines
// auto-scroll and the jump-to-latest pill hides. Past it, the user is reading history.
export const STICK_THRESHOLD_PX = 24;

/** Pure: is a scroll region within `threshold` px of its bottom edge? */
export function isNearBottom(
    m: { scrollTop: number; scrollHeight: number; clientHeight: number },
    threshold = STICK_THRESHOLD_PX
): boolean {
    return m.scrollHeight - m.scrollTop - m.clientHeight < threshold;
}

export interface AgentSections {
    asking: AgentVM[];
    working: AgentVM[];
    idle: AgentVM[];
}

/** Pure: the three rendered sections, each already sorted by sortAgents. */
export function groupAgents(agents: AgentVM[]): AgentSections {
    const sorted = sortAgents(agents);
    return {
        asking: sorted.filter((a) => a.state === "asking"),
        working: sorted.filter((a) => a.state === "working"),
        idle: sorted.filter((a) => a.state === "idle"),
    };
}

/** Pure: the text of the most recent message-kind entry, or undefined. Drives the working row's
 *  current-activity line and the focus view's accented "now" message. */
export function latestMessageText(entries: AgentEntry[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "message") {
            return e.text;
        }
    }
    return undefined;
}

export type AgentActionEntry = Extract<AgentEntry, { kind: "action" }>;

/** Pure: the last `max` action-kind entries, oldest-first. Drives the working row's steps column. */
export function recentActions(entries: AgentEntry[], max: number): AgentActionEntry[] {
    const actions = entries.filter((e): e is AgentActionEntry => e.kind === "action");
    return max > 0 ? actions.slice(-max) : actions;
}

export const CollapseRunThreshold = 3;

// Per-kind inline line budget (Wave-transcript-feed.dc.html DCLogic `capped`). At or under the
// budget the detail expands inline; over it, the row opens the modal instead.
export const DETAIL_INLINE_MAX: Record<ActionDetail["kind"], number> = {
    grep: 6,
    read: 9,
    bash: 8,
    skill: 6,
    edit: 9,
};

// Pure: number of lines a detail would render inline (drives inline-vs-modal routing).
export function detailLineCount(d: ActionDetail): number {
    switch (d.kind) {
        case "grep":
            return d.matches.length;
        case "read":
            return d.snippet.split("\n").length;
        case "bash":
            return d.output.split("\n").length + (d.command ? 1 : 0);
        case "skill":
            return d.args ? d.args.split("\n").length + 1 : 1;
        case "edit":
            return d.files.reduce((n, f) => n + f.lines.length + 1, 0);
    }
}

// Pure: true when detail exceeds its inline budget and a click should open the modal directly.
export function detailExceedsInline(d: ActionDetail): boolean {
    return detailLineCount(d) > DETAIL_INLINE_MAX[d.kind];
}

// A timeline render item: prose/user pass through inline; a maximal run of >= threshold
// consecutive actions folds into one `group` (keyed by the run's first entry index, which
// is stable because entries are append-only). Shorter runs stay as inline `action` items.
export type TimelineItem =
    | { kind: "message"; text: string; index: number }
    | { kind: "user"; text: string; images?: string[]; index: number }
    | { kind: "command"; name: string; args?: string; isSkill?: boolean; index: number }
    | { kind: "compaction"; trigger?: string; preTokens?: number; postTokens?: number; summary?: string; index: number }
    | { kind: "notification"; summary: string; status?: string; result?: string; index: number }
    | { kind: "interrupted"; index: number }
    | { kind: "action"; action: AgentActionEntry; index: number }
    | { kind: "group"; startIndex: number; actions: AgentActionEntry[] }
    | { kind: "edit-burst"; startIndex: number; files: EditFile[]; adds: number; dels: number };

// Pure: fold a run of edit actions (verb "edited"/"wrote" carrying an edit detail) into one burst.
export function aggregateEditBurst(
    actions: AgentActionEntry[],
    startIndex: number
): Extract<TimelineItem, { kind: "edit-burst" }> {
    const files: EditFile[] = [];
    for (const a of actions) {
        if (a.detail?.kind === "edit") {
            files.push(...a.detail.files);
        }
    }
    const adds = files.reduce((n, f) => n + f.adds, 0);
    const dels = files.reduce((n, f) => n + f.dels, 0);
    return { kind: "edit-burst", startIndex, files, adds, dels };
}

// Pure: does this action participate in an edit burst?
export function isEditAction(e: AgentEntry): boolean {
    return e.kind === "action" && (e.verb === "edited" || e.verb === "wrote") && e.detail?.kind === "edit";
}

/** Pure: collapse bursts of consecutive actions into groups while preserving chronology. */
export function groupTimeline(entries: AgentEntry[], threshold = CollapseRunThreshold): TimelineItem[] {
    const items: TimelineItem[] = [];
    let runStart = -1;
    let run: AgentActionEntry[] = [];
    const flush = () => {
        if (run.length === 0) {
            return;
        }
        if (run.length >= threshold && run.every((a) => isEditAction(a))) {
            items.push(aggregateEditBurst(run, runStart));
        } else if (run.length >= threshold) {
            items.push({ kind: "group", startIndex: runStart, actions: run });
        } else {
            run.forEach((action, k) => items.push({ kind: "action", action, index: runStart + k }));
        }
        run = [];
        runStart = -1;
    };
    entries.forEach((e, i) => {
        if (e.kind === "action") {
            if (run.length === 0) {
                runStart = i;
            }
            run.push(e);
            return;
        }
        flush();
        if (e.kind === "message") {
            items.push({ kind: "message", text: e.text, index: i });
        } else if (e.kind === "user") {
            items.push(
                e.images
                    ? { kind: "user", text: e.text, images: e.images, index: i }
                    : { kind: "user", text: e.text, index: i }
            );
        } else if (e.kind === "command") {
            items.push({ kind: "command", name: e.name, args: e.args, isSkill: e.isSkill, index: i });
        } else if (e.kind === "compaction") {
            items.push({
                kind: "compaction",
                trigger: e.trigger,
                preTokens: e.preTokens,
                postTokens: e.postTokens,
                summary: e.summary,
                index: i,
            });
        } else if (e.kind === "notification") {
            items.push({ kind: "notification", summary: e.summary, status: e.status, result: e.result, index: i });
        } else if (e.kind === "interrupted") {
            items.push({ kind: "interrupted", index: i });
        }
    });
    flush();
    return items;
}

// Pure: how a collapsed action group renders. "reveal" = the user expanded a historical burst, so
// it animates open. "open" = the auto-open trailing burst during live streaming — plain, never
// animated (the burst guard: a streaming run must not strobe, even if the user had also expanded it).
// "collapsed" = show the summary button.
export function burstRenderMode(o: { userOpened: boolean; autoOpen: boolean }): "reveal" | "open" | "collapsed" {
    if (o.autoOpen) {
        return "open";
    }
    return o.userOpened ? "reveal" : "collapsed";
}

// Joins the prose (message + user) entries of a transcript into one copyable string. Tool actions
// are omitted — they are not conversational content.
export function conversationText(entries: AgentEntry[]): string {
    const out: string[] = [];
    for (const e of entries) {
        if (e.kind === "message" || e.kind === "user") {
            out.push(e.text);
        } else if (e.kind === "command") {
            const name = e.isSkill ? "/" + e.name : e.name;
            out.push(e.args ? `${name} ${e.args}` : name);
        }
    }
    return out.join("\n\n");
}

export interface ActionsSummary {
    total: number;
    byVerb: { verb: string; count: number }[];
    outcome: "ok" | "fail";
    failed: number;
}

/** Pure: per-verb counts (count desc, then first appearance), the number of failed actions, and the aggregate
 *  outcome (fail if any action failed). Drives a collapsed group's summary label. */
export function summarizeActions(actions: AgentActionEntry[]): ActionsSummary {
    const order: string[] = [];
    const counts = new Map<string, number>();
    let failed = 0;
    for (const a of actions) {
        if (!counts.has(a.verb)) {
            order.push(a.verb);
        }
        counts.set(a.verb, (counts.get(a.verb) ?? 0) + 1);
        if (a.outcome === "fail") {
            failed++;
        }
    }
    const byVerb = order.map((verb) => ({ verb, count: counts.get(verb)! })).sort((x, y) => y.count - x.count);
    return { total: actions.length, byVerb, outcome: failed > 0 ? "fail" : "ok", failed };
}

/**
 * Pure: a millisecond duration -> short age label ("just now" / "4m" / "2h" / "8d").
 *
 * The days tier exists because this is also the age on a record row, and a dossier last touched a week ago
 * read as "192h". Agents and sessions gain it too — an hour count past a day is no easier to read there.
 */
export function formatAge(ms?: number): string {
    if (ms == null || ms < 60_000) {
        return "just now";
    }
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) {
        return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
        return `${hours}h`;
    }
    return `${Math.floor(hours / 24)}d`;
}

/** Pure: formatAge for a line that must fit a narrow column, where "just now" crowds out what follows. */
// an age as a time in the past: formatAge says "just now" under a minute, which takes no "ago"
export function formatAgo(ms: number | undefined): string {
    return ms == null || ms < 60_000 ? "just now" : `${formatAge(ms)} ago`;
}

export function formatAgeShort(ms?: number): string {
    return ms == null || ms < 60_000 ? "<1m" : formatAge(ms);
}

/**
 * Pure: the age a card should render for this agent — the field that is actually populated for its
 * state. agentVMFromInput writes exactly one of activeMs | blockedMs | idleSince depending on state,
 * so a reader that always reaches for activeMs renders "just now" forever on an asking or idle agent
 * (formatAge(undefined) === "just now"). `now` is only consulted for idle, because idleSince is an
 * absolute stamp rather than a duration; callers that render a provably-asking row may omit it.
 */
export function displayAgeMs(agent: AgentVM, now?: number): number | undefined {
    if (agent.state === "asking") {
        return agent.blockedMs;
    }
    if (agent.state === "idle") {
        return agent.idleSince != null && now != null ? Math.max(0, now - agent.idleSince) : undefined;
    }
    return agent.activeMs;
}

/** Pure: usage percentage -> threshold band for color (shared by the plan strip and context bars). */
export function usageLevel(pct: number): "ok" | "warn" | "hot" {
    if (pct > 85) {
        return "hot";
    }
    if (pct > 60) {
        return "warn";
    }
    return "ok";
}

/** Pure: a token count -> short label ("38k" / "142k" / "1.0M"). */
export function formatTokens(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(1)}M`;
    }
    if (n >= 1_000) {
        return `${Math.round(n / 1_000)}k`;
    }
    return String(n);
}

/** Pure: an epoch-seconds reset time -> short countdown ("now" / "44m" / "2h 11m"). */
export function formatReset(resetSec: number, now: number): string {
    const mins = Math.floor((resetSec * 1000 - now) / 60_000);
    if (mins <= 0) {
        return "now";
    }
    if (mins < 60) {
        return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    // a weekly window is days out: "3d 13h" reads at a glance where "85h 57m" makes you divide
    if (hours >= 24) {
        return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    }
    return `${hours}h ${mins % 60}m`;
}

const PROVIDER_RANK: Record<string, number> = { claude: 0, codex: 1, opencode: 2 };

/** Pure: one plan-limit usage row per agent that carries rate data (no per-provider collapse), so
 *  multiple concurrent agents each show a row. Sorted claude-first, then codex, then others in
 *  first-seen order. */
export function providerPlanUsage(
    agents: AgentVM[]
): { agentId: string; name: string; provider: string; usage: AgentUsage }[] {
    const rows: { agentId: string; name: string; provider: string; usage: AgentUsage }[] = [];
    for (const a of agents) {
        const u = a.usage;
        if (!u || (u.fivehourpct == null && u.weekpct == null)) {
            continue;
        }
        rows.push({ agentId: a.id, name: a.name, provider: a.agent || "claude", usage: u });
    }
    // stable sort keeps active-first input order within a provider; claude before codex across providers
    return rows.sort((x, y) => (PROVIDER_RANK[x.provider] ?? 99) - (PROVIDER_RANK[y.provider] ?? 99));
}

/** Pure: agents whose live rate-limit window reading is current. Rate limits are account-level, so
 *  every active session of a provider reports the same window; an idle agent instead keeps a frozen
 *  snapshot from its last turn. Feeding that as "live" lets a stale idle reading override a fresher
 *  active one when providerPlanUsage rows collapse per-provider. Excluding idle agents lets them fall
 *  through to the persisted (continuously-updated) saved reading. The Usage surface's Provider limits
 *  and the cockpit rail take this so they show the same, current account window. */
export function liveWindowAgents(agents: AgentVM[]): AgentVM[] {
    return agents.filter((a) => a.state !== "idle");
}

/** Minimal per-agent inputs the live roster feeds the pure mapping. `status` is the sidebar's
 *  SessionStatus string ("working" | "waiting" | "idle"); `ts` is the status event's UnixMilli. */
export interface LiveAgentInput {
    id: string; // tabId — open target + stable key
    name: string;
    status: string;
    detail?: string;
    agent?: string; // coding-agent identity (claude | codex | …)
    model?: string; // raw model id
    ts?: number; // last status change (UnixMilli)
    transcriptPath?: string;
    blockId?: string;
    project?: string; // launch-time project name (session:project); groups the roster without the lossy path derivation
    sessionId?: string; // pi control-channel session id (agentstatus --session-id)
    runORef?: string; // jarvis:runoref on the tab: "run:<id>"
    effortORef?: string; // session:effort on the tab: "effort:<oid>"
    step?: string; // the status event's step: the "n/m" part an idle turn stopped on
}

/** Pure: one live row -> an AgentVM. `asking` (a pending AskUserQuestion) maps straight to asking so
 *  the badge is amber even when the ask fell back to the terminal (no structured agent:ask). `waiting`
 *  (a permission prompt or another input request; an idle prompt reports idle) maps to asking too:
 *  either way the agent is blocked on you. withAsk later overlays the answer UI when a
 *  live agent:ask arrives; working age -> activeMs. task/ask filled later (async). */
export function agentVMFromInput(input: LiveAgentInput, now: number): AgentVM {
    const state: AgentState =
        input.status === "asking" || input.status === "waiting"
            ? "asking"
            : input.status === "working"
              ? "working"
              : "idle";
    const age = input.ts != null ? Math.max(0, now - input.ts) : undefined;
    const vm: AgentVM = {
        id: input.id,
        name: input.name,
        task: "",
        state,
        agent: input.agent,
        model: modelLabel(input.model),
        activity: input.detail,
        transcriptPath: input.transcriptPath,
        blockId: input.blockId,
        project: input.project,
        sessionId: input.sessionId,
    };
    if (input.runORef?.startsWith("run:")) {
        vm.runId = input.runORef.slice("run:".length);
    }
    if (input.effortORef?.startsWith("effort:")) {
        vm.effortId = input.effortORef.slice("effort:".length);
    }
    if (input.status === "waiting" || input.status === "idle") {
        vm.atPrompt = true;
    }
    if (state === "working") {
        vm.activeMs = age;
    } else if (state === "asking") {
        // blocked since the question appeared; withAsk refines this from ask.ts when a structured ask exists
        vm.blockedMs = age;
    } else if (input.ts != null) {
        vm.idleSince = input.ts;
    }
    if (state === "idle" && input.step) {
        vm.step = input.step;
    }
    return vm;
}

/** A session-sidebar row, narrowed to the fields terminal-derivation needs. */
export interface TerminalRowInput {
    tabId: string;
    label: string;
    termBlockOref?: string;
    isAgentsTab?: boolean;
    agent?: string; // session:agent runtime, set at launch for agent tabs (never for terminals)
    projectLabel?: string; // session:project, stamped at launch (launchAgent writes it for a terminal too)
    cwd?: string; // the session terminal's cwd: the registered project it sits in names its project first
}

/** Pure: the plain-terminal sessions — rows that own a term block but never emitted an agent status
 *  (so they're not in the agent roster) and aren't the Agents tab itself. These are the "background"
 *  terminals launched via New Agent; the Agent surface lists + renders them separately from agents.
 *  `hasAgentStatus(oref)` reports whether that block has a live agent:status (i.e. it's a real agent).
 *  A terminal's project follows its live cwd's registered project first, then the launch-time label, so a `cd`
 *  into another registered repo moves it. `registeredProject` defaults to "no registry" for callers that have none. */
export function deriveTerminalVMs(
    rows: TerminalRowInput[],
    hasAgentStatus: (termBlockOref: string) => boolean,
    // the registry's project for a cwd; the launch-time label covers a terminal outside every registered project
    registeredProject: (cwd: string) => string = () => ""
): AgentVM[] {
    const out: AgentVM[] = [];
    for (const row of rows) {
        // An agent tab (session:agent set) is never a terminal, even in the window before its status
        // reporter fires — otherwise a just-launched agent renders as BOTH a pending agent and a terminal.
        const isAgentSession = row.agent != null && row.agent !== "terminal";
        if (row.isAgentsTab || isAgentSession || !row.termBlockOref || hasAgentStatus(row.termBlockOref)) {
            continue;
        }
        const project = registeredProject(row.cwd ?? "") || row.projectLabel?.trim() || undefined;
        out.push({
            id: row.tabId,
            name: row.label,
            task: "",
            state: "idle",
            kind: "terminal",
            agent: "terminal", // selects the "Terminal" pill in the header (runtimeMeta)
            blockId: row.termBlockOref.split(":")[1],
            ...(project != null ? { project } : {}),
        });
    }
    return out;
}

/** Pure: reconcile a stable order list against the current id set. Kept ids retain their existing
 *  slot regardless of `ids` order (anchored ordering); new ids append in `ids` order; absent ids
 *  drop. This is why a working->asking transition never moves a panel: the id stays in the set. */
export function mergeOrder(prev: string[], ids: string[]): string[] {
    const present = new Set(ids);
    const kept = prev.filter((id) => present.has(id));
    const keptSet = new Set(kept);
    const added = ids.filter((id) => !keptSet.has(id));
    return [...kept, ...added];
}

/** pure: apply stored card order without hiding agents that appeared before orderAtom updated. */
export function applyAgentOrder(order: string[], agents: AgentVM[]): AgentVM[] {
    const byId = new Map(agents.map((a) => [a.id, a]));
    return mergeOrder(
        order,
        agents.map((a) => a.id)
    )
        .map((id) => byId.get(id))
        .filter(Boolean) as AgentVM[];
}

/** Pure: split working-state agents into the active set (rendered in the working region) and the
 *  backgrounded set (collapsed lane). An id in `backgroundedIds` goes to backgrounded; order within
 *  each is preserved. Asking agents are never passed here (they live in the asks region), so a
 *  backgrounded agent that starts asking naturally re-surfaces. */
export function partitionBackgrounded(
    working: AgentVM[],
    backgroundedIds: Set<string>
): { active: AgentVM[]; backgrounded: AgentVM[] } {
    const active: AgentVM[] = [];
    const backgrounded: AgentVM[] = [];
    for (const a of working) {
        (backgroundedIds.has(a.id) ? backgrounded : active).push(a);
    }
    return { active, backgrounded };
}

/** Pure: the asking agent whose body is expanded in the spotlight. The cursor's ask wins when the
 *  cursor is on an ask; otherwise the first ask. Undefined when nothing is asking. */
export function focusedAskId(askingIds: string[], cursorId: string | undefined): string | undefined {
    if (askingIds.length === 0) {
        return undefined;
    }
    if (cursorId != null && askingIds.includes(cursorId)) {
        return cursorId;
    }
    return askingIds[0];
}

/** Pure: the ask to jump to after `current`, cycling with wrap. Defaults to the first ask when
 *  `current` is absent or no longer in the list. Undefined for an empty list. */
export function nextAskId(ids: string[], current?: string): string | undefined {
    if (ids.length === 0) {
        return undefined;
    }
    const idx = current != null ? ids.indexOf(current) : -1;
    return ids[(idx + 1) % ids.length];
}

/** Pure: the id `delta` steps from `current` in `ids`, clamped at both ends (no wrap). Falls back to
 *  the first id when `current` is absent/unknown. Undefined for an empty list. Drives j/k cursor moves. */
export function moveCursor(ids: string[], current: string | undefined, delta: number): string | undefined {
    if (ids.length === 0) {
        return undefined;
    }
    const idx = current != null ? ids.indexOf(current) : -1;
    if (idx === -1) {
        return ids[0];
    }
    return ids[Math.max(0, Math.min(ids.length - 1, idx + delta))];
}

/** Pure: like moveCursor but wraps around the ends (for cycling shortcuts). Unknown current -> first. */
export function cycleId(ids: string[], current: string | undefined, delta: number): string | undefined {
    if (ids.length === 0) {
        return undefined;
    }
    const idx = current != null ? ids.indexOf(current) : -1;
    return ids[(idx + delta + ids.length) % ids.length];
}

/** Pure: one AgentAnswerItem per question. A non-empty trimmed text wins over the selection and
 *  emits { text }; otherwise emits { selectedindexes } (ascending). */
export function buildAskAnswers(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    texts: Record<number, string> = {},
    prose = false
): AgentAnswerItem[] {
    return questions.map((_, qi) => {
        const text = (texts[qi] ?? "").trim();
        if (text !== "") {
            return { text };
        }
        if (prose) {
            // prose cards have no native picker: a chip click means "type this label".
            const idxs = Array.from(selections[qi] ?? []);
            if (idxs.length !== 1) {
                return { text: "" };
            }
            return { text: questions[qi].options?.[idxs[0]]?.label ?? "" };
        }
        return { selectedindexes: Array.from(selections[qi] ?? []).sort((a, b) => a - b) };
    });
}

/** Pure: toggle option `oi` of question `qi` in a selection map. Single-select replaces the
 *  question's choice; multi-select toggles membership. Never mutates `prev` (clones the map and
 *  the affected set). Mirrors the AnswerBar's interaction. */
export function toggleSelection(
    prev: Record<number, Set<number>>,
    qi: number,
    oi: number,
    multiSelect: boolean
): Record<number, Set<number>> {
    const next = { ...prev };
    const set = new Set(next[qi] ?? []);
    if (multiSelect) {
        if (set.has(oi)) {
            set.delete(oi);
        } else {
            set.add(oi);
        }
    } else {
        set.clear();
        set.add(oi);
    }
    next[qi] = set;
    return next;
}

/** Pure: map a 1-9 keyboard digit to the (question, option) it toggles for an asking agent, given the
 *  active question tab. Returns null when the agent isn't asking or the digit has no matching option.
 *  Shared by the cockpit grid keymap and the Channels ask rows so both number keys behave identically. */
export function answerDigitTarget(agent: AgentVM, activeTab: number, digit: number): { qi: number; oi: number } | null {
    if (agent.state !== "asking") {
        return null;
    }
    const questions = agent.ask?.questions ?? [];
    if (questions.length === 0) {
        return null;
    }
    const qi = Math.min(Math.max(activeTab, 0), questions.length - 1);
    const oi = digit - 1;
    const opts = questions[qi]?.options ?? [];
    return oi >= 0 && oi < opts.length ? { qi, oi } : null;
}

/** Pure: submittable only when every question has at least one selected option or non-empty text. */
export function canSubmitAsk(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    texts: Record<number, string> = {}
): boolean {
    return (
        questions.length > 0 &&
        questions.every((_, qi) => (selections[qi]?.size ?? 0) >= 1 || (texts[qi] ?? "").trim() !== "")
    );
}

/** Pure: the single muted footer hint for an ask, so one consistent line always renders.
 *  - one single-select question, no typed text: prompt to answer (mentions 1–9 only when the picker is numbered)
 *  - a typed answer in any question: "press Enter to send" (replaces "press Enter to submit" when both apply)
 *  - one multi-select question: "press Enter to submit" (multi-select needs a confirm)
 *  - multiple questions: "N/M answered" (typed text counts as answered), plus "press Enter to submit"/"press
 *    Enter to send" if any is multi-select or has typed text */
export function answerHint(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    numbered: boolean,
    texts: Record<number, string> = {}
): string {
    if (questions.length === 0) {
        return "";
    }
    const total = questions.length;
    const hasTyped = questions.some((_, qi) => (texts[qi] ?? "").trim() !== "");
    const needsConfirm = questions.some((q) => q.multiSelect) || hasTyped;
    if (total === 1 && !needsConfirm) {
        return numbered ? "Press 1–9 or click to answer" : "Click to answer";
    }
    const parts: string[] = [];
    if (total > 1) {
        const answered = questions.filter(
            (_, qi) => (selections[qi]?.size ?? 0) > 0 || (texts[qi] ?? "").trim() !== ""
        ).length;
        parts.push(`${answered}/${total} answered`);
    }
    if (needsConfirm) {
        parts.push(hasTyped ? "press Enter to send" : "press Enter to submit");
    }
    return parts.join(" · ");
}

/** Pure: the question to move to once question `qi` has an answer, or -1 when every other question has one (a
 *  selection or typed text) and the ask can go. Shared by an option click and Enter in the typed-answer field. */
export function nextUnansweredQuestion(
    questions: AgentAskQuestion[],
    selections: Record<number, Set<number>>,
    texts: Record<number, string>,
    qi: number
): number {
    return questions.findIndex(
        (_, j) => j !== qi && (selections[j]?.size ?? 0) === 0 && (texts[j] ?? "").trim() === ""
    );
}

/** Pure: whether the agent has a structured ask (with options) to answer. The amber "asking" status and
 *  a structured ask are decoupled — the reporter can mark an agent "waiting" for a plain-text question
 *  (e.g. "Proceed? (yes/no)") that never produced an AskUserQuestion payload. Drives the choice between
 *  the option-picker AnswerBar (true) and the free-text composer (false); without it an asking agent
 *  with no questions would show neither. */
export function hasAnswerableAsk(agent: AgentVM): boolean {
    return (agent.ask?.questions?.length ?? 0) > 0;
}

/** Pure: the identity of an agent's *current ask* — the stable per-ask id, NOT the block oref (which is
 *  reused across successive asks from the same block). Single source for "which ask was answered", so a
 *  second ask from the same agent is never locked by the first. Undefined when the agent is not asking. */
export function askSentKey(agent: AgentVM): string | undefined {
    return agent.ask?.askId;
}

/** Pure: a working agent is "quiet" when no new narration has arrived for thresholdMs. */
export function isQuiet(lastActivityMs: number | undefined, now: number, thresholdMs = 45_000): boolean {
    return lastActivityMs != null && now - lastActivityMs > thresholdMs;
}

/** Single source of truth for how long a just-finished agent keeps its full panel (so you can
 *  reply) before it collapses into the Idle list. */
export const IDLE_GRACE_MS = 300_000;

/** Pure: a just-finished idle agent still warrants a full panel until graceMs after it went idle.
 *  False for non-idle agents, those past the window, or those with no idleSince. */
export function isRecentlyIdle(agent: AgentVM, now: number, graceMs = IDLE_GRACE_MS): boolean {
    return agent.state === "idle" && agent.idleSince != null && now - agent.idleSince < graceMs;
}

/** pure: agents whose transcript should stay streamed into the cockpit panel. just-finished
 *  agents keep rendering during the idle grace window, so their stream stays open too; otherwise a
 *  fast final Codex/Claude write can race the stop event and never reach the panel. */
export function streamableTranscriptAgents(agents: AgentVM[], now: number): AgentVM[] {
    return agents.filter(
        (a) => a.transcriptPath && (a.state === "asking" || a.state === "working" || isRecentlyIdle(a, now))
    );
}

/** Pure: overlay a pending ask onto an agent. A live ask makes the agent `asking` regardless of
 *  the reporter's status (a blocked AskCommand RPC may still report "working"); blockedMs is
 *  derived from now - ask.ts. A null/cleared ask leaves the agent untouched. */
/** Pure: a pending ask is stale once the agent has demonstrably resumed — a working status update
 *  materially newer than the ask. Idle deliberately does NOT trigger: the pi prose bridge raises its
 *  ask at agent_settled, the same moment the status reporter emits its settle-idle, so a same-tick
 *  idle would kill every prose card before it renders. Working gets the same grace: the pi status
 *  reporter's message_end + tool_execution_start RPCs land in the same instant as the ask mirror RPC
 *  (a sub-second race), so without ASK_STALE_GRACE_MS every pi card dies before it renders. Real
 *  "moved on" signals arrive after the ask's tool completes (seconds later, when the clear fires).
 *  The PostToolUse/next-agent_start clear hook is the fast path; this is the fallback. */
export const ASK_STALE_GRACE_MS = 2000;
export function isAskStale(askTs: number | undefined, statusTs: number | undefined, statusState: string): boolean {
    if (askTs == null || statusTs == null) {
        return false;
    }
    if (statusState !== "working") {
        return false;
    }
    return statusTs - askTs > ASK_STALE_GRACE_MS;
}

/** Pure: wire ask questions (lowercase Go json tags) in the view model's shape. Shared by the session ask
 *  and the dag child-ask card, so both render one question shape. */
export function toAskQuestions(questions: AgentAskData["questions"]): AgentAskQuestion[] {
    return (questions ?? []).map((q) => ({
        question: q.question,
        header: q.header,
        multiSelect: q.multiselect,
        options: q.options?.map((o) => ({ label: o.label, description: o.description, preview: o.preview })),
    }));
}

export function withAsk(vm: AgentVM, ask: AgentAskData | null, now: number): AgentVM {
    if (ask == null || ask.cleared) {
        return vm;
    }
    return {
        ...vm,
        state: "asking",
        activeMs: undefined,
        blockedMs: ask.ts != null ? Math.max(0, now - ask.ts) : vm.blockedMs,
        ask: {
            questions: toAskQuestions(ask.questions),
            askId: ask.askid,
            oref: ask.oref,
            prose: ask.prose,
            note: ask.note,
        },
    };
}

export interface ProjectInfo {
    name: string;
    agentCount: number;
    askingCount: number;
}

/** Pure: an agent's project — the explicit `project` field if set, else derived from its transcript
 *  path. The derivation is lossy (last hyphen segment only), so an explicit field is the only way to
 *  carry hyphenated names like "payments-api". Single source for every project read in the cockpit. */
export function projectOf(a: AgentVM): string {
    return a.project || projectNameFromTranscriptPath(a.transcriptPath ?? "");
}

/** Pure: distinct projects across agents, each with its agent + asking counts.
 *  Agents with no resolvable project name are skipped. Sorted by project name. */
export function projectsFromAgents(agents: AgentVM[]): ProjectInfo[] {
    const byName = new Map<string, ProjectInfo>();
    for (const a of agents) {
        const name = projectOf(a);
        if (!name) {
            continue;
        }
        const cur = byName.get(name) ?? { name, agentCount: 0, askingCount: 0 };
        cur.agentCount++;
        if (a.state === "asking") {
            cur.askingCount++;
        }
        byName.set(name, cur);
    }
    return [...byName.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/** Pure: does an agent fall within the current project scope? "all" matches everything. */
export function matchesProjectFilter(agent: AgentVM, filter: string): boolean {
    if (filter === "all") {
        return true;
    }
    return projectOf(agent) === filter;
}

/** Pure: apply the project scope + live-only (hide idle) filters, preserving input order. The chip
 *  filter is applied separately by the caller so the live-section counts can ignore it. */
export function filterAgents(agents: AgentVM[], projectFilter: string, liveOnly: boolean): AgentVM[] {
    return agents.filter((a) => matchesProjectFilter(a, projectFilter) && (!liveOnly || a.state !== "idle"));
}

/** Pure: the highest reported 5-hour plan pct across agents, or undefined if none report one. */
export function topFiveHourPct(agents: AgentVM[]): number | undefined {
    let top: number | undefined;
    for (const a of agents) {
        const p = a.usage?.fivehourpct;
        if (p == null) {
            continue;
        }
        if (top == null || p > top) {
            top = p;
        }
    }
    return top;
}

// --- card data types --------------------------------------------------------
// Real sources: diff stats from cardgitstore.ts (GitChangesCommand per card); task list from the
// transcript's latest TodoWrite (transcriptprojection.extractTasks, streamed via
// livetranscript.tasksByIdAtom).

export interface DiffStats {
    files: number;
    adds: number;
    dels: number;
}

export interface CardTask {
    text: string;
    done: boolean;
}

/** Pure: done/total/percent for a task list. */
export function taskProgress(tasks: CardTask[]): { done: number; total: number; pct: number } {
    const total = tasks.length;
    const done = tasks.filter((t) => t.done).length;
    return { done, total, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** A just-launched agent that doesn't exist in the roster yet (the reporter hasn't emitted a status).
 *  `tabId` is the session tab we created — the SAME id the real roster row will use (`row.tabId`),
 *  so supersede needs no id migration. */
export interface PendingLaunch {
    tabId: string;
    blockId: string;
    name: string;
    project: string;
    ts: number; // launch time (UnixMilli) — drives the booting row's age
}

/** Pure: a pending launch -> a "booting" working AgentVM. No transcriptPath (none exists yet); the
 *  Agent surface shows its live terminal until the real row arrives. */
export function pendingToVM(p: PendingLaunch, now: number): AgentVM {
    return {
        id: p.tabId,
        name: p.name,
        task: "",
        state: "working",
        project: p.project,
        blockId: p.blockId,
        activeMs: Math.max(0, now - p.ts),
    };
}

/** Pure: overlay booting launches onto the base roster. A pending entry whose tabId already exists in
 *  base is dropped (the real row supersedes it). Never mutates input. */
export function mergePendingLaunches(base: AgentVM[], pending: PendingLaunch[], now: number): AgentVM[] {
    const baseIds = new Set(base.map((a) => a.id));
    const overlay = pending.filter((p) => !baseIds.has(p.tabId)).map((p) => pendingToVM(p, now));
    return [...base, ...overlay];
}

/** Pure: one `claude agents --json` entry -> an AgentVM in the background lane. `blocked` (parked on
 *  input) maps to working + needsInput so it reads as live and flags for attention; `idle` stays idle;
 *  everything else is working. id IS the sessionId (the resume target); no transcriptPath/blockId
 *  exists for a detached agent, so it never enters the transcript-stream or block-input paths. */
export function backgroundAgentToVM(bg: BackgroundAgentData, projectName: string, now: number): AgentVM {
    const state: AgentState = bg.state === "idle" ? "idle" : "working";
    return {
        id: bg.sessionid,
        name: bg.name || "background agent",
        task: "",
        state,
        kind: "background",
        agent: "claude",
        project: projectName,
        cwd: bg.cwd,
        needsInput: bg.state === "blocked",
        activeMs: bg.startedts ? Math.max(0, now - bg.startedts) : undefined,
    };
}

/** Pure: drop background agents that are already tracked as live hook-fed agents. A live agent's
 *  session id is the stem of its transcript filename (sessionIdFromTranscript); a background agent's
 *  id IS its session id. Same id => same session => show it once (the live, richer one wins). */
export function dedupBackgroundAgents(background: AgentVM[], liveAgents: AgentVM[]): AgentVM[] {
    const liveSessionIds = new Set(liveAgents.map((a) => sessionIdFromTranscript(a.transcriptPath)).filter(Boolean));
    return background.filter((b) => !liveSessionIds.has(b.id));
}
