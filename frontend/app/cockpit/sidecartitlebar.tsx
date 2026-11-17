// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Sidecar's title bar (boards E-strain-band, P-orbit-dashboard and Q-compact-live). The window has no frame of its own, so
// the page draws the name, the machine's figures and the window buttons; in the small layout it shrinks to the name, the
// short figures and the S, pin and close buttons. What waits on you is counted in the dashboard's core, not here. It
// runs on the slim page (frontend/tauri/sidecar.tsx), which boots no cockpit store: this file may import only the Tauri
// window API and the shared types.

import { cn } from "@/util/util";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import { pinButtonChange, smallButtonChange, type FormChange, type SidecarLayout } from "./sidecarlayout";
import { machineReadout } from "./sidecarstrainmodel";
import type { SidecarForm, SidecarMachine, SidecarStrain } from "./sidecartypes";

/** The host built the window with macOS's native frame, its title bar laid over the page (src-tauri/src/sidecar.rs
 *  `sidecar_builder`): the traffic lights are the window buttons, so the bar leaves them their room and draws none of
 *  its own (the green light is full screen). Read from the page's url, so a browser stand-in on a Mac keeps the bar of
 *  a frameless window. */
export const NATIVE_MAC_FRAME = new URLSearchParams(window.location.search).get("frame") === "mac";

// the room the traffic lights take at the bar's left, as the main window's app bar leaves it; they hide in full screen
const MAC_LIGHTS_ROOM = "pl-[92px]";

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

// the figure's colour: amber and red are the warning and error tokens the band uses, so the bar and the band agree
const TONE = { normal: "text-primary", amber: "text-warning", red: "text-error" } as const;

// "RAM 2.1 GB free · CPU 93%" on the wide bar, the bare numbers ("2.1 GB · 93%") where the small bar has no room for the
// words. One span of inline text either way, so a reader gets the whole line.
function Machine(props: {
    machine: SidecarMachine;
    strain: SidecarStrain | undefined;
    short: boolean;
    className?: string;
}) {
    const r = machineReadout(props.machine, props.strain);
    const ram = <b className={cn("font-semibold", TONE[r.ramTone])}>{r.ram}</b>;
    const cpu = <b className={cn("font-semibold", TONE[r.cpuTone])}>{r.cpu}</b>;
    return (
        <span
            data-sidecar-machine
            data-ram-tone={r.ramTone}
            data-cpu-tone={r.cpuTone}
            className={cn(
                "min-w-0 truncate whitespace-nowrap text-[12px] tabular-nums text-secondary",
                props.className
            )}
        >
            {props.short ? (
                <>
                    {ram} · {cpu}
                </>
            ) : (
                <>
                    RAM {ram} free · CPU {cpu}
                </>
            )}
        </span>
    );
}

// tabIndex -1 and no focus on press: a button left focused would take the Enter that opens the selected row and the
// arrow keys of the dashboard, and a frameless window's controls are the mouse's anyway (F11 is the keyboard's).
function TitleButton(props: {
    name: "small" | "pin" | "minimize" | "maximize" | "fullscreen" | "close";
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
// the wide bar's boxed buttons (S, full screen); a pressed one reads as held down
const BOXED_BTN = "h-[26px] w-[30px] rounded-md border border-edge-mid bg-surface-raised hover:bg-surface-hover";
const BOXED_PRESSED = "bg-surface-selected text-primary";
// the small bar's buttons (board F): 26 × 24, flat, a pressed one filled
const SMALL_BTN = "h-6 w-[26px] shrink-0 rounded-md hover:bg-surface-hover";

function SmallGlyph({ small }: { small: boolean }) {
    // arrows in (shrink to the small form) / arrows out (grow back to the wall)
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            {small ? (
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            ) : (
                <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            )}
        </svg>
    );
}

function CloseGlyph() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 6l12 12M18 6 6 18" />
        </svg>
    );
}

export interface SidecarTitleBarProps {
    machine?: SidecarMachine;
    strain?: SidecarStrain;
    layout: SidecarLayout;
    // the host's form, and a request to change it (the page invokes sidecar_form and takes the answer)
    form: SidecarForm;
    onForm: (change: FormChange) => void;
}

