import { describe, expect, it } from "vitest";
import {
    canMarkDecided,
    canMerge,
    groupIdeas,
    IDEA_GROUPS,
    ideaCounts,
    ideaKindLabel,
    ideaKindOf,
    ideaMeta,
    ideaSections,
    ideaTip,
    isFresh,
    planEdit,
    pruneChecked,
    sectionFoldKey,
    sectionOpen,
    selectionLabel,
    sessionIdFromTranscript,
    toggleChecked,
    validSessionId,
} from "./ideasmodel";

const idea = (id: string, kind: string, ts: number, extra: Partial<Idea> = {}): Idea => ({
    id,
    text: `text ${id}`,
    kind,
    by: "agent",
    turn: 2,
    ts,
    ...extra,
});

const session = (ideas: Idea[], seenat = 0): SessionIdeas => ({
    sessionid: "s1",
    seenat,
    prompts: 0,
    lastideaprompt: 0,
    nudgedat: 0,
    nextid: ideas.length + 1,
    ideas,
});

describe("sessionIdFromTranscript", () => {
    it("is the file name without .jsonl, on either slash", () => {
        expect(sessionIdFromTranscript("C:\\Users\\me\\.claude\\projects\\p\\0f6b-44c5.jsonl")).toBe("0f6b-44c5");
        expect(sessionIdFromTranscript("/home/me/.claude/projects/p/0f6b-44c5.jsonl")).toBe("0f6b-44c5");
        expect(sessionIdFromTranscript("C:/Users/me/p\\mixed/abc_1.jsonl")).toBe("abc_1");
        expect(sessionIdFromTranscript("abc.jsonl")).toBe("abc");
    });
    it("keeps a name with no .jsonl as it is", () => {
        expect(sessionIdFromTranscript("/x/y/session-9")).toBe("session-9");
    });
    it("is null for no path, or a path that names no file", () => {
        expect(sessionIdFromTranscript(undefined)).toBeNull();
        expect(sessionIdFromTranscript("")).toBeNull();
        expect(sessionIdFromTranscript("/x/y/")).toBeNull();
        expect(sessionIdFromTranscript("/x/.jsonl")).toBeNull();
    });
});

describe("validSessionId", () => {
    it("accepts what ideastore does: a uuid or another word of letters, digits, - and _", () => {
        expect(validSessionId("0f6b44c5-d8ca-46bc-8391-11bf4a4ee578")).toBe(true);
        expect(validSessionId("ideas-fixture")).toBe(true);
        expect(validSessionId("a_b")).toBe(true);
    });
    it("refuses an empty id, a path piece, other characters and over 128", () => {
        expect(validSessionId(null)).toBe(false);
        expect(validSessionId("")).toBe(false);
        expect(validSessionId("../x")).toBe(false);
        expect(validSessionId("2026-10-14T01:02:03_abc")).toBe(false);
        expect(validSessionId("a".repeat(129))).toBe(false);
        expect(validSessionId("a".repeat(128))).toBe(true);
    });
});

