// Minimal toast store for the cockpit's own transient feedback (a failed open, a focus warning). A
// `wsh notify` is not a toast while arcterm is focused: the avatar is its voice then (petsources.tsx).
// Agent notifications (notifysync.tsx) are, and carry an `onOpen`.

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

// the row above an agent notification's title: what kind it is (a dot and a word, never color alone) and where from
export interface ToastEyebrow {
    label: string;
    tone: "asking" | "done" | "info";
    meta?: string;
}

export interface ToastNotification {
    id: number;
    title: string;
    message: string;
    level: "info" | "warn" | "error";
    eyebrow?: ToastEyebrow;
    onOpen?: () => void;
}

export const toastsAtom = atom<ToastNotification[]>([]);

let nextId = 1;
export const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 5;

export function pushToast(n: Omit<ToastNotification, "id">): void {
    const toast = { ...n, id: nextId++ };
    globalStore.set(toastsAtom, (prev) => [...prev.slice(-(MAX_TOASTS - 1)), toast]);
    setTimeout(() => dismissToast(toast.id), TOAST_TTL_MS);
}

export function dismissToast(id: number): void {
    globalStore.set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
}
