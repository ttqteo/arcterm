// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The item the avatar popup is peeking at, if any. A peek shows a target without landing on it: openref.ts
// loads the target and writes it here, and the popup renders it in place of the hub. Nothing here touches a
// destination's selection, which is the point of a peek.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { OpenTarget } from "./address";
import { petBubbleAtom, petPeekOpenAtom, petUnreadAtom } from "./petstore";

export type PeekTarget = Exclude<OpenTarget, { kind: "channel" } | { kind: "canvas" }>;

export type PeekItem = { target: PeekTarget; status: "loading" | "ready" };

export const peekItemAtom = atom<PeekItem | null>(null) as PrimitiveAtom<PeekItem | null>;

// What only the item's body knows: whether the target is still there. The body reports it; the item view's
// button reads it. null until the body has said.
export type PeekFacts = { gone: boolean };

export const peekFactsAtom = atom<PeekFacts | null>(null) as PrimitiveAtom<PeekFacts | null>;

// Every field, so two peeks at one record with different anchors are different items.
export function peekTargetKey(target: PeekTarget | null | undefined): string {
    if (target == null) {
        return "";
    }
    return Object.keys(target)
        .sort()
        .map((k) => `${k}=${(target as Record<string, unknown>)[k] ?? ""}`)
        .join("&");
}

// a body still mounted on the item it replaced must not speak for the new one
export function reportPeekFacts(target: PeekTarget, facts: PeekFacts): void {
    if (peekTargetKey(globalStore.get(peekItemAtom)?.target) !== peekTargetKey(target)) {
        return;
    }
    globalStore.set(peekFactsAtom, facts);
}

// subscribed rather than reset in each setter, so an item set from anywhere drops the facts of the one before
let factsKey = "";
globalStore.sub(peekItemAtom, () => {
    const key = peekTargetKey(globalStore.get(peekItemAtom)?.target);
    if (key !== factsKey) {
        factsKey = key;
        globalStore.set(peekFactsAtom, null);
    }
});

type PeekBase = { item: PeekItem | null; open: boolean };

// What a loading peek returns to if its load fails or an open supersedes it. Taken when a peek starts from a
// settled state; a peek that replaces a loading one keeps the base it found, so a failure never restores a
// spinner.
let base: PeekBase = { item: null, open: false };

export function backToHub(): void {
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, true);
}

// The popup on its hub, from a click on the creature or its key (g w). Opening it is the notice, so the bubble and
// the unread mark go.
export function openPetPeek(): void {
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, true);
    globalStore.set(petUnreadAtom, false);
    globalStore.set(petBubbleAtom, null);
}

export function closePeek(): void {
    globalStore.set(peekItemAtom, null);
    globalStore.set(petPeekOpenAtom, false);
}

// The popup opens at once on a loading item; the returned item is the handle settlePeek checks against.
export function startPeek(target: PeekTarget): PeekItem {
    const cur = globalStore.get(peekItemAtom);
    if (cur?.status !== "loading") {
        const open = globalStore.get(petPeekOpenAtom);
        // an item left behind by a popup closed some other way is not something to return to
        base = { item: open ? cur : null, open };
    }
    const item: PeekItem = { target, status: "loading" };
    globalStore.set(peekItemAtom, item);
    globalStore.set(petPeekOpenAtom, true);
    return item;
}

// A no-op once the item has been replaced or dismissed: a load that finishes after the user closed the popup
// must not reopen it.
export function settlePeek(item: PeekItem): void {
    if (globalStore.get(peekItemAtom) !== item) {
        return;
    }
    globalStore.set(peekItemAtom, { ...item, status: "ready" });
}

export function clearLoadingPeek(): void {
    if (globalStore.get(peekItemAtom)?.status !== "loading") {
        return;
    }
    globalStore.set(peekItemAtom, base.item);
    globalStore.set(petPeekOpenAtom, base.open);
}
