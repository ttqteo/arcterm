// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The Ctrl+Tab switcher drawn over the window (tabswitcher.ts): a row of tiles, one per tab, recent first, each the
// runtime's mark with its status dot and unread count, the pick in the grey selection fill; under the row the pick's
// name, state and model, then the keys. In Float the tiles are bare (smaller in a narrow window); in fullscreen there is
// room for each tile's name. Mounted once in the cockpit root, it also owns the keyup that opens the pick and the blur and
// stray key that close it; the bindings (switcher:*) open and step it.

import { globalStore } from "@/app/store/jotaiStore";
import { isMacOS } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { SquareTerminal } from "lucide-react";
import { useEffect } from "react";
import { STATE_COLOR, STATE_LABEL } from "./agentheader";
import type { AgentsViewModel } from "./agents";
import { askingLabel, projectOf, type AgentVM } from "./agentsviewmodel";
import { floatModeAtom } from "./floatstore";
import { RuntimeMark } from "./runtimemark";
import { StatusDot } from "./statusdot";
import { keepsSwitcher, releasesSwitcher, type SwitcherMod } from "./tabswitcher";
import { closeSwitcher, openFromSwitcher, tabSwitcherAtom } from "./tabswitcherstore";
import { unreadLabel } from "./unreadagents";
import { unreadAgentsAtom } from "./unreadagentsstore";

type Size = "sm" | "md" | "lg";

// a float narrower than this takes the small tiles, so seven tabs still fit in one row
const NARROW_FLOAT_PX = 520;

const TILE: Record<Size, string> = {
    sm: "h-10 w-10 rounded-[9px]",
    md: "h-[52px] w-[52px] rounded-[11px]",
    lg: "h-16 w-16 rounded-[13px]",
};
const MARK: Record<Size, string> = { sm: "h-5 w-5", md: "h-[26px] w-[26px]", lg: "h-8 w-8" };
const ICON_PX: Record<Size, number> = { sm: 19, md: 24, lg: 30 };
const DOT: Record<Size, string> = {
    sm: "right-1.5 bottom-1.5",
    md: "right-2 bottom-2",
    lg: "right-2.5 bottom-2.5 h-2.5 w-2.5",
};

function modGlyph(mod: SwitcherMod): string {
    if (mod === "alt") {
        return isMacOS() ? "⌥" : "Alt";
    }
    return isMacOS() ? "⌃" : "Ctrl";
}

function Key({ children }: { children: React.ReactNode }) {
    return (
        <kbd className="rounded-[5px] border border-edge-strong px-[5px] py-px font-mono text-[10px] text-secondary">
            {children}
        </kbd>
    );
}

function stateText(a: AgentVM): string {
    if (a.kind === "terminal") {
        return "terminal";
    }
    return a.state === "asking" ? askingLabel(a) : STATE_LABEL[a.state];
}

function metaText(a: AgentVM): string {
    const parts = a.kind === "terminal" ? [projectOf(a)] : [a.agent, a.model, projectOf(a)];
    return parts.filter((p) => p != null && p !== "").join(" · ");
}

