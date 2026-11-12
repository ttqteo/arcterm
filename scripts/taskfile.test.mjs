import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const taskfile = parse(readFileSync(fileURLToPath(new URL("../Taskfile.yml", import.meta.url)), "utf8"));

// sync:claudemod empties cmd/wsh/cmd/claude-*mod (rm -rf, then copies) and go mod tidy loads cmd/wsh/cmd's go:embed of
// them: run side by side, a cold dev build failed tidy with "no matching versions for query latest" (exit 201)
describe("go:mod:tidy", () => {
    it("waits for the go:embed copies, so it never reads them half written", () => {
        expect(taskfile.tasks["go:mod:tidy"].deps).toEqual(expect.arrayContaining(["sync:piartifacts", "sync:claudemod"]));
    });

    it("shares the one sync:claudemod run with the builds that also reach it", () => {
        expect(taskfile.tasks["sync:claudemod"].run).toBe("once");
    });
});
