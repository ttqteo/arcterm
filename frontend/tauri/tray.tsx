// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The tray popover's own page (src-tauri/src/tray.rs opens it in the "tray" window): it shows the TraySnapshot the
// cockpit emits as tray:snapshot, the offline page on tray:offline, and emits each click as tray:act. It never boots
// the cockpit, the wsh client or WOS. The host loads it on a hover over the icon and keeps it between opens: it is on
// screen from tray:shown to tray:closed. ?fixture=<name> (trayfixtures.ts) draws a canned snapshot and records the acts
// in window.__trayActs, for the CDP scenarios.

import { pageState } from "@/app/cockpit/trayformat";
import { LoadingPage, MainPage, OfflinePage } from "@/app/cockpit/traypage";
import { FreeUpPage, StoragePage } from "@/app/cockpit/traysubpages";
import type { TrayAct, TrayPage, TraySnapshot } from "@/app/cockpit/traytypes";
import { PopoverReveal } from "@/app/element/popoverreveal";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { loadFonts } from "@/util/fontutil";
import { cn } from "@/util/util";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { TRAY_FIXTURES } from "./trayfixtures";

declare global {
    interface Window {
        __trayActs?: TrayAct[];
    }
}

const fixtureName = new URLSearchParams(location.search).get("fixture");
const fixture = fixtureName != null ? TRAY_FIXTURES[fixtureName] : undefined;
// Windows 11 draws the real window's rounded border itself (shadow on an undecorated window); a CSS one inside it
// shows as a second edge at the corners. The fixture page has no window frame, so it keeps its own.
const osFrame = fixtureName == null && /Windows/.test(navigator.userAgent);
// the loading card shows only when the cockpit's first snapshot is this late
const LOADING_SHOWS_MS = 400;

function send(act: TrayAct): void {
    if (fixtureName != null) {
        window.__trayActs = [...(window.__trayActs ?? []), act];
        return;
    }
    void emit("tray:act", act);
}

function TrayRoot() {
    useApplyCockpitTheme();
    const [snap, setSnap] = useState<TraySnapshot | null>(fixture?.snapshot ?? null);
    const [offline, setOffline] = useState(fixture?.offline ?? false);
    // not the last snapshot's arrival: the cockpit keeps sending snapshots after wavesrv has gone
    const lastHeard = snap?.heardAt ?? fixture?.lastHeard ?? null;
    const [page, setPageState] = useState<TrayPage>(fixture?.page ?? "main");
    const [waited, setWaited] = useState(false);
    // the reveal plays on the first show only: a kept page painted last as it was at the hide, so a replay would flash
    // it, then nothing, then the reveal; the host fades the kept panel in instead
    const [everShown, setEverShown] = useState(fixtureName != null);
    const rootRef = useRef<HTMLDivElement>(null);
    const setPage = (p: TrayPage) => {
        setPageState(p);
        send({ kind: "page", page: p });
    };

    useEffect(() => {
        if (fixtureName != null) {
            return;
        }
        const unlisten = [
            listen<TraySnapshot>("tray:snapshot", (e) => setSnap(e.payload)),
            listen("tray:offline", () => setOffline(true)),
            listen("tray:shown", () => {
                setEverShown(true);
                // after the frame that draws it: the host logs the open's time
                requestAnimationFrame(() => send({ kind: "shown" }));
            }),
            // the next open starts on the main page, already drawn when the kept panel comes back
            listen("tray:closed", () => setPageState("main")),
        ];
        send({ kind: "hello" });
        const timer = setTimeout(() => setWaited(true), LOADING_SHOWS_MS);
        return () => {
            clearTimeout(timer);
            unlisten.forEach((p) => void p.then((off) => off()));
        };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            e.preventDefault();
            if (page !== "main") {
                setPage("main");
            } else {
                send({ kind: "close" });
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [page]);

    useEffect(() => {
        const el = rootRef.current;
        if (fixtureName != null || el == null) {
            return;
        }
        // offsetHeight, not getBoundingClientRect: the reveal's scale must not shrink the window. Nothing shows before
        // the first snapshot, and the window keeps its first height meanwhile.
        const ro = new ResizeObserver(() => {
            if (el.offsetHeight === 0) {
                return;
            }
            void invoke("tray_popover_size", { height: Math.ceil(el.offsetHeight) }).catch(() => {});
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const state = pageState(snap, offline);
    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="arcterm"
            data-tray-page={state === "ready" ? page : state}
            className="w-[360px]"
        >
            {/* the shared popover reveal (reduced motion respected), from the icon's side; the shadow is the window's own.
                It waits for the first snapshot, or LOADING_SHOWS_MS: revealed at once, it played on the loading card,
                and the real page then came in with no motion at all. */}
            <PopoverReveal
                open={everShown && (state !== "loading" || waited)}
                origin={snap?.platform === "win" ? "bottom center" : "top center"}
                className={cn("bg-surface p-2.5 font-sans", !osFrame && "rounded-lg border border-edge-strong")}
            >
                {state === "offline" ? (
                    <OfflinePage lastHeard={lastHeard} send={send} />
                ) : state === "loading" || snap == null ? (
                    <LoadingPage />
                ) : page === "freeup" ? (
                    <FreeUpPage s={snap} send={send} back={() => setPage("main")} />
                ) : page === "storage" ? (
                    <StoragePage s={snap} send={send} back={() => setPage("main")} />
                ) : (
                    <MainPage s={snap} send={send} setPage={setPage} />
                )}
            </PopoverReveal>
        </div>
    );
}

loadFonts();
if (fixtureName != null) {
    // a backdrop for the CDP shots; the real window is transparent around the popover
    document.body.classList.add("bg-background", "p-4");
} else {
    // The real window never scrolls: the host sizes it to the popover, and a scrollbar holds itself up once shown. It
    // narrows the 360 px page, the page then scrolls sideways, and that second bar keeps the height short.
    document.body.classList.add("overflow-hidden");
    if (osFrame) {
        // fills the frame while the window catches up with the page's height, not the page's own height (the host
        // sizes the window from it, so the window could never shrink)
        document.body.classList.add("bg-surface");
    }
}
createRoot(document.getElementById("tray")!).render(<TrayRoot />);
