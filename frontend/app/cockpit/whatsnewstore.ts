// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { Binding } from "@/app/store/keybindings/types";
import type { SurfaceKey } from "@/app/view/agents/agents";
import { atom, type PrimitiveAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { pushToast } from "./notificationstore";
import { postCloseContext } from "./palette-commands";
import { UNKNOWN_VERSION, versionInfoAtom } from "./versioninfo";
import { hasUnseen, parseChangelog, type Release } from "./whatsnew";

// The version whose notes were last opened, "" before the first launch seeds it. Read on init: a first render with
// the default would light the dot for a frame on every start.
export const whatsNewSeenAtom = atomWithStorage<string>("whatsnew.seen", "", undefined, {
    getOnInit: true,
}) as PrimitiveAtom<string>;

// While the sheet is open, the seen version it opened over: the releases after it are the ones read for the first time.
// Opening marks the running version seen at once, so the dot goes as the notes come up.
export const whatsNewSinceAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export const whatsNewUnseenAtom = atom((get) => hasUnseen(get(versionInfoAtom).app, get(whatsNewSeenAtom)));

// A first launch has read nothing, and a new install has nothing to catch up on: it starts at its own version.
export function seedWhatsNewSeen(): void {
    const current = globalStore.get(versionInfoAtom).app;
    if (current !== UNKNOWN_VERSION && globalStore.get(whatsNewSeenAtom) === "") {
        globalStore.set(whatsNewSeenAtom, current);
    }
}

export function openWhatsNew(): void {
    const current = globalStore.get(versionInfoAtom).app;
    globalStore.set(whatsNewSinceAtom, globalStore.get(whatsNewSeenAtom));
    if (current !== UNKNOWN_VERSION) {
        globalStore.set(whatsNewSeenAtom, current);
    }
}

export function closeWhatsNew(): void {
    globalStore.set(whatsNewSinceAtom, null);
}

// the changelog is ~100 KB and only the open sheet reads it, so it is its own chunk, fetched on the first open
let releases: Promise<Release[]> | null = null;

export function loadReleases(): Promise<Release[]> {
    releases ??= import("../../../CHANGELOG.md?raw").then((m) => parseChangelog(m.default));
    return releases;
}

// The binding an entry's Try button runs, judged as the palette judges its rows: against the surface as it will be
// once the sheet has closed. Null when it is not registered or cannot run from here.
export function tryBinding(bindings: Binding[], id: string, surface: SurfaceKey): Binding | null {
    const b = bindings.find((x) => x.id === id);
    if (b == null || (b.when != null && !b.when(postCloseContext(surface)))) {
        return null;
    }
    return b;
}

export function runTry(id: string, surface: SurfaceKey): void {
    const b = tryBinding(globalStore.get(bindingsAtom), id, surface);
    if (b == null) {
        pushToast({ title: "That can't open from here", message: "", level: "warn" });
        return;
    }
    b.run(postCloseContext(surface));
    closeWhatsNew();
}
