// frontend/app/view/agents/comparestore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Branch-comparison state for the Diff surface. Separate from githistorystore.ts on purpose: that
// file is the single-ref history spine, this is a two-ref read with its own selection. Same idioms —
// module-level atoms written by async loaders through globalStore, with a guard token so a stale load
// cannot clobber a newer one. Module scope is load-bearing: the surface unmounts on nav switch, so
// the refs, the selection and the open file would be lost in component state.
//
// One selection model, two data sources: the aggregate row reads the two-ref commands, a commit row
// reads the same commit-scoped commands the history spine uses — a commit's contents mean the same
// thing however you reached it.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { devCommitFault, type ChangesStatus } from "./changesstatus";
import { AGGREGATE } from "./comparerows";
import type { CompareForm } from "./diffcontent";
import type { DiffRange } from "./diffscope";
import { diffScopeAtom } from "./diffscopeatom";
import { parseGitChanges, type GitChanges } from "./gitstatus";

export interface CompareRefs {
    base: string;
    head: string;
}

export interface CompareSides {
    ahead: HistoryCommit[];
    behind: HistoryCommit[];
    mergeBase: string;
    // unix ms; 0 when the read carries no time
    mergeBaseTs: number;
}

// Derived, not stored: there is exactly one place that says what the surface is showing, so the
// surface can no longer be comparing and in some other scope at the same time.
export const compareOnAtom = atom((get) => get(diffScopeAtom)?.range.kind === "compare");
export const compareRefsAtom = atom<CompareRefs | null>(null) as PrimitiveAtom<CompareRefs | null>;
export const compareSidesAtom = atom<CompareSides | null>(null) as PrimitiveAtom<CompareSides | null>;
export const compareAggregateAtom = atom<GitChanges | null>(null) as PrimitiveAtom<GitChanges | null>;
// AGGREGATE, or a commit hash from either side
export const compareSelectionAtom = atom<string>(AGGREGATE) as PrimitiveAtom<string>;
export const compareSelectedFileAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
// A failed compare read, phrased with the refs in it so the column can name what did not resolve.
export const compareErrorAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
export const compareBranchesAtom = atom<BranchInfo[]>([]) as PrimitiveAtom<BranchInfo[]>;

const commitChangesAtom = atom<GitChanges | null>(null) as PrimitiveAtom<GitChanges | null>;
// What the selected compare commit's read is doing. commitChangesAtom is null both while it loads and
// after it fails, so the list could not tell "0 files" from "not read yet" without this.
const commitChangesStatusAtom = atom<ChangesStatus>("ready") as PrimitiveAtom<ChangesStatus>;

// Pane 2 reads one source regardless of which row is selected.
export const compareActiveChangesAtom = atom<GitChanges | null>((get) =>
    get(compareSelectionAtom) === AGGREGATE ? get(compareAggregateAtom) : get(commitChangesAtom)
);

// The status of whichever list compareActiveChangesAtom holds. The aggregate row has no read of its own:
// it is the setCompareRefs read, so it loads until the aggregate lands and fails with the compare error.
export const compareActiveChangesStatusAtom = atom<ChangesStatus>((get) => {
    if (get(compareSelectionAtom) !== AGGREGATE) {
        return get(commitChangesStatusAtom);
    }
    if (get(compareErrorAtom) != null) {
        return "failed";
    }
    return get(compareAggregateAtom) == null ? "loading" : "ready";
});

const current = { token: "" };

// The scope is the single source of truth for which form is active; this reads it rather than
// carrying a second copy that could disagree with the range strip.
function activeForm(): CompareForm {
    const r = globalStore.get(diffScopeAtom)?.range;
    return r?.kind === "compare" ? r.form : "mergebase";
}

// Which repository the remembered pair in compareRefsAtom was picked in. That atom survives
// clearCompareState on purpose, but the pair is only an offer for the repo it came from — carried
// into another one it names branches that do not resolve there.
const remembered = { cwd: "" };

// Restores the range comparison interrupted. Named leaveCompare rather than exitCompare because it
// now moves the surface somewhere specific instead of clearing a flag.
export function leaveCompare(): void {
    const scope = globalStore.get(diffScopeAtom);
    if (scope != null && scope.range.kind === "compare") {
        globalStore.set(diffScopeAtom, { ...scope, range: scope.range.from });
    }
    clearCompareState();
}

function clearCompareState(): void {
    current.token = "";
    globalStore.set(compareSidesAtom, null);
    globalStore.set(compareAggregateAtom, null);
    globalStore.set(compareSelectionAtom, AGGREGATE);
    globalStore.set(compareSelectedFileAtom, null);
    globalStore.set(commitChangesAtom, null);
    globalStore.set(commitChangesStatusAtom, "ready");
    globalStore.set(compareErrorAtom, null);
    // compareRefsAtom survives on purpose: re-entering compare should offer the pair you last used.
}

