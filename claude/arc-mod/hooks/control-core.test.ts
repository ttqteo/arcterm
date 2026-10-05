import { describe, expect, it } from "vitest";
import { controlText, deliver, takeLines } from "./control-core";

function recorder() {
    const calls: string[][] = [];
    return {
        calls,
        session: {
            submit: async (text: string) => void calls.push(["submit", text]),
            command: async (name: string, args: string) => void calls.push(["command", name, args]),
        },
    };
}

describe("takeLines", () => {
    it("holds a line back until its newline arrives", () => {
        expect(takeLines('{"text":"a"}\n{"te')).toEqual({ lines: ['{"text":"a"}'], rest: '{"te' });
        expect(takeLines('{"te' + 'xt":"b"}\n')).toEqual({ lines: ['{"text":"b"}'], rest: "" });
    });

    it("drops blank lines and a windows line ending", () => {
        expect(takeLines('{"text":"a"}\r\n\n')).toEqual({ lines: ['{"text":"a"}'], rest: "" });
    });
});

describe("controlText", () => {
    it("reads a prompt, newlines kept", () => {
        expect(controlText('{"text":"wake: task 1 done\\nwsh jarvis dag status"}')).toBe(
            "wake: task 1 done\nwsh jarvis dag status"
        );
    });

    it("ignores a line that is not a prompt", () => {
        expect(controlText("not json")).toBeNull();
        expect(controlText('{"text":""}')).toBeNull();
        expect(controlText('{"other":1}')).toBeNull();
        expect(controlText("null")).toBeNull();
    });
});

describe("deliver", () => {
    it("submits plain text as a prompt", async () => {
        const { calls, session } = recorder();
        await deliver(session, "wake: task 1 done\nmore");
        expect(calls).toEqual([["submit", "wake: task 1 done\nmore"]]);
    });

    it("runs a leading slash as a command with its arguments", async () => {
        const { calls, session } = recorder();
        await deliver(session, "/compact Keep: the reasons. Drop: tool output.");
        expect(calls).toEqual([["command", "compact", "Keep: the reasons. Drop: tool output."]]);
    });

    it("runs a bare command with no arguments", async () => {
        const { calls, session } = recorder();
        await deliver(session, "/compact");
        expect(calls).toEqual([["command", "compact", ""]]);
    });
});
