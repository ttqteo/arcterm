import { describe, expect, it } from "vitest";
import { KEEP_RELEASES, releasesToDrop } from "./release-prune.mjs";

const f = (name, mtimeMs) => ({ name, mtimeMs });

describe("releasesToDrop", () => {
    it("keeps the newest three installers and drops the rest, oldest included", () => {
        const files = [
            f("arcterm_1.9.0_aaa_x64-setup.exe", 1),
            f("arcterm_1.9.0_bbb_x64-setup.exe", 5),
            f("arcterm_1.10.0_ccc_x64-setup.exe", 3),
            f("arcterm_1.10.0_ddd_x64-setup.exe", 4),
            f("arcterm_1.10.0_eee_aarch64.dmg", 2),
        ];
        expect(KEEP_RELEASES).toBe(3);
        expect(releasesToDrop(files).sort()).toEqual(["arcterm_1.10.0_eee_aarch64.dmg", "arcterm_1.9.0_aaa_x64-setup.exe"]);
    });

    it("drops nothing at or under the limit", () => {
        expect(releasesToDrop([f("arcterm_1_a_x64-setup.exe", 1), f("arcterm_1_b_x64-setup.exe", 2)])).toEqual([]);
    });

    it("never touches a file that is not an installer", () => {
        const files = [f("notes.txt", 0), f("arcterm.log", 0), ...[1, 2, 3, 4].map((i) => f(`arcterm_1_${i}_x64-setup.exe`, i))];
        expect(releasesToDrop(files)).toEqual(["arcterm_1_1_x64-setup.exe"]);
    });

    it("keeps the build just made even when its mtime is older than the rest (a copy keeps the bundle's time)", () => {
        const files = [1, 2, 3, 4].map((i) => f(`arcterm_1_${i}_x64-setup.exe`, i * 10)).concat(f("arcterm_1_new_x64-setup.exe", 0));
        const drop = releasesToDrop(files, 3, "arcterm_1_new_x64-setup.exe");
        expect(drop).not.toContain("arcterm_1_new_x64-setup.exe");
        expect(drop.sort()).toEqual(["arcterm_1_1_x64-setup.exe", "arcterm_1_2_x64-setup.exe"]);
    });
});
