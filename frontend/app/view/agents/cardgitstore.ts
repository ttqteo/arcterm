// frontend/app/view/agents/cardgitstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Per-card git diff stats (files/adds/dels) for the cockpit grid. Mirrors railstore.ts (which loads
// the same for the single focused agent) but keyed by agent id for every rendered card. The card
// grid effect drives this: refreshCardGit on enter, scheduleCardGit (debounced) on transcript
// activity, dropCardGit on leave. cwd resolution + the pure GitChanges parse are shared with the
// Files surface / rail.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { readAgentChanges } from "./agentchanges";
import type { DiffStats } from "./agentsviewmodel";
import { resolveCwd } from "./agentcwdresolve";
import { ensureSessionStart } from "./agentsessionstore";
import { parseGitChanges, type GitChanges } from "./gitstatus";

export const diffStatsByIdAtom = atom<Record<string, DiffStats>>({}) as PrimitiveAtom<Record<string, DiffStats>>;

/** Pure: collapse a GitChanges into the card's headline stats. */
export function diffStatsFromChanges(changes: GitChanges): DiffStats {
    return { files: changes.files.length, adds: changes.adds, dels: changes.dels };
}

// debounce after transcript activity — git runs while an agent works, idles when quiet
const DEBOUNCE_MS = 4000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
// monotonically-increasing load token per id: a newer load supersedes an in-flight older one
const loadSeq = new Map<string, number>();

function setStats(id: string, stats: DiffStats | null): void {
    const cur = globalStore.get(diffStatsByIdAtom);
    if (stats == null) {
        if (!(id in cur)) {
            return;
        }
        const { [id]: _, ...rest } = cur;
        globalStore.set(diffStatsByIdAtom, rest);
        return;
    }
    globalStore.set(diffStatsByIdAtom, { ...cur, [id]: stats });
}

/** Resolve the agent's cwd and load git changes for it, updating diffStatsByIdAtom. A clean repo,
 *  non-repo, or unresolvable cwd drops the id from the map (the card's diff button hides). Guarded
 *  so a superseding load (or a drop) discards a slower older result. `runtime` is the AgentVM's `agent`:
 *  a Claude agent (absent counts as one) is counted on its own edits, any other on its checkout. */
export async function refreshCardGit(
    id: string,
    transcriptPath: string | undefined,
    blockId?: string,
    runtime?: string
): Promise<void> {
    const seq = (loadSeq.get(id) ?? 0) + 1;
    loadSeq.set(id, seq);
    const [cwd, startTs] = await Promise.all([resolveCwd(transcriptPath, blockId), ensureSessionStart(transcriptPath)]);
    if (loadSeq.get(id) !== seq) {
        return;
    }
    if (!cwd) {
        setStats(id, null);
        return;
    }
    try {
        // a Claude agent's pill counts only its own edits; any other anchors on the commit that was HEAD when its
        // session began (commits since start + uncommitted), and a null ts (no transcript yet) degrades to the live
        // working-tree-vs-HEAD diff
        const { ch } = await readAgentChanges(cwd, { transcriptPath, runtime }, startTs);
        if (loadSeq.get(id) !== seq) {
            return;
        }
        if (!ch.isrepo) {
            setStats(id, null);
            return;
        }
        if (ch.numstaterror) {
            // the file list is there but its line counts are not: a +0 −0 chip would claim no edits
            console.warn(`cardgit: line counts failed for agent ${id}`, ch.numstaterror);
            setStats(id, null);
            return;
        }
        const stats = diffStatsFromChanges(parseGitChanges(ch.statusz, ch.numstat));
        setStats(id, stats.files > 0 ? stats : null);
    } catch {
        if (loadSeq.get(id) === seq) {
            setStats(id, null);
        }
    }
}

/** Debounced refresh, coalescing a burst of transcript activity into one git load. */
export function scheduleCardGit(
    id: string,
    transcriptPath: string | undefined,
    blockId?: string,
    runtime?: string
): void {
    const existing = timers.get(id);
    if (existing) {
        clearTimeout(existing);
    }
    timers.set(
        id,
        setTimeout(() => {
            timers.delete(id);
            void refreshCardGit(id, transcriptPath, blockId, runtime);
        }, DEBOUNCE_MS)
    );
}

/** Stop tracking an agent that left the rendered set: cancel its pending refresh, invalidate any
 *  in-flight load, and drop its stats. */
export function dropCardGit(id: string): void {
    const existing = timers.get(id);
    if (existing) {
        clearTimeout(existing);
        timers.delete(id);
    }
    loadSeq.set(id, (loadSeq.get(id) ?? 0) + 1);
    setStats(id, null);
}
