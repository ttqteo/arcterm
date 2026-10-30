// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { afterReread, canOpenInOsApp, type PanelFile } from "./filetabload";

describe("canOpenInOsApp", () => {
    it("opens a document or media file in its own app, whatever the extension's case", () => {
        expect(canOpenInOsApp("D:\\Workspace\\SIEM\\apps\\website\\docs\\slide\\Deck_v1.4.pptx")).toBe(true);
        expect(canOpenInOsApp("/home/me/report.PDF")).toBe(true);
        expect(canOpenInOsApp("C:/x/sheet.xlsx")).toBe(true);
        expect(canOpenInOsApp("C:/x/clip.mov")).toBe(true);
    });

    it("never offers a file that runs, or one with no extension", () => {
        for (const p of [
            "C:\\x\\app.exe",
            "C:\\x\\run.bat",
            "C:\\x\\a.lnk",
            "C:\\x\\s.ps1",
            "C:\\x\\p.html",
            "C:\\x\\noext",
        ]) {
            expect(canOpenInOsApp(p), p).toBe(false);
        }
    });
});

describe("afterReread", () => {
    const text = (t: string, stamp: string): PanelFile => ({ kind: "text", text: t, stamp });

    it("shows the file as read when it changed", () => {
        const next = text("b", "2:2");
        expect(afterReread(text("a", "1:1"), next)).toBe(next);
        const gone: PanelFile = { kind: "missing" };
        expect(afterReread(text("a", "1:1"), gone)).toBe(gone);
    });

    it("keeps what is shown when the re-read reads the same", () => {
        const prev: PanelFile = { kind: "image", size: 10, modtime: 5 };
        expect(afterReread(prev, { kind: "image", size: 10, modtime: 5 })).toBe(prev);
        const missing: PanelFile = { kind: "missing" };
        expect(afterReread(missing, { kind: "missing" })).toBe(missing);
        expect(afterReread(prev, { kind: "image", size: 10, modtime: 6 })).not.toBe(prev);
    });

    it("keeps a file on screen over a failed read, but shows the failure of a first read", () => {
        const prev = text("a", "1:1");
        expect(afterReread(prev, { kind: "error", message: "rpc closed" })).toBe(prev);
        const failed: PanelFile = { kind: "error", message: "rpc closed" };
        expect(afterReread({ kind: "loading" }, failed)).toBe(failed);
    });
});
