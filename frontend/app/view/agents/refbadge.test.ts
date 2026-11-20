import { describe, expect, it } from "vitest";
import { badgeLook, codeRef, refSpans, refTitle, resolveBareRef, resolveRef, type RefSources } from "./refbadge";

const src: RefSources = {
    agents: [
        { id: "7cd99627-1111-4a4a-8b8b-000000000001", name: "chat-commit-card", state: "working", agent: "claude" },
        { id: "3fa1c2e0-2222-4a4a-8b8b-000000000002", name: "api-tests", state: "asking", agent: "codex" },
        { id: "3fa1c2ff-3333-4a4a-8b8b-000000000003", name: "docs-sweep", state: "idle", agent: "claude" },
        { id: "9a9a9a9a-6666-4a4a-8b8b-000000000006", name: "odd-one", state: "idle", agent: "nosuchruntime" },
    ],
    runs: [{ oid: "071a8e3b-4444-4a4a-8b8b-000000000004", goal: "Close the tree's picked rows\ntogether" }],
    councils: [{ id: "c41d9e02-5555-4a4a-8b8b-000000000005", feature: "Chat compact work" }],
    project: "D:\\projects\\arcterm",
};

const now = Date.parse("2026-11-17T12:00:00Z");
const src2: RefSources = {
    ...src,
    sessions: [
        {
            id: "9f31d0b4-6666-4a4a-8b8b-000000000006",
            runtime: "claude",
            task: "Fix CDP fails\nand more",
            projectname: "arcterm",
            lastactivets: now - 3 * 86_400_000,
        },
    ],
    efforts: [
        { oref: "effort:e9b20f17-7777-4a4a-8b8b-000000000007", title: "Chat polish", done: 4, total: 9 },
        { oref: "effort:4c0aa7d3-8888-4a4a-8b8b-000000000008", title: "RAM watch", done: 6, total: 6 },
    ],
    now,
};

describe("refSpans", () => {
    it("finds a token as its own word, after @ too, and keeps the text as written", () => {
        const text = "có gồm agent:7cd99627 không? @run:071a8e3b, (council:C41D9E02)";
        expect(refSpans(text).map((s) => [s.kind, s.id, s.raw, text.slice(s.start, s.end)])).toEqual([
            ["agent", "7cd99627", "agent:7cd99627", "agent:7cd99627"],
            ["run", "071a8e3b", "@run:071a8e3b", "@run:071a8e3b"],
            ["council", "c41d9e02", "council:C41D9E02", "council:C41D9E02"],
        ]);
    });
    it("reads tab: as agent", () => {
        expect(refSpans("tab:7cd99627")[0].kind).toBe("agent");
    });
    it("leaves glued, too short, non-hex and other kinds as text", () => {
        expect(refSpans("xagent:7cd99627 agent:7cd agent:zzzz9999 xsession:9f31d0b4 agent:7cd99627x")).toEqual([]);
    });
    it("finds session: and effort: tokens", () => {
        expect(refSpans("đọc session:9f31d0b4 rồi effort:e9b20f17.").map((s) => s.kind)).toEqual(["session", "effort"]);
    });
    it("leaves the token the caret is in or at the end of", () => {
        expect(refSpans("agent:7cd99627", 14)).toEqual([]);
        expect(refSpans("agent:7cd99627 ", 15)).toHaveLength(1);
    });
});

describe("resolveRef", () => {
    it("resolves an agent by unique prefix, with its runtime and state", () => {
        expect(resolveRef("agent", "7cd99627", src)).toEqual({
            status: "resolved",
            kind: "agent",
            id: src.agents[0].id,
            name: "chat-commit-card",
            runtime: "claude",
            state: "working",
        });
    });
    it("names a run by its goal's first line and a council by its feature", () => {
        expect(resolveRef("run", "071a8e3b", src)).toMatchObject({
            status: "resolved",
            name: "Close the tree's picked rows",
        });
        expect(resolveRef("council", "c41d9e02", src)).toMatchObject({ status: "resolved", name: "Chat compact work" });
    });
    it("prefers an exact id over prefixes", () => {
        const exact = {
            ...src,
            agents: [...src.agents, { id: "3fa1", name: "short", state: "idle" as const, agent: "pi" }],
        };
        expect(resolveRef("agent", "3fa1", exact)).toMatchObject({ status: "resolved", name: "short" });
    });
    it("says why it cannot resolve", () => {
        expect(resolveRef("agent", "deadbeef", src)).toEqual({
            status: "unresolved",
            reason: "No agent deadbeef is open",
        });
        expect(resolveRef("agent", "3fa1", src)).toEqual({ status: "unresolved", reason: "agent:3fa1 names 2 agents" });
        expect(resolveRef("run", "deadbeef", src)).toEqual({
            status: "unresolved",
            reason: "No run deadbeef in this project",
        });
        expect(resolveRef("council", "deadbeef", { ...src, project: "" })).toEqual({
            status: "unresolved",
            reason: "This chat has no project to find council deadbeef in",
        });
    });
});

