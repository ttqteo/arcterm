// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pinned app's page, shown on the Agent surface in place of its (still mounted, hidden) terminal: the page once it
// answers, a waiting card before. Its header is the terminal's (TerminalPaneHead: Page | Log, Back, Forward, Reload,
// Home, Open in browser, state line, Restart, Stop or Start). What it shows is appmodel.ts's; the state is appstore.ts's.
//
// The page is not drawn here but by AppFrames in the shell, over the slot AppPane leaves for it: a frame under
// display:none (the Agent surface off screen, the terminal stack under History) loses its scroll, and one unmounted
// loads afresh. So each open app's frame stays loaded where it was, invisible while out of sight, until its idle limit.

import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { appFrameName, appShows, appWaitLine, keptAppFrames, type AppState } from "./appmodel";
import {
    appSeenAtom,
    appSlotAtom,
    appStatesAtom,
    lastAppRect,
    setAppSlot,
    setAppView,
    shownAppTab,
    type AppRect,
    type AppSlot,
} from "./appstore";
import { toolsStatusAtom } from "./toolsstore";

function useNow(on: boolean, everyMs: number): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) {
            return;
        }
        const id = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(id);
    }, [on, everyMs]);
    return now;
}

function sameRect(a: AppRect | null, b: AppRect | null): boolean {
    return (
        a === b ||
        (a != null && b != null && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
    );
}

// The place the page takes: its rect on screen, null while it has none (display:none above it). Two surfaces can hold a
// slot for the same service (Agent's pane and the app surface), and the Agent one stays mounted under display:none: so
// an inactive one neither measures nor publishes, and one going away clears the atom only if it still holds its own slot.
export function AppSlotView({ tabId, active = true }: { tabId: string; active?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        if (!active) {
            return;
        }
        const el = ref.current!;
        let mine: AppSlot | null = null;
        const measure = () => {
            const r = el.getBoundingClientRect();
            const rect =
                r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
            if (mine == null || globalStore.get(appSlotAtom) !== mine || !sameRect(mine.rect, rect)) {
                mine = { tabId, rect };
                setAppSlot(mine);
            }
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        window.addEventListener("resize", measure);
        return () => {
            ro.disconnect();
            window.removeEventListener("resize", measure);
            if (mine != null && globalStore.get(appSlotAtom) === mine) {
                setAppSlot(null);
            }
        };
    }, [tabId, active]);
    return <div ref={ref} data-app-slot={tabId} className="min-h-0 w-full flex-1" />;
}

export function AppPane({ tabId, state, active = true }: { tabId: string; state: AppState; active?: boolean }) {
    const name = useAtomValue(toolsStatusAtom)?.find((t) => t.id === state.toolId)?.name ?? state.toolId;
    const shows = appShows(state);
    const now = useNow(shows === "waiting", 1000);
    if (shows === "page") {
        return <AppSlotView tabId={tabId} active={active} />;
    }
    return (
        <div data-app-waiting={tabId} className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-primary">
                <span aria-hidden className="h-[8px] w-[8px] animate-pulse rounded-full bg-accent" />
                Starting {name}
            </div>
            <div className="text-[12.5px] tabular-nums text-muted">{appWaitLine(state, now)}</div>
            <button
                type="button"
                data-app-show-log
                onClick={() => setAppView(tabId, "log")}
                className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-accent-soft hover:text-accent"
            >
                Show the log
            </button>
        </div>
    );
}

// Every open app's page that is kept loaded (keptAppFrames): the one on screen over its slot, the rest invisible where
// they last showed, at that size, so each keeps its page and its scroll. In the shell, mounted once.
export function AppFrames() {
    const states = useAtomValue(appStatesAtom);
    const slot = useAtomValue(appSlotAtom);
    const seen = useAtomValue(appSeenAtom);
    const tools = useAtomValue(toolsStatusAtom);
    const shown = shownAppTab(slot);
    const [now, setNow] = useState(() => Date.now());
    const kept = keptAppFrames(states, shown, seen, now);
    const outOfSight = kept.some((id) => id !== shown);
    // the idle limit is checked each minute, and only while a page is out of sight
    useEffect(() => {
        if (!outOfSight) {
            return;
        }
        const id = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(id);
    }, [outOfSight]);
    return (
        <>
            {kept.map((id) => {
                const s = states[id];
                const on = id === shown;
                const rect = on ? slot!.rect! : lastAppRect(id);
                return (
                    <iframe
                        // Home bumps reloads: a new frame loads the app's own url afresh
                        key={`${id}:${s.reloads}`}
                        data-app-frame={id}
                        data-app-frame-shown={on ? "true" : undefined}
                        name={appFrameName(id)}
                        src={s.url}
                        title={tools?.find((t) => t.id === s.toolId)?.name ?? s.toolId}
                        allow="clipboard-read; clipboard-write"
                        aria-hidden={on ? undefined : true}
                        tabIndex={on ? undefined : -1}
                        style={rect ?? undefined}
                        // a page with no background of its own reads as it does in a browser: on white, not on the
                        // cockpit's dark. Out of sight it is invisible, not display:none, which would lose its scroll.
                        className={cn("fixed border-0 bg-page-canvas", !on && "invisible")}
                    />
                );
            })}
        </>
    );
}
