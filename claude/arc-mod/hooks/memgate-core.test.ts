import { describe, expect, it } from "vitest";
import { memgateArgs, memgateLine } from "./memgate-core";

describe("memgateArgs", () => {
    it("passes the command as one argument after --, so a leading dash is never a flag", () => {
        expect(memgateArgs("-n task check:ts")).toEqual(["memgate", "--", "-n task check:ts"]);
    });
});

describe("memgateLine", () => {
    it("reads a hold line as a notice for the person", () => {
        expect(memgateLine('{"hold":"Low RAM: `task check:ts` needs about 3 GB"}')).toEqual({
            hold: "Low RAM: `task check:ts` needs about 3 GB",
        });
    });

    it("reads a run verdict as no refusal", () => {
        expect(memgateLine('{"run":true}')).toEqual({ refusal: null });
    });

    it("reads a refused verdict as its reason", () => {
        expect(memgateLine('{"run":false,"reason":"Not run: the person chose not to run it."}')).toEqual({
            refusal: "Not run: the person chose not to run it.",
        });
    });

    it.each([
        ["blank", ""],
        ["not json", "Error: wsh must be run inside a Wave-managed SSH session"],
        ["a refusal with no reason", '{"run":false}'],
        ["an empty hold", '{"hold":""}'],
        ["a json string", '"run"'],
        ["null", "null"],
    ])("ignores %s", (_name, line) => {
        expect(memgateLine(line)).toBeNull();
    });
});
