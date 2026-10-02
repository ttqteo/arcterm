import { describe, expect, it } from "vitest";
import { toggleProject } from "./projectfoldstore";

describe("toggleProject", () => {
    it("adds a project that is not in the list", () => {
        expect(toggleProject(["a"], "b")).toEqual(["a", "b"]);
    });
    it("removes a project that is in the list and leaves the others", () => {
        expect(toggleProject(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    });
});
