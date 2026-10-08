// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    filterChannels,
    highlightSegments,
    mentionCandidates,
    partitionChannels,
    promoteConsultText,
    resolveTargetChannel,
} from "./channelderive";
import type { RosterEntry } from "./channelmessages";

const roster = (...names: string[]): RosterEntry[] => names.map((name, i) => ({ id: `t${i}`, name }));

describe("mentionCandidates", () => {
    it("includes installed runtimes tagged as runtime", () => {
        const c = mentionCandidates(["claude", "codex"], []);
        expect(c).toContainEqual({ name: "claude", kind: "runtime" });
        expect(c).toContainEqual({ name: "codex", kind: "runtime" });
    });

    it("includes live roster names tagged as agent", () => {
        expect(mentionCandidates([], roster("api-auth"))).toContainEqual({ name: "api-auth", kind: "agent" });
    });

    it("orders runtimes, then agents", () => {
        const names = mentionCandidates(["claude"], roster("api-auth")).map((c) => c.name);
        expect(names).toEqual(["claude", "api-auth"]);
    });

    it("offers agy as a runtime mention", () => {
        expect(mentionCandidates(["agy"], [])).toContainEqual({ name: "agy", kind: "runtime" });
    });

    it("no longer offers a reserved jarvis handle", () => {
        expect(mentionCandidates([], []).map((c) => c.name)).not.toContain("jarvis");
    });

    it("dedupes case-insensitively, keeping the runtime over a same-named agent", () => {
        const c = mentionCandidates(["claude"], roster("Claude"));
        expect(c.filter((x) => x.name.toLowerCase() === "claude")).toEqual([{ name: "claude", kind: "runtime" }]);
    });
});

describe("highlightSegments", () => {
    // "api-auth" is a roster worker: a known mention target that is not a dispatch runtime.
    const known = new Set(["claude", "codex", "api-auth"]);
    const runtimes = new Set(["claude", "codex"]);

    it("returns an empty array for empty text", () => {
        expect(highlightSegments("", known, runtimes)).toEqual([]);
    });

    it("returns a single plain segment when there is no mention", () => {
        expect(highlightSegments("just text", known, runtimes)).toEqual([{ text: "just text", kind: "text" }]);
    });

    it("marks a leading known @token as a mention", () => {
        expect(highlightSegments("@claude fix it", known, runtimes)).toEqual([
            { text: "@claude", kind: "mention" },
            { text: " fix it", kind: "text" },
        ]);
    });

    it("does not highlight an unknown @token", () => {
        expect(highlightSegments("@nope hi", known, runtimes)).toEqual([{ text: "@nope hi", kind: "text" }]);
    });

    it("does not highlight an @ glued to a preceding non-space", () => {
        expect(highlightSegments("a@claude", known, runtimes)).toEqual([{ text: "a@claude", kind: "text" }]);
    });

    it("matches the known target case-insensitively", () => {
        expect(highlightSegments("@Claude go", known, runtimes)).toEqual([
            { text: "@Claude", kind: "mention" },
            { text: " go", kind: "text" },
        ]);
    });

    it("highlights a leading 'ask' as a command when a runtime consult follows", () => {
        expect(highlightSegments("ask @codex now", known, runtimes)).toEqual([
            { text: "ask", kind: "command" },
            { text: " ", kind: "text" },
            { text: "@codex", kind: "mention" },
            { text: " now", kind: "text" },
        ]);
    });

    it("does not treat 'ask' as a command without a runtime consult", () => {
        expect(highlightSegments("ask me anything", known, runtimes)).toEqual([
            { text: "ask me anything", kind: "text" },
        ]);
    });

    it("does not treat 'ask' as a command when the target is not a runtime", () => {
        // api-auth is a known mention target but not a dispatch runtime -> not a consult
        expect(highlightSegments("ask @api-auth hey", known, runtimes)).toEqual([
            { text: "ask ", kind: "text" },
            { text: "@api-auth", kind: "mention" },
            { text: " hey", kind: "text" },
        ]);
    });

    it("does not mistake 'asking' for the ask command", () => {
        expect(highlightSegments("asking @codex politely", known, runtimes)).toEqual([
            { text: "asking ", kind: "text" },
            { text: "@codex", kind: "mention" },
            { text: " politely", kind: "text" },
        ]);
    });
});

