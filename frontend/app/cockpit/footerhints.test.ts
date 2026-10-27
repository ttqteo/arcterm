// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    buildAgentBindings,
    buildCockpitBindings,
    buildFilesBindings,
    buildGlobalBindings,
    buildJarvisBindings,
    buildListNavBindings,
} from "@/app/store/keybindings/bindings";
import { describe, expect, it } from "vitest";
import { GLOBAL_HINTS, SURFACE_HINTS } from "./footerhints";

// Every binding id a footer hint references must exist in the built registry, or the footer would
// silently lie about what a key does. Rename/remove a binding id -> this fails the build.
describe("footer hints reference real bindings", () => {
    it("has no dangling binding id", () => {
        const model = {} as any; // build() reads no atoms
        const ids = new Set(
            [
                ...buildGlobalBindings(model),
                ...buildAgentBindings(model),
                ...buildFilesBindings(),
                ...buildListNavBindings(model),
                ...buildCockpitBindings(),
                ...buildJarvisBindings(model),
            ].map((b) => b.id)
        );
        const referenced = [...GLOBAL_HINTS, ...Object.values(SURFACE_HINTS).flat()].flatMap((h) => h.ids);
        const missing = referenced.filter((id) => !ids.has(id));
        expect(missing).toEqual([]);
    });
});

// The brainstorm pane's keys are listed in the footer while the pane is up: b back to the terminal, Esc back, and Enter
// to send what is typed (the pane's fields send it themselves; agent:brainstorm-send only documents it)
describe("the Agent footer lists the brainstorm pane's keys", () => {
    const agent = SURFACE_HINTS.agent!;
    const chip = (id: string) => agent.find((h) => h.ids.includes(id));

    it("has a chip for b, Esc, Enter and the chord that works inside the terminal", () => {
        expect(chip("agent:brainstorm-open")).toMatchObject({ glyph: "b", label: "brainstorm" });
        expect(chip("agent:brainstorm-close")).toMatchObject({ glyph: "b", label: "terminal" });
        expect(chip("agent:brainstorm-back")).toMatchObject({ glyph: "esc", label: "back" });
        expect(chip("agent:brainstorm-send")).toMatchObject({ glyph: "⏎", label: "send" });
        expect(chip("agent:view-chord")).toMatchObject({ keys: "Ctrl:Shift:b" });
    });

    it("never shares a chip between the terminal's b and the pane's, which the footer tells apart by label", () => {
        expect(chip("agent:brainstorm-open")).not.toBe(chip("agent:brainstorm-close"));
    });
});
