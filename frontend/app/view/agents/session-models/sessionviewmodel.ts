// Pure view-model logic for the session sidebar. No React, no Wave runtime imports.

import { versionAfter } from "../modellabel";

export const NO_CWD_LABEL = "ungrouped";

export type SessionStatus = "working" | "waiting" | "asking" | "idle";

/** Pure: a status that means "needs the human" — a pending question (asking) or a nudge (waiting).
 *  Both get the amber dot, mark the row blocked, and are targeted by the needs-you navigation. */
export function isNeedsYou(status: SessionStatus): boolean {
    return status === "asking" || status === "waiting";
}

export type SubagentState = "working" | "success" | "failure" | "done";

export interface SubagentVM {
    id: string;
    type: string;
    state: SubagentState;
    model?: string;
    transcriptPath?: string; // disk-backed source: the child's own transcript file (undefined for the legacy hook path)
}

// Couples to the Phase 0 reporter's color constants. Phase 2 replaces this with an explicit
// `state` field carried by the `wsh agentstatus` event.
export const COLOR_WORKING = "#3fb950";
export const COLOR_WAITING = "#d29922";

/** Map a tab's primary badge (set by the Phase 0 reporter) to a status. */
export function badgeToStatus(badge?: { color?: string } | null): SessionStatus {
    const color = badge?.color?.toLowerCase();
    if (color === COLOR_WORKING) {
        return "working";
    }
    if (color === COLOR_WAITING) {
        return "waiting";
    }
    return "idle";
}

/** Priority for a collapsed group's aggregate dot: asking > waiting > working > idle. */
export function aggregateStatus(statuses: SessionStatus[]): SessionStatus {
    if (statuses.includes("asking")) {
        return "asking";
    }
    if (statuses.includes("waiting")) {
        return "waiting";
    }
    if (statuses.includes("working")) {
        return "working";
    }
    return "idle";
}

/** Per-tab data collected by the container atom and fed to the builder. */
export interface SessionInput {
    tabId: string;
    name: string;
    agent?: string;
    customLabel?: string;
    title?: string; // agent ai-title (task summary): auto label between customLabel and agent
    projectLabel?: string; // launch-time project name: a non-sticky default below title, above the agent name
    runORef?: string; // jarvis:runoref, stamped on a run's lead and worker tabs at spawn
    effortORef?: string; // session:effort, the initiative the session was launched from or last touched
    pinned: boolean;
    isAgentsTab?: boolean;
    cwd?: string;
    serviceLabel: string;
    status: SessionStatus;
    detail?: string;
    model?: string;
    subagents?: SubagentVM[];
    subagentsExpanded?: boolean;
    termBlockOref?: string;
    active: boolean;
}

export interface SessionRowVM {
    tabId: string;
    label: string;
    customLabel?: string;
    projectLabel?: string; // launch-time project name; the roster groups by this (not the lossy transcript-path derivation)
    cwd?: string; // the session terminal's cwd; resolves the registered project the agent works in
    runORef?: string; // the run this session works for: a lead's own run, a worker's child run
    effortORef?: string; // the initiative this session works on
    agent?: string; // session:agent runtime (claude/codex/…); undefined for plain terminals
    status: SessionStatus;
    active: boolean;
    blocked: boolean;
    pinned: boolean;
    isAgentsTab?: boolean;
    detail?: string;
    model?: string;
    subagents: SubagentVM[];
    subagentsExpanded: boolean;
    termBlockOref?: string;
}

export interface SessionGroupVM {
    label: string;
    sessions: SessionRowVM[];
    aggregateStatus: SessionStatus;
}

export interface SidebarViewModel {
    pinned: SessionRowVM[];
    groups: SessionGroupVM[];
}

export interface ResolvedSessionBlock {
    blockId: string;
    block: Block | null | undefined;
}

export interface SessionTermBlock {
    blockId: string;
    cwd: string;
    meta: Record<string, any>;
}

