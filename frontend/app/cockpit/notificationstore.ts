// Minimal toast store for the cockpit's own transient feedback (a failed open, a focus warning). A
// `wsh notify` is not a toast while arcterm is focused: the avatar is its voice then (petsources.tsx).
// Agent notifications (notifysync.tsx) are, and carry an `onOpen`.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

export type ToastIcon = "ask" | "done" | "decision" | "message" | "summary";

// the row above an agent notification's title, and the tile at its left: what kind it is (an icon and a word, never
// color alone) and where from (the project, and the harness's mark when an agent sent it)
export interface ToastEyebrow {
    label: string;
    tone: "asking" | "done" | "info";
    icon: ToastIcon;
    meta?: string;
    runtime?: string;
}

/** A button on a toast. `at` is where it was pressed (a viewport point), for an action that opens something there. */
export interface ToastAction {
    label: string;
    run: (at?: { x: number; y: number }) => void;
}

export interface ToastNotification {
    id: number;
    title: string;
    message: string;
    level: "info" | "warn" | "error";
    eyebrow?: ToastEyebrow;
    onOpen?: () => void;
    // a button on the toast ("Undo"): runs, and the toast closes
    action?: ToastAction;
    // a second button beside it ("Open" and "Move to…"): the two then sit in a row under the message
    alt?: ToastAction;
    // a green check before the title of a plain toast: something was done ("Link copied")
    check?: boolean;
    // how long it stays, TOAST_TTL_MS when unset: something waiting on you is given longer to be read
    ttlMs?: number;
}

export const toastsAtom = atom<ToastNotification[]>([]);

let nextId = 1;
export const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 5;

// each toast's dismiss timer, and what was left of it when the pointer came to rest on the toast
interface Clock {
    timer: ReturnType<typeof setTimeout> | null;
    remaining: number;
    startedAt: number;
}
const clocks = new Map<number, Clock>();

function arm(id: number, ms: number): void {
    clocks.set(id, { timer: setTimeout(() => dismissToast(id), ms), remaining: ms, startedAt: Date.now() });
}

export function pushToast(n: Omit<ToastNotification, "id">): void {
    const toast = { ...n, id: nextId++ };
    globalStore.set(toastsAtom, (prev) => [...prev.slice(-(MAX_TOASTS - 1)), toast]);
    arm(toast.id, n.ttlMs ?? TOAST_TTL_MS);
}

export function dismissToast(id: number): void {
    const c = clocks.get(id);
    if (c?.timer != null) {
        clearTimeout(c.timer);
    }
    clocks.delete(id);
    globalStore.set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
}

/** Runs a toast's action button (`which`: its first, or the second beside it) and closes the toast; a toast with no such
 *  action, or one that is gone, just closes. `at` is where the button was pressed, which the action gets. */
export function runToastAction(id: number, which: "action" | "alt" = "action", at?: { x: number; y: number }): void {
    const toast = globalStore.get(toastsAtom).find((t) => t.id === id);
    const action = which === "alt" ? toast?.alt : toast?.action;
    dismissToast(id);
    action?.run(at);
}

/** Stops a toast's clock while you read it (the pointer is on it). */
export function holdToast(id: number): void {
    const c = clocks.get(id);
    if (c == null || c.timer == null) {
        return;
    }
    clearTimeout(c.timer);
    c.timer = null;
    c.remaining -= Date.now() - c.startedAt;
}

/** Restarts a held toast's clock with the time it had left. */
export function releaseToast(id: number): void {
    const c = clocks.get(id);
    if (c == null || c.timer != null) {
        return;
    }
    arm(id, Math.max(0, c.remaining));
}