describe("groupIdeas", () => {
    const s = session([
        idea("i1", "decision", 100),
        idea("i2", "idea", 200),
        idea("i3", "question", 300),
        idea("i4", "idea", 400),
        idea("i5", "decision", 500),
        idea("i6", "idea", 600, { dropped: true }),
    ]);
    it("splits by kind, newest first in each", () => {
        const g = groupIdeas(s);
        expect(g.decided.map((i) => i.id)).toEqual(["i5", "i1"]);
        expect(g.ideas.map((i) => i.id)).toEqual(["i4", "i2"]);
        expect(g.open.map((i) => i.id)).toEqual(["i3"]);
    });
    it("puts a dropped idea only in dropped", () => {
        const g = groupIdeas(s);
        expect(g.dropped.map((i) => i.id)).toEqual(["i6"]);
        expect([...g.decided, ...g.ideas, ...g.open].some((i) => i.id === "i6")).toBe(false);
    });
    it("orders ideas added in one millisecond by their ids, newest first", () => {
        const g = groupIdeas(session([idea("i2", "idea", 100), idea("i10", "idea", 100), idea("i3", "idea", 100)]));
        expect(g.ideas.map((i) => i.id)).toEqual(["i10", "i3", "i2"]);
    });
    it("files an unknown kind under ideas, and does not reorder the input", () => {
        const input = session([idea("i1", "odd", 1), idea("i2", "decision", 2)]);
        const before = input.ideas.map((i) => i.id);
        expect(groupIdeas(input).ideas.map((i) => i.id)).toEqual(["i1"]);
        expect(input.ideas.map((i) => i.id)).toEqual(before);
    });
    it("reads no list, or a list of null, as empty", () => {
        expect(groupIdeas(null)).toEqual({ decided: [], ideas: [], open: [], dropped: [] });
        expect(groupIdeas({ ...s, ideas: null as unknown as Idea[] }).ideas).toEqual([]);
    });
});

describe("ideaCounts and isFresh", () => {
    const s = session(
        [
            idea("i1", "decision", 100),
            idea("i2", "idea", 200),
            idea("i3", "idea", 300),
            idea("i4", "question", 400, { dropped: true }),
        ],
        200
    );
    it("counts the live ideas, and those added after seenat as fresh", () => {
        expect(ideaCounts(s)).toEqual({ live: 3, fresh: 1 });
    });
    it("an idea added at the instant of seenat is read", () => {
        expect(isFresh(idea("i2", "idea", 200), 200)).toBe(false);
        expect(isFresh(idea("i3", "idea", 201), 200)).toBe(true);
    });
    it("a dropped idea is never fresh, so it never counts", () => {
        expect(isFresh(idea("i4", "question", 400, { dropped: true }), 200)).toBe(false);
    });
    it("everything is fresh until the list is first marked read (seenat 0), and an absent list counts nothing", () => {
        expect(ideaCounts({ ...s, seenat: 0 })).toEqual({ live: 3, fresh: 3 });
        expect(ideaCounts(null)).toEqual({ live: 0, fresh: 0 });
        expect(ideaCounts(session([]))).toEqual({ live: 0, fresh: 0 });
    });
});

describe("ideaMeta", () => {
    it("names the turn and the author", () => {
        expect(ideaMeta(idea("i1", "idea", 1, { turn: 4 }))).toBe("turn 4 · agent");
        expect(ideaMeta(idea("i1", "idea", 1, { turn: 3, by: "you" }))).toBe("turn 3 · you");
    });
    it("leaves the turn out when it is not known", () => {
        expect(ideaMeta(idea("i1", "idea", 1, { turn: 0, by: "you" }))).toBe("you");
        expect(ideaMeta(idea("i1", "idea", 1, { turn: undefined }))).toBe("agent");
    });
    it("leads with the topic only when asked, and only when there is one", () => {
        const topical = idea("i1", "question", 1, { turn: 4, topic: "RAM" });
        expect(ideaMeta(topical)).toBe("turn 4 · agent");
        expect(ideaMeta(topical, true)).toBe("RAM · turn 4 · agent");
        expect(ideaMeta(idea("i2", "question", 1, { turn: 4 }), true)).toBe("turn 4 · agent");
        expect(ideaMeta(idea("i3", "question", 1, { turn: 0, by: "you", topic: " Layout " }), true)).toBe(
            "Layout · you"
        );
    });
});