/** Pure: the first terminal block carrying the cwd that defines a session's identity. */
export function findSessionTermBlock(blocks: ResolvedSessionBlock[]): SessionTermBlock | undefined {
    for (const { blockId, block } of blocks) {
        const meta = block?.meta;
        const cwd = meta?.["cmd:cwd"];
        if (meta?.view === "term" && typeof cwd === "string" && cwd.length > 0) {
            return { blockId, cwd, meta };
        }
    }
    return undefined;
}

/** Pure: the run a session works for. The engine stamps jarvis:runoref on the tab only after the tab has reached
 *  the app, and that write is not broadcast, so a freshly spawned worker or reviewer would read as a plain agent
 *  until a reload. Its terminal block's agent:runid is set before the tab is sent, so it stands in. */
export function sessionRunORef(
    tabMeta: Record<string, any>,
    termMeta: Record<string, any> | undefined
): string | undefined {
    const runId = termMeta?.["agent:runid"];
    return tabMeta["jarvis:runoref"] || (typeof runId === "string" && runId ? `run:${runId}` : undefined);
}

/** Pure: is this submitted rename worth a write? Both sides trim, so retyping the same name is a
 *  no-op. An empty draft is NOT automatically a no-op: against an existing custom label it is the
 *  clear gesture (renameSession writes null and rowLabel falls back to the auto label), and only
 *  against no custom label at all does it mean "nothing happened". */
export function labelChanged(draft: string, current: string | undefined): boolean {
    return draft.trim() !== (current ?? "").trim();
}

/** Pure: a session's auto title. The live status carries the ai-title its hook read; a sleeping agent has no process to
 *  report one (its exit publishes a bare idle, and a restart leaves it no status at all), and codex reports none, so the
 *  title the Conversations archive scanned from the same transcript stands in. The archive holds only the newest
 *  sessions, so for an agent asleep behind more of them the title read from its own transcript's tail does
 *  (sleepertitles.ts). */
export function sessionTitle(
    statusTitle: string | undefined,
    scannedTask: string | undefined,
    transcriptTitle?: string
): string | undefined {
    return statusTitle || scannedTask || transcriptTitle || undefined;
}

function rowLabel(s: SessionInput, includeService: boolean): string {
    const custom = s.customLabel && s.customLabel.length > 0 ? s.customLabel : undefined;
    const title = s.title && s.title.trim().length > 0 ? s.title.trim() : undefined;
    const project = s.projectLabel && s.projectLabel.trim().length > 0 ? s.projectLabel.trim() : undefined;
    const agent = s.agent && s.agent.length > 0 ? s.agent : s.name;
    const base = custom ?? title ?? project ?? (agent && agent.length > 0 ? agent : "session");
    return includeService && !s.isAgentsTab ? `${base} · ${s.serviceLabel}` : base;
}

function toRow(s: SessionInput, includeService: boolean): SessionRowVM {
    const subagents = s.subagents ?? [];
    const status = rollUpStatus(s.status, subagents);
    return {
        tabId: s.tabId,
        label: rowLabel(s, includeService),
        customLabel: s.customLabel,
        projectLabel: s.projectLabel,
        cwd: s.cwd,
        runORef: s.runORef,
        effortORef: s.effortORef,
        agent: s.agent,
        status,
        active: s.active,
        blocked: isNeedsYou(status),
        pinned: s.pinned,
        isAgentsTab: s.isAgentsTab ?? false,
        detail: s.detail,
        model: s.model,
        subagents,
        subagentsExpanded: s.subagentsExpanded ?? false,
        termBlockOref: s.termBlockOref,
    };
}

