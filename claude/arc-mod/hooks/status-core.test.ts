import { describe, expect, it } from "vitest";
import { idleArgs, TurnStatus } from "./status-core";

const IDLE = ["agentstatus", "--state", "idle", "--agent", "claude", "--transcript", "/t.jsonl"];
const WORKING = ["agentstatus", "--state", "working", "--agent", "claude", "--transcript", "/t.jsonl"];

function recorder() {
    const sent: string[][] = [];
    return { sent, run: async (args: string[]) => void sent.push(args) };
}

describe("TurnStatus", () => {
    it("takes the mod's idle back at the next main-loop step, after the idle has landed", async () => {
        const sent: string[][] = [];
        let landIdle!: () => void;
        const run = (args: string[]) =>
            new Promise<void>((resolve) => {
                if (args[2] === "idle") {
                    // the interrupted turn's wsh is still running when the queued message's turn steps
                    landIdle = () => {
                        sent.push(args);
                        resolve();
                    };
                    return;
                }
                sent.push(args);
                resolve();
            });
        const status = new TurnStatus();
        const ended = status.ended(IDLE, run);
        const stepped = status.stepped(undefined, "/t.jsonl", run);
        await Promise.resolve();
        expect(sent).toEqual([]);
        landIdle();
        await Promise.all([ended, stepped]);
        expect(sent).toEqual([IDLE, WORKING]);
    });

    it("reports working once per idle: the turn's later steps send nothing", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        await status.ended(IDLE, run);
        await status.stepped(undefined, "/t.jsonl", run);
        await status.stepped(undefined, "/t.jsonl", run);
        expect(sent).toEqual([IDLE, WORKING]);
    });

    it("sends nothing on a step when the last turn ended with Stop's own report", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        await status.ended(null, run);
        await status.stepped(undefined, "/t.jsonl", run);
        expect(sent).toEqual([]);
    });

    it("leaves the idle standing through a subagent's step", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        await status.ended(IDLE, run);
        await status.stepped("a1", "/t.jsonl", run);
        expect(sent).toEqual([IDLE]);
    });

    it("keeps reporting after a report fails", async () => {
        const sent: string[][] = [];
        const run = async (args: string[]) => {
            if (args[2] === "idle") {
                throw new Error("wsh not found");
            }
            sent.push(args);
        };
        const status = new TurnStatus();
        await status.ended(IDLE, run);
        await status.stepped(undefined, null, run);
        expect(sent).toEqual([["agentstatus", "--state", "working", "--agent", "claude"]]);
    });

    it("reports working each time a question is answered, mid-turn: no settings hook does", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        await status.answered("/t.jsonl", run);
        await status.answered("/t.jsonl", run);
        expect(sent).toEqual([WORKING, WORKING]);
    });

    it("queues an answer's working behind an idle still landing, and a dismissal's idle after it lands last", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        void status.ended(IDLE, run);
        void status.answered("/t.jsonl", run);
        await status.ended(IDLE, run);
        expect(sent).toEqual([IDLE, WORKING, IDLE]);
    });

    it("an answer's working stands in for the step's: the turn's next step sends nothing more", async () => {
        const { sent, run } = recorder();
        const status = new TurnStatus();
        await status.ended(IDLE, run);
        await status.answered("/t.jsonl", run);
        await status.stepped(undefined, "/t.jsonl", run);
        expect(sent).toEqual([IDLE, WORKING]);
    });
});

describe("idleArgs", () => {
    it("leaves an answered turn to the Stop settings hook", () => {
        expect(idleArgs({ reason: "answer" }, "/t.jsonl")).toBeNull();
    });

    it("reports idle for an answered turn that put a question in claude's dialog: a dismissal runs no Stop", () => {
        expect(idleArgs({ reason: "answer" }, null, true)).toEqual(["agentstatus", "--state", "idle", "--agent", "claude"]);
        expect(idleArgs({ reason: "answer", agentId: "a1" }, null, true)).toBeNull();
    });

    it("reports idle for an interrupted turn, with the transcript it knows", () => {
        expect(idleArgs({ reason: "aborted" }, "/t.jsonl")).toEqual([
            "agentstatus", "--state", "idle", "--agent", "claude", "--transcript", "/t.jsonl",
        ]);
    });

    it("reports idle for a turn an API error or a refusal ended", () => {
        for (const reason of ["error", "refusal"]) {
            expect(idleArgs({ reason }, "/t.jsonl")).toEqual([
                "agentstatus", "--state", "idle", "--agent", "claude", "--transcript", "/t.jsonl",
            ]);
        }
    });

    it("sends no transcript flag before the session has named one", () => {
        expect(idleArgs({ reason: "aborted" }, null)).toEqual([
            "agentstatus", "--state", "idle", "--agent", "claude",
        ]);
    });

    it("ignores a subagent's turn: the session is still working", () => {
        expect(idleArgs({ reason: "aborted", agentId: "a1" }, "/t.jsonl")).toBeNull();
    });
});
