import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const taskfile = parse(readFileSync(fileURLToPath(new URL("../Taskfile.yml", import.meta.url)), "utf8"));

// go mod tidy loads cmd/wsh/cmd's go:embed of the pi copies: run beside the copy, a cold dev build once failed tidy
// with "no matching versions for query latest" (exit 201)
describe("go:mod:tidy", () => {
    it("waits for the go:embed copies, so it never reads them half written", () => {
        expect(taskfile.tasks["go:mod:tidy"].deps).toEqual(expect.arrayContaining(["sync:piartifacts"]));
    });
});

// wsh embeds the Claude mods straight from claude/ (package claude): no task copies them, and a build that skipped
// on a mod-only edit would install the mod from before it
describe("the Claude mods wsh embeds", () => {
    it("are not copied by any task", () => {
        expect(taskfile.tasks["sync:claudemod"]).toBeUndefined();
        expect(JSON.stringify(taskfile.tasks)).not.toContain("sync:claudemod");
    });

    for (const task of ["build:wsh", "build:wsh:devhost"]) {
        it(`rebuild wsh when they change (${task})`, () => {
            expect(taskfile.tasks[task].sources).toEqual(
                expect.arrayContaining(["claude/*.go", "claude/arc-mod/**/*", "claude/arc-view-mod/**/*", "claude/skim-mod/**/*"])
            );
        });
    }
});
