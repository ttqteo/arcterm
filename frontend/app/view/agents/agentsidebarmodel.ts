// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Agent surface's sidebar once it carries conversations as well as live agents. Two sections. Active
// holds the live agents as the tree builds them (agenttreemodel.ts: one collapsible folder per project). Conversations
// is a flat list of every ended session across projects, newest first, each row naming its project; a project filter
// narrows it and "Show more" pages it (20 per press). Live and ended never mix: a live agent and its session record are
// one row, in Active, joined by normalized transcript path (overlayLive), and a session an orchestrator run launched is
// not listed, since the run's own done fold already holds it (History still shows it, grouped by run). Status filters
// live in History only. No React. It imports overlayLive from sessionsarchivestore, which pulls in the RPC client and
// the store; nothing here calls either.

import { formatAgeShort, projectOf, type AgentVM } from "./agentsviewmodel";
import { foldCollapsedProjects, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { overlayLive, type LiveSession } from "./sessionsarchivestore";
import { sessionKey } from "./sessionsruns";

export const CONVERSATION_PAGE = 20;
// the project filter's value for no filter
export const ALL_PROJECTS = "all";
export const UNTITLED_SESSION = "(untitled session)";

// an ended session, with the project it is filed under
export interface EndedSessionRow {
    kind: "session";
    project: string;
    key: string; // sessionKey: the value sessionsSelAtom takes to read it
    title: string; // the first human prompt, on one line
    tooltip: string; // the full prompt, for the row's title attribute
    lastactivets: number;
    session: LiveSession;
}

// "Show more" at the end of the Conversations list, counting the conversations still hidden
export interface MoreConversationsRow {
    kind: "more";
    hidden: number;
}

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

// the registered projects (projects.json), as the config atom holds them: name -> { path }
export type ProjectRegistry = Readonly<Record<string, { path?: string }>>;

function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// A Claude Code transcript lives in <home>/.claude/projects/<encoded-cwd>/<id>.jsonl, so its folder is one working
// directory. "" for any other layout: codex keeps one folder per day for every project, so two transcripts sharing it
// say nothing about sharing a project.
function claudeTranscriptFolder(path: string | undefined): string {
    if (!path) {
        return "";
    }
    const parts = normPath(path).split("/");
    const at = parts.lastIndexOf("projects");
    return at >= 0 && at + 3 === parts.length ? parts.slice(0, at + 2).join("/") : "";
}

/** Pure: how the sidebar names the project of each ended session, so that it is the folder its live agents are in. The
 *  tree files an agent under projectOf (the registered name it was launched into, else the last hyphen segment of its
 *  transcript folder), while the scan names a session for the last segment of its cwd, which differs whenever a
 *  project is registered under another name or its folder has a hyphen. In order: the project of a live agent writing
 *  into the session's own transcript folder (the agent's folder is where the eye is, though its name is the lossy one);
 *  the registered project at the session's path; the scan's own name. */
function projectKeyResolver(roster: AgentVM[], registered: ProjectRegistry): (s: SessionActivity) => string {
    const byFolder = new Map<string, string>();
    for (const a of roster) {
        const folder = claudeTranscriptFolder(a.transcriptPath);
        if (folder && !byFolder.has(folder)) {
            byFolder.set(folder, projectOf(a) || UNGROUPED_PROJECT);
        }
    }
    const byPath = new Map<string, string>();
    for (const [name, project] of Object.entries(registered)) {
        const path = project?.path ? normPath(project.path) : "";
        if (path && !byPath.has(path)) {
            byPath.set(path, name);
        }
    }
    return (s) =>
        byFolder.get(claudeTranscriptFolder(s.transcriptpath)) ??
        byPath.get(normPath(s.projectpath ?? "")) ??
        (s.projectname || UNGROUPED_PROJECT);
}

/** Pure: the archive's ended, non-run sessions by project (see projectKeyResolver: the project a live agent of it is
 *  filed under, else "ungrouped"), newest first, equal times in key order. `base` is null until the scan loads. A
 *  session a roster agent is writing the transcript of is live, so it is that agent's row and not an ended one. */
export function endedSessionsByProject(
    base: SessionActivity[] | null,
    roster: AgentVM[],
    registered: ProjectRegistry = {}
): Map<string, EndedSessionRow[]> {
    const out = new Map<string, EndedSessionRow[]>();
    if (base == null) {
        return out;
    }
    const projectKey = projectKeyResolver(roster, registered);
    // overlayLive's third argument (`now`) is unused, so 0 stands in for it
    for (const s of overlayLive(base, roster, 0)) {
        if (s.live || s.runid) {
            continue;
        }
        const project = projectKey(s);
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

/** Pure: the Active section's rows, `rows` being buildAgentTree's output (a group row, then that project's agent rows).
 *  A collapsed project keeps its group row, which carries the count and attention of what it hides, and loses the rows
 *  under it. */
export function activeRows(rows: AgentTreeRow[], collapsed: ReadonlySet<string>): AgentTreeRow[] {
    return foldCollapsedProjects(rows, collapsed);
}

/** Pure: the projects the Conversations filter offers, those with at least one ended conversation, the one with the
 *  newest conversation first (equal times in name order). */
export function conversationProjects(ended: ReadonlyMap<string, EndedSessionRow[]>): string[] {
    const newest = new Map<string, number>();
    for (const [project, list] of ended) {
        if (list.length > 0) {
            let latest = -Infinity;
            for (const r of list) {
                latest = Math.max(latest, r.lastactivets);
            }
            newest.set(project, latest);
        }
    }
    return [...newest.keys()].sort((a, b) => newest.get(b) - newest.get(a) || byText(a, b));
}

/** Pure: the filter that applies. A chosen project with no ended conversation left (its last one was resumed, or fell
 *  out of the scan's window) no longer filters, so the list is never stuck empty behind a project the menu does not
 *  offer. `projects` is conversationProjects' list, empty until the scan has loaded. */
export function effectiveProject(chosen: string, projects: readonly string[]): string {
    return chosen === ALL_PROJECTS || projects.includes(chosen) ? chosen : ALL_PROJECTS;
}

/** Pure: the Conversations list. The ended sessions of `project` (all of them for ALL_PROJECTS), newest first across
 *  projects and equal times in key order, the first CONVERSATION_PAGE of them plus one page per "Show more" press, then
 *  a more row counting what is still hidden. */
export function conversationRows(
    ended: ReadonlyMap<string, EndedSessionRow[]>,
    project: string,
    presses: number
): (EndedSessionRow | MoreConversationsRow)[] {
    const all: EndedSessionRow[] = [];
    if (project === ALL_PROJECTS) {
        for (const list of ended.values()) {
            all.push(...list);
        }
    } else {
        all.push(...(ended.get(project) ?? []));
    }
    all.sort((a, b) => b.lastactivets - a.lastactivets || byText(a.key, b.key));
    const shown = all.slice(0, CONVERSATION_PAGE * (1 + Math.max(0, presses)));
    const hidden = all.length - shown.length;
    return hidden > 0 ? [...shown, { kind: "more", hidden }] : shown;
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
