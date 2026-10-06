// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import type { AgentsViewModel } from "@/app/view/agents/agents";
import { ProjectSwitcher } from "@/app/view/agents/projectswitcher";
import { HeaderUsageMeters } from "@/app/view/agents/usagemeters";
import { formatChordString } from "@/util/keysym";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAtomValue } from "jotai";
import { TriangleAlert } from "lucide-react";
import { versionInfoAtom } from "./versioninfo";

// Handoff top app bar (46px). Replaces CockpitTitlebar + the old "+ New Agent" strip.
// Windows adaptation (spec D1): functional min/max/close on the right; no mac traffic-lights.
// Window dragging: a bare data-tauri-drag-region only fires on a press directly on its own element,
// so every non-interactive piece carries one. Not "deep" on the bar: the switchers' click-away
// backdrops and dropdowns render inside it and would start a drag instead of closing.
export function CockpitAppBar({ model }: { model: AgentsViewModel }) {
    const win = getCurrentWindow();
    return (
        <div
            data-tauri-drag-region
            className="flex h-[46px] shrink-0 items-center gap-4 border-b border-border bg-surface pl-4"
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

            <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center">
                <button
                    type="button"
                    onClick={() => globalStore.set(model.paletteOpenAtom, true)}
                    className="flex w-[min(520px,42%)] cursor-text items-center gap-2.5 rounded-[9px] border border-edge-mid bg-surface-raised px-3 py-[7px] text-muted hover:border-edge-strong hover:bg-surface-hover"
                >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="5.5" cy="5.5" r="4" />
                        <path d="M9 9l3 3" strokeLinecap="round" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-left text-[13px]">Search, or type a goal…</span>
                    <span className="rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[11px]">
                        {formatChordString("Ctrl:p")}
                    </span>
                </button>
            </div>

            <div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-2.5">
                <VersionMismatchPill />
                <HeaderUsageMeters model={model} />
                {/* secondary, so New agent stays the one primary action. data-new-run: the Brief's `r` key
                    presses this (buildJarvisBindings). */}
                <button
                    type="button"
                    data-new-run
                    aria-haspopup="dialog"
                    onClick={() => globalStore.set(model.newRunOpenAtom, true)}
                    className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-edge-mid bg-surface-raised px-[clamp(9px,1.3vw,12px)] py-[6px] text-[clamp(11px,1.35vw,12.5px)] font-semibold text-primary hover:border-edge-strong hover:bg-surface-hover"
                >
                    <span className="-mt-px text-[15px] leading-none">+</span>New run
                </button>
                <button
                    type="button"
                    onClick={() => globalStore.set(model.newAgentOpenAtom, true)}
                    className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] bg-accent px-[clamp(9px,1.3vw,12px)] py-[7px] text-[clamp(11px,1.35vw,12.5px)] font-semibold text-background hover:bg-accenthover"
                >
                    <span className="-mt-px text-[15px] leading-none">+</span>New agent
                </button>

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
                        aria-label="Maximize"
                        className="flex h-8 w-11 cursor-pointer items-center justify-center text-secondary hover:bg-hover"
                    >
                        &#x25A1;
                    </button>
                    <button
                        onClick={() => win.close()}
                        aria-label="Close"
                        className="flex h-8 w-11 cursor-pointer items-center justify-center text-secondary hover:bg-error hover:text-white"
                    >
                        &#x2715;
                    </button>
                </div>
            </div>
        </div>
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