describe("ideaSections", () => {
    const shape = (s: SessionIdeas) =>
        ideaSections(groupIdeas(s)).map((x) => [x.key, x.label, x.items.map((i) => i.id).join(","), x.topical]);

    it("is the three kind groups, in their order and without empty ones, while no live idea has a topic", () => {
        const s = session([
            idea("i1", "decision", 100),
            idea("i2", "question", 200),
            idea("i3", "decision", 300),
            idea("i4", "idea", 400, { topic: "RAM", dropped: true }),
        ]);
        expect(shape(s)).toEqual([
            ["decision", "Decided", "i3,i1", false],
            ["question", "Open", "i2", false],
        ]);
    });

    it("once one has a topic: Open, then each topic in the order it came up, decisions before ideas, then Other", () => {
        const s = session([
            idea("i1", "idea", 100, { topic: "Layout" }),
            idea("i2", "decision", 200, { topic: "RAM" }),
            idea("i3", "decision", 300, { topic: "Layout" }),
            idea("i4", "question", 400, { topic: "RAM" }),
            idea("i5", "idea", 500),
            idea("i6", "decision", 600, { topic: "Layout" }),
            idea("i7", "question", 700),
        ]);
        expect(shape(s)).toEqual([
            ["question", "Open", "i7,i4", true],
            ["topic", "Layout", "i6,i3,i1", true],
            ["topic", "RAM", "i2", true],
            ["other", "Other", "i5", true],
        ]);
    });

    it("takes a topic's spelling from its oldest idea and folds case and spaces", () => {
        const s = session([idea("i1", "decision", 100, { topic: "RAM" }), idea("i2", "idea", 200, { topic: " ram " })]);
        expect(shape(s)).toEqual([["topic", "RAM", "i1,i2", true]]);
    });

    it("leaves out a topic held only by questions, which sit in Open, and an empty Other", () => {
        const s = session([
            idea("i1", "question", 100, { topic: "Part 2" }),
            idea("i2", "decision", 200, { topic: "RAM" }),
        ]);
        expect(shape(s)).toEqual([
            ["question", "Open", "i1", true],
            ["topic", "RAM", "i2", true],
        ]);
    });

    it("ignores a dropped idea's topic", () => {
        const s = session([idea("i1", "decision", 100), idea("i2", "idea", 200, { topic: "RAM", dropped: true })]);
        expect(shape(s)).toEqual([["decision", "Decided", "i1", false]]);
    });
});

describe("folding sections", () => {
    const sections = (s: SessionIdeas) => ideaSections(groupIdeas(s));
    const opens = (s: SessionIdeas, overrides: Record<string, boolean> = {}) => {
        const all = sections(s);
        return all.map((x) => [x.label, sectionFoldKey(x), sectionOpen(x, all, overrides)]);
    };
    const topical = session([
        idea("i1", "idea", 100, { topic: "Layout" }),
        idea("i2", "decision", 200, { topic: "RAM" }),
        idea("i3", "question", 900, { topic: "Layout" }),
        idea("i4", "idea", 300),
        idea("i5", "idea", 400, { topic: " ram " }),
    ]);

    it("folds topics and Other only; Open and the kind groups always show", () => {
        expect(opens(topical).map(([label, key]) => [label, key])).toEqual([
            ["Open", null],
            ["Layout", "topic:layout"],
            ["RAM", "topic:ram"],
            ["Other", "other"],
        ]);
        const plain = session([idea("i1", "decision", 100), idea("i2", "idea", 200), idea("i3", "question", 300)]);
        expect(opens(plain).every(([, key, open]) => key == null && open)).toBe(true);
    });

    it("opens, by default, only the foldable section holding the newest idea (a question in Open does not count)", () => {
        expect(opens(topical).map(([label, , open]) => [label, open])).toEqual([
            ["Open", true],
            ["Layout", false],
            ["RAM", true],
            ["Other", false],
        ]);
    });

    it("breaks a tie on time by the newer id, as the rows sort", () => {
        const tie = session([idea("i1", "idea", 100, { topic: "Layout" }), idea("i2", "idea", 100, { topic: "RAM" })]);
        expect(opens(tie).map(([label, , open]) => [label, open])).toEqual([
            ["Layout", false],
            ["RAM", true],
        ]);
    });

    it("lets the user's fold or unfold win over the default", () => {
        const folded = opens(topical, { "topic:ram": false, other: true });
        expect(folded.map(([label, , open]) => [label, open])).toEqual([
            ["Open", true],
            ["Layout", false],
            ["RAM", false],
            ["Other", true],
        ]);
    });
});

