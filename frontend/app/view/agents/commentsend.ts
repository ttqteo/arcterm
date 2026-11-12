// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Who receives a batch of diff comments and how they get there: a live agent takes the prompt through its
// mod (else it is typed), anything else gets a new Claude Code agent with the prompt as its task. As in
// canvassend.ts, each failing step throws with what failed and the batch stays for a retry.

import { launchAgent } from "@/app/cockpit/cockpit-actions";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { buildCommentPrompt } from "./commentprompt";
import { removeComments, sentNoteAtom, type CommentBatch } from "./diffcomments";
import { runtimeStartupCommand } from "./launch";
import { folderName } from "./usageattribution";

export type Recipient =
    | { kind: "live"; name: string; blockId: string; working: boolean }
    // folder: how the bar names the place ("waveterm", "loom's folder"); ended: the agent that is gone
    | { kind: "new"; cwd: string; project: string; folder: string; ended?: string }
    // forAgent: the wait is on a live agent that will take the comments, so the button does not offer to start one
    | { kind: "wait"; reason: string; forAgent?: true };

export interface RecipientFacts {
    // the roster entry, absent when the agent has ended
    agent?: Pick<AgentVM, "name" | "blockId" | "state" | "kind" | "runId">;
    run?: Pick<Run, "status" | "landpath" | "land" | "projectpath">;
    // the registered path for batch.source.project
    projectPath?: string;
    // for batch.source.cwd; null while unknown
    folderExists: boolean | null;
}

const RUN_ID_CHARS = 8;

function shortRun(id: string): string {
    return id.slice(0, RUN_ID_CHARS);
}

function newAgent(
    cwd: string,
    project: string | undefined,
    extra: { folder?: string; ended?: string } = {}
): Recipient {
    return { kind: "new", cwd, project: project || folderName(cwd), folder: extra.folder ?? folderName(cwd), ...extra };
}

// the run's tree is gone once it landed, so its changes live in the project's path; before that a new
// agent editing the landing tree would make the land refuse
function resolveRun(runId: string, batch: CommentBatch, run: RecipientFacts["run"]): Recipient {
    const name = `run ${shortRun(runId)}`;
    if (run == null) {
        return { kind: "wait", reason: `checking ${name}` };
    }
    const landed = run.land?.state === "landed" || (!run.landpath && run.status === "done");
    if (landed) {
        return run.projectpath
            ? newAgent(run.projectpath, batch.source.project)
            : { kind: "wait", reason: `${name} has no project folder` };
    }
    if (run.land?.state === "held") {
        return { kind: "wait", reason: `${name} is held before land${run.land.reason ? `: ${run.land.reason}` : ""}` };
    }
    if (run.status === "cancelled" && run.landpath) {
        return { kind: "wait", reason: `${name} ended without landing` };
    }
    return { kind: "wait", reason: `${name} hasn't landed; send once it does` };
}

function resolveProject(batch: CommentBatch, projectPath: string | undefined): Recipient {
    const path = projectPath || batch.source.projectPath;
    return path ? newAgent(path, batch.source.project) : { kind: "wait", reason: "the project's folder is unknown" };
}

function resolveEnded(batch: CommentBatch, facts: RecipientFacts): Recipient {
    const { source } = batch;
    const ended = source.label;
    if (source.cwd && facts.folderExists === null) {
        return { kind: "wait", reason: "checking the folder" };
    }
    if (source.cwd && facts.folderExists) {
        return newAgent(source.cwd, source.project, { folder: `${ended}'s folder`, ended });
    }
    const path = facts.projectPath || source.projectPath;
    return path ? newAgent(path, source.project, { ended }) : { kind: "wait", reason: "the folder is gone" };
}

