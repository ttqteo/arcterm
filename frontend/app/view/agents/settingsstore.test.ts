// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { describe, expect, it } from "vitest";
import { openSettingsSection, pendingSettingsSectionAtom, takePendingSettingsSection } from "./settingsstore";

describe("takePendingSettingsSection", () => {
    it("returns nothing when no escort is pending", () => {
        globalStore.set(pendingSettingsSectionAtom, null);
        expect(takePendingSettingsSection()).toBeNull();
    });

    it("honours one escort exactly once, so a remount does not re-scroll", () => {
        globalStore.set(pendingSettingsSectionAtom, "headless");
        expect(takePendingSettingsSection()).toBe("headless");
        expect(takePendingSettingsSection()).toBeNull();
    });
});

describe("openSettingsSection", () => {
    it("asks Settings for the section, then switches to it", () => {
        const surfaceAtom = atom<string>("cockpit");
        openSettingsSection({ surfaceAtom } as never, "storage");
        expect(globalStore.get(pendingSettingsSectionAtom)).toBe("storage");
        expect(globalStore.get(surfaceAtom)).toBe("settings");
    });
});
