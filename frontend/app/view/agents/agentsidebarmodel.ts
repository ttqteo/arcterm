// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Agent surface's sidebar once it carries conversations as well as live agents. Two parts, each
// collapsible. The project tree (projectTree) is one collapsible folder per project: the live agents as the tree builds
// them (agenttreemodel.ts), the project's councils (a Councils label and a row per council, when it has any), a divider, then
// the project's held services, then its plain terminals and tools. Terminals with no project sit in a
// Home folder at the end; a project's split is one row in its folder, in place of its cells' rows. Conversations holds every ended session, in a collapsible folder per
// project (the folder with the newest conversation first, newest first inside it, each row reading its own age), and
// "Show more" pages a folder (CONVERSATION_PAGE per press). The app bar's project switcher narrows both to one
// project, which then needs no folder: each part is a flat list, and agentsElsewhere counts the agents it hides so one
// asking elsewhere is not lost. Live and ended never mix: a live agent and its session record are one row, in the
// tree, joined by normalized transcript path (overlayLive), and the sessions an orchestrator run launched fold into one
// entry for the run, listed once none of them is live (until then the run is in the tree). Status filters live in
// History only. No React. It imports overlayLive from sessionsarchivestore, which pulls in the RPC client and the
// store; nothing here calls either.

import { placesOf, splitGrids, type CellPlacement, type GridState, type ProjectGrids } from "./agentgrid";
import { formatAgeShort, projectOf, type AgentVM } from "./agentsviewmodel";
import { UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { canRemoveCouncil, councilProjectKey, treeMeta, type CouncilTone } from "./councilmodel";
import type { RunInfo } from "./runlineage";
import type { QueuedRow } from "./runqueuemodel";
import { overlayLive, type LiveSession } from "./sessionsarchivestore";
import { groupRunSessions, memberSession, runSelKey, sessionKey, type RunSessions } from "./sessionsruns";

export const CONVERSATION_PAGE = 10;
// the project filter's value for no filter (the model's projectFilterAtom)
export const ALL_PROJECTS = "all";
export const UNTITLED_SESSION = "(untitled session)";
export const UNTITLED_COUNCIL = "(untitled council)";

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

// the pager at the end of a project's folder: "Show more" counting its conversations still hidden, and "Show less" once
// a press has opened more than the first page
export interface MoreConversationsRow {
    kind: "more";
    project: string;
    hidden: number;
    less: boolean;
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

// the branches a conversation is on unless it says otherwise, and a detached HEAD: a row naming one would tell rows
// apart by nothing
const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD"]);

/** Pure: the branch a row names, undefined for none, a default branch or a detached HEAD. */
export function notableBranch(branch: string | undefined): string | undefined {
    const b = branch?.trim();
    return b && !DEFAULT_BRANCHES.has(b) ? b : undefined;
}

/** Pure: the keys of the shown session rows whose title another shown session row of the same project also has; those
 *  rows name when they started, the one thing left to tell them apart at a glance. */
export function collidingTitles(rows: readonly ConversationTreeRow[]): Set<string> {
    const byTitle = new Map<string, string[]>();
    for (const r of rows) {
        if (r.kind === "session") {
            const id = JSON.stringify([r.project, r.title]);
            byTitle.set(id, [...(byTitle.get(id) ?? []), r.key]);
        }
    }
    return new Set([...byTitle.values()].filter((keys) => keys.length > 1).flat());
}

/** Pure: the tokens an orchestrator run spent, every session of it together. */
export function runTokens(group: RunSessions): number {
    return group.sessions.reduce((n, s) => n + (s.tokenstotal || 0), 0);
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Pure: when a session started, in local time: "started 09:12" today, "started Oct 6 09:12" before. */
export function startedLabel(startedts: number, now: number): string {
    const d = new Date(startedts);
    const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    if (startedts >= startOfDay(now)) {
        return `started ${clock}`;
    }
    return `started ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${clock}`;
}

/** Pure: how long ago a session last moved, as the tree's other rows read ("<1m", "16m", "3h", "3d"). */
export function sessionAgeLabel(lastactivets: number, now: number): string {
    return formatAgeShort(Math.max(0, now - lastactivets));
}

// the registered projects (projects.json), as the config atom holds them: name -> { path }
export type ProjectRegistry = Readonly<Record<string, { path?: string }>>;

// a path compared without case, separator or trailing separator
export function normPath(p: string): string {
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
 *  project checkout the tree was made from (projectroot, which wavesrv sets for a tree under the shared root, else
 *  engineWorktreeRoot), for the last two as for the first. */
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
        // wavesrv names the checkout of a tree under the shared root (<cache>/arc-wt/<key>), whose path names none
        const root = s.projectroot ? s.projectroot.replace(/\\/g, "/") : engineWorktreeRoot(s.projectpath ?? "");
        return (
            byFolder.get(claudeTranscriptFolder(s.transcriptpath)) ??
            byPath.get(normPath(root ?? s.projectpath ?? "")) ??
            ((root != null ? root.replace(/\/+$/, "").split("/").pop() : s.projectname) || UNGROUPED_PROJECT)
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

/** Pure: what the project filter hides, for the row under the tree: the agents of every other project (`tree` being
 *  buildAgentTree's output, a group row per project) and how many of them are asking. Nothing is hidden with no filter. */
export function agentsElsewhere(tree: AgentTreeRow[], filter: string): { agents: number; asking: number } {
    if (filter === ALL_PROJECTS) {
        return { agents: 0, asking: 0 };
    }
    const others = tree.filter(
        (r): r is Extract<AgentTreeRow, { kind: "group" }> => r.kind === "group" && r.project !== filter
    );
    return { agents: others.reduce((n, g) => n + g.count, 0), asking: others.reduce((n, g) => n + g.attn, 0) };
}

/** Pure: the digit Alt+1..9 jumps to for each of the first nine agents the Active section shows (activeAgentIds order),
 *  which is also the digit its row shows while Alt is held. */
export const AGENT_DIGITS = 9;

export function agentDigits(ids: readonly string[]): Map<string, number> {
    return new Map(ids.slice(0, AGENT_DIGITS).map((id, i) => [id, i + 1]));
}

// the project name a terminal with no project is filed under: its own folder, last
export const HOME_PROJECT = "~home";

// the agent body rows buildAgentTree emits under a project's group row (parent, lead, run, worker, ...)
type AgentBodyRow = Exclude<AgentTreeRow, { kind: "group" }>;

// A council as the tree draws its row: its feature, its state in a word (`meta`) and the tone that word is drawn in.
// `created` (epoch ms) is the order: a running council saves constantly, so its `updated` would reshuffle the rows.
export interface CouncilRowVM {
    id: string;
    feature: string;
    created: number;
    meta: string;
    tone: CouncilTone;
    /** it ended while the person was elsewhere and they have not opened it since (councilUnreadAtom) */
    unread: boolean;
    /** it waits for the one council that runs: the row offers Remove from queue. Set only on a queued council. */
    queued?: true;
    /** nothing works on it any more (canRemoveCouncil): the row offers Remove. Set only on such a council. */
    removable?: true;
}

/** Pure: the councils (councilListAtom("")) as tree rows, by the registered project each one ran in. The folders of
 *  projectTree are keyed by project name and a council holds the project's path, so each is filed under the name whose
 *  root is the same path (councilProjectKey: separators, trailing slash and a drive path's case aside). A council of a
 *  folder that is no registered project has no folder to sit in and is left out. `null` is a list not loaded yet.
 *  `unread` is the ids of the councils that ended unseen. A queued council reads `Queued · after <feature>` of the council
 *  it waits on, found in the whole list (that one may sit in another project's folder), `Queued` when it is not there. */
export function councilRowsByProject(
    councils: readonly Council[] | null | undefined,
    roots: ReadonlyMap<string, string>,
    unread: ReadonlySet<string> = new Set()
): Map<string, CouncilRowVM[]> {
    const out = new Map<string, CouncilRowVM[]>();
    const nameOf = new Map<string, string>();
    for (const [name, root] of roots) {
        const key = councilProjectKey(root);
        if (!nameOf.has(key)) {
            nameOf.set(key, name);
        }
    }
    const byId = new Map((councils ?? []).map((c) => [c.id, c]));
    for (const c of councils ?? []) {
        const name = nameOf.get(councilProjectKey(c.project));
        if (name == null) {
            continue;
        }
        const { text, tone } = treeMeta(c);
        const ahead = c.state === "queued" && c.queuedafter ? byId.get(c.queuedafter) : undefined;
        const row: CouncilRowVM = {
            id: c.id,
            feature: c.feature.trim() || UNTITLED_COUNCIL,
            created: c.created,
            meta: ahead != null ? `${text} · after ${ahead.feature.trim() || UNTITLED_COUNCIL}` : text,
            tone,
            unread: unread.has(c.id),
        };
        if (c.state === "queued") {
            row.queued = true;
        }
        if (canRemoveCouncil(c)) {
            row.removable = true;
        }
        const list = out.get(name);
        if (list == null) {
            out.set(name, [row]);
        } else {
            list.push(row);
        }
    }
    return out;
}

export type ProjectTreeRow =
    // a project's folder: the agents it holds (done workers aside) and the terminals, the agents among them waiting on
    // you, and those working now
    | {
          kind: "group";
          project: string;
          agents: number;
          terminals: number;
          attn: number;
          running: number;
          open: boolean;
      }
    // the thin line between a project's agents and its terminals
    | { kind: "divider"; project: string }
    // `place` names the folder it runs in when that is not the project's root (terminalPlace)
    | { kind: "terminal"; project: string; terminal: AgentVM; place?: string }
    // a held service (servicesstore.ts), after the divider and ahead of the terminals; `tabId` is its tab once it has one
    | { kind: "service"; project: string; serviceId: string; tabId?: string }
    // the councils block of a project's folder, after its agents: the Councils label and a row per council, newest first.
    // Neither is a focus target. A council is started from New (the launcher's Council row) or the palette.
    | { kind: "councilhead"; project: string }
    | ({ kind: "council"; project: string } & CouncilRowVM)
    // a plan queued to start, in its project's folder right under the project's agents. Named apart from the tree's
    // "queued" row, which folds a run's queued tasks.
    | ({ kind: "queuedentry" } & QueuedRow)
    // a project's split (2+ cells) as one row, where the topmost of its cells' rows was: each cell its tab and its place
    // in the 2x2 the surface draws. `shown` is the split on screen; another project's saved split is drawn too.
    | { kind: "split"; project: string; shown: boolean; cells: SplitRowCell[] }
    | AgentBodyRow;

// One cell of a split row. `menu` is the row menu its right-click opens, the one its own row in the tree has: an
// agent's, a lead's (with its run's items, from `run`), a worker's or a stage's ("task", the short one), a terminal's.
export interface SplitRowCell {
    id: string;
    vm: AgentVM;
    place: CellPlacement;
    menu: "agent" | "lead" | "task" | "terminal";
    run?: RunInfo;
}

// the tab a row stands for, when it is one a split cell can hold
function rowTabId(r: ProjectTreeRow): string | undefined {
    if (r.kind === "terminal") {
        return r.terminal.id;
    }
    if (r.kind === "parent" || r.kind === "lead" || r.kind === "stage" || r.kind === "worker") {
        return r.agent?.id;
    }
    return undefined;
}

// The menu a cell opens: its row's when it has one; with none (a worker of a folded run), a run's tab takes the
// worker's and any other its kind's.
function cellMenu(vm: AgentVM, row: ProjectTreeRow | undefined): Pick<SplitRowCell, "menu" | "run"> {
    if (row?.kind === "lead") {
        return { menu: "lead", run: row.run };
    }
    if (row?.kind === "worker" || row?.kind === "stage") {
        return { menu: "task" };
    }
    if (vm.kind === "terminal") {
        return { menu: "terminal" };
    }
    return { menu: row == null && vm.runId != null ? "task" : "agent" };
}

// One folder's body with its split folded in: the cells' rows pulled out, one split row where the first of them was
// (the top of the body when none had a row), and a divider left with nothing above or below it dropped. A cell the
// roster does not hold is left out; fewer than two left, the body is returned as it was.
function foldSplit(
    body: ProjectTreeRow[],
    project: string,
    grid: GridState,
    shown: boolean,
    byId: ReadonlyMap<string, AgentVM>
): ProjectTreeRow[] {
    const places = placesOf(grid);
    const rowOf = new Map<string, ProjectTreeRow>();
    for (const r of body) {
        const id = rowTabId(r);
        if (id != null && !rowOf.has(id)) {
            rowOf.set(id, r);
        }
    }
    const cells: SplitRowCell[] = grid.ids.flatMap((id, i) => {
        const vm = byId.get(id);
        return vm != null ? [{ id, vm, place: places[i], ...cellMenu(vm, rowOf.get(id)) }] : [];
    });
    if (cells.length < 2) {
        return body;
    }
    const ids = new Set(cells.map((c) => c.id));
    const at = body.findIndex((r) => ids.has(rowTabId(r) ?? ""));
    const kept: ProjectTreeRow[] = [];
    body.forEach((r, i) => {
        if (i === at) {
            kept.push({ kind: "split", project, shown, cells });
        }
        if (!ids.has(rowTabId(r) ?? "")) {
            kept.push(r);
        }
    });
    if (at < 0) {
        kept.unshift({ kind: "split", project, shown, cells });
    }
    return kept.filter((r, i) => r.kind !== "divider" || (i > 0 && i < kept.length - 1));
}

/** Pure: the root a council opened with no project named (the palette's New council…, `wsh ui do new-council`) starts
 *  in: the root of the project of the agent or terminal in focus, else the first registered project that has a path.
 *  "" when none is registered, so there is nowhere to start one. */
export function newCouncilRoot(focus: AgentVM | undefined, projects: ProjectRegistry): string {
    const own = focus != null ? projects[projectOf(focus)]?.path : undefined;
    if (own) {
        return own;
    }
    return Object.values(projects).find((p) => p?.path)?.path ?? "";
}

/** Pure: the sidebar's one tree per project. `tree` is buildAgentTree's output; `terminals` are the plain shells and
 *  tools (liveTerminalsAtom). Each project's folder lists its agent rows, a divider when terminals follow, then its
 *  terminals in the order given. The folders are the agents' projects in the tree's order, then the projects only
 *  terminals or queued plans are in, then Home (the terminals with no project). A collapsed project keeps its group row,
 *  which counts what it hides, and loses the rows under it.
 *
 *  `queue` (queuedRows) is the plans waiting to start: each goes in its project's folder right after the project's
 *  agent rows, in queue order, ahead of the divider and the terminals. They are not agents, so the group row does not
 *  count them, and treeNavIds skips them (they select nothing).
 *
 *  `councils` (councilRowsByProject, by project name) turns the councils block on: the folder of each registered project
 *  that has a council then holds, right after its queued plans and ahead of the divider, a Councils label and one row
 *  per council (`created`, newest first). A project with no council has no block; one whose only content is a council
 *  still gets a folder. A project with no root (Home, the agents with no registered project) has no block. The rows are
 *  no focus target, so treeNavIds skips them and j/k need no councils input.
 *
 *  Each project's split (`splits`, its grids of 2+ cells) is one row in its folder, where the topmost of its cells'
 *  rows was; the cells' own rows go. `roster` is every live agent and terminal, read for a cell the tree draws no row
 *  for.
 *
 *  Filtered to a project (the app bar's switcher), no folder and no fold: that project's agent rows, its queued plans, a
 *  divider and its terminals together with those that name no project, as the Terminals section filtered before. */
export function projectTree(input: {
    tree: AgentTreeRow[];
    terminals: AgentVM[];
    filter: string;
    collapsed: readonly string[];
    roots: ReadonlyMap<string, string>; // project name -> root path
    queue?: readonly QueuedRow[];
    // the held services to list; `project` is the status's (wavesrv's "Home" for none), `tabId` its tab. A terminal on
    // a service's tab is the service's row, never a terminal row.
    services?: readonly { id: string; name: string; project: string; tabId?: string }[];
    // every held service's tab, listed or not (treeServiceInput): a sleeping service keeps its tab, which is still no
    // terminal row. Left out, the tabs of `services`.
    serviceTabs?: ReadonlySet<string>;
    splits?: ProjectGrids; // the grids as the surface reconciles them (gridstore treeSplits)
    roster?: readonly AgentVM[];
    councils?: ReadonlyMap<string, CouncilRowVM[]>; // by project name
}): ProjectTreeRow[] {
    const { tree, filter, roots } = input;
    const services = input.services ?? [];
    const serviceTabs = input.serviceTabs ?? new Set(services.flatMap((s) => (s.tabId ? [s.tabId] : [])));
    const terminals = input.terminals.filter((t) => !serviceTabs.has(t.id));
    const serviceFolder = (s: { project: string }) => (s.project === "Home" ? HOME_PROJECT : s.project);
    const serviceRowsOf = (project: string): ProjectTreeRow[] =>
        services
            .filter((s) => serviceFolder(s) === project)
            .map((s) => ({ kind: "service", project, serviceId: s.id, tabId: s.tabId }));
    const collapsed = new Set(input.collapsed);
    const queue = input.queue ?? [];
    // an entry whose channel names no project is filed under Home, as a terminal with none is
    const queueFolder = (q: QueuedRow) => q.project || HOME_PROJECT;
    const queuedRowsOf = (project: string): ProjectTreeRow[] =>
        queue.filter((q) => queueFolder(q) === project).map((q) => ({ kind: "queuedentry", ...q, project }));
    const termProject = (t: AgentVM) => projectOf(t) || HOME_PROJECT;
    const termRows = (project: string, list: AgentVM[]): ProjectTreeRow[] =>
        list.map((terminal) => ({
            kind: "terminal",
            project,
            terminal,
            place: terminalPlace(terminal.cwd, roots.get(project)),
        }));
    // a project's councils block: nothing without the input, for a project with no root, or for one with no council
    const councilRowsOf = (project: string): ProjectTreeRow[] => {
        if (input.councils == null || !roots.has(project)) {
            return [];
        }
        const list = [...(input.councils.get(project) ?? [])].sort(
            (a, b) => b.created - a.created || byText(a.id, b.id)
        );
        if (list.length === 0) {
            return [];
        }
        return [
            { kind: "councilhead", project },
            ...list.map((c): ProjectTreeRow => ({ kind: "council", project, ...c })),
        ];
    };
    const splits = input.splits != null ? splitGrids(input.splits) : new Map<string, GridState>();
    const byId = new Map((input.roster ?? []).map((a) => [a.id, a]));
    const fold = (project: string, body: ProjectTreeRow[]) => {
        const grid = splits.get(project);
        return grid == null ? body : foldSplit(body, project, grid, input.splits?.project === project, byId);
    };

    if (filter !== ALL_PROJECTS) {
        const out: ProjectTreeRow[] = [];
        let inProject = false;
        for (const r of tree) {
            if (r.kind === "group") {
                inProject = r.project === filter;
            } else if (inProject) {
                out.push(r);
            }
        }
        out.push(...queuedRowsOf(filter), ...councilRowsOf(filter));
        // a shell attributed to no project shows under every one
        const mine = terminals.filter((t) => projectOf(t) === "" || projectOf(t) === filter);
        const held = serviceRowsOf(filter);
        if (mine.length + held.length > 0 && out.length > 0) {
            out.push({ kind: "divider", project: filter });
        }
        out.push(...held, ...termRows(filter, mine));
        return fold(filter, out);
    }

    const byProject = new Map<string, AgentVM[]>();
    for (const t of terminals) {
        const project = termProject(t);
        byProject.set(project, [...(byProject.get(project) ?? []), t]);
    }
    const bodies = new Map<string, { group: Extract<AgentTreeRow, { kind: "group" }>; body: AgentBodyRow[] }>();
    for (const r of tree) {
        if (r.kind === "group") {
            bodies.set(r.project, { group: r, body: [] });
        } else {
            bodies.get(r.project)?.body.push(r);
        }
    }
    // the agents' projects in the tree's order, then the others in the order terminals, queued plans, services and
    // councils came, Home last
    const councilFolders = [...(input.councils ?? [])].flatMap(([p, list]) =>
        list.length > 0 && roots.has(p) ? [p] : []
    );
    const order = [...bodies.keys()];
    const seen = new Set(order);
    const others = [
        ...new Set([
            ...terminals.map(termProject),
            ...queue.map(queueFolder),
            ...services.map(serviceFolder),
            ...councilFolders,
        ]),
    ]
        .filter((p) => !seen.has(p))
        .sort((a, b) => Number(a === HOME_PROJECT) - Number(b === HOME_PROJECT));
    const out: ProjectTreeRow[] = [];
    for (const project of [...order, ...others]) {
        const folder = bodies.get(project);
        const list = byProject.get(project) ?? [];
        const open = !collapsed.has(project);
        out.push({
            kind: "group",
            project,
            agents: folder?.group.count ?? 0,
            terminals: list.length,
            attn: folder?.group.attn ?? 0,
            running: folder?.group.running ?? 0,
            open,
        });
        if (!open) {
            continue;
        }
        const agentRows = folder?.body ?? [];
        const waiting = queuedRowsOf(project);
        const held = serviceRowsOf(project);
        const body: ProjectTreeRow[] = [...agentRows, ...waiting, ...councilRowsOf(project)];
        if (list.length + held.length > 0 && body.length > 0) {
            body.push({ kind: "divider", project });
        }
        body.push(...held, ...termRows(project, list));
        out.push(...fold(project, body));
    }
    return out;
}

/** Pure: the folder a terminal runs in, as the row names it beside the project: the last folder of its `cwd`, or
 *  undefined when that is the project's root (the paths compared without case, separator or trailing separator), and
 *  when there is no cwd or no root to compare it with. */
export function terminalPlace(cwd: string | undefined, root: string | undefined): string | undefined {
    if (!cwd || !root || normPath(cwd) === normPath(root)) {
        return undefined;
    }
    return (
        cwd
            .replace(/[\\/]+$/, "")
            .split(/[\\/]/)
            .pop() || undefined
    );
}

/** Pure: a folder's name as the tree reads it. The terminals with no project sit in Home (HOME_PROJECT is the key the
 *  model and the fold list use); the agents with no project keep their own "ungrouped" folder, so the two never read as
 *  one. Every other folder is the project's name. */
export function projectLabel(project: string): string {
    return project === HOME_PROJECT ? "Home" : project;
}

/** Pure: what a folded folder says it holds: "2 agents · 1 terminal", only "2 terminals" when it holds no agent and only
 *  "2 agents" when it holds no terminal, "" for neither. */
export function folderCounts(agents: number, terminals: number): string {
    const part = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
    return [agents > 0 ? part(agents, "agent") : "", terminals > 0 ? part(terminals, "terminal") : ""]
        .filter(Boolean)
        .join(" · ");
}

export type TerminalRowState = "installing" | "failed" | "removed";

/** Pure: how a terminal row stands when it is not simply running. `installing` and `failed` map a tool's id to the tab
 *  of its install terminal (toolsstore's installingAtom and failedAtom): "installing" while the install runs, "failed"
 *  once it exited non-zero and was kept open with its output (also when both name the tab: the exit is the later fact).
 *  "removed" is a terminal whose folder is gone (`gone`, worktreegone.ts's goneTerminals): the row strikes its branch
 *  through. Undefined for every other terminal. */
export function terminalRowState(
    tabId: string,
    installing: Readonly<Record<string, string>>,
    failed: Readonly<Record<string, string>>,
    gone: readonly string[] = []
): TerminalRowState | undefined {
    if (Object.values(failed).includes(tabId)) {
        return "failed";
    }
    if (Object.values(installing).includes(tabId)) {
        return "installing";
    }
    return gone.includes(tabId) ? "removed" : undefined;
}

export type TerminalShows = "panel";

/** Pure: where a terminal shows when that is not the centre: "panel" while it is the docked one, nothing otherwise (a
 *  cell of a split has no terminal row: the split row holds it). */
export function terminalShows(id: string, dockedId: string | null | undefined): TerminalShows | undefined {
    return dockedId === id ? "panel" : undefined;
}

/** Pure: the ids the agent keys (j/k, the arrows, Alt+1..9, Ctrl+Tab) step through, agents and terminals together: each
 *  row's agent or terminal in the order the tree reads. A folded project's rows are not in `rows`, so they are not in
 *  it; a worker row with no session left has none. */
export function treeNavIds(rows: ProjectTreeRow[]): string[] {
    const ids: string[] = [];
    for (const r of rows) {
        if (r.kind === "terminal") {
            ids.push(r.terminal.id);
        } else if (r.kind === "service") {
            // a service with no tab selects nothing until it is opened, as a queued entry does
            if (r.tabId) {
                ids.push(r.tabId);
            }
        } else if (r.kind === "split") {
            ids.push(...r.cells.map((c) => c.id));
        } else if ((r.kind === "parent" || r.kind === "lead" || r.kind === "worker" || r.kind === "stage") && r.agent) {
            ids.push(r.agent.id);
        }
    }
    return [...new Set(ids)];
}

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

// a folder row and the rows under it, which fold as one block; a flat list (filtered to a project) is one block with no
// head
export interface FolderBlock<R> {
    head: R | null;
    body: R[];
}

/** Pure: a section's rows (conversationTree's) cut at each folder row, so each folder's rows render
 *  in one block that can open and close under it. A collapsed folder's block has an empty body. */
export function folderBlocks<R extends { kind: string }>(rows: readonly R[]): FolderBlock<R>[] {
    const out: FolderBlock<R>[] = [];
    for (const r of rows) {
        if (r.kind === "folder") {
            out.push({ head: r, body: [] });
        } else if (out.length === 0) {
            out.push({ head: null, body: [r] });
        } else {
            out[out.length - 1].body.push(r);
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
 *  a project's name) keeps, then, unless the folder is collapsed, its ended conversations in the order `ended` holds them
 *  (endedConversationsByProject's, newest first, after laterFirst): the first CONVERSATION_PAGE plus one page per
 *  "Show more" press on that folder, then a pager row
 *  counting what is still hidden and, once a press opened more, offering to fold back to the first page. Filtered to a project, the one folder's rows alone: no folder row, so no fold
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
        // in the order given: endedConversationsByProject's newest first, then laterFirst's marked ones ahead (sorting
        // again here would put a marked session back under "Show more")
        const list = ended.get(project);
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
        const hidden = list.length - shown.length;
        const less = shown.length > CONVERSATION_PAGE;
        if (hidden > 0 || less) {
            out.push({ kind: "more", project, hidden, less });
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

/** Pure: what the roster holds for agentExited: each agent's tab id and, apart, each transcript an agent is writing. A
 *  tab that stays while its session ends (/clear, a claude quit and started again in it, a resume of another session)
 *  keeps its id but drops its transcript. */
export function rosterSessionKeys(agents: readonly Pick<AgentVM, "id" | "transcriptPath">[]): Set<string> {
    const out = new Set<string>();
    for (const a of agents) {
        out.add(`tab:${a.id}`);
        if (a.transcriptPath) {
            out.add(`transcript:${a.transcriptPath.replace(/\\/g, "/").toLowerCase()}`);
        }
    }
    return out;
}

/** Pure: did an agent, or the transcript one was writing, leave the roster between two snapshots of rosterSessionKeys?
 *  A session just ended, so the sidebar rescans. */
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
