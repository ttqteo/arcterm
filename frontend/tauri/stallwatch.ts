// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Logs each long animation frame (Chromium's Long Animation Frames API) to waveapp.log, so a main-thread stall shows
// what ran in it. Every packaged launch from 2026-11-20 to 11-23 went 12 to 43 s silent right after "cockpit rendered";
// the WebView read nothing meanwhile, and wavesrv's writes to it timed out and dropped the link. The packaged build has
// no CDP to profile it, so its frames say it here. WebKit has no such entries: there it logs nothing.

// a frame at least this long is a stall worth a line; a launch writes at most MAX_LINES of them
const LONG_FRAME_MS = 1000;
const MAX_LINES = 12;
const TOP_SCRIPTS = 3;

type ScriptTiming = {
    invoker?: string;
    invokerType?: string;
    sourceURL?: string;
    sourceFunctionName?: string;
    sourceCharPosition?: number;
    duration: number;
    forcedStyleAndLayoutDuration?: number;
};

export type LongFrame = {
    startTime: number;
    duration: number;
    blockingDuration?: number;
    renderStart?: number;
    styleAndLayoutStart?: number;
    scripts?: ScriptTiming[];
};

function baseName(url: string | undefined): string {
    if (!url) {
        return "?";
    }
    const path = url.split(/[?#]/)[0];
    return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Pure: one waveapp.log line for a long frame: when it started (ms after the page loaded), how long it ran, how much
 *  of it scripts took and how much style and layout, then its longest scripts with where they came from. */
export function formatLongFrame(f: LongFrame): string {
    const scripts = [...(f.scripts ?? [])].sort((a, b) => b.duration - a.duration);
    const scriptMs = scripts.reduce((s, x) => s + x.duration, 0);
    const end = f.startTime + f.duration;
    const layoutMs = f.styleAndLayoutStart ? end - f.styleAndLayoutStart : 0;
    const forcedMs = scripts.reduce((s, x) => s + (x.forcedStyleAndLayoutDuration ?? 0), 0);
    const parts = [
        `[stall] frame at ${Math.round(f.startTime)}ms ran ${Math.round(f.duration)}ms`,
        `script=${Math.round(scriptMs)}ms forced-layout=${Math.round(forcedMs)}ms style+layout=${Math.round(layoutMs)}ms`,
    ];
    for (const s of scripts.slice(0, TOP_SCRIPTS)) {
        const fn = s.sourceFunctionName || "(anonymous)";
        parts.push(
            `| ${Math.round(s.duration)}ms ${s.invokerType ?? "?"}:${s.invoker ?? "?"} ${baseName(s.sourceURL)}:${s.sourceCharPosition ?? "?"} ${fn}`
        );
    }
    if (scripts.length > TOP_SCRIPTS) {
        parts.push(`| +${scripts.length - TOP_SCRIPTS} more`);
    }
    return parts.join(" ");
}

/** Watches for long frames from now on, writing each to `log`, up to MAX_LINES a launch. */
export function installStallWatch(log: (msg: string) => void): void {
    const PO = (globalThis as any).PerformanceObserver;
    if (!PO || !(PO.supportedEntryTypes ?? []).includes("long-animation-frame")) {
        return;
    }
    let lines = 0;
    const obs = new PO((list: { getEntries(): LongFrame[] }) => {
        for (const f of list.getEntries()) {
            if (f.duration < LONG_FRAME_MS) {
                continue;
            }
            log(formatLongFrame(f));
            if (++lines >= MAX_LINES) {
                log(`[stall] ${MAX_LINES} long frames logged, no more this launch`);
                obs.disconnect();
                return;
            }
        }
    });
    try {
        obs.observe({ type: "long-animation-frame", buffered: true });
    } catch {
        // not supported after all
    }
}
