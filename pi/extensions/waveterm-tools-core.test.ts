import { describe, expect, it } from "vitest";
import {
    captureTailArgs,
    dagRulesArgs,
    jobslotArgs,
    jobslotLine,
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

describe("jobslot", () => {
    it("passes the command as one argument after --, so a leading dash is never a flag", () => {
        expect(jobslotArgs("-rf x")).toEqual(["jobslot", "--", "-rf x"]);
    });

    it("reads a queued place as a hold line", () => {
        expect(jobslotLine('{"queued":2,"behind":"task check:ts","for":"run 700db4"}')).toEqual({
            hold: "Queued #2 — waiting behind task check:ts (run 700db4)",
        });
        expect(jobslotLine('{"queued":1,"behind":"go test ./..."}')).toEqual({
            hold: "Queued #1 — waiting behind go test ./...",
        });
    });

    it("names the place alone when nothing is known of the job ahead", () => {
        expect(jobslotLine('{"queued":3}')).toEqual({ hold: "Queued #3" });
    });

    it("reads run true as no refusal, run false as the reason", () => {
        expect(jobslotLine('{"run":true}')).toEqual({ refusal: null });
        expect(jobslotLine('{"run":false,"reason":"Not run: skipped"}')).toEqual({ refusal: "Not run: skipped" });
    });

    it.each([
        ["blank", ""],
        ["not json", "Error: wsh must be run inside a Wave-managed SSH session"],
        ["an empty object", "{}"],
        ["a refusal with no reason", '{"run":false}'],
        ["a place of zero", '{"queued":0}'],
        ["a place that is not a number", '{"queued":"2"}'],
        ["an array", "[1]"],
        ["a json string", '"run"'],
        ["null", "null"],
    ])("ignores %s", (_name, line) => {
        expect(jobslotLine(line)).toBeNull();
    });
});
