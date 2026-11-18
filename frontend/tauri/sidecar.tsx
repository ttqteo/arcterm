// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Sidecar window's own page (src-tauri/src/sidecar.rs opens it as the "sidecar" window): it draws the
// SidecarSnapshot the main window's bridge emits as sidecar:snapshot and emits each click as sidecar:act. Like the tray
// popover's page (tray.tsx) it never boots the cockpit, the wsh client, WOS or a store: the main window owns all of
// them, and a second copy here would cost its RAM again. Spec 2026-11-13-sidecar-design.md, section 2.

import { SidecarCompact } from "@/app/cockpit/sidecarcompact";
import { HudLabel } from "@/app/cockpit/sidecarhud";
import { layoutFor, type FormChange, type SidecarLayout } from "@/app/cockpit/sidecarlayout";
import { SidecarOrbit } from "@/app/cockpit/sidecarorbit";
import { SidecarResourcesPanel } from "@/app/cockpit/sidecarresourcespanel";
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
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";

// the main window may start after this page (a reopened Sidecar loads first): until a snapshot arrives the page asks
// again, so either launch order shows the dashboard
const HELLO_RETRY_MS = 2000;
// ages are minutes and hours: a redraw every 30 s keeps them honest at no other cost
const CLOCK_TICK_MS = 30_000;
// while the resource panel is open the host is asked again which processes draw the page: a renderer that crashed and
// came back is a new pid
const PIDS_REFRESH_MS = 15_000;

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

// The resources: while the wall shows its band or the small form's panel is open, the page tells the main window's bridge
// (which then polls the Resource Manager) with the pids the host says draw this page, and again as they change; once
// neither shows, it tells the bridge to stop. A pid read that fails leaves Sidecar's own row unmeasured, the rest as it
// is. The band takes the panel's place: a panel left open shuts when the window widens to the wall.
// The page asks only once it has heard its first snapshot (`answered`): the bridge answers a hello by shutting the
// resource panel ("a reloaded page starts with its panel shut", sidecarbridge.tsx), so an open act that reaches it before
// the hello is wiped and never sent again. A snapshot heard means the hello was answered; the panel and the column still
// show at once (measuring) from the page's own state, whatever the bridge has heard.
function useResourcesPanel(band: boolean, answered: boolean): [boolean, () => void, () => void] {
    const [open, setOpen] = useState(false);
    if (band && open) {
        setOpen(false);
    }
    const want = (open || band) && answered;
    useEffect(() => {
        if (!want) {
            return;
        }
        let live = true;
        let last = "";
        const tell = () => {
            invoke<number[]>("sidecar_pids")
                .catch((err) => {
                    console.error("sidecar: reading the page's processes failed", err);
                    return [] as number[];
                })
                .then((pids) => {
                    const key = pids.join(",");
                    if (live && key !== last) {
                        last = key;
                        send({ kind: "resources", open: true, pids });
                    }
                });
        };
        // the panel shows at once (measuring) while the pids are read
        send({ kind: "resources", open: true, pids: [] });
        tell();
        const timer = setInterval(tell, PIDS_REFRESH_MS);
        return () => {
            live = false;
            clearInterval(timer);
            send({ kind: "resources", open: false, pids: [] });
        };
    }, [want]);
    const toggle = useCallback(() => setOpen((o) => !o), []);
    const close = useCallback(() => setOpen(false), []);
    return [open, toggle, close];
}

function SidecarRoot() {
    useApplyCockpitTheme();
    const [heard, setHeard] = useState<Heard | null>(null);
    const layout = useLayout();
    const wall = layout === "wall";
    const [form, changeForm] = useSidecarForm();
    const [resourcesOpen, toggleResources, closeResources] = useResourcesPanel(wall, heard != null);
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
        // frame's and the ring's colour); the base layer's button transitions go, so a button never moves on its own.
        // Nothing in Sidecar is text to copy (it has no input either), so no drag or Cmd+A paints a selection over it.
        <div className="relative flex h-screen w-screen select-none flex-col overflow-hidden bg-hud-bg font-sans text-primary [&_button]:transition-none">
            <SidecarTitleBar
                machine={heard?.snap.machine}
                strain={heard?.snap.strain}
                layout={layout}
                form={form}
                onForm={changeForm}
                resourcesOpen={resourcesOpen}
                onResources={wall ? undefined : toggleResources}
            />
            {/* the body under the bar: the small form's Resources view covers it as a tab would, while the dashboard stays
                mounted under it (its alert frame, fixed over the whole window, keeps showing) */}
            <div className="relative flex min-h-0 flex-1 flex-col">
                {heard == null ? (
                    <div data-sidecar-waiting role="status" className="flex flex-1 items-center justify-center">
                        <HudLabel className="text-[12px]">Waiting for arcterm…</HudLabel>
                    </div>
                ) : layout === "small" ? (
                    <SidecarCompact snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
                ) : (
                    <SidecarOrbit snap={heard.snap} receivedAt={heard.at} clock={clock} send={send} />
                )}
                {resourcesOpen && <SidecarResourcesPanel resources={heard?.snap.resources} onClose={closeResources} />}
            </div>
        </div>
    );
}

// The alert frame (an inset edge over the whole window) and every box in Sidecar are rounded, never sharp (spec
// 2026-11-18-sidecar-hud-design.md, "Corners"): the frame takes `--sidecar-corner` as its radius. A native Mac window's
// radius is the host's to read (`sidecar_corner`, AppKit's own: 16px on macOS 26 and later, where a 12px frame left the
// window's rounder corner cutting its stroke away); 12px until it answers, or when it cannot. On Windows (10 and 11
// alike) the frame is 8px whatever the window's state, a maximized or full-screen one included, so nothing reads the
// window or listens to its resizes for it.
const MAC_CORNER = "12px";
const WIN_CORNER = "8px";

function setCorner(px: string): void {
    document.documentElement.style.setProperty("--sidecar-corner", px);
}

loadFonts();
setCorner(NATIVE_MAC_FRAME ? MAC_CORNER : WIN_CORNER);
if (NATIVE_MAC_FRAME) {
    invoke<number | null>("sidecar_corner")
        .then((r) => r != null && r > 0 && setCorner(`${r}px`))
        .catch((err) => console.error("sidecar: reading the window's corner failed", err));
}
// the window never scrolls: P is drawn to fit it, and Q's Needs you list scrolls inside itself
document.body.classList.add("overflow-hidden");
createRoot(document.getElementById("sidecar")!).render(<SidecarRoot />);
