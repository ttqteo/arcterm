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
const TONE = { normal: "text-hud-text", amber: "text-warning", red: "text-error" } as const;

// "RAM 2.1 GB free · CPU 93%" on the wide bar, the bare numbers ("2.1 GB · 93%") where the small bar has no room for the
// words. One span of inline text either way, so a reader gets the whole line.
function Machine(props: {
    machine: SidecarMachine;
    strain: SidecarStrain | undefined;
    short: boolean;
    // the resource panel: open under the bar, and the press that opens or closes it. None while the wall shows the
    // Resources column, where the figures are plain text.
    open: boolean;
    onToggle?: () => void;
    className?: string;
}) {
    const r = machineReadout(props.machine, props.strain);
    const ram = <b className={cn("font-medium", TONE[r.ramTone])}>{r.ram}</b>;
    const cpu = <b className={cn("font-medium", TONE[r.cpuTone])}>{r.cpu}</b>;
    const words = props.short ? (
        <>
            {ram} · {cpu}
        </>
    ) : (
        <>
            RAM {ram} free · CPU {cpu}
        </>
    );
    if (props.onToggle == null) {
        return (
            <span
                data-sidecar-machine
                data-ram-tone={r.ramTone}
                data-cpu-tone={r.cpuTone}
                className={cn(
                    "min-w-0 truncate whitespace-nowrap font-mono tabular-nums text-hud-muted",
                    props.short ? "px-1 text-[11px]" : "px-1.5 text-[11.5px] uppercase",
                    props.className
                )}
            >
                {words}
            </span>
        );
    }
    // a button for the resource panel, its chevron saying it opens; tabIndex -1 and no focus on press, as the bar's
    // other buttons
    return (
        <button
            type="button"
            data-sidecar-machine
            data-ram-tone={r.ramTone}
            data-cpu-tone={r.cpuTone}
            aria-expanded={props.open}
            aria-haspopup="dialog"
            title="What arcterm, its agents and Sidecar itself take"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onToggle}
            className={cn(
                "flex min-w-0 items-center gap-1 whitespace-nowrap rounded-sm border border-hud-line py-0.5 text-left font-mono tabular-nums text-hud-muted hover:bg-hud-panel",
                // the small bar has no room to spare: its figures are a size down and the box a little tighter
                props.short ? "px-1 text-[11px]" : "px-1.5 text-[11.5px] uppercase",
                props.open && "bg-hud-panel",
                props.className
            )}
        >
            <span className="min-w-0 truncate">{words}</span>
            <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
                className={cn("shrink-0 text-hud-muted", props.open && "rotate-180")}
            >
                <path d="m6 9 6 6 6-6" />
            </svg>
        </button>
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
            className={cn("flex items-center justify-center text-hud-muted hover:text-hud-text", props.className)}
        >
            {props.children}
        </button>
    );
}

const WINDOW_BTN = "h-full w-11 hover:bg-hud-panel";
// the wide bar's boxed buttons (S, full screen), a `hud-line` box as board A draws them; a pressed one reads as held down
const BOXED_BTN = "h-[26px] w-[30px] rounded-sm border border-hud-line bg-hud-bg hover:bg-hud-panel";
const BOXED_PRESSED = "border-hud-glow bg-hud-glow-dim text-hud-text";
// the small bar's buttons (board F): 26 × 24, flat, a pressed one filled
const SMALL_BTN = "h-6 w-[26px] shrink-0 rounded-sm hover:bg-hud-panel";
const SMALL_PRESSED = "bg-hud-glow-dim text-hud-text";

function SmallGlyph({ small }: { small: boolean }) {
    // a screen with a small window in its corner (shrink to the small form, pinned) / that window growing back out to
    // the wall. Not arrows: the full screen button's corners are arrows in and out, and the two read as one button.
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="2.5" y="4" width="19" height="16" rx="2" />
            {small ? (
                <path d="M8 16l7-7M10 9h5v5" />
            ) : (
                <rect x="12" y="12" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" />
            )}
        </svg>
    );
}

function PinGlyph() {
    return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 17v5M9 10.8V4h6v6.8l3 3.2H6z" />
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
    // the resource panel the machine figures open
    resourcesOpen: boolean;
    // none while the wall shows the Resources column
    onResources?: () => void;
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
            className={cn(small ? SMALL_BTN : BOXED_BTN, form.small && (small ? SMALL_PRESSED : BOXED_PRESSED))}
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
                    "flex shrink-0 select-none items-center gap-1.5 border-b border-hud-line bg-hud-bg",
                    // a Mac's bar is the main window's height, where the lights sit
                    mac ? "h-[38px] pr-2" : "h-8 pr-1",
                    lightsRoom ? MAC_LIGHTS_ROOM : "pl-3"
                )}
            >
                {/* the one word: Q's 340 px bar has no room for "arcterm / sidecar" in mono (the CSS uppercases it), and a
                    dev app's marker drops its parentheses, so the figures after them keep their room */}
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.1em] text-hud-glow">Sidecar</span>
                {import.meta.env.DEV ? (
                    <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.1em] text-hud-muted">
                        dev
                    </span>
                ) : null}
                {machine == null ? null : (
                    <Machine
                        machine={machine}
                        strain={strain}
                        short
                        open={props.resourcesOpen}
                        onToggle={props.onResources}
                        className="ml-0.5"
                    />
                )}
                <span className="flex-1" />
                {sButton}
                <TitleButton
                    name="pin"
                    label="Pin on top"
                    pressed={form.pinned}
                    onClick={() => props.onForm(pinButtonChange(form))}
                    className={cn(SMALL_BTN, form.pinned && SMALL_PRESSED)}
                >
                    <PinGlyph />
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
                "flex h-[38px] shrink-0 select-none items-center gap-4 border-b border-hud-line bg-hud-bg",
                lightsRoom ? MAC_LIGHTS_ROOM : "pl-3.5",
                mac && "pr-3.5"
            )}
        >
            {/* board A's "ARCTERM / SIDECAR": mono, letter-spaced, the glow colour (the CSS uppercases the words) */}
            <div className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.18em] text-hud-glow">
                <span>arcterm</span>
                {/* a dev app beside the installed one must not pass for it (the window's own title says so too) */}
                {import.meta.env.DEV ? <span className="text-hud-muted">(dev)</span> : null}
                <span className="text-hud-muted">/</span>
                <span>Sidecar</span>
            </div>
            {/* the machine's two figures, always once a snapshot carries them: the band speaks only past a threshold */}
            {machine == null ? null : (
                <Machine
                    machine={machine}
                    strain={strain}
                    short={false}
                    open={props.resourcesOpen}
                    onToggle={props.onResources}
                    className="ml-2"
                />
            )}
            <div className="ml-auto flex h-full items-center gap-4">
                {sButton}
                {/* the pin alone, here too: a full-screen or maximized wall can stay over the apps on its screen */}
                <TitleButton
                    name="pin"
                    label={form.pinned ? "Unpin" : "Pin on top"}
                    pressed={form.pinned}
                    onClick={() => props.onForm(pinButtonChange(form))}
                    className={cn(BOXED_BTN, form.pinned && BOXED_PRESSED)}
                >
                    <PinGlyph />
                </TitleButton>
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
