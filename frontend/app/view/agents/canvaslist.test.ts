// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { canvasTopics } from "./canvaslist";

describe("canvasTopics", () => {
    it("lists the folders by name, sorted", () => {
        expect(
            canvasTopics([
                { name: "terminal-tui", isdir: true },
                { name: "arc-pet", isdir: true },
            ])
        ).toEqual(["arc-pet", "terminal-tui"]);
    });

    it("skips files and names a canvas address cannot carry", () => {
        expect(
            canvasTopics([
                { name: "notes.md", isdir: false },
                { name: "has space", isdir: true },
                { name: "", isdir: true },
                { name: "usage-insights", isdir: true },
            ])
        ).toEqual(["usage-insights"]);
    });
});
