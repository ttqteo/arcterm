import { describe, expect, it } from "vitest";
import {
    askingJudgeId,
    judgeLineDot,
    judgeLineTokens,
    judgeLineWords,
    judgeStateOf,
    type JudgeState,
} from "./pairjudgeline";

const relaying = { state: "relaying", stopreason: "" };
const stopped = (stopreason: string) => ({ state: "stopped", stopreason });

describe("judgeStateOf", () => {
    it("reads asleep from the roster's sleeping record, else the agent's own state", () => {
        expect(judgeStateOf({ state: "idle", sleeping: { since: 1, freedBytes: 0 } })).toBe("asleep");
        expect(judgeStateOf({ state: "working" })).toBe("working");
        expect(judgeStateOf({ state: "asking" })).toBe("asking");
        expect(judgeStateOf({ state: "idle" })).toBe("idle");
    });
});

describe("judgeLineWords with one judge", () => {
    it.each<[string, { state: string; stopreason: string }, JudgeState, string, string, "normal" | "warning"]>([
        ["working", relaying, "working", "judge reviewing", "judge đang soát", "normal"],
        ["waiting", relaying, "idle", "judge waiting", "judge đang chờ", "normal"],
        ["asleep", relaying, "asleep", "judge asleep", "judge đang ngủ", "normal"],
        ["asking", relaying, "asking", "judge is asking you", "judge đang hỏi bạn", "warning"],
        [
            "no new points",
            stopped("no-new-points"),
            "idle",
            "judge paused: no new points",
            "judge dừng: hết điểm",
            "normal",
        ],
        ["settled", stopped("settled"), "idle", "judge paused: both agree", "judge dừng: hai bên thống nhất", "normal"],
        ["token cap", stopped("token-cap"), "idle", "judge paused: token cap", "judge dừng: chạm trần token", "normal"],
        [
            "judges gone",
            stopped("judges-gone"),
            "idle",
            "judge paused: no judge left",
            "judge dừng: không còn judge",
            "normal",
        ],
        ["a reason it does not know", stopped("other"), "idle", "judge paused", "judge dừng", "normal"],
    ])("%s", (_name, pair, state, en, vi, tone) => {
        expect(judgeLineWords(pair, [state], false)).toEqual({ text: en, tone, count: 1 });
        expect(judgeLineWords(pair, [state], true)).toEqual({ text: vi, tone, count: 1 });
    });

    it("says a stopped pair's reason for an asleep judge too: the stop is what the person reads", () => {
        expect(judgeLineWords(stopped("no-new-points"), ["asleep"], false).text).toBe("judge paused: no new points");
    });

    it("lets a judge that asks you speak over a stop, and a judge that still works not", () => {
        expect(judgeLineWords(stopped("settled"), ["asking"], false)).toMatchObject({
            text: "judge is asking you",
            tone: "warning",
        });
        expect(judgeLineWords(stopped("settled"), ["working"], false).text).toBe("judge paused: both agree");
    });

    it("has no judge to name when none is in the roster: a relaying pair waits, a stopped one says why", () => {
        expect(judgeLineWords(relaying, [], false)).toEqual({ text: "judge waiting", tone: "normal", count: 0 });
        expect(judgeLineWords(stopped("judges-gone"), [], false).text).toBe("judge paused: no judge left");
    });
});

describe("judgeLineWords with several judges", () => {
    it("begins with how many there are and speaks for the one that needs you most: asking, then working, then the rest", () => {
        expect(judgeLineWords(relaying, ["idle", "asking", "working"], false)).toEqual({
            text: "3 judge · asking you",
            tone: "warning",
            count: 3,
        });
        expect(judgeLineWords(relaying, ["asleep", "working"], false)).toEqual({
            text: "2 judge · reviewing",
            tone: "normal",
            count: 2,
        });
        expect(judgeLineWords(relaying, ["asleep", "idle"], false).text).toBe("2 judge · waiting");
        expect(judgeLineWords(relaying, ["asleep", "asleep"], false).text).toBe("2 judge · asleep");
    });

    it("keeps the stop's words on a stopped pair, in both languages", () => {
        expect(judgeLineWords(stopped("no-new-points"), ["idle", "idle"], false).text).toBe(
            "2 judge · paused: no new points"
        );
        expect(judgeLineWords(stopped("no-new-points"), ["idle", "idle"], true).text).toBe("2 judge · dừng: hết điểm");
        expect(judgeLineWords(relaying, ["asking", "idle"], true)).toEqual({
            text: "2 judge · đang hỏi bạn",
            tone: "warning",
            count: 2,
        });
        expect(judgeLineWords(relaying, ["working", "idle"], true).text).toBe("2 judge · đang soát");
    });
});

describe("judgeLineDot", () => {
    it("is green for a judge at work, amber for one asking, and none for the rest, a stop included", () => {
        expect(judgeLineDot(relaying, ["working"])).toBe("working");
        expect(judgeLineDot(relaying, ["idle", "asking"])).toBe("asking");
        expect(judgeLineDot(relaying, ["idle"])).toBeNull();
        expect(judgeLineDot(stopped("no-new-points"), ["idle"])).toBeNull();
        expect(judgeLineDot(stopped("no-new-points"), ["working"])).toBeNull();
        expect(judgeLineDot(stopped("no-new-points"), ["asking"])).toBe("asking");
    });
});

describe("askingJudgeId", () => {
    it("names the first judge that asks, or none", () => {
        const j = (id: string, state: "idle" | "asking" | "working") => ({ id, state });
        expect(askingJudgeId([j("a", "idle"), j("b", "asking"), j("c", "asking")])).toBe("b");
        expect(askingJudgeId([j("a", "idle"), j("b", "working")])).toBeUndefined();
        expect(askingJudgeId([])).toBeUndefined();
    });
});

describe("judgeLineTokens", () => {
    it("formats the judges' tokens the way a row does, and says nothing for none", () => {
        expect(judgeLineTokens(853_000)).toBe("853k");
        expect(judgeLineTokens(1_240_000)).toBe("1.2M");
        expect(judgeLineTokens(0)).toBeNull();
        expect(judgeLineTokens(undefined)).toBeNull();
    });
});
