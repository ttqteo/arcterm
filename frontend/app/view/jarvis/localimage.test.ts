// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { imageStatus, localFileUrl } from "./localimage";

describe("localFileUrl", () => {
    it("encodes a Windows path with mixed separators, drive colon and spaces into the query", () => {
        const url = localFileUrl(
            "http://127.0.0.1:61000",
            "C:\\Users\\a b\\AppData\\Local\\Arc\\data\\final-shots\\d1/1/cdp-shots/jarvis-peek.png"
        );
        expect(url).toBe(
            "http://127.0.0.1:61000/wave/stream-local-file?path=" +
                "C%3A%5CUsers%5Ca%20b%5CAppData%5CLocal%5CArc%5Cdata%5Cfinal-shots%5Cd1%2F1%2Fcdp-shots%2Fjarvis-peek.png"
        );
        expect(new URL(url).searchParams.get("path")).toBe(
            "C:\\Users\\a b\\AppData\\Local\\Arc\\data\\final-shots\\d1/1/cdp-shots/jarvis-peek.png"
        );
    });

    it("keeps a # or & in a file name inside the path parameter", () => {
        const url = localFileUrl("http://h", "C:/x/a#1&b.png");
        expect(new URL(url).searchParams.get("path")).toBe("C:/x/a#1&b.png");
    });
});

describe("imageStatus", () => {
    it("maps 200 to ok, 404 to missing and anything else to error", () => {
        expect(imageStatus(200)).toBe("ok");
        expect(imageStatus(404)).toBe("missing");
        expect(imageStatus(500)).toBe("error");
        expect(imageStatus(403)).toBe("error");
    });
});

// useLocalImage hands <img> a blob: URL, and the packaged app's CSP decides whether WebView2 will show it. The dev app
// never applies the CSP (cargo tauri dev serves through the dev server), so only a packaged build would catch it.
describe("the packaged CSP", () => {
    it("lets an <img> load the blob: URLs useLocalImage makes", () => {
        const conf = JSON.parse(readFileSync(resolve(__dirname, "../../../../src-tauri/tauri.conf.json"), "utf8"));
        const imgSrc = String(conf.app.security.csp)
            .split(";")
            .map((d: string) => d.trim().split(/\s+/))
            .find((d: string[]) => d[0] === "img-src");
        expect(imgSrc).toContain("blob:");
    });
});
