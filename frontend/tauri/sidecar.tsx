// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar window's own page (src-tauri/src/sidecar.rs opens it as the "sidecar" window): it draws the
// SidecarSnapshot the main window's bridge emits as sidecar:snapshot and emits each click as sidecar:act. Like the tray
// popover's page (tray.tsx) it never boots the cockpit, the wsh client, WOS or a store: the main window owns all of
// them, and a second copy here would cost its RAM again. Spec 2026-11-13-sidecar-design.md, section 2.

import { SidecarTitleBar, toggleSidecarFullscreen } from "@/app/cockpit/sidecartitlebar";
import {
    SIDECAR_ACT_EVENT,
    SIDECAR_SNAPSHOT_EVENT,
    type SidecarAct,
    type SidecarSnapshot,
} from "@/app/cockpit/sidecartypes";
import { SidecarWall } from "@/app/cockpit/sidecarwall";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { loadFonts } from "@/util/fontutil";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";

// the main window may start after this page (a reopened Sidecar loads first): until a snapshot arrives the page asks
// again, so either launch order shows the wall
const HELLO_RETRY_MS = 2000;
// ages are minutes and hours: a redraw every 30 s keeps them honest at no other cost
const CLOCK_TICK_MS = 30_000;

function send(act: SidecarAct): void {
    emit(SIDECAR_ACT_EVENT, act).catch((err) => console.error("sidecar: could not send", act.kind, err));
}

interface Heard {
    snap: SidecarSnapshot;
    at: number; // Date.now() when it arrived
}

function SidecarRoot() {
    useApplyCockpitTheme();
    const [heard, setHeard] = useState<Heard | null>(null);
    // Date.now() too: the wall adds (clock - heard.at) to the snapshot's own `now`, so the two must share one clock
    const [clock, setClock] = useState(() => Date.now());

    useEffect(() => {
        let live = true;
        let answered = false;
        let retry: ReturnType<typeof setInterval> | undefined;
        const unlisten = listen<SidecarSnapshot>(SIDECAR_SNAPSHOT_EVENT, (e) => {
            answered = true;
            const at = Date.now();
            setHeard({ snap: e.payload, at });
            // a snapshot's arrival is an age reading too, or the age would lag by up to a tick
            setClock(at);
        });
        // the hello goes out once the listener is registered, so its answer cannot arrive before anything hears it
        unlisten
            .then(() => {
                if (!live) {
                    return;
                }
                const hello = () => {
                    if (answered) {
                        clearInterval(retry);
                        return;
                    }
                    send({ kind: "hello" });
                };
                hello();
                retry = setInterval(hello, HELLO_RETRY_MS);
            })
            .catch((err) => console.error("sidecar: cannot listen for snapshots", err));
        const tick = setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
        return () => {
            live = false;
            clearInterval(retry);
            clearInterval(tick);
            void unlisten.then((off) => off()).catch(() => {});
        };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "F11") {
                return;
            }
            e.preventDefault();
            toggleSidecarFullscreen().catch((err) => console.error("sidecar: toggling full screen failed", err));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        // nothing on this page animates (spec decision 14), so the base layer's button transitions go too
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-primary [&_button]:transition-none">
            <SidecarTitleBar counts={heard?.snap.counts ?? null} />
            {heard == null ? (
                <div
                    data-sidecar-waiting
                    role="status"
                    className="flex flex-1 items-center justify-center text-[13px] text-muted"
                >
                    Waiting for arcterm…
                </div>
            ) : (
                <SidecarWall snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
            )}
        </div>
    );
}

loadFonts();
// the window never scrolls: the wall fits one screen, or scrolls inside itself
document.body.classList.add("overflow-hidden");
createRoot(document.getElementById("sidecar")!).render(<SidecarRoot />);
