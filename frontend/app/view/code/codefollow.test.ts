// frontend/app/view/code/codefollow.test.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { projectToFollow } from "./codefollow";

const waveterm = { name: "waveterm", path: "C:\\src\\waveterm" };
const siem = { name: "siem", path: "C:\\src\\siem" };
const projects = [waveterm, siem];

describe("projectToFollow", () => {
    it("projectToFollow ignores the first value, all, and the current project", () => {
        // the ref starts at the first value, so the first reading is prev === next
        expect(projectToFollow("siem", "siem", projects, null)).toBeNull();
        expect(projectToFollow("siem", "all", projects, waveterm)).toBeNull();
        // the current project matched by path, so a by-path pick of the same folder counts too
        expect(projectToFollow("all", "siem", projects, { name: "siem-folder", path: "c:/src/SIEM/" })).toBeNull();
    });

    it("projectToFollow returns the registered project for a new name", () => {
        expect(projectToFollow("all", "siem", projects, waveterm)).toEqual(siem);
        expect(projectToFollow("waveterm", "siem", projects, null)).toEqual(siem);
        // a name the switcher lists from agents alone has no path to open
        expect(projectToFollow("all", "unregistered", projects, waveterm)).toBeNull();
    });
});
