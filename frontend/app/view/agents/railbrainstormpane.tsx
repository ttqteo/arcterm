// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Agent panel's Brainstorm tab: the brainstorm attached to the agent as one timeline
// (docs/superpowers/specs/2026-11-20-agent-rail-brainstorm-initiative-tabs-design.md, canvas board D-timeline). The head
// is its title, `Open` with the `b` key and one meta line (the agent's state, how many decisions are the user's, how many
// boards); the body numbers the decisions in the design's order with each board under the decision it illustrates, then
// lists the boards of parts not decided yet under `Open parts`. A board's chip opens it large in the dialog over the
// agent's cell (openChatBoard, ChatBoardDialog in brainstormbandview.tsx), and takes that board as seen; opening the tab
// takes none as seen. What is drawn comes from railbrainstorm.ts (the rows and the state it is in) over brainstormband.ts.
//
// The root is data-owns-keys, so the dispatcher counts focus in it as editable and the single-key bindings stand down;
// its handler answers `b` itself, opening the Brainstorm view, which the global binding would do anywhere else.

import { KeyCap } from "@/app/element/keycap";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { LayoutTemplate } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { backgroundActivity, shownState } from "./bgactivity";
import type { BandBoard } from "./brainstormband";
import { openBrainstorm, openChatBoard } from "./brainstormbandview";
import { brainstormAtom, brainstormBandAtom } from "./brainstormstore";
import { machineServersReadingAtom } from "./machineserversstore";
import { brainstormPaneState, railBrainstormRows } from "./railbrainstorm";
import { backgroundTasksByIdAtom } from "./subagentsstore";

const boardsText = (n: number) => `${n} ${n === 1 ? "board" : "boards"}`;

