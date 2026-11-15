import { describe, expect, it } from "vitest";
import { stripResultLines, withResultLines } from "./chatinitiative";
import {
    asleepCommand,
    fixMessage,
    runBlock,
    runBlocks,
    runsAsleep,
    runShell,
    runStatus,
    splitSleepRuns,
    type CarriedRun,
    type SleepRun,
} from "./chatsleepbash";

const failed: CarriedRun = { command: "npm test", stdout: "1 failing\n", stderr: "Error: boom\n", exit: 1 };
const ok: CarriedRun = { command: "git status", stdout: "clean\n", stderr: "", exit: 0 };

describe("runsAsleep", () => {
    it("runs a `!` command typed to a sleeping agent", () => {
        expect(runsAsleep("!git status", true, 0)).toBe(true);
    });
    it("leaves it to the agent awake, with files attached, or with nothing after the `!`", () => {
        expect(runsAsleep("!git status", false, 0)).toBe(false);
        expect(runsAsleep("!git status", true, 1)).toBe(false);
        expect(runsAsleep("!  ", true, 0)).toBe(false);
        expect(runsAsleep("git status", true, 0)).toBe(false);
    });
    it("runs the text after the `!`, trimmed", () => {
        expect(asleepCommand("! git status ")).toBe("git status");
    });
});

describe("the block a run rides in", () => {
    it("comes back out of a message whole, the message after it", () => {
        const wire = withResultLines([runBlock(failed), runBlock(ok)], "what now?");
        const { runs, body } = splitSleepRuns(wire);
        expect(runs).toEqual([failed, ok]);
        expect(body).toBe("what now?");
    });
    it("is read out of the paste Claude Code wraps a multi-line message in", () => {
        const wire = withResultLines([runBlock(ok)], "go on");
        const pasted = `[Pasted text #1 +8 lines]`;
        // a text with no block and no paste stays as it was
        expect(splitSleepRuns(pasted)).toEqual({ runs: [], body: pasted });
        expect(splitSleepRuns(wire.replace(/\n/g, "\r\n")).runs).toEqual([{ ...ok, stdout: "clean\n" }]);
    });
    it("says a run stopped at the timeout", () => {
        const { runs } = splitSleepRuns(withResultLines([runBlock({ ...ok, exit: "timeout" })], "x"));
        expect(runs[0].exit).toBe("timeout");
    });
    it("leaves a message that carries none as it was", () => {
        expect(splitSleepRuns("hello\n\nthere")).toEqual({ runs: [], body: "hello\n\nthere" });
    });
    it("is no part of the bubble: stripResultLines drops it, behind initiative lines too", () => {
        const line = "initiative: added note to Ship it";
        expect(stripResultLines(withResultLines([runBlock(ok)], "hi"))).toBe("hi");
        expect(stripResultLines(withResultLines([line, runBlock(ok)], "hi"))).toBe("hi");
    });
    it("carries only the runs that finished", () => {
        const runs: SleepRun[] = [
            { id: "a", command: "ls", cwd: "/r", at: 1, result: ok },
            { id: "b", command: "sleep 9", cwd: "/r", at: 2 },
            { id: "c", command: "x", cwd: "/r", at: 3, error: "no shell" },
        ];
        expect(runBlocks(runs)).toEqual([runBlock(ok)]);
    });
});

describe("the row", () => {
    it("says how the run ended", () => {
        expect(runStatus({ exit: 1, durMs: 2300 })).toBe("exit 1 · 2.3s");
        expect(runStatus({ exit: 0, durMs: 40 })).toBe("exit 0 · 40ms");
        expect(runStatus({ exit: "timeout" })).toBe("Stopped after 2 min");
    });
    it("draws the output without its last newline", () => {
        expect(runShell(failed)).toEqual({ output: "1 failing", error: "Error: boom" });
    });
    it("asks the agent to fix the command that failed, by name", () => {
        expect(fixMessage(failed)).toBe(
            "`npm test` failed with exit 1 while you were asleep. Find out why and fix it."
        );
        expect(fixMessage({ command: "make", exit: "timeout" })).toContain("ran past the 2-minute limit");
    });
});