// The picker's suggestions and the default base. Failure degrades to free text rather than an error:
// you can still type a ref by hand, which is the whole reason the fields accept free text.
export async function loadCompareRefsMeta(cwd: string): Promise<string> {
    try {
        // remote-tracking refs too: an origin/* ref is the review base most of the time, and the
        // backend's default branch now prefers the remote one (T2)
        const rtn = await RpcApi.ListBranchesCommand(TabRpcClient, { projectpath: cwd, includeremotes: true });
        globalStore.set(compareBranchesAtom, rtn.branches ?? []);
        return rtn.default ?? "";
    } catch {
        globalStore.set(compareBranchesAtom, []);
        return "";
    }
}

// Enter compare on the checked-out branch against the repo's default branch — the review question,
// and the pair that needs no typing. currentBranch comes from filesStateAtom.branch, which the
// change-list read already resolved, so learning where you are costs no extra git call. The range
// records what it interrupted so leaving is a restore rather than a guess; that is also why the old
// compareAnchorAtom and the effect that invalidated it are gone.
export async function enterCompare(cwd: string, currentBranch: string): Promise<void> {
    const scope = globalStore.get(diffScopeAtom);
    if (scope == null) {
        return;
    }
    const from: DiffRange = scope.range.kind === "compare" ? scope.range.from : scope.range;
    globalStore.set(compareErrorAtom, null);
    globalStore.set(compareSidesAtom, null);
    globalStore.set(compareAggregateAtom, null);
    const def = await loadCompareRefsMeta(cwd);
    const prev = remembered.cwd === cwd ? globalStore.get(compareRefsAtom) : null;
    const base = prev?.base || def;
    const head = prev?.head || currentBranch;
    globalStore.set(diffScopeAtom, { ...scope, range: { kind: "compare", base, head, form: "mergebase", from } });
    await setCompareRefs(cwd, base, head);
}

export async function setCompareRefs(cwd: string, base: string, head: string): Promise<void> {
    globalStore.set(compareRefsAtom, { base, head });
    remembered.cwd = cwd;
    // the scope stays the single source of truth for what the surface is showing
    const scope = globalStore.get(diffScopeAtom);
    if (scope?.range.kind === "compare") {
        globalStore.set(diffScopeAtom, { ...scope, range: { ...scope.range, base, head } });
    }
    const form = activeForm();
    const token = `${cwd}|${base}|${head}|${form}`;
    current.token = token;
    globalStore.set(compareSidesAtom, null);
    globalStore.set(compareAggregateAtom, null);
    globalStore.set(compareSelectionAtom, AGGREGATE);
    globalStore.set(compareSelectedFileAtom, null);
    globalStore.set(commitChangesAtom, null);
    globalStore.set(commitChangesStatusAtom, "ready");
    globalStore.set(compareErrorAtom, null);
    if (!base || !head) {
        globalStore.set(compareErrorAtom, "Pick two refs to compare.");
        return;
    }
    try {
        const [div, agg] = await Promise.all([
            RpcApi.GitDivergenceCommand(TabRpcClient, { cwd, base, head }),
            // the wire takes a bool because git has exactly two range separators; the union stays
            // the vocabulary everywhere above it
            RpcApi.GitCompareChangesCommand(TabRpcClient, { cwd, base, head, tips: form === "tips" }),
        ]);
        if (current.token !== token) {
            return;
        }
        if (!div.isrepo || !agg.isrepo) {
            globalStore.set(compareErrorAtom, "Not a git repository.");
            return;
        }
        globalStore.set(compareSidesAtom, {
            ahead: div.ahead ?? [],
            behind: div.behind ?? [],
            mergeBase: div.mergebase ?? "",
            mergeBaseTs: div.mergebasets ?? 0,
        });
        const changes = parseGitChanges(agg.statusz, agg.numstat);
        globalStore.set(compareAggregateAtom, changes);
        const first = changes.files[0]?.path;
        if (first) {
            selectCompareFile(first);
        }
    } catch {
        if (current.token === token) {
            // Name the pair: an unresolvable ref is the common cause, and a blank column would
            // otherwise read as "these refs do not differ".
            globalStore.set(compareErrorAtom, `Couldn’t compare ${base} with ${head}.`);
        }
    }
}

// A form change is a different question about the same two refs, so it re-reads the aggregate and the
// open file but leaves the commit columns alone — divergence does not depend on the form.
export async function setCompareForm(cwd: string, form: CompareForm): Promise<void> {
    const scope = globalStore.get(diffScopeAtom);
    if (scope == null || scope.range.kind !== "compare" || scope.range.form === form) {
        return;
    }
    globalStore.set(diffScopeAtom, { ...scope, range: { ...scope.range, form } });
    await setCompareRefs(cwd, scope.range.base, scope.range.head);
}

