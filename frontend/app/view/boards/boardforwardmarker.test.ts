import { describe, expect, it } from "vitest";
import { parseBoardForward } from "./boardforwardmarker";

// the strings are the ones boardforward.Marker writes (pkg/boardforward/boardforward_test.go)
describe("parseBoardForward", () => {
    it("reads a marker with a selection", () => {
        expect(
            parseBoardForward('[From board "Auth flow" · on Login box, Token store · turn t-1]\nwhy two stores?')
        ).toEqual({ board: "Auth flow", on: "Login box, Token store", turnId: "t-1", question: "why two stores?" });
    });

    it("reads a marker with nothing selected", () => {
        expect(parseBoardForward('[From board "Auth flow" · turn t-2]\nwhat is this?')).toEqual({
            board: "Auth flow",
            on: "",
            turnId: "t-2",
            question: "what is this?",
        });
    });

    it("keeps every line of your words", () => {
        expect(
            parseBoardForward('[From board "Auth flow" · on Login box · turn t-3]\nline one\nline two')?.question
        ).toBe("line one\nline two");
    });

    it("reads a marker with no words after it", () => {
        expect(parseBoardForward('[From board "Auth flow" · turn t-4]')).toEqual({
            board: "Auth flow",
            on: "",
            turnId: "t-4",
            question: "",
        });
    });

    it("takes a board named like a command, and a name holding the separators, as written", () => {
        expect(parseBoardForward('[From board "/clear" · on /etc · turn t-5]\n/compact')).toMatchObject({
            board: "/clear",
            on: "/etc",
            question: "/compact",
        });
        expect(parseBoardForward('[From board "A · turn B" · on x · turn t-6]\nq')).toMatchObject({
            board: "A · turn B",
            on: "x",
            turnId: "t-6",
        });
    });

    it("leaves a message that is not a marker alone", () => {
        expect(parseBoardForward("why two stores?")).toBeNull();
        expect(parseBoardForward('[From board "Auth flow" · on x]\nq')).toBeNull();
        expect(parseBoardForward('[From board "Auth flow" · turn ]\nq')).toBeNull();
        expect(parseBoardForward('[From board "Auth flow · turn t-7]\nq')).toBeNull();
        expect(parseBoardForward('the line [From board "A" · turn t-8]')).toBeNull();
    });
});
