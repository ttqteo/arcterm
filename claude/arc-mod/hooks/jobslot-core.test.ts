import { describe, expect, it } from "vitest";
import { jobslotArgs, jobslotLine } from "./jobslot-core";

describe("jobslotArgs", () => {
    it("passes the command as one argument after --, so a leading dash is never a flag", () => {
        expect(jobslotArgs("-rf x")).toEqual(["jobslot", "--", "-rf x"]);
    });
});

describe("jobslotLine", () => {
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
