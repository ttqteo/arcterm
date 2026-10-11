// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Settings surface's only cross-surface state: which section a deep link wants. Its own file rather
// than an atom exported from settingssurface.tsx, so a caller does not have to import a surface component
// to navigate into it.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentsViewModel } from "./agents";

export const pendingSettingsSectionAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

export function takePendingSettingsSection(): string | null {
    const want = globalStore.get(pendingSettingsSectionAtom);
    if (want != null) {
        globalStore.set(pendingSettingsSectionAtom, null);
    }
    return want;
}

/** Opens Settings on a section, from any surface: Settings takes the pending section when it mounts, and while it
 *  already shows. */
export function openSettingsSection(model: Pick<AgentsViewModel, "surfaceAtom">, id: string): void {
    globalStore.set(pendingSettingsSectionAtom, id);
    globalStore.set(model.surfaceAtom, "settings");
}
