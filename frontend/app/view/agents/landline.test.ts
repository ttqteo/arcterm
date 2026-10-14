import { describe, expect, it } from "vitest";
import { landPlace, landProjectKey, landSlotOfRun, type LandSlot } from "./landline";

const slot = (runId: string, state: string | undefined, over: Partial<LandSlot> = {}): LandSlot => ({
    runId,
    title: `run ${runId}`,
    projectPath: "/p/arc",
    land: state ? { state } : undefined,
    ...over,
});

describe("landPlace", () => {
    it("places a queued land behind the one in its turn and the older queued ones", () => {
        const turn = slot("a", "pending");
        const first = slot("b", "queued", { land: { state: "queued", queuedts: 10 } });
        const second = slot("c", "queued", { land: { state: "queued", queuedts: 20 } });
        const other = slot("d", "queued", { projectPath: "/p/other", land: { state: "queued", queuedts: 5 } });
        const runs = [turn, first, second, other];
        expect(landPlace(turn, runs)).toEqual({ place: 0, ahead: undefined });
        expect(landPlace(first, runs)).toEqual({ place: 2, ahead: turn });
        expect(landPlace(second, runs)).toEqual({ place: 3, ahead: first });
        expect(landPlace(other, runs)).toEqual({ place: 1, ahead: undefined });
    });

    it("is first when nothing is ahead", () => {
        const only = slot("a", "queued", { land: { state: "queued", queuedts: 10 } });
        expect(landPlace(only, [only])).toEqual({ place: 1, ahead: undefined });
    });

    it("orders lands asked for at the same moment by run id, as the driver does", () => {
        const a = slot("a", "queued", { land: { state: "queued", queuedts: 10 } });
        const b = slot("b", "queued", { land: { state: "queued", queuedts: 10 } });
        expect(landPlace(a, [a, b]).place).toBe(1);
        expect(landPlace(b, [a, b])).toEqual({ place: 2, ahead: a });
    });

    it("counts one turn however many lands read pending, and ignores resolving and held lands", () => {
        const me = slot("m", "queued", { land: { state: "queued", queuedts: 30 } });
        const runs = [
            me,
            slot("p1", "pending"),
            slot("p2", "pending"),
            slot("r", "resolving"),
            slot("h", "held"),
            slot("l", "landed"),
            slot("n", undefined),
        ];
        expect(landPlace(me, runs).place).toBe(2);
    });

    it("keeps two projects with the same folder name apart, and reads one path through its separators", () => {
        const mine = slot("a", "queued", { projectPath: "C:\\code\\arc", land: { state: "queued", queuedts: 10 } });
        const same = slot("b", "pending", { projectPath: "C:/code/arc/" });
        const namesake = slot("c", "pending", { projectPath: "D:\\work\\arc" });
        expect(landPlace(mine, [mine, namesake])).toEqual({ place: 1, ahead: undefined });
        expect(landPlace(mine, [mine, same, namesake])).toEqual({ place: 2, ahead: same });
    });

    it("cannot place a land whose project it does not know", () => {
        const lost = slot("a", "queued", { projectPath: undefined, land: { state: "queued", queuedts: 10 } });
        expect(landPlace(lost, [lost, slot("b", "pending", { projectPath: undefined })])).toEqual({
            place: 0,
            ahead: undefined,
        });
    });
});

describe("landProjectKey", () => {
    it("reads a path as Go's filepath.Clean does: one separator, no trailing one, no dot segments", () => {
        expect(landProjectKey("C:\\code\\arc\\")).toBe("C:/code/arc");
        expect(landProjectKey("/home//me/./arc/")).toBe("/home/me/arc");
        expect(landProjectKey("/home/me/x/../arc")).toBe("/home/me/arc");
        expect(landProjectKey("/")).toBe("/");
        expect(landProjectKey(undefined)).toBe("");
    });
});

describe("landSlotOfRun", () => {
    it("reads a run object the way the lineage names it", () => {
        const run = {
            id: "r1",
            goal: "ship the thing\nmore",
            projectpath: "/p/arc",
            land: { state: "queued", queuedts: 3 },
        } as unknown as Run;
        expect(landSlotOfRun(run)).toEqual({
            runId: "r1",
            title: "ship the thing",
            projectPath: "/p/arc",
            land: { state: "queued", queuedts: 3 },
        });
    });
});
