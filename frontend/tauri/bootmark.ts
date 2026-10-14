// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The page's first script, run before main.tsx's module graph has loaded. It tells a CDP check (scripts/cdp/verify.mjs)
// how far the boot got: "html" while a cold vite still pre-bundles main.tsx's imports (the page can read
// readyState "complete" by then, so that says nothing), then main.tsx's own phases. It also keeps the first uncaught
// error from before main.tsx runs: a module that throws while loading leaves it nowhere else, since main.tsx's own
// error logging never installs.

type ArcBoot = { phase: "html" | "started" | "rendered" | "failed"; error: string | null };

declare global {
    interface Window {
        __arcBoot?: ArcBoot;
    }
}

const boot: ArcBoot = { phase: "html", error: null };
window.__arcBoot = boot;
window.addEventListener("error", (e) => {
    // only before the app runs: later errors (a ResizeObserver loop, say) are not a failed boot
    if (boot.phase === "html") boot.error ??= e.error?.stack ?? e.message;
});

export {};
