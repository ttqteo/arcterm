import { describe, expect, it } from "vitest";
import { pathActions, revealLabel } from "./pathactions";

describe("revealLabel", () => {
    it("names each OS's file manager", () => {
        expect(revealLabel("darwin")).toBe("Reveal in Finder");
        expect(revealLabel("win32")).toBe("Show in Explorer");
        expect(revealLabel("linux")).toBe("Open Containing Folder");
    });
});

describe("pathActions", () => {
    it("copies the relative path, then the absolute one, then reveals the file", () => {
        expect(pathActions("/repo/slides/a.html", "slides/a.html", "darwin")).toEqual([
            { kind: "copy", label: "Copy Relative Path", text: "slides/a.html" },
            { kind: "copy", label: "Copy Absolute Path", text: "/repo/slides/a.html" },
            { kind: "reveal", label: "Reveal in Finder", path: "/repo/slides/a.html" },
        ]);
    });

    it("leaves out the relative path for a file outside its folder", () => {
        for (const rel of [null, ""]) {
            expect(pathActions("/tmp/out.log", rel, "darwin").map((a) => a.label)).toEqual([
                "Copy Absolute Path",
                "Reveal in Finder",
            ]);
        }
    });
});
