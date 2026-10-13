import { describe, expect, it } from "vitest";
import { TEST_EXCLUDES } from "./vitest.config";

describe("Vitest worktree isolation", () => {
    it("excludes Wave runtime worktrees", () => {
        expect(TEST_EXCLUDES).toContain("**/.waveterm/worktrees/**");
    });

    it("excludes the gitignored .superpowers scratch dir", () => {
        expect(TEST_EXCLUDES).toContain("**/.superpowers/**");
    });
});
