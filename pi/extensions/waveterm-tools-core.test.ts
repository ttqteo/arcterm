import { describe, expect, it } from "vitest";
import {
    captureTailArgs,
    dagRulesArgs,
    memgateArgs,
    memgateRefusal,
    notifyArgs,
    openFileArgs,
    querySessionsArgs,
    runCommandArgs,
    withOrchestrationRules,
} from "./waveterm-tools-core";

describe("waveterm-tools-core", () => {
    it("builds the dag rules argv", () => {
        expect(dagRulesArgs()).toEqual(["jarvis", "dag", "rules"]);
    });

    it("appends a lead's rules as the last user message", () => {
        const messages = [{ role: "user", content: "hi", timestamp: 1 }];
        expect(withOrchestrationRules(messages, "  You are the lead for run r-1.\n", 5)).toEqual([
            ...messages,
            { role: "user", content: "You are the lead for run r-1.", timestamp: 5 },
        ]);
    });

    it("leaves a request alone when there are no rules", () => {
        expect(withOrchestrationRules([{ role: "user", content: "hi", timestamp: 1 }], " \n", 5)).toBeUndefined();
    });

    it("builds wsh run argv with an optional cwd", () => {
        expect(runCommandArgs("echo hi", "C:\\proj")).toEqual(["run", "--cwd", "C:\\proj", "-c", "echo hi"]);
        expect(runCommandArgs("echo hi")).toEqual(["run", "-c", "echo hi"]);
    });

    it("builds the capture-tail argv", () => {
        expect(captureTailArgs("b1")).toEqual(["termscrollback", "-b", "b1", "--lastcommand"]);
    });

    it("builds open-file and query-sessions argv", () => {
        expect(openFileArgs("C:\\a.txt")).toEqual(["view", "C:\\a.txt"]);
        expect(querySessionsArgs()).toEqual(["blocks", "list", "--json"]);
    });

    it("builds notify argv with optional message and level", () => {
        expect(notifyArgs("t")).toEqual(["notify", "t"]);
        expect(notifyArgs("t", { message: "m", level: "error" })).toEqual([
            "notify",
            "t",
            "--message",
            "m",
            "--level",
            "error",
        ]);
        expect(notifyArgs("t", { level: "info" })).toEqual(["notify", "t"]);
    });
});

describe("memgate", () => {
    it("passes the command as one argument after --", () => {
        expect(memgateArgs("-n task check:ts")).toEqual(["memgate", "--", "-n task check:ts"]);
    });

    it("lets the command run on a run verdict, after hold lines", () => {
        expect(memgateRefusal('{"hold":"Low RAM: waiting for your answer"}\n{"run":true}\n')).toBeNull();
    });

    it("blocks with the reason of a refused verdict", () => {
        expect(memgateRefusal('{"hold":"Low RAM"}\n{"run":false,"reason":"Not run: skipped."}\n')).toBe(
            "Not run: skipped."
        );
    });

    it.each([
        ["no output", ""],
        ["an error", "Error: wsh must be run inside a Wave-managed SSH session\n"],
        ["a refusal with no reason", '{"run":false}\n'],
        ["only a hold", '{"hold":"Low RAM"}\n'],
    ])("lets the command run on %s", (_name, stdout) => {
        expect(memgateRefusal(stdout)).toBeNull();
    });
});
