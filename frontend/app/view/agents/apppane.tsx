// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A pinned app's page, shown on the Agent surface in place of its (still mounted, hidden) terminal: the page in a frame
// once it answers, a waiting card before. Its header is the terminal's (TerminalPaneHead: Page | Log, Reload, Open in
// browser, Stop). What it shows is appmodel.ts's; the state is appstore.ts's.

import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { appShows, appWaitLine, type AppState } from "./appmodel";
import { setAppView } from "./appstore";
import { toolsStatusAtom } from "./toolsstore";

function useNow(on: boolean): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) {
            return;
        }
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [on]);
    return now;
}

export function AppPane({ tabId, state }: { tabId: string; state: AppState }) {
    const name = useAtomValue(toolsStatusAtom)?.find((t) => t.id === state.toolId)?.name ?? state.toolId;
    const shows = appShows(state);
    const now = useNow(shows === "waiting");
    if (shows === "page") {
        return (
            <iframe
                key={state.reloads}
                data-app-frame={tabId}
                src={state.url}
                title={name}
                allow="clipboard-read; clipboard-write"
                // a page with no background of its own reads as it does in a browser: on white, not on the cockpit's dark
                className="min-h-0 w-full flex-1 border-0 bg-page-canvas"
            />
        );
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
