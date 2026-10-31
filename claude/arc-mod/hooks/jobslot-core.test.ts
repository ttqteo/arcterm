import { describe, expect, it } from "vitest";
import { heavyArgs, heldInBackground, heldOriginal, jobslotArgs, jobslotLine } from "./jobslot-core";

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

describe("a heavy background command", () => {
    const wsh = "/Users/me/.arc/bin/wsh";

    it("asks wsh whether it takes a slot, the command one argument after --", () => {
        expect(heavyArgs("-x task check:ts")).toEqual(["jobslot", "--heavy", "--", "-x task check:ts"]);
    });

    it("runs behind wsh in its own shell, and stops only on a skip", () => {
        expect(heldInBackground(wsh, "task check:ts")).toBe(
            "'/Users/me/.arc/bin/wsh' jobslot --hold-parent -- 'task check:ts'; [ $? -ne 75 ] || exit 75\ntask check:ts"
        );
    });

    it("quotes a command holding quotes for wsh, and keeps it as written to run", () => {
        const command = `cd 'a b' && echo "it's" | tail -3`;
        const held = heldInBackground(wsh, command);
        expect(held).toContain(`-- 'cd '\\''a b'\\'' && echo "it'\\''s" | tail -3';`);
        expect(held.endsWith(`\n${command}`)).toBe(true);
    });

    it("gives the permission check back the command as written", () => {
        for (const command of [
            "task check:ts",
            "cd x && go test ./... 2>&1 | tail -20 # all of it",
            "npx vitest run; [ $? -ne 75 ] || exit 75\nnpm test",
            "line one\nline two",
        ]) {
            expect(heldOriginal(wsh, heldInBackground(wsh, command))).toBe(command);
        }
    });

    it("reads any other command as not held", () => {
        expect(heldOriginal(wsh, "task check:ts")).toBeNull();
        expect(heldOriginal(wsh, heldInBackground("/other/wsh", "task check:ts"))).toBeNull();
        // anything added after the wrapped command is no longer the wrapper's: checked whole, rm included
        expect(heldOriginal(wsh, heldInBackground(wsh, "task check:ts") + "; rm -rf x")).toBeNull();
        expect(heldOriginal(wsh, heldInBackground(wsh, "a").replace("'a'", "'b'"))).toBeNull();
    });
});