describe("badgeLook and refTitle", () => {
    it("tints an agent by its runtime, a run and a council by their marks", () => {
        expect(badgeLook(resolveRef("agent", "7cd99627", src))).toEqual({
            frame: "border-rt-claude-line bg-rt-claude-soft",
            mark: "runtime",
            dot: "working",
        });
        expect(badgeLook(resolveRef("agent", "3fa1c2e0", src)).dot).toBe("asking");
        expect(badgeLook(resolveRef("agent", "3fa1c2ff", src)).dot).toBeNull();
        expect(badgeLook(resolveRef("run", "071a8e3b", src))).toEqual({
            frame: "border-mark-run-line bg-mark-run-soft",
            mark: "run",
            dot: null,
        });
        expect(badgeLook(resolveRef("council", "c41d9e02", src)).mark).toBe("council");
    });
    it("gives an agent of an unknown runtime runtimeMeta's fallback frame", () => {
        expect(badgeLook(resolveRef("agent", "9a9a9a9a", src))).toEqual({
            frame: "border-border bg-surface-hover",
            mark: "runtime",
            dot: null,
        });
    });
    it("draws an unresolved token dashed with no mark", () => {
        expect(badgeLook(resolveRef("agent", "deadbeef", src))).toEqual({
            frame: "border-dashed border-edge-strong bg-transparent text-muted",
            mark: null,
            dot: null,
        });
    });
    it("titles a badge with name, kind, short id and state, or the reason", () => {
        expect(refTitle(resolveRef("agent", "3fa1c2e0", src))).toBe(
            "api-tests · agent 3fa1c2e0 · asking (click to open)"
        );
        expect(refTitle(resolveRef("run", "071a8e3b", src))).toBe(
            "Close the tree's picked rows · run 071a8e3b (click to open)"
        );
        expect(refTitle(resolveRef("agent", "deadbeef", src))).toBe("No agent deadbeef is open");
    });
    it("leaves '(click to open)' off a title when the badge does not open (the message box's)", () => {
        expect(refTitle(resolveRef("agent", "3fa1c2e0", src), { opens: false })).toBe("api-tests · agent 3fa1c2e0 · asking");
        expect(refTitle(resolveRef("run", "071a8e3b", src), { opens: false })).toBe(
            "Close the tree's picked rows · run 071a8e3b"
        );
        // opens: true is the default, and an unresolved title is the reason either way
        expect(refTitle(resolveRef("agent", "3fa1c2e0", src), { opens: true })).toBe(
            "api-tests · agent 3fa1c2e0 · asking (click to open)"
        );
        expect(refTitle(resolveRef("agent", "deadbeef", src), { opens: false })).toBe("No agent deadbeef is open");
    });
});

describe("session: and effort:", () => {
    it("resolves a conversation by id prefix, with its age, and an initiative by its oid, with its chunks", () => {
        expect(resolveRef("session", "9f31d0b4", src2)).toMatchObject({
            status: "resolved",
            name: "Fix CDP fails",
            meta: "3d",
            ageMs: 3 * 86_400_000,
        });
        expect(resolveRef("effort", "e9b20f17", src2)).toMatchObject({
            status: "resolved",
            id: "e9b20f17-7777-4a4a-8b8b-000000000007",
            name: "Chat polish",
            meta: "4/9",
            metaDone: false,
        });
        expect(resolveRef("effort", "4c0aa7d3", src2)).toMatchObject({ meta: "6/6", metaDone: true });
    });
    it("resolves both without a project", () => {
        expect(resolveRef("session", "9f31d0b4", { ...src2, project: "" }).status).toBe("resolved");
        expect(resolveRef("effort", "e9b20f17", { ...src2, project: "" }).status).toBe("resolved");
    });
    it("says why it cannot resolve them", () => {
        expect(resolveRef("session", "77aa01fe", src2)).toEqual({
            status: "unresolved",
            reason: "No conversation 77aa01fe in the loaded history",
        });
        expect(resolveRef("effort", "deadbeef", src2)).toEqual({
            status: "unresolved",
            reason: "No initiative deadbeef",
        });
    });
    it("names the kind in the plural when an id starts several", () => {
        const twin = {
            ...src2,
            sessions: [...(src2.sessions ?? []), { ...(src2.sessions ?? [])[0], id: "9f31d0b4-ffff" }],
        };
        expect(resolveRef("session", "9f31d0", twin)).toEqual({
            status: "unresolved",
            reason: "session:9f31d0 names 2 conversations",
        });
        const twins = {
            ...src2,
            efforts: [...(src2.efforts ?? []), { oref: "effort:e9b20f17-aaaa", title: "Other", done: 0, total: 0 }],
        };
        expect(resolveRef("effort", "e9b20f", twins)).toEqual({
            status: "unresolved",
            reason: "effort:e9b20f names 2 initiatives",
        });
    });
    it("names a conversation by its project, then its id, when it has no task", () => {
        const bare = (s: Partial<NonNullable<RefSources["sessions"]>[number]>): RefSources => ({
            ...src2,
            sessions: [{ ...(src2.sessions ?? [])[0], task: "", ...s }],
        });
        expect(resolveRef("session", "9f31d0b4", bare({}))).toMatchObject({ name: "arcterm" });
        expect(resolveRef("session", "9f31d0b4", bare({ projectname: "" }))).toMatchObject({ name: "9f31d0b4" });
    });
    it("reads missing sources as none, so a caller that passes no history still compiles and resolves nothing", () => {
        expect(resolveRef("session", "9f31d0b4", src).status).toBe("unresolved");
        expect(resolveRef("effort", "e9b20f17", src).status).toBe("unresolved");
    });
    it("draws both neutral, told apart by mark", () => {
        expect(badgeLook(resolveRef("session", "9f31d0b4", src2))).toEqual({
            frame: "border-edge-mid bg-surface",
            mark: "session",
            dot: null,
        });
        expect(badgeLook(resolveRef("effort", "e9b20f17", src2)).mark).toBe("effort");
    });
    it("titles them", () => {
        expect(refTitle(resolveRef("session", "9f31d0b4", src2))).toBe(
            "Fix CDP fails · conversation 9f31d0b4 · claude · arcterm · 3d ago (click to open)"
        );
        expect(refTitle(resolveRef("effort", "e9b20f17", src2))).toBe(
            "Chat polish · initiative e9b20f17 · 4 of 9 chunks done (click to open)"
        );
        expect(refTitle(resolveRef("effort", "e9b20f17", src2), { opens: false })).toBe(
            "Chat polish · initiative e9b20f17 · 4 of 9 chunks done"
        );
    });
});

