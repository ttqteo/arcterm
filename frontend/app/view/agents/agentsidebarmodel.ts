// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Pure model for the Agent surface's sidebar. The project tree (projectTree) is one collapsible folder per project: the
// live agents as the tree builds them (agenttreemodel.ts), the project's councils (its pinned ones at the folder's top,
// the others after the agents, peers of them with no label, those the tree rule councilInTree keeps), a divider, then
// the project's held services, then its plain terminals and tools. Terminals with no project sit in a
// Home folder at the end; a project's split is one row in its folder, in place of its cells' rows. The app bar's
// project switcher narrows it to one project, which then needs no folder: the list is flat, and agentsElsewhere counts
// the agents it hides so one asking elsewhere is not lost. A live agent and its session record are one row, joined by
// normalized transcript path (overlayLive, for the branch a row names). Ended sessions and runs are not here: they are
// the Library surface's Conversations tab. No React. It imports overlayLive from sessionsarchivestore, which pulls in
// the RPC client and the store; nothing here calls either.

import { placesOf, splitGrids, type CellPlacement, type GridState, type ProjectGrids } from "./agentgrid";
import { projectOf, type AgentVM } from "./agentsviewmodel";
import { UNGROUPED_PROJECT, type AgentTreeRow } from "./agenttreemodel";
import { avatarTone, isLit, seatInitials, type AvatarTone } from "./councildiscussionmodel";
import {
    canRemoveCouncil,
    councilProjectKey,
    isPinnedCouncil,
    panel,
    queuedLine,
    treeMeta,
    UNTITLED_COUNCIL,
    type CouncilTone,
} from "./councilmodel";
import { isClosedCouncil, isUnreadCouncil, keptSince, type CouncilOpenedMap } from "./councilopened";
import { HOME_NAME } from "./launcher";
import type { Lineage, RunInfo } from "./runlineage";
import type { QueuedRow } from "./runqueuemodel";
import { overlayLive } from "./sessionsarchivestore";
import type { StartingRun } from "./startingrunsmodel";

// the project filter's value for no filter (the model's projectFilterAtom)
export const ALL_PROJECTS = "all";
export { UNTITLED_COUNCIL };

// a total order on strings (code units, not locale), so a tie broken by it never depends on the input's order
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// the branches a conversation is on unless it says otherwise, and a detached HEAD: a row naming one would tell rows
// apart by nothing
const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD"]);

/** Pure: the branch a row names, undefined for none, a default branch or a detached HEAD. */
export function notableBranch(branch: string | undefined): string | undefined {
    const b = branch?.trim();
    return b && !DEFAULT_BRANCHES.has(b) ? b : undefined;
}

// the registered projects (projects.json), as the config atom holds them: name -> { path }
export type ProjectRegistry = Readonly<Record<string, { path?: string }>>;

