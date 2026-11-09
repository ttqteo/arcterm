// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Chat or Terminal per agent, remembered: a map of agent id to "terminal" in localStorage agent.chatmode (only the
// non-default is stored, pruned to the last 200; chatmode.ts), read once into a module-level atom. Module-level, as
// every surface but Agent unmounts on a switch. The header's control, the grid bar's switch and the keys all switch
// through selectCellView, so Chat and Terminal stay the one "terminal" slot of agentview.ts.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, useAtomValue } from "jotai";
import { atomFamily } from "jotai/utils";
import type { AgentVM } from "./agentsviewmodel";
import { setAgentView } from "./agentview";
import { parseChatModes, shownChatMode, withChatMode, type CellView, type ChatMode, type ChatModes } from "./chatmode";

const STORAGE_KEY = "agent.chatmode";

function readModes(): ChatModes {
    try {
        return parseChatModes(localStorage.getItem(STORAGE_KEY));
    } catch {
        return {};
    }
}

const modesAtom = atom<ChatModes>(readModes());

// the stored mode of one agent: "terminal", or undefined for the default
export const chatModeAtom = atomFamily((agentId: string) =>
    atom<ChatMode | undefined>((get) => get(modesAtom)[agentId])
);

type ChatAgent = Pick<AgentVM, "id" | "agent" | "kind" | "blockId">;

// what the agent's cell shows in its terminal slot: Terminal for an agent that is not chat-capable
export function useChatMode(agent: ChatAgent): ChatMode {
    return shownChatMode(agent, useAtomValue(chatModeAtom(agent.id)));
}

export function getChatMode(agent: ChatAgent): ChatMode {
    return shownChatMode(agent, globalStore.get(chatModeAtom(agent.id)));
}

export function setChatMode(agentId: string, mode: ChatMode): void {
    const next = withChatMode(globalStore.get(modesAtom), agentId, mode);
    globalStore.set(modesAtom, next);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // storage unavailable: the mode holds for this session
    }
}

export function toggleChatMode(agent: ChatAgent): void {
    setChatMode(agent.id, getChatMode(agent) === "chat" ? "terminal" : "chat");
}

// Chat or Terminal set the chat mode and bring the terminal slot back; Canvas, Review or Brainstorm take the slot and
// leave the chat mode, so coming back to the cell shows Chat or Terminal as it was.
export function selectCellView(agentId: string, view: CellView, now: number): void {
    if (view === "chat" || view === "terminal") {
        setChatMode(agentId, view);
        setAgentView(agentId, "terminal", now);
        return;
    }
    setAgentView(agentId, view, now);
}

declare global {
    interface Window {
        __arcChatMode?: { get: (id: string) => ChatMode; set: (id: string, mode: ChatMode) => void };
    }
}

// scenarios pin a cell to Chat or Terminal; get reads the stored mode (Chat when none), not whether the agent can chat
if (import.meta.env.DEV && typeof window !== "undefined") {
    window.__arcChatMode = {
        get: (id) => globalStore.get(chatModeAtom(id)) ?? "chat",
        set: (id, mode) => setChatMode(id, mode),
    };
}