export function SidecarTitleBar(props: SidecarTitleBarProps) {
    const win = getCurrentWindow();
    const fullscreen = useFullscreen();
    const { machine, strain, layout, form } = props;
    const small = layout === "small";
    const mac = NATIVE_MAC_FRAME;
    const lightsRoom = mac && !fullscreen;

    // S is in both layouts: it is the way into the small form and the way back out
    const sButton = (
        <TitleButton
            name="small"
            label={form.small ? "Back to the full Sidecar" : "Small form, pinned on top"}
            pressed={form.small}
            onClick={() => props.onForm(smallButtonChange(form))}
            className={cn(
                small ? SMALL_BTN : BOXED_BTN,
                form.small && (small ? "bg-surface-selected text-primary" : BOXED_PRESSED)
            )}
        >
            <SmallGlyph small={form.small} />
        </TitleButton>
    );

    if (small) {
        return (
            <div
                data-sidecar-titlebar
                data-sidecar-layout="small"
                data-tauri-drag-region="deep"
                className={cn(
                    "flex shrink-0 select-none items-center gap-2 border-b border-border bg-surface",
                    // a Mac's bar is the main window's height, where the lights sit
                    mac ? "h-[38px] pr-2" : "h-8 pr-1",
                    lightsRoom ? MAC_LIGHTS_ROOM : "pl-3"
                )}
            >
                <span className="shrink-0 text-[12px] font-semibold text-primary">Sidecar</span>
                {import.meta.env.DEV ? <span className="shrink-0 text-[12px] text-muted">(dev)</span> : null}
                {machine == null ? null : <Machine machine={machine} strain={strain} short className="ml-1" />}
                <span className="flex-1" />
                {sButton}
                <TitleButton
                    name="pin"
                    label="Pin on top"
                    pressed={form.pinned}
                    onClick={() => props.onForm(pinButtonChange(form))}
                    className={cn(SMALL_BTN, form.pinned && "bg-surface-selected text-primary")}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z" />
                    </svg>
                </TitleButton>
                {/* the person's own close: the host reads it as "do not reopen Sidecar next launch" (a Mac's red light) */}
                {mac ? null : (
                    <TitleButton
                        name="close"
                        label="Close"
                        onClick={windowAction("closing", () => win.close())}
                        className={cn(SMALL_BTN, "hover:bg-error hover:text-white")}
                    >
                        <CloseGlyph />
                    </TitleButton>
                )}
            </div>
        );
    }

    return (
        <div
            data-sidecar-titlebar
            data-sidecar-layout="wall"
            // "deep": the whole bar drags, the buttons opt out (the main window's app bar does the same)
            data-tauri-drag-region="deep"
            className={cn(
                "flex h-[38px] shrink-0 select-none items-center gap-4 border-b border-border bg-surface",
                lightsRoom ? MAC_LIGHTS_ROOM : "pl-3.5",
                mac && "pr-3.5"
            )}
        >
            <div className="flex items-center gap-2 text-[13px]">
                <span className="font-bold text-primary">arcterm</span>
                {/* a dev app beside the installed one must not pass for it (the window's own title says so too) */}
                {import.meta.env.DEV ? <span className="font-medium text-muted">(dev)</span> : null}
                <span className="text-muted">/</span>
                <span className="font-semibold text-primary">Sidecar</span>
            </div>
            {/* the machine's two figures, always once a snapshot carries them: the band speaks only past a threshold */}
            {machine == null ? null : <Machine machine={machine} strain={strain} short={false} className="ml-3" />}
            <div className="ml-auto flex h-full items-center gap-4">
                {sButton}
                {/* a Mac's traffic lights are the window buttons, the green one full screen */}
                {mac ? null : (
                    <>
                        <TitleButton
                            name="fullscreen"
                            label={fullscreen ? "Exit full screen (F11)" : "Full screen (F11)"}
                            pressed={fullscreen}
                            onClick={windowAction("toggling full screen", toggleSidecarFullscreen)}
                            className={BOXED_BTN}
                        >
                            <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                            >
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
                                <CloseGlyph />
                            </TitleButton>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
