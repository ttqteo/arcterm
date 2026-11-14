import { describe, expect, it } from "vitest";
import { MAX_REFS, promptRefs, refsContext } from "./refs-core";

describe("promptRefs", () => {
    it("reads a kind:id address, tab: as agent:", () => {
        expect(promptRefs("xem council:0c28170c368b5ab0 rồi tab:8e33269b")).toEqual([
            { kind: "council", id: "0c28170c368b5ab0" },
            { kind: "agent", id: "8e33269b" },
        ]);
    });

    it("reads a hex id after a word that says what it is", () => {
        expect(promptRefs("đọc agent 5065BD8C và làm tiếp")).toEqual([{ kind: "agent", id: "5065bd8c" }]);
        expect(promptRefs("đọc hội đồng 0c28170c368b5ab0")).toEqual([{ kind: "council", id: "0c28170c368b5ab0" }]);
        expect(promptRefs("phiên 4b199176 hôm qua")).toEqual([{ kind: "session", id: "4b199176" }]);
    });

    it("leaves the kind to wsh read when the prompt names two, or says chat", () => {
        expect(promptRefs("đọc run/agent 700db496 rồi sửa")).toEqual([{ kind: null, id: "700db496" }]);
        expect(promptRefs("chat 5065bd8c nói gì")).toEqual([{ kind: null, id: "5065bd8c" }]);
    });

    it("takes a whole uuid alone, but never a bare hash, which is as likely a commit", () => {
        expect(promptRefs("run fed0d00e-a6df-496d-923e-778d8d58749a")).toEqual([
            { kind: "run", id: "fed0d00e-a6df-496d-923e-778d8d58749a" },
        ]);
        expect(promptRefs("xem fed0d00e-a6df-496d-923e-778d8d58749a")).toEqual([
            { kind: null, id: "fed0d00e-a6df-496d-923e-778d8d58749a" },
        ]);
        expect(promptRefs("commit 615a57bd4 đã lên main")).toEqual([]);
        expect(promptRefs("revert 615a57bd4")).toEqual([]);
    });

    it("is not fooled by a path, a word or a short hex", () => {
        expect(promptRefs("mở src/run:12345678/x và agentx 12345678")).toEqual([]);
        expect(promptRefs("agent abc123")).toEqual([]);
        expect(promptRefs("the agent is running")).toEqual([]);
    });

    it("names each id once, keeping a kind a later mention gives, and at most MAX_REFS", () => {
        expect(
            promptRefs("8e33269b-aaaa-bbbb-cccc-111122223333 là agent 8e33269b-aaaa-bbbb-cccc-111122223333")
        ).toEqual([{ kind: "agent", id: "8e33269b-aaaa-bbbb-cccc-111122223333" }]);
        const many = Array.from({ length: 8 }, (_, i) => `run:${String(i).repeat(8)}`).join(" ");
        expect(promptRefs(many)).toHaveLength(MAX_REFS);
    });
});

describe("refsContext", () => {
    it("is null for a prompt that names no id", () => {
        expect(refsContext("sửa lỗi này đi")).toBeNull();
    });

    it("names the ids and wsh read, and says reading sends nothing", () => {
        const line = refsContext("đọc run/agent 700db496 và council:0c28170c368b5ab0 rồi chốt");
        expect(line).toContain("`700db496`, `council:0c28170c368b5ab0`");
        expect(line).toContain("wsh read <id>");
        expect(line).toContain("Reading sends nothing");
    });
});