/** Pure: ordered session inputs -> pinned group + service groups (first-appearance order). */
export function buildSessionViewModel(sessions: SessionInput[]): SidebarViewModel {
    const pinned: SessionRowVM[] = [];
    const groupOrder: string[] = [];
    const groupMap = new Map<string, SessionInput[]>();

    for (const s of sessions) {
        if (s.pinned) {
            pinned.push(toRow(s, true));
            continue;
        }
        const label = s.serviceLabel;
        if (!groupMap.has(label)) {
            groupMap.set(label, []);
            groupOrder.push(label);
        }
        groupMap.get(label)!.push(s);
    }

    const groups: SessionGroupVM[] = groupOrder.map((label) => {
        const rows = groupMap.get(label)!.map((s) => toRow(s, false));
        return { label, sessions: rows, aggregateStatus: aggregateStatus(rows.map((r) => r.status)) };
    });

    return { pinned, groups };
}

/** Phase 1 grouping: the last path segment of the terminal cwd (Phase 2 replaces this with the marker walk-up RPC). */
export function cwdToServiceLabel(cwd?: string): string {
    if (!cwd) {
        return NO_CWD_LABEL;
    }
    const trimmed = cwd.replace(/[\\/]+$/, "");
    const segments = trimmed.split(/[\\/]+/);
    const last = segments[segments.length - 1];
    return last && last.length > 0 ? last : NO_CWD_LABEL;
}

/** Pure: add the label if absent, remove it if present. Never mutates the input. */
export function toggleCollapsed(groups: string[], label: string): string[] {
    return groups.includes(label) ? groups.filter((g) => g !== label) : [...groups, label];
}

/** Sidebar visual order: pinned rows first, then each group's rows top-to-bottom. */
export function flattenVisualOrder(vm: SidebarViewModel): SessionRowVM[] {
    return [...vm.pinned, ...vm.groups.flatMap((g) => g.sessions)];
}

/** Pure: move draggedId before/after targetId within a single group, rewriting only the slots the
 *  group occupies in tabids — so group order (first-appearance) and every other group are left
 *  byte-for-byte identical. Returns the input array (same ref) on a no-op or when either id is not a
 *  member of the group. Reorders the Pinned group too (members = the pinned tabIds). */
export function reorderWithinGroup(
    tabids: string[],
    memberIds: string[],
    draggedId: string,
    targetId: string,
    placeBefore: boolean
): string[] {
    if (draggedId === targetId) {
        return tabids;
    }
    if (!memberIds.includes(draggedId) || !memberIds.includes(targetId)) {
        return tabids;
    }
    const without = memberIds.filter((id) => id !== draggedId);
    const targetIdx = without.indexOf(targetId);
    const insertAt = placeBefore ? targetIdx : targetIdx + 1;
    const newOrder = [...without.slice(0, insertAt), draggedId, ...without.slice(insertAt)];
    const slots = memberIds.map((id) => tabids.indexOf(id)).sort((a, b) => a - b);
    const result = [...tabids];
    slots.forEach((slot, i) => {
        result[slot] = newOrder[i];
    });
    return result;
}

/** Pure: the tabId to switch to when cycling by offset (+1 next, -1 prev) in visual order, wrapping. */
export function cycleTarget(vm: SidebarViewModel, offset: number): string | undefined {
    const order = flattenVisualOrder(vm);
    if (order.length === 0) {
        return undefined;
    }
    const activeIdx = order.findIndex((r) => r.active);
    // no active row: next starts at the top, prev at the bottom
    const base = activeIdx === -1 ? (offset > 0 ? -1 : 0) : activeIdx;
    const nextIdx = (base + offset + order.length) % order.length;
    return order[nextIdx].tabId;
}

/** Pure: the next/prev waiting session relative to the active one in visual order, wrapping.
 *  offset +1 scans forward, -1 scans backward. */
export function waitingTarget(vm: SidebarViewModel, offset: number): string | undefined {
    const order = flattenVisualOrder(vm);
    if (order.length === 0) {
        return undefined;
    }
    const activeIdx = order.findIndex((r) => r.active);
    for (let i = 1; i <= order.length; i++) {
        // double-mod normalizes a possibly-negative index (offset -1) back into [0, len)
        const idx = (((activeIdx + offset * i) % order.length) + order.length) % order.length;
        if (isNeedsYou(order[idx].status)) {
            return order[idx].tabId;
        }
    }
    return undefined;
}

