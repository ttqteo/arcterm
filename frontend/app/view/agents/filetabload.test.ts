// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { canOpenInOsApp } from "./filetabload";

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
