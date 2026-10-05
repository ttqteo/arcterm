// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Agent surface's sidebar once it carries conversations as well as live agents. Each project is
// a folder: its live agents (agenttreemodel.ts), then up to five ended sessions, then "Show more" (five per press).
// A live agent and its session record are one row, joined by normalized transcript path (overlayLive); a session an
// orchestrator run launched is not listed, since the run's own done fold already holds it (History still shows it,
// grouped by run). Status filters live in History only. No React. It imports overlayLive from sessionsarchivestore,
// which pulls in the RPC client and the store; nothing here calls either.

import { formatAgeShort, type AgentVM } from "./agentsviewmodel";
import { UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { overlayLive, type LiveSession } from "./sessionsarchivestore";
import { sessionKey } from "./sessionsruns";

export const SESSION_PAGE = 5;
export const UNTITLED_SESSION = "(untitled session)";

// an ended session under its project
export interface EndedSessionRow {
    kind: "session";
    project: string;
    key: string; // sessionKey: the value sessionsSelAtom takes to read it
    title: string; // the first human prompt, on one line
    tooltip: string; // the full prompt, for the row's title attribute
    lastactivets: number;
    session: LiveSession;
}

// "Show more" under a project whose ended sessions do not all fit yet
export interface MoreSessionsRow {
    kind: "more";
    project: string;
    hidden: number;
}

export type SidebarRow = AgentTreeRow | EndedSessionRow | MoreSessionsRow;

// a total order on strings (code units, not locale), so a tie broken by it never depends on the input's order
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pure: a session's title, its first prompt (the scan already trims it) with whitespace collapsed to one line. */
export function sessionTitle(task: string): string {
    return task.replace(/\s+/g, " ").trim() || UNTITLED_SESSION;
}

/** Pure: how long ago a session last moved, as the tree's other rows read ("<1m", "16m", "3h", "3d"). */
export function sessionAgeLabel(lastactivets: number, now: number): string {
    return formatAgeShort(Math.max(0, now - lastactivets));
}

/** Pure: the archive's ended, non-run sessions by project (an agent's own project name, else "ungrouped"), newest
 *  first, equal times in key order. `base` is null until the scan loads. A session a roster agent is writing the
 *  transcript of is live, so it is that agent's row and not an ended one. */
export function endedSessionsByProject(
    base: SessionActivity[] | null,
    roster: AgentVM[]
): Map<string, EndedSessionRow[]> {
    const out = new Map<string, EndedSessionRow[]>();
    if (base == null) {
        return out;
    }
    // overlayLive's third argument (`now`) is unused, so 0 stands in for it
    for (const s of overlayLive(base, roster, 0)) {
        if (s.live || s.runid) {
            continue;
        }
        const project = s.projectname || UNGROUPED_PROJECT;
        const row: EndedSessionRow = {
            kind: "session",
            project,
            key: sessionKey(s),
            title: sessionTitle(s.task),
            tooltip: s.task.trim() || UNTITLED_SESSION,
            lastactivets: s.lastactivets,
            session: s,
        };
        const list = out.get(project);
        if (list == null) {
            out.set(project, [row]);
        } else {
            list.push(row);
        }
    }
    for (const list of out.values()) {
        list.sort((a, b) => b.lastactivets - a.lastactivets || byText(a.key, b.key));
    }
    return out;
}

// presses so far under a project; an own-property read, since a project can be named "constructor" or "toString"
function pressesOf(project: string, pages: Readonly<Record<string, number>>): number {
    return Object.prototype.hasOwnProperty.call(pages, project) ? pages[project] : 0;
}

/** Pure: how many ended sessions a project shows, given how many times "Show more" was pressed under it. */
export function visibleCount(project: string, pages: Readonly<Record<string, number>>): number {
    return SESSION_PAGE * (1 + pressesOf(project, pages));
}

/** Pure: the pages map after one more "Show more" press under `project`. */
export function showMore(pages: Readonly<Record<string, number>>, project: string): Record<string, number> {
    return { ...pages, [project]: pressesOf(project, pages) + 1 };
}

function sessionRowsOf(
    project: string,
    list: EndedSessionRow[],
    pages: Readonly<Record<string, number>>
): SidebarRow[] {
    const shown = list.slice(0, visibleCount(project, pages));
    const hidden = list.length - shown.length;
    return hidden > 0 ? [...shown, { kind: "more", project, hidden }] : shown;
}

/** Pure: the sidebar's rows. `rows` is buildAgentTree's output (a group row, then that project's agent rows);
 *  `ended` is endedSessionsByProject's, each list newest first. Each project's ended sessions follow its last agent
 *  row, and a project with ended sessions but no live agent gets a folder of its own after the live ones, newest
 *  conversation first (equal times in project-name order). A collapsed project keeps its group row and loses
 *  everything under it, agents and sessions alike. */
export function buildSidebarRows(
    rows: AgentTreeRow[],
    ended: ReadonlyMap<string, EndedSessionRow[]>,
    collapsed: ReadonlySet<string>,
    pages: Readonly<Record<string, number>>
): SidebarRow[] {
    const out: SidebarRow[] = [];
    const placed = new Set<string>();
    let project: string | null = null;
    const flush = () => {
        if (project != null && !collapsed.has(project)) {
            out.push(...sessionRowsOf(project, ended.get(project) ?? [], pages));
        }
    };
    for (const r of rows) {
        if (r.kind === "group") {
            flush();
            project = r.project;
            placed.add(r.project);
            out.push(r);
        } else if (project != null && !collapsed.has(project)) {
            out.push(r);
        }
    }
    flush();
    const agentless = [...ended.entries()]
        .filter(([p, list]) => !placed.has(p) && list.length > 0)
        .sort(([pa, a], [pb, b]) => b[0].lastactivets - a[0].lastactivets || byText(pa, pb));
    for (const [p, list] of agentless) {
        out.push({ kind: "group", project: p, count: 0, attn: 0 });
        if (!collapsed.has(p)) {
            out.push(...sessionRowsOf(p, list, pages));
        }
    }
    return out;
}

/** Pure: did an agent leave the roster between two snapshots of its ids? Its session just ended, so the sidebar
 *  rescans. */
export function agentExited(prev: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
    for (const id of prev) {
        if (!next.has(id)) {
            return true;
        }
    }
    return false;
}

export type ScanReason = "enter" | "exit";

// the scan reads 30 days of transcripts across four runtimes: a quick re-entry must not repeat it
const SCAN_MIN_GAP_MS: Record<ScanReason, number> = { enter: 5_000, exit: 1_000 };

/** Pure: is a sidebar scan due, `lastAt` being when the previous one started (0 for none)? */
export function scanDue(lastAt: number, now: number, reason: ScanReason): boolean {
    return now - lastAt >= SCAN_MIN_GAP_MS[reason];
}