/** Pure: the next waiting (needs-you) session after the active one in visual order, wrapping. */
export function needsYouTarget(vm: SidebarViewModel): string | undefined {
    return waitingTarget(vm, 1);
}

/** Pure: the row's dot reflects children — the parent's own needs-you state (amber) dominates;
 *  otherwise any working child lifts an idle/working parent to working. */
export function rollUpStatus(parent: SessionStatus, subagents: SubagentVM[]): SessionStatus {
    if (isNeedsYou(parent)) {
        return parent;
    }
    if (subagents.some((s) => s.state === "working")) {
        return "working";
    }
    return parent;
}

/** Pure: the subagents the tree still shows — those still working or that failed (need attention).
 *  Children that finished cleanly (success) or terminated with unknown outcome (done) are dropped so
 *  a completed fan-out doesn't linger. Never mutates input. */
export function visibleSubagents(subagents: SubagentVM[]): SubagentVM[] {
    return subagents.filter((s) => s.state === "working" || s.state === "failure");
}

/** Pure: auto-expand while a child is working; a manual override (set this turn) wins.
 *  An empty list is never expanded (nothing to show). */
export function subagentExpanded(subagents: SubagentVM[], manualOverride?: boolean): boolean {
    if (subagents.length === 0) {
        return false;
    }
    if (manualOverride != null) {
        return manualOverride;
    }
    return subagents.some((s) => s.state === "working");
}

const MODEL_FAMILIES = ["opus", "sonnet", "haiku", "fable"];

/** Pure: a raw model id (e.g. "claude-opus-5-5") -> the family and its version for the row tag ("opus 5.5"), read
 *  as prettyModel reads it; a bare alias ("sonnet") stays the family alone. Unknown ids fall back to the id with a
 *  leading "claude-" stripped. Empty input -> "". */
export function modelLabel(modelId?: string): string {
    if (!modelId) {
        return "";
    }
    const lower = modelId.toLowerCase();
    for (const fam of MODEL_FAMILIES) {
        if (lower.includes(fam)) {
            return fam + versionAfter(lower, fam);
        }
    }
    return modelId.replace(/^claude-/i, "");
}

export const DEFAULT_LOOM_BIN = "loom";

// A blank app:loombin value ("" / whitespace) is not null, so it slips past ?? at the call site;
// trim-and-check here so a blank config still falls back to the PATH lookup.
export function loomBinOrDefault(configVal?: string): string {
    const trimmed = configVal?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_LOOM_BIN;
}

/** Launch-relevant block meta keys copied from a source terminal block to reproduce its session in a clone.
 *  cmd:shell/cmd:jwt are agent launch flags — dropping them would relaunch the clone without the
 *  injected JWT env (WAVETERM_JWT/BLOCKID), silently killing agent-status reporting; agent:baseargs
 *  keeps resume-on-reopen working for the clone. */
const DUPLICATE_META_KEYS = [
    "controller",
    "cmd",
    "cmd:args",
    "cmd:cwd",
    "cmd:interactive",
    "connection",
    "cmd:shell",
    "cmd:jwt",
    "agent:baseargs",
];

/** Pure: build the new block-def meta for a duplicated session from the source term block's meta.
 *  Always a terminal; copies only the launch-relevant keys that are present on the source so the clone
 *  reproduces exactly how the source was started (agent re-launches; a plain shell stays a shell in the cwd). */
export function buildDuplicateBlockMeta(sourceMeta: Record<string, any>): Record<string, any> {
    const meta: Record<string, any> = { view: "term" };
    for (const key of DUPLICATE_META_KEYS) {
        if (sourceMeta?.[key] != null) {
            meta[key] = sourceMeta[key];
        }
    }
    return meta;
}
