// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Is a conversation item the same as the one drawn for its key last time? chatItems (chatmodel.ts) rebuilds every item from
// every entry on each append, so none keeps its identity while the agent streams; what React needs to skip a settled item is
// an element it has already seen, and chatconversation.tsx keeps that element while this says the item did not change. Pure.
//
// An item changes only in ways the transcript can write: text is final once written, and the one thing that lands later is a
// tool call's result, which sets its outcome and duration together with its detail. So a tool call is compared by what a
// result sets and by the size of its detail, never by walking a Read's body, which would cost what the render it saves does.

import type { ActionDetail, AgentActionEntry, EditFile } from "./agentsviewmodel";
import type { AgentPart, ChatItem } from "./chatmodel";

function sameStrings(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
    if (a === b) {
        return true;
    }
    return a != null && b != null && a.length === b.length && a.every((s, i) => s === b[i]);
}

function sameFiles(a: EditFile[], b: EditFile[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (f, i) =>
                f.path === b[i].path &&
                f.adds === b[i].adds &&
                f.dels === b[i].dels &&
                f.lines.length === b[i].lines.length
        )
    );
}

function sameDetail(a: ActionDetail | undefined, b: ActionDetail | undefined): boolean {
    if (a === b) {
        return true;
    }
    if (a == null || b == null || a.kind !== b.kind) {
        return false;
    }
    switch (a.kind) {
        case "grep":
            return a.matches.length === (b as typeof a).matches.length && a.more === (b as typeof a).more;
        case "read":
            return a.snippet.length === (b as typeof a).snippet.length && a.truncated === (b as typeof a).truncated;
        case "bash":
            return (
                a.command === (b as typeof a).command &&
                a.exit === (b as typeof a).exit &&
                a.output.length === (b as typeof a).output.length
            );
        case "skill":
            return a.name === (b as typeof a).name && a.args === (b as typeof a).args;
        case "edit":
            return sameFiles(a.files, (b as typeof a).files);
        case "ask": {
            const other = b as typeof a;
            return (
                a.questions.length === other.questions.length &&
                a.questions.every(
                    (q, i) => q.typed === other.questions[i].typed && sameStrings(q.picked, other.questions[i].picked)
                )
            );
        }
    }
}

function sameAction(a: AgentActionEntry, b: AgentActionEntry): boolean {
    return (
        a.verb === b.verb &&
        a.target === b.target &&
        a.path === b.path &&
        a.outcome === b.outcome &&
        a.note === b.note &&
        a.summary === b.summary &&
        a.durationMs === b.durationMs &&
        a.startedAt === b.startedAt &&
        sameDetail(a.detail, b.detail)
    );
}

function samePart(a: AgentPart, b: AgentPart): boolean {
    switch (a.kind) {
        case "prose":
            return b.kind === "prose" && a.text === b.text && a.uuid === b.uuid && a.live === b.live;
        case "work":
            return (
                b.kind === "work" &&
                a.work.startIndex === b.work.startIndex &&
                a.work.durationMs === b.work.durationMs &&
                a.work.failed === b.work.failed &&
                a.work.actions.length === b.work.actions.length &&
                a.work.actions.every((action, i) => sameAction(action, b.work.actions[i]))
            );
        case "files":
            return b.kind === "files" && a.adds === b.adds && a.dels === b.dels && sameFiles(a.files, b.files);
        // the moments are small, plain data (a verdict and its reviewer call, a question, an anchor): compared whole
        case "verdict":
            return (
                b.kind === "verdict" &&
                a.key === b.key &&
                JSON.stringify(a.verdict) === JSON.stringify(b.verdict) &&
                JSON.stringify(a.reviewer) === JSON.stringify(b.reviewer)
            );
        case "handoff":
            return b.kind === "handoff" && a.key === b.key && JSON.stringify(a.question) === JSON.stringify(b.question);
        case "runstart":
            return b.kind === "runstart" && a.key === b.key && JSON.stringify(a.anchor) === JSON.stringify(b.anchor);
        case "councilstart":
            return (
                b.kind === "councilstart" && a.key === b.key && JSON.stringify(a.anchor) === JSON.stringify(b.anchor)
            );
        case "docreview":
            return (
                b.kind === "docreview" && a.key === b.key && JSON.stringify(a.question) === JSON.stringify(b.question)
            );
    }
}

/** Pure: does `b` draw exactly as `a` did? Both are items of the same key. */
export function sameChatItem(a: ChatItem, b: ChatItem): boolean {
    if (a === b) {
        return true;
    }
    if (a.kind !== b.kind || a.key !== b.key) {
        return false;
    }
    switch (a.kind) {
        case "you": {
            const other = b as typeof a;
            if ("command" in a || "command" in other) {
                return (
                    "command" in a &&
                    "command" in other &&
                    a.command === other.command &&
                    a.shell?.output === other.shell?.output &&
                    a.shell?.error === other.shell?.error &&
                    a.terminal === other.terminal &&
                    JSON.stringify(a.btw) === JSON.stringify(other.btw)
                );
            }
            return (
                a.text === other.text &&
                a.uuid === other.uuid &&
                sameStrings(a.images, other.images) &&
                a.chunk?.n === other.chunk?.n &&
                a.chunk?.label === other.chunk?.label
            );
        }
        case "sent": {
            const other = b as typeof a;
            return (
                a.from === other.from &&
                a.header === other.header &&
                a.tabId === other.tabId &&
                sameStrings(a.lines, other.lines)
            );
        }
        case "agent": {
            const other = b as typeof a;
            return a.parts.length === other.parts.length && a.parts.every((part, i) => samePart(part, other.parts[i]));
        }
        case "marker":
            return JSON.stringify(a.item) === JSON.stringify((b as typeof a).item);
    }
}
