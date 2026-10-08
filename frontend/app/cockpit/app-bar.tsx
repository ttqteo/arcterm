// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ShortcutHint } from "@/app/element/shortcuthint";
import { atoms, isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { useBindingKeys } from "@/app/store/keybindings/store";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { ConsumersPanel } from "@/app/view/agents/consumerspanel";
import { ProjectSwitcher } from "@/app/view/agents/projectswitcher";
import { HeaderUsageMeters } from "@/app/view/agents/usagemeters";
import { WorkerCapacityChip } from "@/app/view/agents/workercapacitychip";
import { formatChordString } from "@/util/keysym";
import { isMacOS } from "@/util/platformutil";
import { getCurrentWindow } from "@tauri-apps/api/window";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { versionInfoAtom } from "./versioninfo";

// Handoff top app bar (46px). Replaces CockpitTitlebar + the old "+ New Agent" strip.
// Windows adaptation (spec D1): functional min/max/close on the right; no mac traffic-lights.
// macOS keeps its native traffic lights instead (tauri.macos.conf.json overlays them on this bar), so
// the bar drops its own controls and leaves room for the lights on the left: 16px margin, the ~60px
// lights, then the bar's own 16px gap before the mark. trafficLightPosition's y puts their centre on
// the bar's centre line.
// Window dragging: a bare data-tauri-drag-region only fires on a press directly on its own element,
// so every non-interactive piece carries one. Not "deep" on the bar: the switchers' click-away
// backdrops and dropdowns render inside it and would start a drag instead of closing.
export function CockpitAppBar({ model }: { model: AgentsViewModel }) {
    const mac = isMacOS();
    // the lights hide in macOS fullscreen, so their room goes with them
    const fullscreen = useAtomValue(atoms.isFullScreen);
    const newRunKeys = useBindingKeys("new-run");
    const newAgentKeys = useBindingKeys("new-agent");
    return (
        <div
            data-tauri-drag-region
            className={clsx(
                "flex h-[46px] shrink-0 items-center gap-4 border-b border-border bg-surface",
                mac ? "pr-4" : null,
                mac && !fullscreen ? "pl-[92px]" : "pl-4"
            )}
        >
            <div data-tauri-drag-region className="flex items-center gap-[9px]">
                <span data-tauri-drag-region className="flex shrink-0 text-primary">
                    <ArctermMark />
                </span>
                <span data-tauri-drag-region className="text-[14.5px] font-bold tracking-[-0.01em] text-primary">
                    arcterm
                    {/* a dev app beside the installed one must not pass for it (main.rs titles its window too) */}
                    {isDev() ? <span className="ml-1 text-[13px] font-medium text-muted">(dev)</span> : null}
                </span>
                <span data-tauri-drag-region className="text-[13px] text-muted">
                    /
                </span>
                <ProjectSwitcher model={model} variant="bar" />
            </div>

            {/* the padding is drag room: at a narrow window the search otherwise fills the whole middle, and
                the bar leaves nothing to grab but the wordmark and the 16px gaps */}
            <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center px-[clamp(24px,5vw,72px)]">
                <button
                    type="button"
                    onClick={() => globalStore.set(model.paletteOpenAtom, true)}
                    className="flex w-full max-w-[520px] cursor-text items-center gap-2.5 rounded-[9px] border border-edge-mid bg-surface-raised px-3 py-[7px] text-muted hover:border-edge-strong hover:bg-surface-hover"
                >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="5.5" cy="5.5" r="4" />
                        <path d="M9 9l3 3" strokeLinecap="round" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-left text-[13px]">Search, or type a goal…</span>
                    <ShortcutHint id="palette" className="border-border" />
                </button>
            </div>

            <div data-tauri-drag-region className="relative flex h-full shrink-0 items-center gap-2.5">
                <VersionMismatchPill />
                <WorkerCapacityChip />
                <HeaderUsageMeters model={model} />
                {/* secondary, so New agent stays the one primary action. data-new-run: the Brief's `r` key
                    presses this (buildJarvisBindings). */}
                <button
                    type="button"
                    data-new-run
                    aria-haspopup="dialog"
                    title={withChord("New run", newRunKeys)}
                    onClick={() => globalStore.set(model.newRunOpenAtom, true)}
                    className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-edge-mid bg-surface-raised px-[clamp(9px,1.3vw,12px)] py-[6px] text-[clamp(11px,1.35vw,12.5px)] font-semibold text-primary hover:border-edge-strong hover:bg-surface-hover"
                >
                    <span className="-mt-px text-[15px] leading-none">+</span>New run
                    <ShortcutHint id="new-run" className={clsx(HINT_FIT, "border-edge-mid text-muted")} />
                </button>
                <button
                    type="button"
                    title={withChord("New agent", newAgentKeys)}
                    onClick={() => globalStore.set(model.newAgentOpenAtom, true)}
                    className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-accent px-[clamp(9px,1.3vw,12px)] py-[7px] text-[clamp(11px,1.35vw,12.5px)] font-semibold text-background hover:bg-accenthover"
                >
                    <span className="-mt-px text-[15px] leading-none">+</span>New agent
                    <ShortcutHint
                        id="new-agent"
                        className={clsx(HINT_FIT, "border-background/30 text-background/75")}
                    />
                </button>

                {mac ? null : <WindowControls />}
                <ConsumersPanel model={model} />
            </div>
        </div>
    );
}

// A button's chips go at a narrow window, where the bar has no room left for them; the title still names the chord.
const HINT_FIT = "ml-0.5 max-[1199px]:hidden";

// a title with its shortcut in trailing parentheses, which the tooltip shows apart (DESIGN.md "Tooltips")
function withChord(label: string, keys: string | undefined): string {
    return keys == null ? label : `${label} (${formatChordString(keys)})`;
}

function WindowControls() {
    const win = getCurrentWindow();
    const maximized = useWindowMaximized();
    return (
        <div data-tauri-drag-region className="flex h-full shrink-0 items-center border-l border-border">
            <button
                onClick={() => win.minimize()}
                aria-label="Minimize"
                className="flex h-8 w-11 cursor-pointer items-center justify-center text-secondary hover:bg-hover"
            >
                &#x2013;
            </button>
            <button
                onClick={() => win.toggleMaximize()}
                aria-label={maximized ? "Restore" : "Maximize"}
                className="flex h-8 w-11 cursor-pointer items-center justify-center text-secondary hover:bg-hover"
            >
                {maximized ? <RestoreGlyph /> : <>&#x25A1;</>}
            </button>
            <button
                onClick={() => win.close()}
                aria-label="Close"
                className="flex h-8 w-11 cursor-pointer items-center justify-center text-secondary hover:bg-error hover:text-white"
            >
                &#x2715;
            </button>
        </div>
    );
}

// Tracks the window's maximized state so the middle control reads Restore once maximized. Snapping, the
// title-bar double-click and Win+Up maximize too, and each of them resizes the window, so onResized
// catches every route rather than only this button.
function useWindowMaximized(): boolean {
    const [maximized, setMaximized] = useState(false);
    useEffect(() => {
        const win = getCurrentWindow();
        let live = true;
        const sync = () => win.isMaximized().then((m) => live && setMaximized(m));
        sync();
        const unlisten = win.onResized(sync);
        return () => {
            live = false;
            unlisten.then((f) => f());
        };
    }, []);
    return maximized;
}

// Windows' restore glyph: a front square with the back one peeking out top-right, sized to sit beside
// the text glyphs of its neighbours.
function RestoreGlyph() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
        </svg>
    );
}

