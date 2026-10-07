// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Agent surface's sidebar once it carries conversations as well as live agents. Three sections, each
// collapsible. Active holds the live agents as the tree builds them (agenttreemodel.ts: one collapsible folder per
// project). Terminals holds the plain shells, a collapsible folder per project. Conversations holds every ended
// session, in a collapsible folder per project (the folder with the newest conversation first, newest first inside
// it, each row reading its own age), and "Show more" pages a folder (CONVERSATION_PAGE per press). The app bar's
// project switcher narrows all three to one project, which then needs no folder: each section is a flat list, and
// Active counts the agents it hides so one asking elsewhere is not lost. Live and ended never mix: a live agent and its session record are one row, in Active, joined by normalized
// transcript path (overlayLive), and the sessions an orchestrator run launched fold into one entry for the run, listed
// once none of them is live (until then the run is in Active). Status filters live in History only. No React. It
// imports overlayLive from sessionsarchivestore, which pulls in the RPC client and the store; nothing here calls
// either.

import { formatAgeShort, projectOf, type AgentVM } from "./agentsviewmodel";
import { foldCollapsedProjects, UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { overlayLive, type LiveSession } from "./sessionsarchivestore";
import { groupRunSessions, memberSession, runSelKey, sessionKey, type RunSessions } from "./sessionsruns";

export const CONVERSATION_PAGE = 10;
// the project filter's value for no filter (the model's projectFilterAtom)
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

// an ended orchestrator run, its sessions folded into one entry; its title and progress come from runView, which needs
// the run's own objects, so the row carries the group they are read for
export interface EndedRunRow {
    kind: "run";
    project: string;
    key: string; // runSelKey: the value sessionsSelAtom takes to open the run in History
    lastactivets: number;
    group: RunSessions;
}

// one entry of the Conversations section: an ended session on its own, or an ended run
export type ConversationEntry = EndedSessionRow | EndedRunRow;

// a project's folder in the Conversations section: its ended conversations, how many of them wait on you, and whether
// it is open
export interface ConversationFolderRow {
    kind: "folder";
    project: string;
    count: number;
    attn: number;
    open: boolean;
}

// "Show more" at the end of a project's folder, counting its conversations still hidden
export interface MoreConversationsRow {
    kind: "more";
    project: string;
    hidden: number;
}

export type ConversationTreeRow = ConversationFolderRow | ConversationEntry | MoreConversationsRow;

// a total order on strings (code units, not locale), so a tie broken by it never depends on the input's order
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Pure: a session's title, its first prompt (the scan already trims it) with whitespace collapsed to one line. */
export function sessionTitle(task: string): string {
    return task.replace(/\s+/g, " ").trim() || UNTITLED_SESSION;
}

/** Pure: the start of the local day `now` falls in, a clock that moves once a day. */
export function startOfDay(now: number): number {
    return new Date(now).setHours(0, 0, 0, 0);
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
 *  the registered project at the session's path; the scan's own name. A path inside an engine worktree reads as the
 *  project checkout the tree was made from (engineWorktreeRoot), for the last two as for the first. */
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
    return (s) => {
        const root = engineWorktreeRoot(s.projectpath ?? "");
        return (
            byFolder.get(claudeTranscriptFolder(s.transcriptpath)) ??
            byPath.get(normPath(root ?? s.projectpath ?? "")) ??
            ((root != null ? root.split("/").pop() : s.projectname) || UNGROUPED_PROJECT)
        );
    };
}

const ENGINE_WORKTREES = "/.waveterm/worktrees/";

// The project checkout an orchestrator worker's working directory belongs to, as the path the session reports: the engine
// runs each task in <project>/.waveterm/worktrees/<run id>-<task> (pkg/orchestrate, runOfWorktree), and the scan names a
// session for the last segment of its cwd, which there is the tree's key. Undefined for a path outside one.
function engineWorktreeRoot(path: string): string | undefined {
    const p = path.replace(/\\/g, "/");
    const at = p.toLowerCase().indexOf(ENGINE_WORKTREES);
    return at > 0 ? p.slice(0, at) : undefined;
}

/** Pure: the archive's ended conversations by project (see projectKeyResolver: the project a live agent of it is filed
 *  under, else "ungrouped"), newest first, equal times in key order. `base` is null until the scan loads. A session a
 *  roster agent is writing the transcript of is live, so it is that agent's row and not an ended one. The sessions of an
 *  orchestrator run are one entry, filed under the project of its lead (else its newest session), and only once none of
 *  them is live: until then the run is in Active. */
export function endedConversationsByProject(
    base: SessionActivity[] | null,
    roster: AgentVM[],
    registered: ProjectRegistry = {}
): Map<string, ConversationEntry[]> {
    const out = new Map<string, ConversationEntry[]>();
    if (base == null) {
        return out;
    }
    const projectKey = projectKeyResolver(roster, registered);
    const add = (row: ConversationEntry) => {
        const list = out.get(row.project);
        if (list == null) {
            out.set(row.project, [row]);
        } else {
            list.push(row);
        }
    };
    // overlayLive's third argument (`now`) is unused, so 0 stands in for it
    const { runs, solos } = groupRunSessions(overlayLive(base, roster, 0));
    for (const s of solos) {
        if (s.live) {
            continue;
        }
        add({
            kind: "session",
            project: projectKey(s),
            key: sessionKey(s),
            title: sessionTitle(s.task),
            tooltip: s.task.trim() || UNTITLED_SESSION,
            lastactivets: s.lastactivets,
            session: s,
        });
    }
    for (const group of runs) {
        if (group.live) {
            continue;
        }
        const newest = [...group.sessions].sort((a, b) => b.lastactivets - a.lastactivets)[0];
        add({
            kind: "run",
            project: projectKey(memberSession(group.lead) ?? newest),
            key: runSelKey(group.runId),
            lastactivets: group.lastactivets,
            group,
        });
    }
    for (const list of out.values()) {
        list.sort((a, b) => b.lastactivets - a.lastactivets || byText(a.key, b.key));
    }
    return out;
}

/** Pure: the sidebar's share of endedConversationsByProject, the folders of projects added to arcterm (the registry's
 *  names), and how many conversations the rest hold: those are Conversation History's alone, so a transcript from a
 *  folder never added does not crowd the sidebar. With nothing registered there is nothing to scope to, so all stay. */
export function registeredConversations(
    ended: ReadonlyMap<string, ConversationEntry[]>,
    registered: ProjectRegistry
): { ended: Map<string, ConversationEntry[]>; elsewhere: number } {
    const names = new Set(Object.keys(registered ?? {}));
    if (names.size === 0) {
        return { ended: new Map(ended), elsewhere: 0 };
    }
    const kept = new Map<string, ConversationEntry[]>();
    let elsewhere = 0;
    for (const [project, list] of ended) {
        if (names.has(project)) {
            kept.set(project, list);
        } else {
            elsewhere += list.length;
        }
    }
    return { ended: kept, elsewhere };
}

export interface ActiveView {
    rows: AgentTreeRow[];
    count: number; // the agents the section holds, for its header; a collapsed folder still counts what it hides
    elsewhere: { agents: number; asking: number }; // what the project filter hides
}

/** Pure: the Active section, `tree` being buildAgentTree's output (a group row, then that project's agent rows).
 *  Unfiltered, a collapsed project keeps its group row, which carries the count and attention of what it hides, and
 *  loses the rows under it. Filtered to a project (the app bar's switcher; strict, as the Cockpit filters, so an agent
 *  with no project is hidden too), the section is that project's rows alone with no group row, so no fold applies,
 *  and `elsewhere` counts the agents of every other group and how many of them are asking. */
export function activeView(tree: AgentTreeRow[], filter: string, collapsed: ReadonlySet<string>): ActiveView {
    const groups = tree.filter((r): r is Extract<AgentTreeRow, { kind: "group" }> => r.kind === "group");
    if (filter === ALL_PROJECTS) {
        const count = groups.reduce((n, g) => n + g.count, 0);
        return { rows: foldCollapsedProjects(tree, collapsed), count, elsewhere: { agents: 0, asking: 0 } };
    }
    const rows: AgentTreeRow[] = [];
    let inProject = false;
    for (const r of tree) {
        if (r.kind === "group") {
            inProject = r.project === filter;
        } else if (inProject) {
            rows.push(r);
        }
    }
    const others = groups.filter((g) => g.project !== filter);
    return {
        rows,
        count: groups.filter((g) => g.project === filter).reduce((n, g) => n + g.count, 0),
        elsewhere: {
            agents: others.reduce((n, g) => n + g.count, 0),
            asking: others.reduce((n, g) => n + g.attn, 0),
        },
    };
}

export interface SplitActive {
    split: AgentVM[]; // the split's agents in cell order; empty when nothing is split
    rows: AgentTreeRow[]; // the Active rows without them
}

/** Pure: the Active section while the Agent surface shows a split. Its agents (`cells`, the grid's ids in cell order)
 *  leave their folders for the one split row at the top, so a split reads as one thing however many projects it
 *  spans. Only a plain agent's row moves: a lead's or worker's stays inside its run. `rows` is buildAgentTree's whole
 *  tree, before activeView folds it, so a collapsed folder loses the agents it holds too: a folder stops counting what
 *  the split took, its asking badge included, and one the split emptied goes. Fewer than two cells on the roster is no
 *  split. */
export function splitActive(rows: AgentTreeRow[], cells: readonly string[], roster: AgentVM[]): SplitActive {
    const byId = new Map(roster.map((a) => [a.id, a]));
    const split = cells.flatMap((id) => byId.get(id) ?? []);
    if (split.length < 2) {
        return { split: [], rows };
    }
    const lifted = new Set(split.map((a) => a.id));
    const out: AgentTreeRow[] = [];
    // the open folder's index in `out`, and whether the split took a row from it
    let folder = -1;
    let took = false;
    const closeFolder = () => {
        if (folder >= 0 && took && folder === out.length - 1) {
            out.pop();
        }
    };
    for (const r of rows) {
        if (r.kind === "group") {
            closeFolder();
            folder = out.length;
            took = false;
            out.push(r);
        } else if (r.kind === "parent" && lifted.has(r.agent.id)) {
            took = true;
            const g = folder >= 0 ? out[folder] : undefined;
            if (g?.kind === "group") {
                out[folder] = { ...g, count: g.count - 1, attn: g.attn - (r.agent.state === "asking" ? 1 : 0) };
            }
        } else {
            out.push(r);
        }
    }
    closeFolder();
    return { split, rows: out };
}

// the Terminals section's rows: a project's folder, and the plain terminals under it
export type TerminalTreeRow =
    | { kind: "folder"; project: string; count: number; open: boolean }
    | { kind: "terminal"; project: string; terminal: AgentVM };

/** Pure: the git branch each live agent's session is on, by agent id, for its Active row's second line. Read from the
 *  archive's record of the transcript the agent is writing (overlayLive's join); an agent the scan has not seen yet, or
 *  one whose session names no branch, is absent. `base` is null until the scan loads. */
export function liveBranches(base: SessionActivity[] | null, roster: AgentVM[]): Map<string, string> {
    const out = new Map<string, string>();
    if (base == null) {
        return out;
    }
    // overlayLive's third argument (`now`) is unused, so 0 stands in for it
    for (const s of overlayLive(base, roster, 0)) {
        if (s.liveId != null && s.branch) {
            out.set(s.liveId, s.branch);
        }
    }
    return out;
}

/** Pure: the Terminals section. A folder per project the plain terminals were launched in (projectOf; "ungrouped" for
 *  none, as the Active section files an agent), the projects in the roster's order, then, unless it is collapsed, the
 *  folder's terminals in that order. Filtered to a project, its terminals alone in that order, flat and unfolded, with
 *  those that name no project: a shell attributed to no project shows under every one. */
export function terminalTree(terminals: AgentVM[], filter: string, collapsed: ReadonlySet<string>): TerminalTreeRow[] {
    if (filter !== ALL_PROJECTS) {
        return terminals
            .filter((t) => projectOf(t) === "" || projectOf(t) === filter)
            .map((terminal) => ({ kind: "terminal", project: projectOf(terminal) || UNGROUPED_PROJECT, terminal }));
    }
    const byProject = new Map<string, AgentVM[]>();
    for (const t of terminals) {
        const project = projectOf(t) || UNGROUPED_PROJECT;
        const list = byProject.get(project);
        if (list == null) {
            byProject.set(project, [t]);
        } else {
            list.push(t);
        }
    }
    const out: TerminalTreeRow[] = [];
    for (const [project, list] of byProject) {
        const open = !collapsed.has(project);
        out.push({ kind: "folder", project, count: list.length, open });
        if (open) {
            out.push(...list.map((terminal): TerminalTreeRow => ({ kind: "terminal", project, terminal })));
        }
    }
    return out;
}

/** Pure: the projects with at least one ended conversation, the one with the newest conversation first (equal times in
 *  name order): the order of the Conversations section's folders. */
export function conversationProjects(ended: ReadonlyMap<string, ConversationEntry[]>): string[] {
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

// the folders the filter keeps, in conversationProjects' order: every one for ALL_PROJECTS, else the chosen project's
// alone, or none when it has no ended conversation (the app bar offers every project, not only those with one)
function projectsInScope(ended: ReadonlyMap<string, ConversationEntry[]>, filter: string): string[] {
    const projects = conversationProjects(ended);
    return filter === ALL_PROJECTS ? projects : projects.filter((p) => p === filter);
}

/** Pure: the Conversations section. A folder row per project the filter (the app bar's project switcher: ALL_PROJECTS or
 *  a project's name) keeps, then, unless the folder is collapsed, its ended conversations newest first (equal times in
 *  key order): the first CONVERSATION_PAGE plus one page per "Show more" press on that folder, then a more row
 *  counting what is still hidden. Filtered to a project, the one folder's rows alone: no folder row, so no fold
 *  applies. */
export function conversationTree(
    ended: ReadonlyMap<string, ConversationEntry[]>,
    filter: string,
    collapsed: ReadonlySet<string>,
    presses: ReadonlyMap<string, number>
): ConversationTreeRow[] {
    const out: ConversationTreeRow[] = [];
    const flat = filter !== ALL_PROJECTS;
    for (const project of projectsInScope(ended, filter)) {
        const list = [...ended.get(project)].sort((a, b) => b.lastactivets - a.lastactivets || byText(a.key, b.key));
        const open = flat || !collapsed.has(project);
        const attn = list.filter((r) => r.kind === "session" && r.session.needsAttention).length;
        if (!flat) {
            out.push({ kind: "folder", project, count: list.length, attn, open });
        }
        if (!open) {
            continue;
        }
        const shown = list.slice(0, CONVERSATION_PAGE * (1 + Math.max(0, presses.get(project) ?? 0)));
        out.push(...shown);
        if (shown.length < list.length) {
            out.push({ kind: "more", project, hidden: list.length - shown.length });
        }
    }
    return out;
}

/** Pure: how many ended conversations the filter keeps, for the Conversations header. */
export function conversationCount(ended: ReadonlyMap<string, ConversationEntry[]>, filter: string): number {
    let n = 0;
    for (const project of projectsInScope(ended, filter)) {
        n += ended.get(project).length;
    }
    return n;
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
