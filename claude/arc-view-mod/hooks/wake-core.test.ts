import { describe, expect, it } from "vitest";
import { commandFits, parseWake, recapLine, wakeSummary } from "./wake-core";

describe("parseWake", () => {
    it("reads each wake line as an event with its trailing command apart", () => {
        const wake = parseWake(
            "wake: task t-3 failed (verify), retry spent. wsh jarvis dag status\n" +
                "wake: merge conflict landing lane ending at task t-4. git status"
        );
        expect(wake?.events).toEqual([
            {
                kind: "alert",
                headline: "task t-3 failed (verify), retry spent",
                more: [],
                command: "wsh jarvis dag status",
            },
            {
                kind: "alert",
                headline: "merge conflict landing lane ending at task t-4",
                more: [],
                command: "git status",
            },
        ]);
    });

    it("keeps a command with an argument", () => {
        const wake = parseWake(
            "wake: task t-5 never started: no worker process 6m after spawn. wsh jarvis dag retry t-5"
        );
        expect(wake?.events[0].command).toBe("wsh jarvis dag retry t-5");
    });

    it("counts the question line as questions, not as an event", () => {
        const wake = parseWake(
            "wake: review failed for task t-5. wsh jarvis dag status\nwake: 2 questions waiting. wsh jarvis dag asks"
        );
        expect(wake?.questions).toBe(2);
        expect(wake?.events[1].kind).toBe("question");
        expect(wakeSummary(wake!)).toBe("1 event · 2 questions");
    });

    it("summarizes a question alone", () => {
        expect(wakeSummary(parseWake("wake: 1 question waiting. wsh jarvis dag asks")!)).toBe("1 question");
    });

    it("puts the rest of a long line and the lines under it after the headline", () => {
        const wake = parseWake(
            "wake: the final stage failed on the merged result in round 1. Write a fix plan and run `wsh jarvis dag submit --round --plan <fix plan>`, or put it to the human if the fix is a product call:\n" +
                "FAIL pkg/orchestrate\nexit status 1"
        );
        expect(wake?.events[0]).toEqual({
            kind: "alert",
            headline: "the final stage failed on the merged result in round 1",
            more: [
                "Write a fix plan and run wsh jarvis dag submit --round --plan <fix plan>, or put it to the human if the fix is a product call",
                "FAIL pkg/orchestrate",
                "exit status 1",
            ],
            command: "",
        });
    });

    it("keeps the final stage's outcome under run finished", () => {
        const wake = parseWake(
            "wake: run finished. wsh jarvis dag status\nThe final stage passed on the merged result."
        );
        expect(wake?.events[0]).toEqual({
            kind: "done",
            headline: "run finished",
            more: ["The final stage passed on the merged result."],
            command: "wsh jarvis dag status",
        });
    });

    it("marks a passed review's note as a note and stops the headline before the reviewer's text", () => {
        const wake = parseWake(
            "wake: task t-1 passed review with a note for later tasks: reuse the stub. It is built. wsh jarvis dag status"
        );
        expect(wake?.events[0]).toEqual({
            kind: "note",
            headline: "task t-1 passed review with a note for later tasks",
            more: ["reuse the stub. It is built"],
            command: "wsh jarvis dag status",
        });
    });

    it("keeps caveats whole and counts recaps", () => {
        const wake = parseWake(
            "wake: review failed for task t-5. wsh jarvis dag status\n" +
                "Unverified:\nt-2 reviewer: the Esc path was not exercised\n" +
                "Since your last wake:\nplan review passed; workers are starting: ok\nt-1's review note reached t-4: reuse it"
        );
        expect(wake?.events).toHaveLength(1);
        expect(wake?.caveats).toEqual(["t-2 reviewer: the Esc path was not exercised"]);
        expect(wake?.recaps).toBe(2);
        expect(recapLine(wake!.recaps)).toBe("2 recaps since your last wake");
    });

    it("is null for text that is not a wake", () => {
        expect(parseWake("t-1 passed review with a note for your task: reuse the stub")).toBeNull();
        expect(parseWake("")).toBeNull();
    });
});

describe("commandFits", () => {
    const event = parseWake("wake: review failed for task t-5. wsh jarvis dag status")!.events[0];

    it("holds the command beside the headline while the row has room", () => {
        expect(commandFits(event, 120)).toBe(true);
    });

    it("drops it under the headline on a narrow terminal", () => {
        expect(commandFits(event, 40)).toBe(false);
    });
});