describe("ideaTip", () => {
    it("is the whole text, then the meta on a line of its own", () => {
        expect(ideaTip(idea("i1", "idea", 1, { turn: 4, text: "Một ý dài" }), false, false)).toBe(
            "Một ý dài\nturn 4 · agent"
        );
    });
    it("names the topic for a row outside its section, and says new while the idea is", () => {
        const q = idea("i1", "question", 1, { turn: 6, topic: "Highlight", text: "Có cần không?" });
        expect(ideaTip(q, true, true)).toBe("Có cần không?\nHighlight · turn 6 · agent · new");
    });
});

describe("checking rows", () => {
    it("toggles an id in and out, keeping the order checked", () => {
        expect(toggleChecked([], "i1")).toEqual(["i1"]);
        expect(toggleChecked(["i1"], "i2")).toEqual(["i1", "i2"]);
        expect(toggleChecked(["i1", "i2"], "i1")).toEqual(["i2"]);
    });
    it("forgets a checked idea that was dropped or is gone, and keeps the same array when none is", () => {
        const s = session([idea("i1", "idea", 1), idea("i2", "idea", 2, { dropped: true })]);
        expect(pruneChecked(["i1", "i2", "i9"], s)).toEqual(["i1"]);
        const kept = ["i1"];
        expect(pruneChecked(kept, s)).toBe(kept);
    });
    it("merges only from two", () => {
        expect(canMerge(["i1"])).toBe(false);
        expect(canMerge(["i1", "i2"])).toBe(true);
    });
    it("labels the selection", () => {
        expect(selectionLabel(2)).toBe("2 selected");
    });
});

describe("canMarkDecided", () => {
    it("is false for a decision, true for an idea or a question", () => {
        expect(canMarkDecided(idea("i1", "decision", 1))).toBe(false);
        expect(canMarkDecided(idea("i1", "idea", 1))).toBe(true);
        expect(canMarkDecided(idea("i1", "question", 1))).toBe(true);
    });
});

describe("planEdit", () => {
    const i = idea("i1", "idea", 1);
    it("is null while the text is blank", () => {
        expect(planEdit(i, { text: "  \n ", kind: "idea" })).toBeNull();
    });
    it("holds only what changed, the text trimmed", () => {
        expect(planEdit(i, { text: "  new words ", kind: "idea" })).toEqual({ text: "new words" });
        expect(planEdit(i, { text: i.text, kind: "question" })).toEqual({ kind: "question" });
        expect(planEdit(i, { text: "x", kind: "decision" })).toEqual({ text: "x", kind: "decision" });
    });
    it("is empty (the box just closes) when nothing changed", () => {
        expect(planEdit(i, { text: ` ${i.text} `, kind: "idea" })).toEqual({});
    });
    it("reads an unknown stored kind as an idea", () => {
        expect(ideaKindOf(idea("i1", "odd", 1))).toBe("idea");
        expect(planEdit(idea("i1", "odd", 1), { text: "text i1", kind: "idea" })).toEqual({});
    });
});

describe("ideaKindLabel", () => {
    it("names the groups as the section does", () => {
        expect(ideaKindLabel("decision")).toBe("Decided");
        expect(ideaKindLabel("idea")).toBe("Ideas");
        expect(ideaKindLabel("question")).toBe("Open");
    });
});

describe("IDEA_GROUPS", () => {
    it("heads the groups Decided / Ideas / Open", () => {
        expect(IDEA_GROUPS.map((g) => g.label)).toEqual(["Decided", "Ideas", "Open"]);
    });
    it("words the edit box's kind choice as Decided / Idea / Open (the middle one is singular)", () => {
        expect(IDEA_GROUPS.map((g) => g.choiceLabel)).toEqual(["Decided", "Idea", "Open"]);
    });
});
