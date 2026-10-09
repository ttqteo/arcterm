import { describe, expect, it } from "vitest";
import { composeTaskWithImages, imageFilesOf, imageRoom, imagesPending, MAX_TASK_IMAGES } from "./launcherimages";

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("imageFilesOf", () => {
    it("keeps only images", () => {
        const got = imageFilesOf([file("a.png", "image/png"), file("b.txt", "text/plain")]);
        expect(got.map((f) => f.name)).toEqual(["a.png"]);
    });
    it("reads nothing from a missing list", () => {
        expect(imageFilesOf(null)).toEqual([]);
    });
});

describe("imageRoom", () => {
    it("takes what fits under the cap", () => {
        expect(imageRoom(MAX_TASK_IMAGES - 1, 3)).toBe(1);
        expect(imageRoom(MAX_TASK_IMAGES, 3)).toBe(0);
        expect(imageRoom(0, 2)).toBe(2);
    });
});

describe("imagesPending", () => {
    it("is true while an image has neither a path nor an error", () => {
        expect(imagesPending([{ id: "1", previewUrl: "" }])).toBe(true);
        expect(
            imagesPending([
                { id: "1", previewUrl: "", path: "p" },
                { id: "2", previewUrl: "", error: "e" },
            ])
        ).toBe(false);
    });
});

describe("composeTaskWithImages", () => {
    it("leaves a task with no images alone", () => {
        expect(composeTaskWithImages("claude", " fix it ", [], false)).toEqual({ task: "fix it", extraArgs: [] });
    });
    it("appends a block for claude", () => {
        expect(composeTaskWithImages("claude", "fix it", ["C:\\t\\a.png", "C:\\t\\b.png"], false)).toEqual({
            task: "fix it\n\nAttached images:\n- C:\\t\\a.png\n- C:\\t\\b.png",
            extraArgs: [],
        });
    });
    it("sends only the block for an empty task", () => {
        expect(composeTaskWithImages("agy", "", ["C:\\t\\a.png"], false).task).toBe("Attached images:\n- C:\\t\\a.png");
    });
    it("gives a fresh codex its own --image after the prompt", () => {
        expect(composeTaskWithImages("codex", "fix it", ["C:\\t\\a.png", "C:\\t\\b.png"], false)).toEqual({
            task: "fix it",
            extraArgs: ["--image", "C:\\t\\a.png,C:\\t\\b.png"],
        });
    });
    it("codex resuming uses the text block", () => {
        expect(composeTaskWithImages("codex", "x", ["C:\\t\\a.png"], true).extraArgs).toEqual([]);
    });
    it("codex with a comma in a path uses the text block", () => {
        expect(composeTaskWithImages("codex", "x", ["C:\\t\\a,b.png"], false).extraArgs).toEqual([]);
    });
});
