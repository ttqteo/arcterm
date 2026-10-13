// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Right-click in a terminal (term:rightclickpaste): one click copies the selection, or pastes when nothing is
// selected; a second click inside DOUBLE_RIGHT_CLICK_MS opens the terminal menu instead. The single action waits
// that window out, so a double click never pastes before the menu opens.

export const DOUBLE_RIGHT_CLICK_MS = 300;

export type RightClickAction = "copy" | "paste";

export function singleRightClickAction(hasSelection: boolean): RightClickAction {
    return hasSelection ? "copy" : "paste";
}

type TimerHandle = ReturnType<typeof setTimeout>;

export type RightClickGateOpts<E> = {
    onSingle: () => void;
    onDouble: (ev: E) => void;
    delayMs?: number;
    setTimer?: (fn: () => void, ms: number) => TimerHandle;
    clearTimer?: (h: TimerHandle) => void;
};

export type RightClickGate<E> = {
    click: (ev: E) => void;
    dispose: () => void;
};

export function makeRightClickGate<E>(opts: RightClickGateOpts<E>): RightClickGate<E> {
    const delayMs = opts.delayMs ?? DOUBLE_RIGHT_CLICK_MS;
    const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
    let pending: TimerHandle = null;
    return {
        click(ev: E) {
            if (pending != null) {
                clearTimer(pending);
                pending = null;
                opts.onDouble(ev);
                return;
            }
            pending = setTimer(() => {
                pending = null;
                opts.onSingle();
            }, delayMs);
        },
        dispose() {
            if (pending != null) {
                clearTimer(pending);
                pending = null;
            }
        },
    };
}