// a path compared without case, separator or trailing separator
export function normPath(p: string): string {
    return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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

/** Pure: the tree folder a project name is filed under. No name, the agent tree's own "ungrouped" and "Home" (what the
 *  New dialog stamps a No folder launch with) are all No folder (HOME_PROJECT), so a launch there never makes a second
 *  folder beside it; "Home" stays a project of its own only when a registered project (`roots`) is named Home. */
export function treeFolder(project: string | undefined, roots: ReadonlyMap<string, string>): string {
    if (!project || project === UNGROUPED_PROJECT || (project === HOME_NAME && !roots.has(HOME_NAME))) {
        return HOME_PROJECT;
    }
    return project;
}

// the agent body rows buildAgentTree emits under a project's group row (parent, lead, run, worker, ...)
type AgentBodyRow = Exclude<AgentTreeRow, { kind: "group" }>;

/** A seat in a council row's picture: its name (the avatar's title), its letters and its identity colour. */
export interface CouncilRowSeat {
    name: string;
    initials: string;
    tone: AvatarTone;
}

// A council as the tree draws its row, a chat-list row: its seats' picture, its feature, its state in a word (`meta`)
// in the tone that word is drawn in, and the time since its newest message (`lastAt`). `created` (epoch ms) is the
// order: a running council saves constantly, so its `updated` would reshuffle the rows.
export interface CouncilRowVM {
    id: string;
    feature: string;
    created: number;
    meta: string;
    tone: CouncilTone;
    /** the picture's seats, back one first (councilSeatPair): two, or one for a council of a single seat */
    seats: CouncilRowSeat[];
    /** the front circle's corner dot: a seat writes, a seat's call failed, or neither */
    dot: "working" | "failed" | null;
    /** when the newest message came (councilLastAt), epoch ms */
    lastAt: number;
    /** it ended while the person was elsewhere and they have not opened it since (councilUnreadAtom) */
    unread: boolean;
    /** the person pinned it (isPinnedCouncil): the tree keeps it, at the top of its project's folder */
    pinned: boolean;
    /** it waits for the one council that runs: the row offers Remove from queue. Set only on a queued council. */
    queued?: true;
    /** nothing works on it any more (canRemoveCouncil): the row offers Remove in its menu. Set only on such
     *  a council. */
    removable?: true;
}

/** Pure: the two seats a council row's picture shows, so each council keeps one picture: its first two panel seats in
 *  order, the coordinator standing in for the second when the panel has one seat, and the one seat alone when the
 *  council has a single seat. */
export function councilSeatPair(c: Council): CouncilRowSeat[] {
    const seats = panel(c).slice(0, 2);
    if (seats.length < 2) {
        const coordinator = c.experts.find((e) => e.coordinator);
        if (coordinator != null) {
            seats.push(coordinator);
        }
    }
    return seats.map((e) => ({ name: e.name, initials: seatInitials(c, e.id), tone: avatarTone(c, e.id) }));
}

/** Pure: the corner dot of a council row's picture: `working` while any seat writes (isLit), `failed` when a seat's
 *  call failed, none otherwise. */
export function councilRowDot(c: Council): "working" | "failed" | null {
    if (c.experts.some((e) => isLit(c, e.id))) {
        return "working";
    }
    return Object.keys(c.failed ?? {}).length > 0 ? "failed" : null;
}

/** Pure: when a council's newest message came: the latest of its ideas' and replies' `ts` and its summary's `at`;
 *  before any, when it started, else when it was created. Not `updated`, which every save of the council file stamps,
 *  so a running council would always read "just now" and Pin or Unpin would reset it. */
export function councilLastAt(c: Council): number {
    const times = [
        ...(c.proposals ?? []).map((p) => p.ts),
        ...(c.replies ?? []).map((r) => r.ts),
        ...(c.summary != null ? [c.summary.at] : []),
    ].filter((t) => t > 0);
    if (times.length > 0) {
        return Math.max(...times);
    }
    return c.started || c.created;
}

/** Pure: the registered project name each project root is, keyed by councilProjectKey (separators, trailing slash and a
 *  drive path's case aside), so a council's path finds its folder's name. The first name of a root shared by two wins. */
export function projectNamesByKey(roots: ReadonlyMap<string, string>): Map<string, string> {
    const nameOf = new Map<string, string>();
    for (const [name, root] of roots) {
        const key = councilProjectKey(root);
        if (!nameOf.has(key)) {
            nameOf.set(key, name);
        }
    }
    return nameOf;
}

/** Pure: one council as a row draws it, in the tree and in Councils (councilhistory.ts). `byId` is the whole list: a
 *  queued council reads queuedLine of the council it waits on, which may sit in another project: `Queued · after
 *  <feature>`, with ` · waiting for <agent>` while that council waits on a busy agent, and `Queued` when it is not there.
 *  A council with held drafts reads `2 drafts wait for you` (treeMeta). */
export function councilRowVM(
    c: Council,
    byId: ReadonlyMap<string, Council>,
    unread: ReadonlySet<string> = new Set()
): CouncilRowVM {
    const { text, tone } = treeMeta(c);
    const row: CouncilRowVM = {
        id: c.id,
        feature: c.feature.trim() || UNTITLED_COUNCIL,
        created: c.created,
        meta: c.state === "queued" ? queuedLine(c.queuedafter ? byId.get(c.queuedafter) : undefined) : text,
        tone,
        seats: councilSeatPair(c),
        dot: councilRowDot(c),
        lastAt: councilLastAt(c),
        unread: unread.has(c.id),
        pinned: isPinnedCouncil(c),
    };
    if (c.state === "queued") {
        row.queued = true;
    }
    if (canRemoveCouncil(c)) {
        row.removable = true;
    }
    return row;
}

// how long an ended council stays in the tree after it ended (or the person resumed it), unless it is pinned or unread
const COUNCIL_TREE_KEEP_MS = 24 * 60 * 60 * 1000;

// the states in which a council has not ended: it runs, waits on the person, or waits its turn
const COUNCIL_LIVE: ReadonlySet<string> = new Set(["running", "awaiting-you", "queued"]);

/** Pure: whether the Agent tree lists council `c`: it runs, waits on the person or is queued; it is pinned; it ended
 *  (endedAt: its summary's time, else its last save) or the person resumed it (keptSince) less than a day before
 *  `now`; or it ended after the person last opened it (isUnreadCouncil, against the last-opened map), unless the person
 *  closed it since (isClosedCouncil), which takes it off the tree at once. Any other council, an ended one a day old
 *  that is unpinned and read, is left to Councils, so Unpin on one takes it off the tree at once. */
export function councilInTree(c: Council, opened: CouncilOpenedMap, now: number): boolean {
    if (COUNCIL_LIVE.has(c.state) || isPinnedCouncil(c)) {
        return true;
    }
    if (isClosedCouncil(c, opened)) {
        return false;
    }
    return now - keptSince(c, opened) < COUNCIL_TREE_KEEP_MS || isUnreadCouncil(c, opened);
}

/** The tabs Close project closes, as its project folder holds them, and how many of the agents are at work. */
export interface ProjectClose {
    agents: AgentVM[];
    terminals: AgentVM[];
    working: number;
}

/** Pure: what Close project closes in `project`'s folder, as the tree files it: every agent there (a run's workers and
 *  stage sessions with their run, whose project is its lead's: buildAgentTree's rule) and every terminal there, a
 *  service's tab left out (`serviceTabs`: wavesrv holds services, and stops them on its own). Councils are no tabs and
 *  stay. `working` counts the agents at work, which the confirm says will stop. */
export function projectClose(input: {
    project: string;
    agents: readonly AgentVM[];
    terminals: readonly AgentVM[];
    lineage: Lineage;
    serviceTabs: ReadonlySet<string>;
    roots?: ReadonlyMap<string, string>; // the registered projects, which tell a project named Home from No folder
}): ProjectClose {
    const { project, lineage } = input;
    const roots = input.roots ?? new Map<string, string>();
    const folderOf = (a: AgentVM): string => {
        const role = lineage.roles[a.id];
        const run = role?.kind === "worker" || role?.kind === "stage" ? lineage.runs[role.leadRunId] : undefined;
        // as projectTree files them (treeFolder): an agent with no project is in No folder, with the terminals that have none
        return treeFolder(run != null ? run.project : projectOf(a), roots);
    };
    const agents = input.agents.filter((a) => folderOf(a) === project);
    const terminals = input.terminals.filter(
        (t) => !input.serviceTabs.has(t.id) && treeFolder(projectOf(t), roots) === project
    );
    return { agents, terminals, working: agents.filter((a) => a.state === "working").length };
}

/** Pure: Close project's confirm: `Close "arc" and its 3 agents and 2 terminals? 1 is working and will stop. Their
 *  conversations stay in Conversations.` A part with none is left out; with nothing to close it is empty. */
export function projectCloseMessage(project: string, close: ProjectClose): string {
    const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
    const parts = [
        ...(close.agents.length > 0 ? [count(close.agents.length, "agent")] : []),
        ...(close.terminals.length > 0 ? [count(close.terminals.length, "terminal")] : []),
    ];
    if (parts.length === 0) {
        return "";
    }
    const working =
        close.working === 0 ? "" : ` ${close.working} ${close.working === 1 ? "is" : "are"} working and will stop.`;
    const kept = close.agents.length > 0 ? " Their conversations stay in Conversations." : "";
    return `Close "${project}" and its ${parts.join(" and ")}?${working}${kept}`;
}

// the states a council can be resumed from: it ran and ended. A council that never ran (not-run) has nothing to resume.
const COUNCIL_RESUMABLE: ReadonlySet<string> = new Set(["done", "stopped", "failed"]);

/** Pure: whether council `c` offers Resume: it ran and ended, the tree does not list it now (councilInTree, against the
 *  last-opened map `opened` at `now`: a day past its end, or closed), and it ran in a registered project (`roots`,
 *  project name -> root path), whose folder it comes back to. Resume (councilresume.tsx) runs nothing: it puts the
 *  council back in the tree for a day and opens its Discussion, where a reply starts a follow-up round. */
export function canResumeCouncil(
    c: Council,
    opened: CouncilOpenedMap,
    now: number,
    roots: ReadonlyMap<string, string>
): boolean {
    return (
        COUNCIL_RESUMABLE.has(c.state) &&
        projectNamesByKey(roots).has(councilProjectKey(c.project)) &&
        !councilInTree(c, opened, now)
    );
}

/** Pure: the councils (councilListAtom("")) the tree lists (councilInTree, against the last-opened map `opened` at
 *  `now`), as tree rows, by the registered project each one ran in. The folders of projectTree are keyed by project
 *  name and a council holds the project's path, so each is filed under the name whose root is the same path
 *  (projectNamesByKey). A council of a folder that is no registered project (`wsh council start` in a scratch folder)
 *  is filed under Home, as a terminal or a queued plan with no project is. `null` is a list not loaded yet. `unread` is the ids of the
 *  councils that ended unseen (councilUnreadAtom), which draw the row's unread dot. */
export function councilRowsByProject(
    councils: readonly Council[] | null | undefined,
    roots: ReadonlyMap<string, string>,
    opened: CouncilOpenedMap,
    now: number,
    unread: ReadonlySet<string> = new Set()
): Map<string, CouncilRowVM[]> {
    const out = new Map<string, CouncilRowVM[]>();
    const nameOf = projectNamesByKey(roots);
    const byId = new Map((councils ?? []).map((c) => [c.id, c]));
    for (const c of councils ?? []) {
        if (!councilInTree(c, opened, now)) {
            continue;
        }
        const name = nameOf.get(councilProjectKey(c.project)) ?? HOME_PROJECT;
        const row = councilRowVM(c, byId, unread);
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
    // a project's folder: the agents it holds (done workers aside), the terminals and the held services it lists, the
    // agents among them waiting on you, and those working now
    | {
          kind: "group";
          project: string;
          agents: number;
          terminals: number;
          services: number;
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
    // a council of a project's folder, a peer of its agents with no label: the pinned ones at the folder's top, the others
    // after the agents, newest first. No focus target. A council is started from New (the launcher's Council row) or the
    // palette.
    | ({ kind: "council"; project: string } & CouncilRowVM)
    // a plan queued to start, in its project's folder right under the project's agents. Named apart from the tree's
    // "queued" row, which folds a run's queued tasks.
    | ({ kind: "queuedentry" } & QueuedRow)
    // a run the New dialog handed off while it starts (startingrunsstore.ts), ahead of the queued plans; no focus target
    | ({ kind: "startingrun" } & StartingRun)
    // an agent arcterm held while the machine was busy (parkedmodel.ts), right under its project's agents; it selects
    // the centre's held view, not a tab, so it is no focus target
    | { kind: "parked"; project: string; parked: ParkedLaunch }
    // a project's split (2+ cells) as one row, where the topmost of its cells' rows was: each cell its tab and its place
    // in the 2x2 the surface draws. `shown` is the split on screen; another project's saved split is drawn too.
    | { kind: "split"; project: string; shown: boolean; cells: SplitRowCell[] }
    // a board, a peer of the folder's agents after them (TreeBoard): `chat` names the chat it reads. A split that holds
    // its cell folds it in like a tab (rowTabId gives its cell id); it is no focus target (treeNavIds skips it).
    | ({ kind: "board"; project: string } & TreeBoard)
    | AgentBodyRow;

// A board the tree lists: an open one (a cell, shown or not), or a live chat's latest. `chatId` is the chat it reads
// ("" for none), `chat` that chat's name.
export interface TreeBoard {
    boardProject: string;
    boardId: string;
    name: string;
    chatId: string;
    chat: string;
    activets: number; // the board's last turn or answer: Remove from list keeps it out until a later one
}

// One cell of a split row. `menu` is the row menu its right-click opens, the one its own row in the tree has: an
// agent's, a lead's (with its run's items, from `run`), a worker's or a stage's ("task", the short one), a terminal's.
export interface TabSplitCell {
    id: string;
    vm: AgentVM;
    place: CellPlacement;
    menu: "agent" | "lead" | "task" | "terminal";
    run?: RunInfo;
}

// A board's cell of a split row: its id is the grid's `board:<project>/<boardId>`.
export interface BoardSplitCell {
    id: string;
    place: CellPlacement;
    board: TreeBoard;
}

export type SplitRowCell = TabSplitCell | BoardSplitCell;

export function isBoardSplitCell(c: SplitRowCell): c is BoardSplitCell {
    return "board" in c;
}

// a board's cell id in the grid (boards/boardcell.ts boardCellId, spelled here so the model imports no store)
export function treeBoardCellId(b: Pick<TreeBoard, "boardProject" | "boardId">): string {
    return `board:${b.boardProject}/${b.boardId}`;
}

// the tab a row stands for, when it is one a split cell can hold (a brainstorm's check and judge rows are tabs too),
// and a board row's cell
function rowTabId(r: ProjectTreeRow): string | undefined {
    if (r.kind === "terminal") {
        return r.terminal.id;
    }
    if (r.kind === "board") {
        return treeBoardCellId(r);
    }
    if (r.kind === "parent" || r.kind === "lead" || r.kind === "stage" || r.kind === "check" || r.kind === "worker") {
        return r.agent?.id;
    }
    return undefined;
}

// The menu a cell opens: its row's when it has one (a check or judge row has a stage's, the short one); with none
// (a worker of a folded run), a run's tab takes the worker's and any other its kind's.
function cellMenu(vm: AgentVM, row: ProjectTreeRow | undefined): Pick<TabSplitCell, "menu" | "run"> {
    if (row?.kind === "lead") {
        return { menu: "lead", run: row.run };
    }
    if (row?.kind === "worker" || row?.kind === "stage" || row?.kind === "check") {
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
    const cells: SplitRowCell[] = grid.ids.flatMap((id, i): SplitRowCell[] => {
        const vm = byId.get(id);
        if (vm != null) {
            return [{ id, vm, place: places[i], ...cellMenu(vm, rowOf.get(id)) }];
        }
        const row = rowOf.get(id);
        return row?.kind === "board" ? [{ id, place: places[i], board: boardOfRow(row) }] : [];
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

/** Pure: the boards the tree lists, in `list`'s order (most recently active first): every open board (`open`, its
 *  `<project>/<boardId>` keys), and each live chat's latest board, so a board just drawn shows without opening it. The
 *  rest are Library's. `chat` names the chat it reads, from the roster or the board's own title. `hidden` holds the
 *  boards removed from the list, by key, with the board's `activets` when it was removed: one that is not open stays
 *  out until it is active again (a new turn or drawing). */
export function treeBoards(
    list: readonly BoardInfo[] | null | undefined,
    open: ReadonlySet<string>,
    agents: readonly Pick<AgentVM, "id" | "name">[],
    hidden: Readonly<Record<string, number>> = {}
): TreeBoard[] {
    const names = new Map(agents.map((a) => [a.id, a.name]));
    const latest = new Set<string>();
    const out: TreeBoard[] = [];
    for (const b of list ?? []) {
        const chatId = b.agenttabid ?? "";
        const live = chatId !== "" && names.has(chatId);
        const first = live && !latest.has(chatId);
        if (first) {
            latest.add(chatId);
        }
        const key = `${b.project}/${b.id}`;
        if (open.has(key)) {
            // listed
        } else if (!first || (hidden[key] != null && b.activets <= hidden[key])) {
            continue;
        }
        out.push({
            boardProject: b.project,
            boardId: b.id,
            name: b.name,
            chatId,
            chat: (live ? names.get(chatId) : undefined) || b.agenttitle || "",
            activets: b.activets,
        });
    }
    return out;
}

function boardOfRow(r: Extract<ProjectTreeRow, { kind: "board" }>): TreeBoard {
    return {
        boardProject: r.boardProject,
        boardId: r.boardId,
        name: r.name,
        chatId: r.chatId,
        chat: r.chat,
        activets: r.activets,
    };
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
 *  `starting` is the runs the New dialog handed off while they start: each goes in its project's folder ahead of the
 *  queued plans, and like them is no agent, no focus target and no count on the group row.
 *
 *  `parked` is the agents arcterm held while the machine was busy (parkedmodel.ts): each goes in its project's folder
 *  right under the project's agents, ahead of the runs starting and the queued plans (Home's for one held on No
 *  folder), oldest first; like them it is no focus target and no count.
 *
 *  `councils` (councilRowsByProject, by project name) puts the councils in: the folder of each registered project that
 *  has a council then holds its pinned councils at its top, above the agents, and right after its queued plans and
 *  ahead of the divider one row per other council (each part by `created`, newest first). Neither part has a label: a
 *  council is a peer of the agents. The councils the tree rule leaves out are not in it (councilInTree; Councils lists
 *  every council). A project whose only content is a council still gets a folder. Home holds the councils of folders that
 *  are no registered project; any other project with no root has no council rows. The rows are no focus target, so treeNavIds skips them and
 *  j/k need no councils input.
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
    starting?: readonly StartingRun[];
    parked?: readonly ParkedLaunch[];
    // the held services to list; `project` is the status's (wavesrv's "Home" for none), `tabId` its tab. A terminal on
    // a service's tab is the service's row, never a terminal row.
    services?: readonly { id: string; name: string; project: string; tabId?: string }[];
    // every held service's tab, listed or not (treeServiceInput): a sleeping service keeps its tab, which is still no
    // terminal row. Left out, the tabs of `services`.
    serviceTabs?: ReadonlySet<string>;
    splits?: ProjectGrids; // the grids as the surface reconciles them (gridstore treeSplits)
    // the boards to list (treeBoards), each in the folder of its project after the folder's agents
    boards?: readonly TreeBoard[];
    roster?: readonly AgentVM[];
    councils?: ReadonlyMap<string, CouncilRowVM[]>; // by project name
}): ProjectTreeRow[] {
    const { tree, filter, roots } = input;
    const services = input.services ?? [];
    const serviceTabs = input.serviceTabs ?? new Set(services.flatMap((s) => (s.tabId ? [s.tabId] : [])));
    const terminals = input.terminals.filter((t) => !serviceTabs.has(t.id));
    const serviceFolder = (s: { project: string }) => treeFolder(s.project, roots);
    const serviceRowsOf = (project: string): ProjectTreeRow[] =>
        services
            .filter((s) => serviceFolder(s) === project)
            .map((s) => ({ kind: "service", project, serviceId: s.id, tabId: s.tabId }));
    const collapsed = new Set(input.collapsed);
    const queue = input.queue ?? [];
    // an entry whose channel names no project is filed under Home, as a terminal with none is
    const queueFolder = (q: QueuedRow) => q.project || HOME_PROJECT;
    const starting = input.starting ?? [];
    const startingFolder = (s: StartingRun) => s.project || HOME_PROJECT;
    const parked = input.parked ?? [];
    // "Home" is the launcher's name for No folder, whose folder in the tree is Home's
    const parkedFolder = (p: ParkedLaunch) => treeFolder(p.project, roots);
    // the agents held while the machine was busy: agents still to start, so they sit right under the project's agents
    const parkedRowsOf = (project: string): ProjectTreeRow[] =>
        parked
            .filter((p) => parkedFolder(p) === project)
            .map((p): ProjectTreeRow => ({ kind: "parked", project, parked: p }));
    // the runs starting, then the plans queued: both wait to become a lead in this folder
    const queuedRowsOf = (project: string): ProjectTreeRow[] => [
        ...starting
            .filter((s) => startingFolder(s) === project)
            .map((s): ProjectTreeRow => ({ kind: "startingrun", ...s, project })),
        ...queue
            .filter((q) => queueFolder(q) === project)
            .map((q): ProjectTreeRow => ({ kind: "queuedentry", ...q, project })),
    ];
    const termProject = (t: AgentVM) => treeFolder(projectOf(t), roots);
    const termRows = (project: string, list: AgentVM[]): ProjectTreeRow[] =>
        list.map((terminal) => ({
            kind: "terminal",
            project,
            terminal,
            place: terminalPlace(terminal.cwd, roots.get(project)),
        }));
    // a project's councils, newest first: nothing without the input, or for a project with no root other than Home, which
    // holds the councils of folders that are no registered project
    const hasCouncils = (project: string) => roots.has(project) || project === HOME_PROJECT;
    const councilsOf = (project: string): CouncilRowVM[] =>
        input.councils == null || !hasCouncils(project)
            ? []
            : [...(input.councils.get(project) ?? [])].sort((a, b) => b.created - a.created || byText(a.id, b.id));
    const councilRow = (project: string, c: CouncilRowVM): ProjectTreeRow => ({ kind: "council", project, ...c });
    // a project's pinned councils, at the top of its folder with no label
    const pinnedRowsOf = (project: string): ProjectTreeRow[] =>
        councilsOf(project)
            .filter((c) => c.pinned)
            .map((c) => councilRow(project, c));
    // a project's other councils, after its agents, with no label
    const councilRowsOf = (project: string): ProjectTreeRow[] =>
        councilsOf(project)
            .filter((c) => !c.pinned)
            .map((c) => councilRow(project, c));
    // A grid is keyed by the project its tabs name (gridProjects), a folder by treeFolder: a No folder launch names
    // "Home", so its split is keyed "Home" and filed here under No folder, as its rows are. Two keys landing in one
    // folder: the shown one's split is drawn.
    const splits = new Map<string, { grid: GridState; shown: boolean }>();
    if (input.splits != null) {
        for (const [key, grid] of splitGrids(input.splits)) {
            const folder = treeFolder(key, roots);
            const shown = input.splits.project === key;
            if (shown || !splits.has(folder)) {
                splits.set(folder, { grid, shown });
            }
        }
    }
    const byId = new Map((input.roster ?? []).map((a) => [a.id, a]));
    // a folder's boards, after its agents: peers of them, not rows under one
    const boardRowsOf = (project: string): ProjectTreeRow[] =>
        (input.boards ?? [])
            .filter((b) => treeFolder(b.boardProject, roots) === project)
            .map((b) => ({ kind: "board", project, ...b }));
    const fold = (project: string, body: ProjectTreeRow[]) => {
        const split = splits.get(project);
        return split == null ? body : foldSplit(body, project, split.grid, split.shown, byId);
    };

    if (filter !== ALL_PROJECTS) {
        const out: ProjectTreeRow[] = pinnedRowsOf(filter);
        const agentRows: AgentBodyRow[] = [];
        let inProject = false;
        for (const r of tree) {
            if (r.kind === "group") {
                inProject = r.project === filter;
            } else if (inProject) {
                agentRows.push(r);
            }
        }
        out.push(...agentRows, ...boardRowsOf(filter));
        out.push(...parkedRowsOf(filter), ...queuedRowsOf(filter), ...councilRowsOf(filter));
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
    // an agent with no project, or launched in No folder, shares No folder with the terminals that have none
    // (treeFolder): the agent tree builds it an "ungrouped" or a "Home" folder of its own, renamed here. Two groups that
    // land in one folder add up.
    const bodies = new Map<string, { group: Extract<AgentTreeRow, { kind: "group" }>; body: AgentBodyRow[] }>();
    for (const t of tree) {
        const folder = treeFolder(t.project, roots);
        const r = folder === t.project ? t : ({ ...t, project: folder } as AgentTreeRow);
        if (r.kind === "group") {
            const had = bodies.get(r.project);
            bodies.set(
                r.project,
                had == null
                    ? { group: r, body: [] }
                    : {
                          group: {
                              ...had.group,
                              count: had.group.count + r.count,
                              attn: had.group.attn + r.attn,
                              running: had.group.running + r.running,
                          },
                          body: had.body,
                      }
            );
        } else {
            bodies.get(r.project)?.body.push(r);
        }
    }
    // the agents' projects in the tree's order, then the others in the order terminals, queued plans, services and
    // councils came, Home last whether it holds agents or not
    const councilFolders = [...(input.councils ?? [])].flatMap(([p, list]) =>
        list.length > 0 && hasCouncils(p) ? [p] : []
    );
    const order = [...bodies.keys()];
    const seen = new Set(order);
    const others = [
        ...new Set([
            ...terminals.map(termProject),
            ...starting.map(startingFolder),
            ...queue.map(queueFolder),
            ...parked.map(parkedFolder),
            ...services.map(serviceFolder),
            ...councilFolders,
        ]),
    ]
        .filter((p) => !seen.has(p))
        .sort((a, b) => Number(a === HOME_PROJECT) - Number(b === HOME_PROJECT));
    const out: ProjectTreeRow[] = [];
    const folders = [...order, ...others];
    for (const project of [
        ...folders.filter((p) => p !== HOME_PROJECT),
        ...folders.filter((p) => p === HOME_PROJECT),
    ]) {
        const folder = bodies.get(project);
        const list = byProject.get(project) ?? [];
        const open = !collapsed.has(project);
        out.push({
            kind: "group",
            project,
            agents: folder?.group.count ?? 0,
            terminals: list.length,
            services: services.filter((s) => serviceFolder(s) === project).length,
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
        const body: ProjectTreeRow[] = [
            ...pinnedRowsOf(project),
            ...agentRows,
            ...boardRowsOf(project),
            ...parkedRowsOf(project),
            ...waiting,
            ...councilRowsOf(project),
        ];
        if (list.length + held.length > 0 && body.length > 0) {
            body.push({ kind: "divider", project });
        }
        body.push(...held, ...termRows(project, list));
        out.push(...fold(project, body));
    }
    return out;
}

/** Pure: how many of Jarvis's items (splitAttention's `jarvis` share: gates, runs to confirm or land, escalations)
 *  each project folder holds, so the folder's icon carries the part of the nav rail's Jarvis badge that is its own. An
 *  item belongs to its run's project: the run as the tree knows it (`runs`, the lineage's), else the project of an agent
 *  working for that run; a blocked queue entry, to its queued row's folder. An item naming neither (a due chunk, a learn
 *  proposal) is in no folder. */
export function jarvisCountsByProject(
    items: readonly AttentionItem[],
    runs: Readonly<Record<string, RunInfo>>,
    agents: readonly AgentVM[],
    queue: readonly QueuedRow[] = []
): Map<string, number> {
    const out = new Map<string, number>();
    for (const i of items) {
        let project = "";
        if (i.runid) {
            project = runs[i.runid]?.project || "";
            if (!project) {
                const a = agents.find((x) => x.runId === i.runid && projectOf(x) !== "");
                project = a != null ? projectOf(a) : "";
            }
        }
        if (!project && i.queueid) {
            const q = queue.find((r) => r.entry.id === i.queueid);
            project = q != null ? q.project || HOME_PROJECT : "";
        }
        if (project) {
            out.set(project, (out.get(project) ?? 0) + 1);
        }
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

/** Pure: a folder's name as the tree reads it. The terminals with no project sit in No folder (HOME_PROJECT is the key the
 *  model and the fold list use); the agents with no project keep their own "ungrouped" folder, so the two never read as
 *  one. Every other folder is the project's name. */
export function projectLabel(project: string): string {
    return project === HOME_PROJECT ? "No folder" : project;
}

/** Pure: what a folded folder says it holds: "2 agents · 1 terminal · 1 app", each part only when it is not zero, so a
 *  folder of only services reads "1 app" rather than nothing; "" for none. A held service is an app, as Setup → Tools
 *  and the footer's Servers name it. */
export function folderCounts(agents: number, terminals: number, services = 0): string {
    const part = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
    return [
        agents > 0 ? part(agents, "agent") : "",
        terminals > 0 ? part(terminals, "terminal") : "",
        services > 0 ? part(services, "app") : "",
    ]
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
            // a board cell is no focus target
            ids.push(...r.cells.flatMap((c) => (isBoardSplitCell(c) ? [] : [c.id])));
        } else if (r.kind === "pair" && !r.open) {
            // folded, a pair's row stands for its working agent (open, that agent's own row follows it)
            ids.push(r.worker.id);
        } else if (
            (r.kind === "parent" ||
                r.kind === "lead" ||
                r.kind === "worker" ||
                r.kind === "stage" ||
                r.kind === "check") &&
            r.agent
        ) {
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
