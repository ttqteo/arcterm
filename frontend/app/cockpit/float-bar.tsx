// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useBindingKeys } from "@/app/store/keybindings/store";
import { ICON_BTN } from "@/app/view/agents/agentheader";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { exitFloat, floatPinnedAtom, setFloatPinned } from "@/app/view/agents/floatstore";
import { StatusDot } from "@/app/view/agents/statusdot";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { PictureInPicture2, Pin } from "lucide-react";
import { WindowControls } from "./app-bar";

// The app bar's place in float mode (floatstore.ts): the window is the focused agent's terminal, so the bar is what
// you drag it by, whose terminal it is, the pin and the way back. 46px like the app bar, because macOS overlays its
// traffic lights at the centre line of a bar that tall (tauri.macos.conf.json).
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
                "flex h-[46px] shrink-0 items-center gap-2 border-b border-border bg-surface",
                mac ? "pl-[92px] pr-3" : "pl-4"
            )}
        >
            <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
                {agent != null ? <StatusDot state={agent.state} /> : null}
                <span data-tauri-drag-region className="truncate text-[13px] font-semibold text-primary">
                    {agent?.name ?? "arcterm"}
                </span>
            </div>
            <button
                type="button"
                data-float-pin
                aria-pressed={pinned}
                aria-label={pinLabel}
                title={pinLabel}
                onClick={() => fireAndForget(() => setFloatPinned(!pinned))}
                className={cn(
                    "cursor-pointer rounded-[7px] border px-[9px] py-[6px]",
                    pinned ? "border-accent bg-accentbg text-accent" : cn(ICON_BTN, "hover:border-edge-strong")
                )}
            >
                <Pin size={15} strokeWidth={1.8} className={pinned ? "" : "rotate-45"} />
            </button>
            <button
                type="button"
                data-float-exit
                aria-label="Leave float"
                title={floatKeys != null ? `Leave float (${formatChordString(floatKeys)})` : "Leave float"}
                onClick={() => fireAndForget(() => exitFloat(true))}
                className={cn(ICON_BTN, "hover:border-edge-strong")}
            >
                <PictureInPicture2 size={15} strokeWidth={1.8} />
            </button>
            {mac ? null : <WindowControls />}
        </div>
    );
}
