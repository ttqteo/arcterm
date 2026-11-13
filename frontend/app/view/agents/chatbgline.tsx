// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The chat box's background line (chatcomposer.tsx draws it at the box's top, under the queued-message line): while the
// agent has background work running (shells, Monitors, background subagents) one line names the newest and how many
// more, and a press on it unfolds the list inside the box. A list row of a shell or a Monitor opens BackgroundTaskPeek
// above it (monitorPeekAtom with origin "chat", which only this draws) and has Stop where the peek would; a subagent
// row opens its conversation. Whether the list is open is kept per agent, since the box unmounts with its surface.
// What shows and its words are chatbgtasks.ts; this is the view.

import { globalStore } from "@/app/store/jotaiStore";
import { isWindows } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtomValue, type PrimitiveAtom } from "jotai";
import { Bot, ChevronDown, ChevronUp, Radio, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { bgSessionLive, bgTaskStoppable } from "./agentrailsections";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { BackgroundTaskPeek } from "./backgroundtaskpeek";
import { chatBgHeader, chatBgItems, chatBgLine, chatBgMore, type ChatBgItem } from "./chatbgtasks";
import {
    backgroundTasksByIdAtom,
    focusSubagentAtom,
    monitorPeekAtom,
    stopBackgroundTask,
    subagentsByIdAtom,
} from "./subagentsstore";

// per agent id: its list is open
const chatBgOpenAtom = atom<Record<string, boolean>>({}) as PrimitiveAtom<Record<string, boolean>>;

function setOpen(agentId: string, open: boolean): void {
    globalStore.set(chatBgOpenAtom, { ...globalStore.get(chatBgOpenAtom), [agentId]: open });
}

// the peek sits this far above the row it opens from
const CHAT_PEEK_GAP_PX = 8;

function clearChatPeek(agentId: string): void {
    const cur = globalStore.get(monitorPeekAtom);
    if (cur?.origin === "chat" && cur.agentId === agentId) {
        globalStore.set(monitorPeekAtom, null);
    }
}

/** Draws nothing while nothing runs, and reads the 1s clock only while something does. */
export function ChatBgLine({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const tasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const subagents = useAtomValue(subagentsByIdAtom)[agent.id];
    const asleep = agent.sleeping != null;
    const any = chatBgItems({ asleep, tasks, subagents, now: 0 }).length > 0;
    // a chat peek outlives neither the line nor the box
    useEffect(() => {
        if (!any) {
            clearChatPeek(agent.id);
        }
    }, [any, agent.id]);
    useEffect(() => () => clearChatPeek(agent.id), [agent.id]);
    return any ? <RunningLine model={model} agent={agent} /> : null;
}

function RunningLine({ model, agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const now = useAtomValue(model.nowAtom);
    const tasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const subagents = useAtomValue(subagentsByIdAtom)[agent.id];
    const items = chatBgItems({ asleep: agent.sleeping != null, tasks, subagents, now });
    const line = chatBgLine(items);
    const open = useAtomValue(chatBgOpenAtom)[agent.id] === true;
    const peekRef = useAtomValue(monitorPeekAtom);
    const peek = peekRef?.origin === "chat" && peekRef.agentId === agent.id ? peekRef : null;
    const peeked =
        open && peek != null ? items.find((i) => i.kind !== "subagent" && i.task.taskId === peek.taskId) : undefined;
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    // the task it names ended (it left the list) or the list folded: nothing to hang from
    const orphaned = peek != null && peeked == null;
    useEffect(() => {
        if (orphaned) {
            clearChatPeek(agent.id);
        }
    }, [orphaned, agent.id]);
    if (line == null) {
        return null;
    }
    const live = isWindows() && bgSessionLive(agent.blockId, false);
    const press = (item: ChatBgItem) => {
        if (item.kind === "subagent") {
            const s = item.subagent;
            if (s.transcriptPath != null) {
                globalStore.set(focusSubagentAtom, {
                    parentId: agent.id,
                    agentId: s.id,
                    transcriptPath: s.transcriptPath,
                    label: s.type,
                });
            }
            return;
        }
        const taskId = item.task.taskId;
        if (taskId == null) {
            return;
        }
        // read the atom, not the render's copy: a press that opens another row's peek has just closed this one's
        const cur = globalStore.get(monitorPeekAtom);
        const same = cur?.origin === "chat" && cur.agentId === agent.id && cur.taskId === taskId;
        globalStore.set(monitorPeekAtom, same ? null : { agentId: agent.id, taskId, origin: "chat" });
    };
    if (!open) {
        const more = chatBgMore(line.more);
        return (
            <button
                type="button"
                data-chat-bg="closed"
                data-chat-bg-count={items.length}
                aria-expanded={false}
                onClick={() => setOpen(agent.id, true)}
                title="Show what is running in the background"
                className="flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap text-left text-[12px] text-muted hover:text-secondary"
            >
                <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-working pulse-dot" />
                <span
                    data-chat-bg-name=""
                    className={cn(
                        "min-w-0 truncate text-secondary",
                        line.lead.kind === "shell" ? "font-mono text-[11.5px]" : ""
                    )}
                >
                    {line.lead.name}
                </span>
                <span className="flex-none tabular-nums">· {line.lead.sub}</span>
                {more != null ? (
                    <span data-chat-bg-more="" className="flex-none text-ink-faint">
                        · {more}
                    </span>
                ) : null}
                <ChevronDown size={13} strokeWidth={2} aria-hidden className="ml-auto flex-none text-ink-faint" />
            </button>
        );
    }
    return (
        <div
            data-chat-bg="open"
            data-chat-bg-count={items.length}
            className="flex flex-col gap-1 border-b border-edge-faint pb-2"
        >
            <button
                type="button"
                data-chat-bg-fold=""
                aria-expanded
                onClick={() => setOpen(agent.id, false)}
                title="Fold the list"
                className="flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap text-left text-[12px] text-muted hover:text-secondary"
            >
                <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-working pulse-dot" />
                <span className="min-w-0 truncate">{chatBgHeader(items.length)}</span>
                <ChevronUp size={13} strokeWidth={2} aria-hidden className="ml-auto flex-none text-ink-faint" />
            </button>
            {items.map((item) => {
                const isOpen = peeked?.key === item.key;
                const pressable =
                    item.kind === "subagent" ? item.subagent.transcriptPath != null : item.task.taskId != null;
                const stoppable = item.kind !== "subagent" && bgTaskStoppable(item.task, live);
                const Icon = item.kind === "shell" ? Terminal : item.kind === "monitor" ? Radio : Bot;
                return (
                    <div
                        key={item.key}
                        ref={isOpen ? setAnchor : undefined}
                        data-chat-bg-row={item.kind}
                        className={cn("flex items-center gap-2 rounded-[6px] text-[12px]", isOpen && "bg-accentbg")}
                    >
                        <button
                            type="button"
                            disabled={!pressable}
                            onClick={() => press(item)}
                            aria-haspopup={item.kind === "subagent" ? undefined : "dialog"}
                            aria-expanded={item.kind === "subagent" ? undefined : isOpen}
                            title={
                                !pressable
                                    ? undefined
                                    : item.kind === "subagent"
                                      ? "Open its conversation"
                                      : "Show its output"
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 py-[3px] text-left enabled:cursor-pointer enabled:hover:text-primary"
                        >
                            <Icon size={12} strokeWidth={2} aria-hidden className="flex-none text-muted" />
                            <span
                                data-chat-bg-row-name=""
                                className={cn(
                                    "min-w-0 truncate text-ink-hi",
                                    item.kind === "shell" && "font-mono text-[11.5px]"
                                )}
                            >
                                {item.name}
                            </span>
                            <span className="min-w-0 flex-none truncate tabular-nums text-muted">{item.sub}</span>
                        </button>
                        {stoppable ? (
                            <button
                                type="button"
                                data-chat-bg-stop=""
                                onClick={() =>
                                    fireAndForget(() => stopBackgroundTask(agent.id, agent.blockId!, item.task))
                                }
                                className="flex-none cursor-pointer px-1 text-[11.5px] text-secondary hover:text-primary"
                            >
                                Stop
                            </button>
                        ) : null}
                    </div>
                );
            })}
            {peeked != null && peeked.kind !== "subagent" && anchor != null ? (
                <BackgroundTaskPeek
                    key={peeked.key}
                    model={model}
                    agentId={agent.id}
                    task={peeked.task}
                    anchor={anchor}
                    placement="top-start"
                    gap={CHAT_PEEK_GAP_PX}
                />
            ) : null}
        </div>
    );
}
