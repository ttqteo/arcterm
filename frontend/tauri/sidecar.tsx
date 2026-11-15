// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar window's own page (src-tauri/src/sidecar.rs opens it as the "sidecar" window): it draws the
// SidecarSnapshot the main window's bridge emits as sidecar:snapshot and emits each click as sidecar:act. Like the tray
// popover's page (tray.tsx) it never boots the cockpit, the wsh client, WOS or a store: the main window owns all of
// them, and a second copy here would cost its RAM again. Spec 2026-11-13-sidecar-design.md, section 2.

import { layoutFor, type FormChange } from "@/app/cockpit/sidecarlayout";
import { SidecarSmall } from "@/app/cockpit/sidecarsmall";
import { SidecarTitleBar, toggleSidecarFullscreen } from "@/app/cockpit/sidecartitlebar";
import {
    SIDECAR_ACT_EVENT,
    SIDECAR_SNAPSHOT_EVENT,
    type SidecarAct,
    type SidecarForm,
    type SidecarSnapshot,
} from "@/app/cockpit/sidecartypes";
import { SidecarWall } from "@/app/cockpit/sidecarwall";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { loadFonts } from "@/util/fontutil";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
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

// the form the page shows until the host has answered: the full Sidecar, unpinned
const FULL_FORM: SidecarForm = { small: false, pinned: false };

// The layout follows the window's width alone (one pure rule, no hysteresis), so a drag across the line just switches and
// nothing reloads: the same snapshot feeds either layout.
function useInnerWidth(): number {
    const [width, setWidth] = useState(() => window.innerWidth);
    useEffect(() => {
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener("resize", onResize);
        onResize();
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return width;
}

// The host's form (the S button's small form, the pin) is the host's to keep: the page reads it once at load and takes the
// host's answer to each change. A failure is logged and the state left as it was: a read that fails reads as the full
// Sidecar, a press that fails changes nothing.
function useSidecarForm(): [SidecarForm, (change: FormChange) => void] {
    const [form, setForm] = useState<SidecarForm>(FULL_FORM);
    useEffect(() => {
        let live = true;
        invoke<SidecarForm>("sidecar_form", { change: null })
            .then((f) => live && setForm(f))
            .catch((err) => console.error("sidecar: reading the window's form failed", err));
        return () => {
            live = false;
        };
    }, []);
    const change = useCallback((change: FormChange) => {
        invoke<SidecarForm>("sidecar_form", { change })
            .then(setForm)
            .catch((err) => console.error("sidecar: changing the window's form failed", err));
    }, []);
    return [form, change];
}

function SidecarRoot() {
    useApplyCockpitTheme();
    const [heard, setHeard] = useState<Heard | null>(null);
    const layout = layoutFor(useInnerWidth());
    const [form, changeForm] = useSidecarForm();
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
            <SidecarTitleBar
                counts={heard?.snap.counts ?? null}
                machine={heard?.snap.machine}
                strain={heard?.snap.strain}
                layout={layout}
                form={form}
                onForm={changeForm}
            />
            {heard == null ? (
                <div
                    data-sidecar-waiting
                    role="status"
                    className="flex flex-1 items-center justify-center text-[13px] text-muted"
                >
                    Waiting for arcterm…
                </div>
            ) : layout === "small" ? (
                <SidecarSmall snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
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