// Swapping is a different comparison, not a redraw: both the divergence and the aggregate invert, so
// it goes through the same path a typed pair does.
export async function swapCompareRefs(cwd: string): Promise<void> {
    const refs = globalStore.get(compareRefsAtom);
    if (refs == null || !refs.base || !refs.head) {
        return;
    }
    await setCompareRefs(cwd, refs.head, refs.base);
}

export interface FetchState {
    running: boolean;
    at: number; // unix seconds of the last successful fetch; 0 = never in this session
    failure: GitFailure | null;
}

// keyed by repository: a fetch is a fact about one remote, so its clock and its failure must not
// follow the surface to the next source picked
export const fetchStatesAtom = atom<Record<string, FetchState>>({}) as PrimitiveAtom<Record<string, FetchState>>;

const FETCH_IDLE: FetchState = { running: false, at: 0, failure: null };

export function fetchStateOf(states: Record<string, FetchState>, cwd: string | undefined): FetchState {
    return (cwd && states[cwd]) || FETCH_IDLE;
}

function setFetchState(cwd: string, patch: Partial<FetchState>): void {
    const states = globalStore.get(fetchStatesAtom);
    globalStore.set(fetchStatesAtom, { ...states, [cwd]: { ...fetchStateOf(states, cwd), ...patch } });
}

// The one network call this surface makes. A remote-tracking ref is only as fresh as the last fetch,
// so comparing against origin/main without one silently compares against yesterday's origin/main.
//
// The budget is raised on purpose: the client's timeout binds the SERVER's context, so at the 5s
// default a merely-slow fetch would be cancelled underneath a git process that is still running.
// 60s sits just outside gitinfo's own 55s fetchTimeout, so git's answer arrives first and a real
// timeout is reported by the side that knows what it was doing.
export async function runFetch(cwd: string): Promise<void> {
    setFetchState(cwd, { running: true, failure: null });
    try {
        const r = await RpcApi.GitFetchCommand(TabRpcClient, { cwd }, { timeout: 60000 });
        // a failed fetch reports no time; the previous one still happened, so the clock keeps reading it
        const prevAt = fetchStateOf(globalStore.get(fetchStatesAtom), cwd).at;
        setFetchState(cwd, { running: false, at: r.fetchedat || prevAt, failure: r.failure ?? null });
        if (r.failure != null) {
            return;
        }
        // The refs moved, so what the picker suggests and what the comparison means both moved with
        // them. Re-reading is the point of having fetched.
        await loadCompareRefsMeta(cwd);
        const refs = globalStore.get(compareRefsAtom);
        if (refs != null) {
            await setCompareRefs(cwd, refs.base, refs.head);
        }
    } catch {
        // An RPC-level failure has no stderr to show, so say the one thing that is known rather than
        // leaving the button spinning.
        setFetchState(cwd, {
            running: false,
            failure: { command: "git fetch", exitcode: -1, stderr: "the fetch did not complete" },
        });
    }
}

export function dismissFetchFailure(cwd: string): void {
    setFetchState(cwd, { failure: null });
}

export async function selectCompareRow(cwd: string, rowId: string): Promise<void> {
    globalStore.set(compareSelectionAtom, rowId);
    globalStore.set(compareSelectedFileAtom, null);
    if (rowId === AGGREGATE) {
        const first = globalStore.get(compareAggregateAtom)?.files[0]?.path;
        if (first) {
            selectCompareFile(first);
        }
        return;
    }
    globalStore.set(commitChangesAtom, null);
    globalStore.set(commitChangesStatusAtom, "loading");
    try {
        await devCommitFault();
        const ch = await RpcApi.GitCommitChangesCommand(TabRpcClient, { cwd, hash: rowId });
        if (globalStore.get(compareSelectionAtom) !== rowId) {
            return; // selection moved on
        }
        if (!ch.isrepo) {
            globalStore.set(commitChangesStatusAtom, "failed");
            return;
        }
        const changes = parseGitChanges(ch.statusz, ch.numstat);
        globalStore.set(commitChangesAtom, changes);
        globalStore.set(commitChangesStatusAtom, "ready");
        const first = changes.files[0]?.path;
        if (first) {
            selectCompareFile(first);
        }
    } catch {
        if (globalStore.get(compareSelectionAtom) === rowId) {
            globalStore.set(commitChangesAtom, null);
            globalStore.set(commitChangesStatusAtom, "failed");
        }
    }
}

// The Retry on a compare commit whose files failed to read: the same row, the same repository.
export function retrySelectedCompareRow(): void {
    const rowId = globalStore.get(compareSelectionAtom);
    if (rowId === AGGREGATE || !remembered.cwd) {
        return;
    }
    void selectCompareRow(remembered.cwd, rowId);
}

// Selection only. Which two refs the aggregate row and a commit row mean is the pane's question now
// (diffcontent.ts), and it reads the same compareSelectionAtom this writes.
export function selectCompareFile(path: string): void {
    globalStore.set(compareSelectedFileAtom, path);
}
