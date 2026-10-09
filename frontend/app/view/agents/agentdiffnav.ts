// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Every way into the Diff surface from elsewhere in the cockpit. One helper rather than a sequence
// each caller assembles, because the file link and the change-list load have to name the scope with
// the same string: a link built from a different one is silently never claimed, and the surface opens
// on its first file instead of the one that was clicked.

import { globalStore } from "@/app/store/jotaiStore";
import { fireAndForget } from "@/util/util";
import type { AgentsViewModel } from "./agents";
import { setCompareRefs } from "./comparestore";
import { defaultRangeFor, scopeKey, type DiffOrigin, type DiffScope } from "./diffscope";
import { requestFileLink } from "./filesstore";
import { runTree } from "./runmodel";

export function agentDiffScope(agentId: string, label: string): DiffScope {
    const origin: DiffOrigin = { kind: "agent", id: agentId };
    return { repo: { origin, label }, range: defaultRangeFor(origin) };
}

// baseCommit is optional because a run may have none: it degrades to "" — the live HEAD diff — which
// is what the change-list loader treats as "no anchor". Defaulting here rather than at each call site
// keeps that guarantee in one tested place.
export function runDiffScope(runId: string, cwd: string, baseCommit?: string): DiffScope {
    const origin: DiffOrigin = { kind: "run", runId, cwd, baseCommit: baseCommit ?? "" };
    return { repo: { origin, label: `run ${runId.slice(0, 8)}` }, range: defaultRangeFor(origin) };
}

// a run's changes live where its lanes landed: its own branch tree when it has one, else the checkout
export function diffScopeOfRun(run: Pick<Run, "id" | "projectpath" | "landpath" | "basecommit">): DiffScope {
    return runDiffScope(run.id, runTree(run), run.basecommit);
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
    globalStore.set(model.surfaceAtom, "files");
}

// the whole branch on the Diff surface: a compare from the default branch it left (merge-base form, what the branch
// introduced), returning to the scope's own range on leaving it
export function openBranchDiff(
    model: AgentsViewModel,
    scope: DiffScope,
    cwd: string,
    base: string,
    head: string
): void {
    openDiff(model, { ...scope, range: { kind: "compare", base, head, form: "mergebase", from: scope.range } });
    fireAndForget(() => setCompareRefs(cwd, base, head));
}
