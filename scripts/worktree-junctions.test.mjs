import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./worktree-junctions.mjs", import.meta.url));

function isLinked(dir) {
    return spawnSync(process.execPath, [script, "is-linked", dir], { encoding: "utf8" });
}

// npm:install runs `is-linked node_modules || npm install`, so exit 0 is what skips the install
describe("is-linked", () => {
    const root = mkdtempSync(join(tmpdir(), "wt-junctions-"));
    const main = join(root, "main-node_modules");
    mkdirSync(main);
    // rm unlinks a junction rather than following it
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    it("exits 0 for a junction to another checkout's node_modules", () => {
        const link = join(root, "linked");
        symlinkSync(main, link, "junction");
        const r = isLinked(link);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("not installing over it");
    });

    it("exits 1 for a real node_modules, so a checkout's install runs", () => {
        const real = join(root, "real");
        mkdirSync(real);
        expect(isLinked(real).status).toBe(1);
    });

    it("exits 1 when node_modules does not exist yet", () => {
        expect(isLinked(join(root, "missing")).status).toBe(1);
    });
});
