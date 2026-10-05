// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The PDF tab's compile, per agent. A .tex review compiles in the background as soon as its state loads, in
// terminal or review mode and whichever tab shows, so the PDF is usually ready by the time the user looks. One
// compile runs per review at a time; its result is kept for the ask, so switching tabs or remounting never
// recompiles, and only Recompile (force) runs it again. A new ask drops the old result.

import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai/utils";
import { useEffect } from "react";
import type { AgentsViewModel } from "./agents";
import { getDocReview } from "./docreviewstore";

export interface DocPdfState {
    askId: string;
    path: string;
    pending: boolean;
    result: CommandDocCompileRtnData | null; // the last result for this ask, kept while a recompile runs
    error: string | null; // the RPC itself failed
    startedAt: number; // when the running, or last, compile started
    at: number; // when the last result or error landed
}

// The server stops a compile at 90 s. With no timeout of its own the RPC gives the handler 5 s, so a longer
// compile would come back as a context error instead of its result.
export const COMPILE_RPC_TIMEOUT_MS = 120_000;

export const docPdfAtom = atomFamily(
    (_agentId: string) => atom<DocPdfState | null>(null) as PrimitiveAtom<DocPdfState | null>
);

// ---------------------------------------------------------------------------------------------------------------
// the scenario's fixture (DEV hook below): it answers the next compile in place of the RPC

export type CompileFixture = Partial<CommandDocCompileRtnData> | "pending";

let fixture: { value: CompileFixture; keep: boolean } | null = null;
let calls = 0;

// `keep` answers every compile until replaced; otherwise the next compile uses it up. null puts the RPC back.
export function setCompileFixture(value: CompileFixture | null, opts: { keep?: boolean } = {}): void {
    fixture = value == null ? null : { value, keep: opts.keep === true };
}

export function compileCalls(): number {
    return calls;
}

function takeFixture(): CompileFixture | null {
    const f = fixture;
    if (f != null && !f.keep) {
        fixture = null;
    }
    return f?.value ?? null;
}

function runCompile(path: string): Promise<CommandDocCompileRtnData> {
    const f = takeFixture();
    if (f === "pending") {
        return new Promise(() => {});
    }
    if (f != null) {
        return Promise.resolve({ rootpath: path, ok: true, engine: "latexmk", durationms: 6200, pages: 0, ...f });
    }
    return RpcApi.DocCompileCommand(TabRpcClient, { path }, { timeout: COMPILE_RPC_TIMEOUT_MS });
}

function countCall(): void {
    calls++;
    if (import.meta.env.DEV && typeof window !== "undefined") {
        window.__docCompileCalls = calls;
    }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------------------------------------------

export function getDocPdf(agentId: string): DocPdfState | null {
    return globalStore.get(docPdfAtom(agentId));
}

// lands a compile's outcome, unless the agent asked again while it ran
function land(agentId: string, askId: string, patch: Partial<DocPdfState>): void {
    const cur = getDocPdf(agentId);
    if (cur?.askId === askId) {
        globalStore.set(docPdfAtom(agentId), { ...cur, ...patch, pending: false, at: Date.now() });
    }
}

export function startDocCompile(
    agentId: string,
    path: string,
    askId: string,
    opts: { force?: boolean } = {},
    now = Date.now()
): Promise<void> {
    let cur = getDocPdf(agentId);
    if (cur?.askId === askId) {
        if (cur.pending || (!opts.force && (cur.result != null || cur.error != null))) {
            return Promise.resolve();
        }
    } else {
        cur = { askId, path, pending: false, result: null, error: null, startedAt: 0, at: 0 };
    }
    globalStore.set(docPdfAtom(agentId), { ...cur, path, pending: true, startedAt: now });
    countCall();
    return runCompile(path).then(
        (result) => land(agentId, askId, { result, error: null }),
        (e) => land(agentId, askId, { error: errorText(e) })
    );
}

// In the always-mounted shell, after useDocReviewSync: each .tex review starts its compile once its state exists.
export function useDocCompileSync(model: AgentsViewModel): void {
    const agents = useAtomValue(model.agentsAtom);
    const key = agents.map((a) => `${a.id}:${a.ask?.askId ?? ""}`).join(",");
    useEffect(() => {
        for (const a of agents) {
            const s = getDocReview(a.id);
            if (s?.doc === "latex") {
                fireAndForget(() => startDocCompile(a.id, s.path, s.askId));
            }
        }
    }, [key]);
}

// DEV-only, for the doc-review-mode scenario: __docCompileFixture(value, { keep }) answers the next compile the
// way the RPC would (a partial result merged over an ok one for the file, or "pending" to leave it compiling;
// null for the real RPC), and __docCompileCalls counts the compiles started, real or fixture.
if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__docCompileFixture = setCompileFixture;
    window.__docCompileCalls = calls;
}

declare global {
    interface Window {
        __docCompileFixture?: (value: CompileFixture | null, opts?: { keep?: boolean }) => void;
        __docCompileCalls?: number;
    }
}
