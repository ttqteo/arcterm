import { describe, expect, it } from "vitest";
import { windowsPtyFor } from "./termwinpty";

describe("windowsPtyFor", () => {
    it("leaves a terminal off Windows alone", () => {
        expect(windowsPtyFor("darwin", "14.0.0")).toBeUndefined();
        expect(windowsPtyFor("linux", null)).toBeUndefined();
    });

    it("names a Windows 11 build, past the one where ConPTY reflows", () => {
        expect(windowsPtyFor("win32", "15.0.0")).toEqual({ backend: "conpty", buildNumber: 22000 });
        expect(windowsPtyFor("win32", "13.0.0")?.buildNumber).toBeGreaterThanOrEqual(21376);
    });

    it("names a Windows 10 build, before it", () => {
        expect(windowsPtyFor("win32", "10.0.0")?.buildNumber).toBeLessThan(21376);
        expect(windowsPtyFor("win32", "1.0.0")?.buildNumber).toBeLessThan(21376);
    });

    it("still says ConPTY when the version is unknown", () => {
        expect(windowsPtyFor("win32", null)).toEqual({ backend: "conpty" });
        expect(windowsPtyFor("win32", "")).toEqual({ backend: "conpty" });
        expect(windowsPtyFor("win32", "0.0.0")).toEqual({ backend: "conpty" });
    });
});
