// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's title bar (board D-fit-by-count). The window has no frame of its own, so the page draws the name, the three
// counts in the wall's words and the window buttons. It runs on the slim page (frontend/tauri/sidecar.tsx), which boots
// no cockpit store: this file may import only the Tauri window API and the shared types.

import { cn } from "@/util/util";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import type { SidecarSnapshot } from "./sidecartypes";

type Counts = SidecarSnapshot["counts"];

function logFailure(what: string, err: unknown): void {
    console.error(`sidecar: ${what} failed`, err);
}

function windowAction(what: string, run: () => Promise<void>): () => void {
    return () => {
        run().catch((err) => logFailure(what, err));
    };
}

/** F11 and the title bar's full screen button: the same toggle on the screen the window is on. */
export async function toggleSidecarFullscreen(): Promise<void> {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
}

// Both toggles resize the window, so onResized is what keeps the state current whichever way it changed (F11, the
// button, the OS).
function useFullscreen(): boolean {
    const [fullscreen, setFullscreen] = useState(false);
    useEffect(() => {
        const win = getCurrentWindow();
        let live = true;
        const sync = () => {
            win.isFullscreen()
                .then((fs) => live && setFullscreen(fs))
                .catch((err) => logFailure("reading the full screen state", err));
        };
        sync();
        const unlisten = win.onResized(sync);
        return () => {
            live = false;
            void unlisten.then((off) => off()).catch(() => {});
        };
    }, []);
    return fullscreen;
}

function Count(props: { kind: keyof Counts; n: number; label: string; tone: string }) {
    // the wrapper holds the number and its words, so a reader (a person, the CDP scenario) gets "3 need you" whole
    return (
        <span data-sidecar-count={props.kind} className="whitespace-nowrap">
            <b className={cn("font-semibold tabular-nums", props.tone)}>{props.n}</b> {props.label}
        </span>
    );
}

// tabIndex -1 and no focus on press: a button left focused would take the Enter that opens the selected agent and the
// arrow keys of the wall, and a frameless window's controls are the mouse's anyway (F11 is the keyboard's).
function TitleButton(props: {
    name: "minimize" | "maximize" | "fullscreen" | "close";
    label: string;
    onClick: () => void;
    pressed?: boolean;
    className: string;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            data-sidecar-btn={props.name}
            aria-label={props.label}
            aria-pressed={props.pressed}
            title={props.label}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onClick}
            className={cn("flex items-center justify-center text-secondary", props.className)}
        >
            {props.children}
        </button>
    );
}

const WINDOW_BTN = "h-full w-11 hover:bg-hover";

export function SidecarTitleBar(props: { counts: Counts | null }) {
    const win = getCurrentWindow();
    const fullscreen = useFullscreen();
    const counts = props.counts;
    return (
        <div
            data-sidecar-titlebar
            // "deep": the whole bar drags, the buttons opt out (the main window's app bar does the same)
            data-tauri-drag-region="deep"
            className="flex h-[38px] shrink-0 select-none items-center gap-4 border-b border-border bg-surface pl-3.5"
        >
            <div className="flex items-center gap-2 text-[13px]">
                <span className="font-bold text-primary">arcterm</span>
                {/* a dev app beside the installed one must not pass for it (the window's own title says so too) */}
                {import.meta.env.DEV ? <span className="font-medium text-muted">(dev)</span> : null}
                <span className="text-muted">/</span>
                <span className="font-semibold text-primary">Sidecar</span>
            </div>
            {/* no counts before the first snapshot: a 0 there would read as "nothing needs you" */}
            {counts == null ? null : (
                <div className="ml-3 flex items-baseline gap-3.5 text-[13px] text-secondary">
                    <Count kind="asking" n={counts.asking} label="need you" tone="text-asking" />
                    <Count kind="working" n={counts.working} label="working" tone="text-working" />
                    <Count kind="idle" n={counts.idle} label="idle" tone="text-primary" />
                </div>
            )}
            <div className="ml-auto flex h-full items-center gap-4">
                {/* the S button's place (part 2): empty, so it takes no room and no dead button shows */}
                <span data-sidecar-slot="small" className="empty:hidden" />
                <TitleButton
                    name="fullscreen"
                    label={fullscreen ? "Exit full screen (F11)" : "Full screen (F11)"}
                    pressed={fullscreen}
                    onClick={windowAction("toggling full screen", toggleSidecarFullscreen)}
                    className="h-[26px] w-[30px] rounded-md border border-edge-mid bg-surface-raised hover:bg-surface-hover"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        {fullscreen ? (
                            <path d="M3 8h3a2 2 0 0 0 2-2V3M16 3v3a2 2 0 0 0 2 2h3M21 16h-3a2 2 0 0 0-2 2v3M8 21v-3a2 2 0 0 0-2-2H3" />
                        ) : (
                            <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
                        )}
                    </svg>
                </TitleButton>
                <div className="flex h-full">
                    <TitleButton
                        name="minimize"
                        label="Minimize"
                        onClick={windowAction("minimizing", () => win.minimize())}
                        className={WINDOW_BTN}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                        >
                            <path d="M5 12h14" />
                        </svg>
                    </TitleButton>
                    {/* the planned capability (spec 1) has toggle-maximize but no is-maximized, so the button cannot tell
                        Maximize from Restore: one glyph, one name */}
                    <TitleButton
                        name="maximize"
                        label="Maximize or restore"
                        onClick={windowAction("toggling maximize", () => win.toggleMaximize())}
                        className={WINDOW_BTN}
                    >
                        <svg
                            width="11"
                            height="11"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                        >
                            <rect x="4" y="4" width="16" height="16" />
                        </svg>
                    </TitleButton>
                    {/* the person's own close: the host reads it as "do not reopen Sidecar next launch" */}
                    <TitleButton
                        name="close"
                        label="Close"
                        onClick={windowAction("closing", () => win.close())}
                        className="h-full w-11 hover:bg-error hover:text-white"
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                        >
                            <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                    </TitleButton>
                </div>
            </div>
        </div>
    );
}
