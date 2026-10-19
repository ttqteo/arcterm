import { describe, expect, it } from "vitest";
import { sessionStartTs } from "./agentsessionstart";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("sessionStartTs", () => {
    it("reads a Claude record's top-level timestamp as unix seconds", () => {
        const line = JSON.stringify({ timestamp: "2026-07-08T00:00:00.000Z", cwd: "/x", type: "user" });
        expect(sessionStartTs([line])).toBe(sec("2026-07-08T00:00:00.000Z"));
    });

    it("reads a Codex session_meta record's top-level timestamp", () => {
        const line = JSON.stringify({ timestamp: "2026-07-08T00:00:01.000Z", type: "session_meta", payload: { cwd: "/x" } });
        expect(sessionStartTs([line])).toBe(sec("2026-07-08T00:00:01.000Z"));
    });

    it("skips blank and non-JSON lines and returns the first valid timestamp", () => {
        const line = JSON.stringify({ timestamp: "2026-07-08T00:00:02.000Z" });
        expect(sessionStartTs(["", "not json {", line])).toBe(sec("2026-07-08T00:00:02.000Z"));
    });

    it("returns null when no line has a timestamp", () => {
        expect(sessionStartTs([JSON.stringify({ type: "user", cwd: "/x" })])).toBeNull();
    });

    it("returns null for an empty transcript", () => {
        expect(sessionStartTs([])).toBeNull();
    });

    it("skips a record whose timestamp is not a string", () => {
        const next = JSON.stringify({ timestamp: "2026-07-08T00:00:03.000Z" });
        expect(sessionStartTs([JSON.stringify({ timestamp: 2026 }), next])).toBe(sec("2026-07-08T00:00:03.000Z"));
    });

    it("skips a record whose timestamp string is not a date", () => {
        const next = JSON.stringify({ timestamp: "2026-07-08T00:00:04.000Z" });
        expect(sessionStartTs([JSON.stringify({ timestamp: "not a date" }), next])).toBe(
            sec("2026-07-08T00:00:04.000Z")
        );
    });

    it("returns null when every timestamp string is unparseable", () => {
        expect(sessionStartTs([JSON.stringify({ timestamp: "not a date" })])).toBeNull();
    });
});