describe("codeRef", () => {
    it("reads a code span that is a whole reference token, or a bare 8-hex id or uuid", () => {
        expect(codeRef("agent:7cd99627")).toEqual({ kind: "agent", id: "7cd99627" });
        expect(codeRef("run:071a8e3b")).toEqual({ kind: "run", id: "071a8e3b" });
        expect(codeRef("4E6EA128")).toEqual({ id: "4e6ea128" });
        expect(codeRef("071a8e3b-4444-4a4a-8b8b-000000000004")).toEqual({ id: "071a8e3b-4444-4a4a-8b8b-000000000004" });
    });
    it("leaves other code alone: commit hashes of 7 or 9 characters, words, a token with more text", () => {
        expect(codeRef("4cd6c17")).toBeNull();
        expect(codeRef("ac030f667")).toBeNull();
        expect(codeRef("deadbeefcafe")).toBeNull();
        expect(codeRef("task check:ts")).toBeNull();
        expect(codeRef("wsh read agent:7cd99627")).toBeNull();
        expect(codeRef("@agent:7cd99627")).toBeNull();
        expect(codeRef("decoded1")).toBeNull();
    });
});

describe("resolveBareRef", () => {
    it("names an open agent first, then a run, then a council", () => {
        const agent = resolveBareRef("7cd99627", src);
        expect(agent).toMatchObject({ status: "resolved", kind: "agent", name: "chat-commit-card" });
        expect(resolveBareRef("071a8e3b", src)).toMatchObject({ status: "resolved", kind: "run" });
        const council = resolveBareRef("c41d9e02", src);
        expect(council).toMatchObject({ status: "resolved", kind: "council", name: "Chat compact work" });
    });
    it("never names a past conversation or an initiative, and an unknown id stays unresolved", () => {
        expect(resolveBareRef("9f31d0b4", src2).status).toBe("unresolved");
        expect(resolveBareRef("e9b20f17", src2).status).toBe("unresolved");
        expect(resolveBareRef("12345678", src).status).toBe("unresolved");
    });
});

describe("board:", () => {
    const withBoards: RefSources = {
        ...src,
        project: "",
        boards: [
            { id: "3f2a1b9c", name: "huong-luan-van", project: "thesis" },
            { id: "3f2a7777", name: "Deploy", project: "arcterm" },
        ],
    };

    it("is a reference in text, as the picker writes it", () => {
        expect(refSpans("vẽ lại board:3f2a1b9c nhé")).toMatchObject([{ kind: "board", id: "3f2a1b9c", raw: "board:3f2a1b9c" }]);
    });

    it("resolves from any project's boards, a chat outside a project's too", () => {
        const r = resolveRef("board", "3f2a1b9c", withBoards);
        expect(r).toMatchObject({ status: "resolved", kind: "board", id: "3f2a1b9c", name: "huong-luan-van", project: "thesis" });
        expect(badgeLook(r)).toMatchObject({ mark: "board", dot: null });
        expect(refTitle(r)).toBe("huong-luan-van · board 3f2a1b9c · thesis (click to open)");
        expect(resolveRef("board", "3f2a", withBoards)).toMatchObject({ status: "unresolved", reason: "board:3f2a names 2 boards" });
        expect(resolveRef("board", "00000000", withBoards)).toMatchObject({ status: "unresolved", reason: "No board 00000000" });
    });
});
