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
                ...buildJarvisBindings(model), // includes the graph peek
            ].map((b) => b.id)
        );
        const referenced = [...GLOBAL_HINTS, ...Object.values(SURFACE_HINTS).flat()].flatMap((h) => h.ids);
        const missing = referenced.filter((id) => !ids.has(id));
        expect(missing).toEqual([]);
    });
});
