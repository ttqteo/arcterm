import { describe, expect, it } from "vitest";
import type { NudgeIO } from "./ideas-core";
import { nudgeRow, promptNudge } from "./ideas-core";
import type { Ran } from "./mention-core";

describe("nudgeRow", () => {
    it.each([
        ["nothing", ""],
        ["spaces", "   "],
        ["a newline", "\n"],
    ])("is null for %s, which is what tick prints when no nudge is due", (_name, nudge) => {
        expect(nudgeRow(nudge)).toBeNull();
    });

    it("prefixes a nudge with arc: and drops the newline wsh prints after it", () => {
        expect(nudgeRow("3 turns since the last idea was recorded.\n")).toBe(
            "arc: 3 turns since the last idea was recorded."
        );
    });
});

// the effects promptNudge may use, recorded; a test names the ones that go wrong
function fakeIO(opts: { ran?: Ran; run?: () => Promise<Ran>; append?: () => Promise<void> } = {}) {
    const calls = { run: [] as string[][], append: [] as string[], log: [] as string[] };
    const io: NudgeIO = {
        run: (argv) => {
            calls.run.push(argv);
            return opts.run ? opts.run() : Promise.resolve(opts.ran ?? { exitCode: 0, stdout: "", stderr: "" });
        },
        append: (text) => {
            calls.append.push(text);
            return opts.append ? opts.append() : Promise.resolve();
        },
        log: (msg) => calls.log.push(msg),
    };
    return { io, calls };
}

describe("promptNudge", () => {
    it("ticks the session by id, so no block has to hold a transcript yet", async () => {
        const { io, calls } = fakeIO();
        await promptNudge(io, "/home/me/.arc/bin/wsh", "abc-123");
        expect(calls.run).toEqual([["/home/me/.arc/bin/wsh", "idea", "tick", "--session", "abc-123"]]);
    });

    it("appends the nudge as one arc: row when tick prints one", async () => {
        const { io, calls } = fakeIO({
            ran: { exitCode: 0, stdout: "3 turns since the last idea was recorded.\n", stderr: "" },
        });
        await promptNudge(io, "wsh", "abc-123");
        expect(calls.append).toEqual(["arc: 3 turns since the last idea was recorded."]);
        expect(calls.log).toEqual([]);
    });

    it("appends nothing when tick prints nothing", async () => {
        const { io, calls } = fakeIO({ ran: { exitCode: 0, stdout: "\n", stderr: "" } });
        await promptNudge(io, "wsh", "abc-123");
        expect(calls.append).toEqual([]);
        expect(calls.log).toEqual([]);
    });

    it("logs a non-zero exit once with its stderr, appends nothing and throws nothing", async () => {
        const { io, calls } = fakeIO({
            ran: { exitCode: 1, stdout: "stale nudge", stderr: "Error: no agent session in this terminal yet\n" },
        });
        await expect(promptNudge(io, "wsh", "abc-123")).resolves.toBeUndefined();
        expect(calls.append).toEqual([]);
        expect(calls.log).toHaveLength(1);
        expect(calls.log[0]).toContain("exited 1");
        expect(calls.log[0]).toContain("no agent session in this terminal yet");
    });

    it("logs a run that rejects once, appends nothing and throws nothing", async () => {
        const { io, calls } = fakeIO({ run: () => Promise.reject(new Error("spawn failed")) });
        await expect(promptNudge(io, "wsh", "abc-123")).resolves.toBeUndefined();
        expect(calls.append).toEqual([]);
        expect(calls.log).toHaveLength(1);
        expect(calls.log[0]).toContain("spawn failed");
    });

    it("logs an append that rejects once and throws nothing", async () => {
        const { io, calls } = fakeIO({
            ran: { exitCode: 0, stdout: "record ideas\n", stderr: "" },
            append: () => Promise.reject(new Error("denied")),
        });
        await expect(promptNudge(io, "wsh", "abc-123")).resolves.toBeUndefined();
        expect(calls.append).toEqual(["arc: record ideas"]);
        expect(calls.log).toHaveLength(1);
        expect(calls.log[0]).toContain("denied");
    });
});