export function RailBrainstormPane({ agent }: { model: AgentsViewModel; agent: AgentVM }) {
    const bs = useAtomValue(brainstormBandAtom(agent.id));
    const s = useAtomValue(brainstormAtom(agent.id));
    // the state the header words, so the line reads the same as the header's
    const bgTasks = useAtomValue(backgroundTasksByIdAtom)[agent.id];
    const machineServers = useAtomValue(machineServersReadingAtom).servers;
    const agentState =
        agent.startError != null ? "idle" : shownState(agent.state, backgroundActivity(bgTasks, machineServers));

    const state = brainstormPaneState(s != null, bs, s?.error ?? null);
    const view = bs != null ? railBrainstormRows(bs) : null;

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) {
            return;
        }
        if (e.key === "b") {
            e.preventDefault();
            e.stopPropagation();
            openBrainstorm(agent.id);
        }
    };

    return (
        <div
            data-rail-brainstorm={agent.id}
            data-owns-keys
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex min-h-0 flex-1 flex-col outline-none"
        >
            <div className="flex flex-none flex-col gap-[3px] border-b border-edge-mid px-[12px] pb-[9px] pt-[10px]">
                <div className="flex items-center gap-[6px]">
                    <span
                        data-rail-brainstorm-title
                        title={bs?.title}
                        className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-hi"
                    >
                        {bs?.title ?? "Brainstorm"}
                    </span>
                    <button
                        type="button"
                        data-rail-brainstorm-open
                        title={`Open in Brainstorm (${formatChordString("b")})`}
                        onClick={() => openBrainstorm(agent.id)}
                        className="flex flex-none cursor-pointer items-center gap-[4px] rounded-[4px] border-0 bg-transparent p-0 text-[11.5px] text-muted outline-none hover:text-ink-hi focus-visible:ring-2 focus-visible:ring-accent"
                    >
                        Open
                        <KeyCap chord="b" variant="inline" className="px-[4px] py-0 text-[10px] leading-[14px]" />
                    </button>
                </div>
                {bs != null ? (
                    <div data-rail-brainstorm-meta className="truncate text-[11.5px] text-muted">
                        {agentState} · Decided {bs.decided.length} · {boardsText(bs.boards.length)}
                    </div>
                ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[12px] pb-[40px] pt-[10px] [scrollbar-gutter:stable]">
                {state === "reading" ? (
                    <div data-rail-brainstorm-state={state} className="text-[12px] text-muted">
                        Reading brainstorm.json…
                    </div>
                ) : null}
                {state === "error" ? (
                    <div
                        data-rail-brainstorm-state={state}
                        className={cn("break-words text-[12px] text-error", view != null && "mb-[10px]")}
                    >
                        {s?.error}
                    </div>
                ) : null}
                {state === "empty" && view != null ? (
                    <div
                        data-rail-brainstorm-state={state}
                        className={cn("text-[12px] text-muted", view.openParts.length > 0 && "mb-[10px]")}
                    >
                        Nothing decided yet
                    </div>
                ) : null}
                {view != null
                    ? view.rows.map((row, i) => (
                          <div
                              key={row.id}
                              data-rail-brainstorm-row={row.n}
                              data-has-new={row.hasNew ? "" : undefined}
                              className="flex gap-[9px]"
                          >
                              <div className="flex w-[18px] flex-none flex-col items-center">
                                  <span
                                      className={cn(
                                          "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] font-semibold",
                                          row.hasNew
                                              ? "bg-accent text-background"
                                              : "border border-edge-strong text-muted"
                                      )}
                                  >
                                      {row.n}
                                  </span>
                                  {i < view.rows.length - 1 ? <span className="w-px flex-1 bg-edge-mid" /> : null}
                              </div>
                              <div className="flex min-w-0 flex-1 flex-col gap-[2px] pb-[9px] pt-px">
                                  <span className="flex items-center gap-[6px] text-[12px] font-semibold text-ink-hi">
                                      <span className="min-w-0 break-words">{row.title}</span>
                                      {row.hasNew ? (
                                          <span className="flex-none text-[10.5px] font-semibold text-accent">new</span>
                                      ) : null}
                                  </span>
                                  {row.gist !== "" ? (
                                      <span className="line-clamp-2 text-[11.5px] leading-[16px] text-ink-mid">
                                          {row.gist}
                                      </span>
                                  ) : null}
                                  {row.boards.length > 0 ? (
                                      <div className="mt-[3px] flex min-w-0 flex-col items-start gap-[4px]">
                                          {row.boards.map((b) => (
                                              <BoardChip key={b.name} agent={agent} board={b} />
                                          ))}
                                      </div>
                                  ) : null}
                              </div>
                          </div>
                      ))
                    : null}
                {view != null && view.openParts.length > 0 ? (
                    <div
                        className={cn(
                            "flex min-w-0 flex-col items-start gap-[4px]",
                            view.rows.length > 0 && "pt-[6px]"
                        )}
                    >
                        <span data-rail-brainstorm-open-parts className="mb-[2px] text-[11px] text-muted">
                            Open parts
                        </span>
                        {view.openParts.map((b) => (
                            <BoardChip key={b.name} agent={agent} board={b} />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** One board, as a chip: the board icon, its file name and `new` while the person has not seen it. A button, so Tab
 *  reaches it; it opens the board in the dialog over the cell (or the Brainstorm tab when the board cannot open there yet). */
function BoardChip({ agent, board }: { agent: AgentVM; board: BandBoard }) {
    return (
        <button
            type="button"
            data-rail-board={board.name}
            data-new={board.isNew ? "" : undefined}
            title={`Open ${board.name}`}
            onClick={() => openChatBoard(agent.id, board.name)}
            className="flex h-[22px] max-w-full cursor-pointer items-center gap-[6px] rounded-[6px] border border-edge-mid bg-surface-raised px-[8px] text-[11px] text-secondary outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        >
            <LayoutTemplate size={13} strokeWidth={1.8} aria-hidden className="flex-none text-muted" />
            <span className="min-w-0 truncate">{board.name}</span>
            {board.isNew ? <span className="flex-none text-[10.5px] font-semibold text-accent">new</span> : null}
        </button>
    );
}
