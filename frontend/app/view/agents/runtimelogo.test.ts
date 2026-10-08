// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runtimeLogo } from "./runtimelogo";

describe("runtimeLogo", () => {
    it("maps OpenCode to the opencode asset url", () => {
        expect(runtimeLogo("OpenCode")).toContain("opencode");
    });

    it("maps PI to the pi asset", () => {
        // vitest's svgr plugin resolves plain .svg imports to components, not url strings, so the
        // app-side url (".../pi.svg") can't be asserted here; the built app imports the same asset
        // as a url whose basename is "pi.svg". Assert the mapping is present (defined) instead.
        expect(runtimeLogo("PI")).toBeDefined();
    });

    it("maps agy to the antigravity asset, sized in em like the other inline marks", () => {
        expect(runtimeLogo("agy")).toBeDefined();
        const svg = readFileSync(new URL("../../asset/antigravity.svg", import.meta.url), "utf-8");
        expect(svg).toMatch(/<svg[^>]*width="1em"/);
        expect(svg).toMatch(/<svg[^>]*height="1em"/);
    });

    it("returns undefined for unknown runtimes", () => {
        expect(runtimeLogo("unknown")).toBeUndefined();
    });

    it("returns undefined for an undefined runtime (booting/pending agents have none yet)", () => {
        // a just-launched agent's pending row has no `agent` field until the status reporter
        // registers it; the header/detail mark must not throw on that window (regression: the
        // RuntimeMark path crashed the whole app with `undefined.toLowerCase()`)
        expect(runtimeLogo(undefined)).toBeUndefined();
    });

    it("pi.svg carries em sizing like the other inline brand marks", () => {
        // the other inline marks (claude-color.svg, codex.svg) size themselves via width/height="1em"
        // so RuntimeMark's text-[Npx] classes scale them to match the label; a viewBox-only svg
        // renders at its intrinsic 150x150 instead, blowing out every icon+label row
        // (regression: pi agent icon misaligned in the agent row/header/details marks)
        const svg = readFileSync(new URL("../../asset/pi.svg", import.meta.url), "utf-8");
        expect(svg).toMatch(/<svg[^>]*width="1em"/);
        expect(svg).toMatch(/<svg[^>]*height="1em"/);
    });
});