export function resolveRecipient(batch: CommentBatch, facts: RecipientFacts): Recipient {
    const { source } = batch;
    switch (source.kind) {
        case "project":
            return resolveProject(batch, facts.projectPath);
        case "worktree":
            // its own checkout, never the registered project's path, which is the main checkout
            return source.projectPath
                ? newAgent(source.projectPath, source.project)
                : { kind: "wait", reason: "the worktree's folder is unknown" };
        case "run":
            return resolveRun(source.runId ?? "", batch, facts.run);
        case "agent": {
            // an agent a run started belongs to the run: edits in its tree can be lost or block the land
            const runId = facts.agent?.runId ?? source.runId;
            if (runId) {
                return resolveRun(runId, batch, facts.run);
            }
            const a = facts.agent;
            // a plain terminal is never live: a prompt pasted into a shell would run as commands
            if (a?.blockId && a.kind !== "terminal") {
                // a prompt typed now would answer the agent's open question
                if (a.state === "asking") {
                    return { kind: "wait", reason: `${a.name} is asking a question — answer it first`, forAgent: true };
                }
                return { kind: "live", name: a.name, blockId: a.blockId, working: a.state === "working" };
            }
            return resolveEnded(batch, facts);
        }
    }
}

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// count and detail are the bar's text around the recipient ("3 comments in 2 files", then "to loom");
// action is the Send button's label
export function sendBarText(
    summary: { comments: number; files: number },
    r: Recipient
): { count: string; detail: string; action: string } {
    const comments = plural(summary.comments, "comment");
    const count = `${comments} in ${plural(summary.files, "file")}`;
    switch (r.kind) {
        case "live":
            return {
                count,
                detail: r.working ? "working, joins its turn" : "at its prompt",
                action: `Send ${comments}`,
            };
        case "new":
            return { count, detail: `in ${r.folder}`, action: `Start agent with ${comments}` };
        case "wait":
            return {
                count,
                detail: r.reason,
                action: r.forAgent ? `Send ${comments}` : `Start agent with ${comments}`,
            };
    }
}

export interface CommentSendIO {
    prompt(blockId: string, text: string): Promise<void>;
    launch(cwd: string, project: string, task: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}

export function tauriCommentSendIO(model: AgentsViewModel): CommentSendIO {
    return {
        async prompt(blockId, text) {
            await RpcApi.AgentPromptCommand(TabRpcClient, { blockid: blockId, text });
        },
        async launch(cwd, project, task) {
            await launchAgent(model, {
                runtime: "claude",
                startupCommand: runtimeStartupCommand("claude"),
                task,
                projectPath: cwd,
                projectName: project,
            });
        },
        // FileInfoCommand rejects on a path that is not there, and some builds answer with notfound instead
        async exists(path) {
            try {
                const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
                return info != null && !info.notfound && info.isdir === true;
            } catch {
                return false;
            }
        },
    };
}

function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

async function step(what: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
    } catch (e) {
        throw new Error(`${what}: ${errText(e)}`);
    }
}

// The send bar's send, registered while the bar is mounted so Shift+Enter on the surface reaches it, as
// diffcommentlayer.ts does for `m`. It returns false when there is nothing to send.
let mountedSend: (() => boolean) | null = null;

export function registerCommentSend(send: () => boolean): () => void {
    mountedSend = send;
    // by identity: a teardown that lands after the next bar mounted must not unregister it
    return () => {
        if (mountedSend === send) {
            mountedSend = null;
        }
    };
}

// false = no bar mounted, no batch, or a recipient that has to wait, so the binding lets the key pass
export function sendPendingComments(): boolean {
    return mountedSend?.() ?? false;
}

// the batches being sent, by source key: a second Shift+Enter must not hand the same comments over twice
const sending = new Set<string>();

// A send already in flight for this batch resolves without sending: the first call reports the outcome.
export async function sendBatch(batch: CommentBatch, r: Recipient, io: CommentSendIO): Promise<void> {
    if (r.kind === "wait") {
        throw new Error(r.reason);
    }
    const key = batch.source.key;
    if (sending.has(key)) {
        return;
    }
    sending.add(key);
    // the snapshot the prompt is built from: a comment added during the hand-over stays for the next send
    const sent = batch.comments.map((c) => c.id);
    try {
        if (r.kind === "live") {
            await step(`Couldn't send to ${r.name}`, () => io.prompt(r.blockId, buildCommentPrompt(batch, "live")));
            removeComments(key, sent);
            const notes = globalStore.get(sentNoteAtom);
            globalStore.set(sentNoteAtom, {
                ...notes,
                [key]: { count: batch.comments.length, to: r.name, at: Date.now() },
            });
            return;
        }
        await step(`Couldn't start an agent in ${r.folder}`, () =>
            io.launch(r.cwd, r.project, buildCommentPrompt(batch, "new"))
        );
        removeComments(key, sent);
    } finally {
        sending.delete(key);
    }
}