// The arcterm "t>" mark (public/logos/arcterm.png) as vector pixel art on whole CSS pixels, so it stays
// sharp where the downscaled PNG blurred. The source is a 12x9 cell grid; each cell sits at 2px steps
// but is drawn 3px square, so neighbours overlap by 1px as the source's blocks do: the chevron reads
// as one stroke and the strokes carry the weight of the bold wordmark beside it.
// pointer-events-none: drag.js skips SVG elements, so the press must land on the parent span.
function ArctermMark() {
    return (
        <svg
            width="25"
            height="19"
            viewBox="0 0 25 19"
            fill="currentColor"
            shapeRendering="crispEdges"
            aria-hidden="true"
            className="pointer-events-none"
        >
            <rect x="2" y="2" width="3" height="13" />
            <rect x="0" y="6" width="11" height="3" />
            <rect x="10" y="12" width="3" height="3" />
            <rect x="4" y="14" width="7" height="3" />
            <path d="M14 0h3v3h-3zM16 2h3v3h-3zM18 4h3v3h-3zM20 6h3v3h-3zM22 8h3v3h-3zM20 10h3v3h-3zM18 12h3v3h-3zM16 14h3v3h-3zM14 16h3v3h-3z" />
        </svg>
    );
}

// Renders only when the shell and the wavesrv it spawned were built from different versions — the
// stale-dist/bin trap, whose only other symptom is an unrelated-looking route error much later.
function VersionMismatchPill() {
    const version = useAtomValue(versionInfoAtom);
    if (!version.mismatch) {
        return null;
    }
    return (
        <span
            title={`App ${version.app}, backend ${version.server}. dist/bin is stale — run \`task build:backend\` and restart.`}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-warning/40 bg-warning/10 px-2 py-[5px] text-[11.5px] font-semibold text-warning"
        >
            <TriangleAlert size={12} />
            {version.app} / {version.server}
        </span>
    );
}
