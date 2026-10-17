// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useBindingKeys } from "@/app/store/keybindings/store";
import { closeAgentChord, confirmCloseSession } from "@/app/view/agents/agentactions";
import { CTX_TEXT, ICON_BTN, ICON_BTN_ON, STATE_COLOR, STATE_LABEL } from "@/app/view/agents/agentheader";
import { contextLevel, contextTokens } from "@/app/view/agents/agentrailmodel";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { askingLabel } from "@/app/view/agents/agentsviewmodel";
import { exitFloat, floatPinnedAtom, setFloatPinned } from "@/app/view/agents/floatstore";
import { StatusDot } from "@/app/view/agents/statusdot";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { Minus, PictureInPicture2, Pin, X } from "lucide-react";
import { WindowControls } from "./app-bar";

// The app bar's place in float mode (floatstore.ts): the window is the focused agent's terminal, so the bar is what
// you drag it by, whose terminal it is and what it is doing (the agent header steps out, so this is the one header),
// the pin, the way back and its close; the tabs to switch it are on the ledge under the terminal (float-ledge.tsx).
// The arrow cursor and no text selection over all of it, as over a native title bar. 38px on a Mac, because macOS
// overlays its traffic lights at the centre line of a bar that tall (tauri.macos.conf.json); 40px elsewhere, room for
// the 32px Sprout and little more.
export function FloatBar({ model }: { model: AgentsViewModel }) {
    const mac = isMacOS();
    const pinned = useAtomValue(floatPinnedAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const agent = agents.find((a) => a.id === focusId) ?? terminals.find((a) => a.id === focusId);
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
                {agent != null ? <StatusDot state={agent.state} pulse={agent.state !== "idle"} /> : null}
                <span data-tauri-drag-region className="min-w-0 truncate text-[13px] font-semibold text-primary">
                    {agent?.name ?? "arcterm"}
                </span>
                {agent != null && agent.kind !== "terminal" ? (
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
            {/* hides the window, as its red button does with the menu bar icon on: the agent keeps running and the Dock
                icon brings the float back (src-tauri main.rs, Reopen), where X ends the agent; ⌘M and the yellow button
                still fold it into the pet. A Mac's alone: elsewhere a hidden window has no Dock icon to come back from,
                and WindowControls holds the window's own buttons */}
            {mac ? (
                <button
                    type="button"
                    data-float-hide
                    aria-label="Hide window"
                    title="Hide — the agent keeps running; the Dock icon brings it back"
                    onClick={() => fireAndForget(() => getCurrentWindow().hide())}
                    className={ICON_BTN}
                >
                    <Minus size={15} strokeWidth={1.9} />
                </button>
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
            {agent != null ? (
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
            {mac ? null : <WindowControls />}
        </div>
    );
}
