// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { doneReportPath, imageStatus, localFileUrl, typedBlob } from "./localimage";

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

describe("the packaged app's CSP", () => {
    // useLocalImage shows the bytes as a blob: URL. the dev app has no CSP, so only this catches a packaged-only block
    it("lets an <img> load a blob: URL", () => {
        const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
        const imgSrc = (conf.app.security.csp as string).split(";").find((d) => d.trim().startsWith("img-src"));
        expect(imgSrc?.trim().split(/\s+/)).toContain("blob:");
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

describe("doneReportPath", () => {
    it("moves a report picture under done/, with / separators", () => {
        expect(doneReportPath("C:/Users/a/AppData/Local/dev.arc.app/data/reports/20261120-163948/screen.png")).toBe(
            "C:/Users/a/AppData/Local/dev.arc.app/data/reports/done/20261120-163948/screen.png"
        );
    });
    it("moves a report picture under done/, with \\ separators", () => {
        expect(doneReportPath("C:\\data\\reports\\20261120-163948\\screen.png")).toBe(
            "C:\\data\\reports\\done\\20261120-163948\\screen.png"
        );
    });
    it("keeps the -N suffix of a report id that shared its second", () => {
        expect(doneReportPath("/home/a/data/reports/20261120-163948-2/screen.png")).toBe(
            "/home/a/data/reports/done/20261120-163948-2/screen.png"
        );
    });
    it("leaves a path already under done/ alone", () => {
        expect(doneReportPath("C:/data/reports/done/20261120-163948/screen.png")).toBeNull();
        expect(doneReportPath("C:\\data\\reports\\done\\20261120-163948\\screen.png")).toBeNull();
    });
    it("leaves a path that is not a report file alone", () => {
        expect(doneReportPath("C:/x/final-shots/d1/1/cdp-shots/jarvis-peek.png")).toBeNull();
        expect(doneReportPath("C:/x/myreports/20261120-163948/screen.png")).toBeNull();
        expect(doneReportPath("C:/x/reports/latest/screen.png")).toBeNull();
        expect(doneReportPath("C:/x/reports/20261120-163948")).toBeNull();
    });
});

describe("typedBlob", () => {
    it("gives an untyped blob the response's content type, without its parameters", () => {
        const b = typedBlob(new Blob(["<svg/>"]), "image/svg+xml; charset=utf-8");
        expect(b.type).toBe("image/svg+xml");
        expect(b.size).toBe(6);
    });
    it("keeps a blob that already has a type, and one with no content type to give", () => {
        const typed = new Blob(["x"], { type: "image/png" });
        expect(typedBlob(typed, "image/svg+xml")).toBe(typed);
        const bare = new Blob(["x"]);
        expect(typedBlob(bare, null)).toBe(bare);
        expect(typedBlob(bare, "")).toBe(bare);
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
