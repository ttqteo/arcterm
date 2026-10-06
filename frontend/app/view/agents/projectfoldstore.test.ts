import { describe, expect, it } from "vitest";
import { toggleFold } from "./projectfoldstore";

describe("toggleFold", () => {
    it("adds a name that is not in the list", () => {
        expect(toggleFold(["a"], "b")).toEqual(["a", "b"]);
    });
    it("removes a name that is in the list and leaves the others", () => {
        expect(toggleFold(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    });
});
