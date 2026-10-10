// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Dev-only spike for float mini (docs/superpowers/specs/2026-10-10-float-mini-sprout-design.md, "Spike first"), run
// from the devtools console while floating:
//   await __arcMiniProbe.shrink()          hide the page; a see-through 200px window on top, a stand-in Sprout
//                                          square that alone takes clicks ("[miniprobe] hit")
//   await __arcMiniProbe.grow()            grow to 380x620 around the square's corner
//   await __arcMiniProbe.restore()         give the frame back
//   await __arcMiniProbe.listenMinimize()  redirect the yellow button; a click logs "[miniprobe] float-minimize"
//   await __arcMiniProbe.unredirect()
// Removed by the plan's last task.

import { listen } from "@tauri-apps/api/event";
import { cursorPosition, getCurrentWindow, LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { FLOAT_MIN_SIZE } from "./floatwindow";
import { FLOAT_MINIMIZE_EVENT, redirectMinimize, setTrafficLightsHidden } from "./macwindow";

if (import.meta.env.DEV) {
    const win = getCurrentWindow();
    let saved: { x: number; y: number; width: number; height: number } | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let square: HTMLDivElement | null = null;

    const shrink = async () => {
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
        saved = { x: pos.x, y: pos.y, width: size.width, height: size.height };
        const main = document.getElementById("main");
        if (main != null) {
            main.style.display = "none";
        }
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        square = document.createElement("div");
        Object.assign(square.style, {
            position: "fixed",
            right: "8px",
            bottom: "8px",
            width: "64px",
            height: "64px",
            borderRadius: "8px",
            background: "var(--color-accent)",
        });
        square.onclick = () => console.log("[miniprobe] hit");
        document.body.appendChild(square);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await setTrafficLightsHidden(true);
        await win.setShadow(false);
        await win.setMinSize(null);
        await win.setSize(new LogicalSize(200, 200));
        await win.setAlwaysOnTop(true);
        let ignoring: boolean | null = null;
        poll = setInterval(async () => {
            if (square == null) {
                return;
            }
            const [c, inner, scale] = await Promise.all([cursorPosition(), win.innerPosition(), win.scaleFactor()]);
            const r = square.getBoundingClientRect();
            const x = (c.x - inner.x) / scale;
            const y = (c.y - inner.y) / scale;
            const hit = x >= r.left && x < r.right && y >= r.top && y < r.bottom;
            if (ignoring !== !hit) {
                ignoring = !hit;
                await win.setIgnoreCursorEvents(!hit);
            }
        }, 1000 / 15);
    };

    const grow = async () => {
        const [pos, size, scale] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
        const w = Math.round(380 * scale);
        const h = Math.round(620 * scale);
        await win.setSize(new PhysicalSize(w, h));
        await win.setPosition(new PhysicalPosition(pos.x + size.width - w, pos.y + size.height - h));
    };

    const restore = async () => {
        if (poll != null) {
            clearInterval(poll);
            poll = null;
        }
        await win.setIgnoreCursorEvents(false);
        await win.setShadow(true);
        await setTrafficLightsHidden(false);
        if (saved != null) {
            await win.setSize(new PhysicalSize(saved.width, saved.height));
            await win.setPosition(new PhysicalPosition(saved.x, saved.y));
        }
        await win.setMinSize(new LogicalSize(FLOAT_MIN_SIZE.width, FLOAT_MIN_SIZE.height));
        await win.setAlwaysOnTop(false);
        square?.remove();
        square = null;
        document.documentElement.style.background = "";
        // index.html paints the body inline; a see-through window shows the desktop wherever nothing paints
        document.body.style.background = "#1a1a1a";
        const main = document.getElementById("main");
        if (main != null) {
            main.style.display = "";
        }
    };

    const listenMinimize = async () => {
        await redirectMinimize(true);
        await listen(FLOAT_MINIMIZE_EVENT, () => console.log("[miniprobe] float-minimize"));
    };

    (globalThis as Record<string, unknown>).__arcMiniProbe = {
        shrink,
        grow,
        restore,
        listenMinimize,
        unredirect: () => redirectMinimize(false),
    };
}
