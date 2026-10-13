// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { bindingsAtom } from "@/app/store/keybindings/store";
import type { Binding } from "@/app/store/keybindings/types";
import type { SurfaceKey } from "@/app/view/agents/agents";
import { atom, type PrimitiveAtom } from "jotai";
import { pushToast } from "./notificationstore";
import { postCloseContext } from "./palette-commands";
import { parseChangelog, type Release } from "./whatsnew";

export const whatsNewOpenAtom = atom(false) as PrimitiveAtom<boolean>;

export function openWhatsNew(): void {
    globalStore.set(whatsNewOpenAtom, true);
}

export function closeWhatsNew(): void {
    globalStore.set(whatsNewOpenAtom, false);
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