describe("filterChannels", () => {
    const ch = (name: string): Channel => ({ oid: name, name, createdts: 0, messages: [] }) as unknown as Channel;
    const list = [ch("waveterm"), ch("cdp-flow"), ch("Wave-API")];
    it("returns the list unchanged for a blank query", () => {
        expect(filterChannels(list, "  ")).toHaveLength(3);
    });
    it("matches case-insensitively on a substring", () => {
        expect(filterChannels(list, "wave").map((c) => c.name)).toEqual(["waveterm", "Wave-API"]);
    });
    it("returns empty when nothing matches", () => {
        expect(filterChannels(list, "zzz")).toHaveLength(0);
    });
});

describe("promoteConsultText", () => {
    it("composes an @runtime dispatch from a consult question", () => {
        expect(promoteConsultText("claude", "how do I fix the auth race?")).toBe("@claude how do I fix the auth race?");
    });
    it("trims surrounding whitespace on the question", () => {
        expect(promoteConsultText("codex", "  do the thing  ")).toBe("@codex do the thing");
    });
});

describe("partitionChannels", () => {
    const ch = (name: string, archived?: boolean): Channel =>
        ({ oid: name, name, createdts: 0, messages: [], meta: archived ? { archived: true } : {} }) as unknown as Channel;
    it("puts everything in active when nothing is archived", () => {
        const { active, archived } = partitionChannels([ch("a"), ch("b")]);
        expect(active.map((c) => c.name)).toEqual(["a", "b"]);
        expect(archived).toHaveLength(0);
    });
    it("splits archived out of active, preserving order", () => {
        const { active, archived } = partitionChannels([ch("a"), ch("b", true), ch("c")]);
        expect(active.map((c) => c.name)).toEqual(["a", "c"]);
        expect(archived.map((c) => c.name)).toEqual(["b"]);
    });
    it("composes with filterChannels (filter first, then partition)", () => {
        const list = [ch("wave"), ch("wave-old", true), ch("other")];
        const { active, archived } = partitionChannels(filterChannels(list, "wave"));
        expect(active.map((c) => c.name)).toEqual(["wave"]);
        expect(archived.map((c) => c.name)).toEqual(["wave-old"]);
    });
});

const ch = (oid: string, projectpath: string): Channel => ({ oid, projectpath } as Channel);

describe("resolveTargetChannel", () => {
    it("returns the first channel matching the project path", () => {
        const channels = [ch("c1", "/repo/a"), ch("c2", "/repo/b"), ch("c3", "/repo/b")];
        expect(resolveTargetChannel(channels, "/repo/b")?.oid).toBe("c2");
    });
    it("ignores a trailing slash on either side", () => {
        expect(resolveTargetChannel([ch("c1", "/repo/a/")], "/repo/a")?.oid).toBe("c1");
        expect(resolveTargetChannel([ch("c1", "/repo/a")], "/repo/a/")?.oid).toBe("c1");
    });
    it("matches across path-separator styles (Windows channel path vs canonPath report path)", () => {
        // Channels store the registry path verbatim (backslashes on Windows); radar report paths are
        // canonPath'd to forward slashes. The compare must normalize separators or the handoff never lands.
        expect(resolveTargetChannel([ch("c1", "C:\\Users\\me\\repo")], "C:/Users/me/repo")?.oid).toBe("c1");
        expect(resolveTargetChannel([ch("c1", "C:/Users/me/repo")], "C:\\Users\\me\\repo")?.oid).toBe("c1");
    });
    it("returns undefined when nothing matches or the path is missing", () => {
        expect(resolveTargetChannel([ch("c1", "/repo/a")], "/repo/z")).toBeUndefined();
        expect(resolveTargetChannel([ch("c1", "/repo/a")], undefined)).toBeUndefined();
    });
});