export function TabSwitcher({ model }: { model: AgentsViewModel }) {
    const state = useAtomValue(tabSwitcherAtom);
    const floating = useAtomValue(floatModeAtom);
    const agents = useAtomValue(model.agentsAtom);
    const terminals = useAtomValue(model.terminalsAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const unread = useAtomValue(unreadAgentsAtom);

    // capture phase: a focused xterm stops key events from bubbling to the window
    useEffect(() => {
        const onKeyUp = (e: KeyboardEvent) => {
            const s = globalStore.get(tabSwitcherAtom);
            if (s != null && releasesSwitcher(s, e.key)) {
                openFromSwitcher(model);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (globalStore.get(tabSwitcherAtom) != null && !keepsSwitcher(e.key)) {
                closeSwitcher();
            }
        };
        // the modifier let go in another window sends this one no keyup: the tab in view stays
        const onBlur = () => closeSwitcher();
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("blur", onBlur);
        };
    }, [model]);

    if (state == null || !state.shown) {
        return null;
    }
    const byId = new Map<string, AgentVM>();
    for (const a of [...agents, ...terminals]) {
        byId.set(a.id, a);
    }
    const size: Size = !floating ? "lg" : window.innerWidth < NARROW_FLOAT_PX ? "sm" : "md";
    const pick = byId.get(state.ids[state.sel]);
    const pickUnread = pick != null ? (unread.get(pick.id) ?? 0) : 0;
    return (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div
                role="listbox"
                aria-label="Switch tab"
                data-tab-switcher
                className={cn(
                    "pointer-events-auto flex max-w-full flex-col items-center rounded-[14px] border border-edge-mid bg-surface-raised shadow-popover",
                    size === "lg" ? "gap-3 px-3.5 pb-3 pt-3.5" : "gap-2.5 px-3 pb-2.5 pt-3"
                )}
            >
                <div className={cn("flex max-w-full flex-wrap justify-center", size === "md" ? "gap-1.5" : "gap-1")}>
                    {state.ids.map((id, i) => {
                        const a = byId.get(id);
                        if (a == null) {
                            return null;
                        }
                        const on = i === state.sel;
                        const count = unread.get(id) ?? 0;
                        const terminal = a.kind === "terminal";
                        return (
                            <div
                                key={id}
                                className={cn(
                                    "flex flex-col items-center",
                                    size === "lg" ? "w-[84px] gap-1.5" : "gap-1"
                                )}
                            >
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={on}
                                    aria-label={`${a.name}, ${stateText(a)}`}
                                    data-tab-switcher-tile={id}
                                    // the terminal keeps the keyboard: a click opens the tab, it does not take focus
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => openFromSwitcher(model, id)}
                                    className={cn(
                                        "relative flex flex-none cursor-pointer items-center justify-center border-0 p-0 text-muted",
                                        TILE[size],
                                        on
                                            ? "bg-surface-selected ring-1 ring-inset ring-edge-strong"
                                            : "bg-transparent hover:bg-surface-hover"
                                    )}
                                >
                                    {terminal ? (
                                        <SquareTerminal size={ICON_PX[size]} strokeWidth={1.8} />
                                    ) : (
                                        <RuntimeMark
                                            runtime={a.agent}
                                            imageClassName={cn(MARK[size], "rounded-[6px]")}
                                            className={cn(
                                                MARK[size],
                                                "flex items-center justify-center text-[13px] font-semibold text-secondary"
                                            )}
                                        />
                                    )}
                                    {terminal ? null : (
                                        <StatusDot
                                            state={a.state}
                                            pulse={a.state !== "idle"}
                                            className={cn(
                                                "absolute ring-2",
                                                on ? "ring-surface-selected" : "ring-surface-raised",
                                                DOT[size]
                                            )}
                                        />
                                    )}
                                    {count > 0 ? (
                                        <span className="absolute right-0.5 top-[3px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold tabular-nums text-background">
                                            {unreadLabel(count)}
                                        </span>
                                    ) : null}
                                </button>
                                {size === "lg" ? (
                                    <span
                                        className={cn(
                                            "max-w-full truncate text-[11px]",
                                            on ? "font-semibold text-primary" : "text-muted"
                                        )}
                                    >
                                        {a.name}
                                    </span>
                                ) : null}
                                {/* the tab in view, where Escape leaves you */}
                                <span
                                    className={cn(
                                        "h-[2px] w-3.5 rounded-[1px]",
                                        id === focusId ? "bg-ink-faint" : "bg-transparent"
                                    )}
                                />
                            </div>
                        );
                    })}
                </div>
                {pick != null ? (
                    <div className="flex min-w-0 max-w-full flex-col items-center gap-[3px]">
                        <div className="flex min-w-0 max-w-full items-baseline gap-[7px]">
                            <span
                                className={cn(
                                    "min-w-0 truncate font-semibold text-primary",
                                    size === "lg" ? "text-[14px]" : "text-[13px]"
                                )}
                            >
                                {pick.name}
                            </span>
                            <span
                                className="flex-none text-[11px] font-medium"
                                style={{ color: pick.kind === "terminal" ? undefined : STATE_COLOR[pick.state] }}
                            >
                                {stateText(pick)}
                            </span>
                            {pickUnread > 0 ? (
                                <span className="flex-none text-[11px] font-medium text-accent-soft">
                                    {pickUnread} unread
                                </span>
                            ) : null}
                        </div>
                        {metaText(pick) !== "" ? (
                            <span className="max-w-full truncate text-[11px] text-muted">{metaText(pick)}</span>
                        ) : null}
                    </div>
                ) : null}
                <div
                    className={cn(
                        "flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 border-t border-edge-mid text-[10.5px] text-muted",
                        size === "lg" ? "pt-[9px]" : "pt-2"
                    )}
                >
                    <span className="flex items-center gap-1">
                        <Key>Tab</Key>next
                    </span>
                    <span className="flex items-center gap-1">
                        <Key>⇧Tab</Key>back
                    </span>
                    <span className="flex items-center gap-1">
                        <Key>esc</Key>stay here
                    </span>
                    <span className="flex items-center gap-1">
                        release<Key>{modGlyph(state.mod)}</Key>to switch
                    </span>
                </div>
            </div>
        </div>
    );
}
