// frontend/app/view/code/codesearchstore.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Content-search state for the Code surface. Its own module rather than more of codestore.ts, which
// is already 325 lines and owns a different concern (the file index and the open buffer).
//
// It deliberately imports nothing from codestore: runSearch takes the project as an argument, so
// codestore can import resetSearch to clear this on a project switch without an import cycle.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atom, type PrimitiveAtom } from "jotai";
import { DEFAULT_SEARCH_OPTS, grepData, type SearchOpts } from "./codesearchopts";

// One union rather than parallel loading/error booleans, for the same reason CodeFile is one: the
// pane renders an exhaustive switch and cannot land in a contradictory pair of states.
export type SearchState =
    | { kind: "idle" }
    | { kind: "searching"; query: string }
    | { kind: "done"; query: string; matches: GitGrepMatch[]; truncated: boolean }
    | { kind: "error"; query: string; message: string };

// "changed" is the working tree's change list — a navigation aid, not a diff: a row opens the
// editor, and the diff for the file you land on is one toggle away in the path bar. "symbols" is the
// open file's outline.
export type CodeColumnMode = "files" | "search" | "changed" | "symbols";
export const codeSearchModeAtom = atom<CodeColumnMode>("files") as PrimitiveAtom<CodeColumnMode>;
export const codeSearchQueryAtom = atom<string>("") as PrimitiveAtom<string>;
export const codeSearchAtom = atom<SearchState>({ kind: "idle" }) as PrimitiveAtom<SearchState>;
export const codeSearchOptsAtom = atom<SearchOpts>(DEFAULT_SEARCH_OPTS) as PrimitiveAtom<SearchOpts>;
// beside the state rather than in it: an invalid pattern leaves the previous results on screen
export const codeSearchInvalidAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
// what a search the surface ran for you was asking — "Definitions of openPath" — so a list of
// candidates reads as the answer rather than as a broken jump. Any search typed by hand clears it.
export const codeSearchTitleAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// The RPC layer's DefaultTimeoutMs is 5s and it binds the SERVER-side context, so a search the
// server would have finished gets killed under it. The reader self-limits at gitinfo's 10s
// gitTimeout; this ceiling sits above that so git's own limit is the one that decides.
const GREP_RPC_TIMEOUT_MS = 20_000;

// guards a slow search against a newer one, same pattern as codestore's index and file loads
const current = { token: "" };

export function grepProject(projectPath: string, query: string, opts: SearchOpts): Promise<CommandGitGrepRtnData> {
    return RpcApi.GitGrepCommand(TabRpcClient, grepData(projectPath, query, opts), { timeout: GREP_RPC_TIMEOUT_MS });
}

export async function runSearch(
    project: { path: string },
    query: string,
    opts: SearchOpts,
    title: string | null = null
): Promise<void> {
    const q = query.trim();
    globalStore.set(codeSearchInvalidAtom, false);
    globalStore.set(codeSearchTitleAtom, title);
    if (q === "") {
        globalStore.set(codeSearchAtom, { kind: "idle" });
        return;
    }
    // the options are part of the token: toggling a flag re-runs the same query
    const token = `${project.path}|${q}|${JSON.stringify(opts)}`;
    current.token = token;
    const before = globalStore.get(codeSearchAtom);
    globalStore.set(codeSearchAtom, { kind: "searching", query: q });
    try {
        const res = await grepProject(project.path, q, opts);
        if (current.token !== token) {
            return;
        }
        if (res.invalidpattern) {
            // a regex typo is the user's to fix, not a failed read: flag the input, keep the results
            globalStore.set(codeSearchAtom, before.kind === "searching" ? { kind: "idle" } : before);
            globalStore.set(codeSearchInvalidAtom, true);
            return;
        }
        globalStore.set(codeSearchAtom, {
            kind: "done",
            query: q,
            matches: res.matches ?? [],
            truncated: res.truncated ?? false,
        });
    } catch (e) {
        if (current.token !== token) {
            return;
        }
        // a failed RPC is an error, not an empty repository — the same distinction the index load makes
        globalStore.set(codeSearchAtom, {
            kind: "error",
            query: q,
            message: e instanceof Error ? e.message : String(e),
        });
    }
}

// Puts a search the surface already ran into the pane, as if typed: the query and filters are left
// in the inputs so the user can loosen them and press Enter. Supersedes any search still in flight.
export function showSearch(r: { query: string; opts: SearchOpts; title: string; state: SearchState }): void {
    current.token = "";
    globalStore.set(codeSearchQueryAtom, r.query);
    globalStore.set(codeSearchOptsAtom, r.opts);
    globalStore.set(codeSearchInvalidAtom, false);
    globalStore.set(codeSearchTitleAtom, r.title);
    globalStore.set(codeSearchAtom, r.state);
    globalStore.set(codeSearchModeAtom, "search");
}

export function resetSearch(): void {
    current.token = "";
    globalStore.set(codeSearchQueryAtom, "");
    globalStore.set(codeSearchAtom, { kind: "idle" });
    globalStore.set(codeSearchOptsAtom, DEFAULT_SEARCH_OPTS);
    globalStore.set(codeSearchInvalidAtom, false);
    globalStore.set(codeSearchTitleAtom, null);
    globalStore.set(codeSearchModeAtom, "files");
}
