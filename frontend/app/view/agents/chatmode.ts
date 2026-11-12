// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat or Terminal: what a Claude agent's cell shows while its terminal slot is on screen. It composes with
// agentview.ts rather than widening it: Chat and Terminal are the same AgentView, "terminal" (the cell stack is on
// screen), and which of the two shows is the agent's chat mode. The header's control and Alt+C walk both at once
// through cellViewOptions / nextCellView. The store (localStorage agent.chatmode) is chatmodestore.ts.

import type { AgentVM } from "./agentsviewmodel";
import type { AgentView } from "./agentview";
import { isFinalStageId } from "./finalstage";
import { isEndedWorkerId } from "./runlineage";

export type ChatMode = "chat" | "terminal";

// what the header's control picks: Chat, or one of the views of agentview.ts
export type CellView = "chat" | AgentView;

// the stored map holds only the non-default ("terminal"), oldest first
export type ChatModes = Record<string, "terminal">;

export const CHAT_MODES_MAX = 200;

type ChatAgent = Pick<AgentVM, "id" | "agent" | "kind" | "blockId">;

// A roster agent (not a plain terminal, not a background agent) on a block, whose harness is Claude (an unset harness
// counts as Claude, as claudeaccount.ts reads it), run leads and live workers included. An ended worker and the final
// stage are read-only records, not live sessions.
export function chatCapable(agent: ChatAgent | null | undefined): boolean {
    if (agent == null || agent.blockId == null) {
        return false;
    }
    if (agent.kind != null && agent.kind !== "agent") {
        return false;
    }
    if (isEndedWorkerId(agent.id) || isFinalStageId(agent.id)) {
        return false;
    }
    return (agent.agent || "claude").toLowerCase() === "claude";
}

export function shownChatMode(agent: ChatAgent | null | undefined, stored: ChatMode | undefined): ChatMode {
    return chatCapable(agent) ? (stored ?? "chat") : "terminal";
}

// the header's value: Chat when the terminal slot is on screen and the mode is chat
export function cellView(agentView: AgentView, chatMode: ChatMode): CellView {
    return agentView === "terminal" && chatMode === "chat" ? "chat" : agentView;
}

// The control's options in its order: Chat (only for a chat-capable agent), Terminal, the brainstorm or the canvas
// (the brainstorm takes the canvas's slot), Review.
// `asleep` is for a caller that walks the options (Alt+C): a sleeping chat-capable agent's header disables Terminal
// (its terminal holds only the kill) but keeps Chat, which draws the conversation whatever the stored mode, so the key
// walks Chat, the canvas / brainstorm and the review. The header lists every option and disables Terminal itself, so it
// leaves `asleep` out. An agent that is not chat-capable has no such rule: it is never "asleep" here.
export function cellViewOptions(
    capable: boolean,
    hasCanvas: boolean,
    hasReview: boolean,
    hasBrainstorm: boolean,
    asleep = false
): CellView[] {
    const chatAsleep = capable && asleep;
    return [
        ...(capable ? ["chat" as const] : []),
        ...(chatAsleep ? [] : ["terminal" as const]),
        ...(hasBrainstorm ? ["brainstorm" as const] : hasCanvas ? ["canvas" as const] : []),
        ...(hasReview ? ["review" as const] : []),
    ];
}

// Alt+C: the option after the current one, wrapping. Null with fewer than two options, so the key passes.
export function nextCellView(current: CellView, options: CellView[]): CellView | null {
    if (options.length < 2) {
        return null;
    }
    const i = options.indexOf(current);
    return options[(i + 1) % options.length];
}

function capped(map: ChatModes): ChatModes {
    const ids = Object.keys(map);
    if (ids.length <= CHAT_MODES_MAX) {
        return map;
    }
    const out: ChatModes = {};
    for (const id of ids.slice(ids.length - CHAT_MODES_MAX)) {
        out[id] = "terminal";
    }
    return out;
}

export function parseChatModes(raw: string | null | undefined): ChatModes {
    if (!raw) {
        return {};
    }
    let v: unknown;
    try {
        v = JSON.parse(raw);
    } catch {
        return {};
    }
    if (v == null || typeof v !== "object" || Array.isArray(v)) {
        return {};
    }
    const out: ChatModes = {};
    for (const [id, mode] of Object.entries(v as Record<string, unknown>)) {
        if (mode === "terminal") {
            out[id] = "terminal";
        }
    }
    return capped(out);
}

// Chat deletes the id (the default); Terminal makes it the newest entry, dropping the oldest past the cap.
export function withChatMode(map: ChatModes, id: string, mode: ChatMode): ChatModes {
    const out: ChatModes = {};
    for (const [k, v] of Object.entries(map)) {
        if (k !== id) {
            out[k] = v;
        }
    }
    if (mode === "terminal") {
        out[id] = "terminal";
    }
    return capped(out);
}
