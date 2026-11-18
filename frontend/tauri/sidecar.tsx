// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar window's own page (src-tauri/src/sidecar.rs opens it as the "sidecar" window): it draws the
// SidecarSnapshot the main window's bridge emits as sidecar:snapshot and emits each click as sidecar:act. Like the tray
// popover's page (tray.tsx) it never boots the cockpit, the wsh client, WOS or a store: the main window owns all of
// them, and a second copy here would cost its RAM again. Spec 2026-11-13-sidecar-design.md, section 2.

import { SidecarCompact } from "@/app/cockpit/sidecarcompact";
import { layoutFor, type FormChange, type SidecarLayout } from "@/app/cockpit/sidecarlayout";
import { SidecarOrbit } from "@/app/cockpit/sidecarorbit";
import { NATIVE_MAC_FRAME, SidecarTitleBar, toggleSidecarFullscreen } from "@/app/cockpit/sidecartitlebar";
import {
    SIDECAR_ACT_EVENT,
    SIDECAR_SNAPSHOT_EVENT,
    type SidecarAct,
    type SidecarForm,
    type SidecarSnapshot,
} from "@/app/cockpit/sidecartypes";
import { useApplyCockpitTheme } from "@/app/view/agents/themestore";
import { loadFonts } from "@/util/fontutil";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";

// the main window may start after this page (a reopened Sidecar loads first): until a snapshot arrives the page asks
// again, so either launch order shows the dashboard
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

// The layout follows the window's width against its screen's (one pure rule, no hysteresis), so a drag across the line
// just switches and nothing reloads: the same snapshot feeds P (the "wall" layout) and Q (the "small" one). The screen
// is read again on each resize, since a move to a screen of another scale resizes the page.
function readLayout(): SidecarLayout {
    return layoutFor(window.innerWidth, window.screen?.availWidth);
}

function useLayout(): SidecarLayout {
    const [layout, setLayout] = useState<SidecarLayout>(readLayout);
    useEffect(() => {
        const onResize = () => setLayout(readLayout());
        window.addEventListener("resize", onResize);
        onResize();
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return layout;
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
    const layout = useLayout();
    const [form, changeForm] = useSidecarForm();
    // Date.now() too: the dashboard adds (clock - heard.at) to the snapshot's own `now`, so the two must share one clock
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
        // the only motion is the dashboard's own (the spec's Motion section: a waiting item's ping, a row's reveal, the
        // frame's and the ring's colour); the base layer's button transitions go, so a button never moves on its own
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background font-sans text-primary [&_button]:transition-none">
            <SidecarTitleBar
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
                <SidecarCompact snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
            ) : (
                <SidecarOrbit snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
            )}
        </div>
    );
}

// The alert frame (an inset edge over the whole window) follows the window's corners, or the OS cuts its corners off.
// A native Mac window rounds them 12px. Windows 11 rounds a frameless window too, 8px, except maximized or full screen
// (and Windows 10 never): read again on each resize, since both toggles resize the window.
const MAC_CORNER = "12px";
const WIN11_CORNER = "8px";

function setCorner(px: string): void {
    document.documentElement.style.setProperty("--sidecar-corner", px);
}

// Windows 11 reports platformVersion 13 and up through the client hints; Windows 10 below 13
async function windows11(): Promise<boolean> {
    const hints = (
        navigator as Navigator & {
            userAgentData?: {
                platform: string;
                getHighEntropyValues(keys: string[]): Promise<{ platformVersion?: string }>;
            };
        }
    ).userAgentData;
    if (hints?.platform !== "Windows") {
        return false;
    }
    const { platformVersion } = await hints.getHighEntropyValues(["platformVersion"]);
    return Number.parseInt(platformVersion ?? "0", 10) >= 13;
}

async function followWindowsCorners(): Promise<void> {
    if (!(await windows11())) {
        return;
    }
    const win = getCurrentWindow();
    const sync = () => {
        Promise.all([win.isMaximized(), win.isFullscreen()])
            .then(([max, fs]) => setCorner(max || fs ? "0px" : WIN11_CORNER))
            .catch((err) => console.error("sidecar: reading the window's state for its corners failed", err));
    };
    sync();
    await win.onResized(sync);
}

loadFonts();
if (NATIVE_MAC_FRAME) {
    setCorner(MAC_CORNER);
} else {
    followWindowsCorners().catch((err) => console.error("sidecar: following the window's corners failed", err));
}
// the window never scrolls: P is drawn to fit it, and Q's Needs you list scrolls inside itself
document.body.classList.add("overflow-hidden");
createRoot(document.getElementById("sidecar")!).render(<SidecarRoot />);
