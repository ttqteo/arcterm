// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useBindingKeys } from "@/app/store/keybindings/store";
import { closeAgentChord, confirmCloseSession } from "@/app/view/agents/agentactions";
import { CTX_TEXT, ICON_BTN, ICON_BTN_ON, STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import { contextLevel, contextTokens } from "@/app/view/agents/agentrailmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { floatNoteOpenAtom, scratchPreviewAtom } from "@/app/view/agents/floatnotestore";
import { exitFloat, floatPinnedAtom, foldToSprout, setFloatPinned } from "@/app/view/agents/floatstore";
import { StatusDot } from "@/app/view/agents/statusdot";
import { toolTerminalName } from "@/app/view/agents/toolsmodel";
import { toolsStatusAtom } from "@/app/view/agents/toolsstore";
import { PET_CHARACTER_NAME, petCharacter } from "@/app/view/jarvis/petcharacter";
import { petCharacterAtom } from "@/app/view/jarvis/petstore";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Minus, PictureInPicture2, Pin, SquareTerminal, StickyNote, X } from "lucide-react";
import { showFoldMenu, useFoldTitle, WindowControls } from "./app-bar";

// The app bar's place in float mode (floatstore.ts): the window is the focused agent's terminal, so the bar is what
// you drag it by, whose terminal it is and what it is doing (the agent header steps out, so this is the one header),
// the pin, the way back and its close (the Note tab's bar has Edit | Preview in place of the close, and a terminal's
// shows its own name in place of an agent's dot); the tabs to switch it are on the ledge under the terminal (float-ledge.tsx).
// The arrow cursor and no text selection over all of it, as over a native title bar. 38px on a Mac, because macOS
// overlays its traffic lights at the centre line of a bar that tall (tauri.macos.conf.json); 40px elsewhere, room for
// the 32px Sprout and little more.
export function FloatBar({ model }: { model: AgentsViewModel }) {
    const mac = isMacOS();
    const pinned = useAtomValue(floatPinnedAtom);
    const character = petCharacter(useAtomValue(petCharacterAtom));
    const foldTitle = useFoldTitle();
    const focusId = useAtomValue(model.focusIdAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
    const noteOpen = useAtomValue(floatNoteOpenAtom);
    const [preview, setPreview] = useAtom(scratchPreviewAtom);
    const tools = useAtomValue(toolsStatusAtom) ?? [];
    const floatKeys = useBindingKeys("agent:float");
    const pinLabel = pinned ? "Turn off always on top" : "Turn on always on top";
    return (
        <div
            data-float-bar
            data-tauri-drag-region
            className={cn(
                "flex shrink-0 cursor-default select-none items-center gap-2 border-b border-border bg-surface",
                mac ? "h-[38px] pl-[92px] pr-3" : "h-[40px] pl-3"
            )}
        >
            <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
                {noteOpen ? (
                    <StickyNote size={14} strokeWidth={2} className="flex-none text-muted" />
                ) : agent?.kind === "terminal" ? (
                    <SquareTerminal size={13} strokeWidth={2} className="flex-none text-muted" />
                ) : agent != null ? (
                    <StatusDot state={agent.state} pulse={agent.state !== "idle"} />
                ) : null}
                <span
                    data-float-title
                    data-tauri-drag-region
                    className="min-w-0 truncate text-[13px] font-semibold text-primary"
                >
                    {noteOpen
                        ? "Note"
                        : agent?.kind === "terminal"
                          ? toolTerminalName(agent, tools)
                          : (agent?.name ?? "arcterm")}
                </span>
                {!noteOpen && agent != null && agent.kind !== "terminal" ? (
                    <span data-tauri-drag-region className="flex flex-none items-baseline gap-[7px] text-[11px]">
                        <span
                            data-tauri-drag-region
                            className="font-medium"
                            style={{ color: STATE_COLOR[agent.state] }}
                        >
                            {agent.state === "asking" ? askingLabel(agent) : STATE_LABEL[agent.state]}
                        </span>
                        {agent.model ? (
                            <span data-tauri-drag-region className="text-muted">
                                {agent.model}
                            </span>
                        ) : null}
                        {agent.usage?.contextpct != null ? (
                            <span
                                data-tauri-drag-region
                                title={`context: ${Math.round(agent.usage.contextpct)}% of the window`}
                                className={cn(
                                    "font-semibold tabular-nums",
                                    CTX_TEXT[contextLevel(agent.usage.contextpct, agent.usage.contextmax)]
                                )}
                            >
                                {contextTokens(agent.usage.contextpct, agent.usage.contextmax) ??
                                    `${Math.round(agent.usage.contextpct)}%`}
                            </span>
                        ) : null}
                    </span>
                ) : null}
            </div>
            {noteOpen ? (
                <div
                    role="group"
                    aria-label="Note view"
                    data-float-note-view
                    className="flex flex-none gap-0.5 rounded-[7px] border border-edge-mid bg-surface-raised p-0.5"
                >
                    {(["edit", "preview"] as const).map((v) => {
                        const on = (v === "preview") === preview;
                        return (
                            <button
                                key={v}
                                type="button"
                                data-float-note-view={v}
                                aria-pressed={on}
                                title={v === "edit" ? "Edit the note" : "Preview the note"}
                                onClick={() => setPreview(v === "preview")}
                                className={cn(
                                    "h-[22px] cursor-pointer rounded-[5px] px-[9px] text-[11.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                                    on
                                        ? "bg-surface-hover font-semibold text-primary"
                                        : "font-medium text-secondary hover:text-primary"
                                )}
                            >
                                {v === "edit" ? "Edit" : "Preview"}
                            </button>
                        );
                    })}
                </div>
            ) : null}
            <button
                type="button"
                data-float-pin
                aria-pressed={pinned}
                aria-label={pinLabel}
                title={pinLabel}
                onClick={() => fireAndForget(() => setFloatPinned(!pinned))}
                className={cn(ICON_BTN, pinned && ICON_BTN_ON)}
            >
                <Pin size={15} strokeWidth={1.8} className={pinned ? "" : "rotate-45"} />
            </button>
            <button
                type="button"
                data-float-exit
                aria-label="Leave float"
                title={floatKeys != null ? `Leave float (${formatChordString(floatKeys)})` : "Leave float"}
                onClick={() => fireAndForget(() => exitFloat(true))}
                className={ICON_BTN}
            >
                <PictureInPicture2 size={15} strokeWidth={1.8} />
            </button>
            {/* the agent header's close, which steps out with the header in float; it still asks first */}
            {agent != null && !noteOpen ? (
                <button
                    type="button"
                    data-float-close
                    aria-label={agent.kind === "terminal" ? "Close terminal" : "Close agent"}
                    title={
                        agent.kind === "terminal"
                            ? `Close terminal — ends its shell (${formatChordString(closeAgentChord())})`
                            : `Close agent — ends its session (${formatChordString(closeAgentChord())})`
                    }
                    onClick={() => confirmCloseSession(agent, model)}
                    className={cn(ICON_BTN, "hover:bg-error/15 hover:text-error")}
                >
                    <X size={15} strokeWidth={1.9} />
                </button>
            ) : null}
            {/* last, at the bar's edge: folds the float into the pet, the agent still running, where X ends it; a
                right-click picks the corner it folds to. A Mac's alone: elsewhere WindowControls' own − folds */}
            {mac ? (
                <button
                    type="button"
                    data-float-minimize
                    aria-label={`Fold into ${PET_CHARACTER_NAME[character]}`}
                    title={foldTitle}
                    onClick={() => fireAndForget(foldToSprout)}
                    onContextMenu={showFoldMenu}
                    className={ICON_BTN}
                >
                    <Minus size={15} strokeWidth={1.9} />
                </button>
            ) : null}
            {mac ? null : <WindowControls />}
        </div>
    );
}
