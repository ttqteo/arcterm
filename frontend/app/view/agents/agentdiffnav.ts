// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Every way into the Diff surface from elsewhere in the cockpit. One helper rather than a sequence
// each caller assembles, because the file link and the change-list load have to name the scope with
// the same string: a link built from a different one is silently never claimed, and the surface opens
// on its first file instead of the one that was clicked.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { landOn } from "@/app/view/jarvis/returnsurface";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import { selectCompareRow, setCompareRefs } from "./comparestore";
import { panelAppliedKeyAtom } from "./difflayout";
import { defaultRangeFor, scopeKey, type DiffOrigin, type DiffScope } from "./diffscope";
import { requestFileLink } from "./filesstore";
import { HISTORY_RPC_TIMEOUT_MS } from "./historyquery";
import { runTree } from "./runmodel";

export function agentDiffScope(agentId: string, label: string): DiffScope {
    const origin: DiffOrigin = { kind: "agent", id: agentId };
    return { repo: { origin, label }, range: defaultRangeFor(origin) };
}

// baseCommit is optional because a run may have none: it degrades to "" — the live HEAD diff — which
// is what the change-list loader treats as "no anchor". Defaulting here rather than at each call site
// keeps that guarantee in one tested place. headCommit bounds a landed run at its own tip; absent or "" reads up to
// HEAD, under the unbounded key its review marks were saved with.
export function runDiffScope(runId: string, cwd: string, baseCommit?: string, headCommit?: string): DiffScope {
    const origin: DiffOrigin = headCommit
        ? { kind: "run", runId, cwd, baseCommit: baseCommit ?? "", headCommit }
        : { kind: "run", runId, cwd, baseCommit: baseCommit ?? "" };
    return { repo: { origin, label: `run ${runId.slice(0, 8)}` }, range: defaultRangeFor(origin) };
}

// a run's changes live where its lanes landed: its own branch tree when it has one, else the checkout
export function diffScopeOfRun(run: Pick<Run, "id" | "projectpath" | "landpath" | "land" | "basecommit">): DiffScope {
    return runDiffScope(run.id, runTree(run), run.basecommit);
}

// The checkout's repo root, which git lists as the main worktree. A project can be a subfolder of its repo, and the
// readers diff --relative to their cwd, so reading a landed run from the project would drop what it changed elsewhere.
async function checkoutRoot(projectPath: string): Promise<string | undefined> {
    try {
        const res = await RpcApi.GitListWorktreesCommand(TabRpcClient, { cwd: projectPath });
        return res?.worktrees?.find((wt) => wt.ismain)?.path;
    } catch (e) {
        console.warn("reading the repo root of", projectPath, e);
        return undefined;
    }
}

// A land is a --no-ff merge, so its second parent is the run branch's tip; one parent means the land commit is the
// tip itself (a fast-forward, or a hand-merge mergedCommit recorded as the tip). "" = unbounded.
export function landedRunTip(
    landCommit: string | undefined,
    parents: string[] | undefined,
    endCommit: string | undefined
): string {
    if (landCommit && parents != null && parents.length >= 2) {
        return parents[1];
    }
    if (landCommit && parents?.length === 1) {
        return landCommit;
    }
    return endCommit ?? "";
}

// A land commit that no longer resolves (gc'd, shallow clone) falls back rather than failing the diff.
async function landCommitParents(cwd: string, landCommit: string | undefined): Promise<string[] | undefined> {
    if (!landCommit) {
        return undefined;
    }
    try {
        const h = await RpcApi.GitHistoryCommand(
            TabRpcClient,
            { cwd, ref: landCommit, limit: 1 },
            { timeout: HISTORY_RPC_TIMEOUT_MS }
        );
        if (h.failure) {
            console.warn("reading the parents of land commit", landCommit, h.failure);
            return undefined;
        }
        return h.commits?.[0]?.parents;
    } catch (e) {
        console.warn("reading the parents of land commit", landCommit, e);
        return undefined;
    }
}

// A landed run's tree is removed, and its commits are merged into the checkout. Its tree was a worktree of the whole
// repo, so the checkout is read from its repo root, bounded at the run's own tip so later commits are not counted.
export async function openRunDiff(model: AgentsViewModel, run: Run, file?: string): Promise<void> {
    let scope = diffScopeOfRun(run);
    if (run.land?.state === "landed") {
        const root = (await checkoutRoot(run.projectpath)) ?? runTree(run);
        const parents = await landCommitParents(root, run.land.commit);
        const tip = landedRunTip(run.land.commit, parents, run.endcommit);
        scope = runDiffScope(run.id, root, run.basecommit, tip);
    }
    openDiff(model, scope, file);
}

export function projectDiffScope(name: string, path: string): DiffScope {
    const origin: DiffOrigin = { kind: "project", name, path };
    return { repo: { origin, label: name }, range: defaultRangeFor(origin) };
}

// The file link is requested before the surface switch because the surface's mount triggers the load
// that consumes it.
export function openDiff(model: AgentsViewModel, scope: DiffScope, file?: string): void {
    if (file) {
        requestFileLink(scopeKey(scope), file);
    }
    globalStore.set(model.diffScopeAtom, scope);
    // the caller named what to see, so the panel opens on the tab that subject calls for even if it was shown before
    globalStore.set(panelAppliedKeyAtom, "");
    landOn(model.surfaceAtom, "files");
}

// the whole branch on the Diff surface: a compare from the default branch it left (merge-base form, what the branch
// introduced), returning to the scope's own range on leaving it. `select` is a commit of that range to open on;
// setCompareRefs resets the selection to the aggregate before its reads, so the commit is chosen after it resolves.
export function openBranchDiff(
    model: AgentsViewModel,
    scope: DiffScope,
    cwd: string,
    base: string,
    head: string,
    select?: string
): void {
    openDiff(model, { ...scope, range: { kind: "compare", base, head, form: "mergebase", from: scope.range } });
    fireAndForget(async () => {
        await setCompareRefs(cwd, base, head);
        if (select) {
            await selectCompareRow(cwd, select);
        }
    });
}
