import { describe, expect, it } from "vitest";
import {
    chatItems,
    chatTab,
    composerFor,
    endedText,
    headerStateLabel,
    liveElapsed,
    permissionCard,
    replyTree,
    rowStateLabel,
    webHref,
} from "./static/chatmodel.js";

const MIN = 60 * 1000;
const NOW = 1_800_000_000_000;
const agent = (state, over = {}) => ({
    tab: "tab-1",
    name: "phone-chat",
    project: "waveterm",
    runtime: "claude",
    state,
    since: NOW - 4 * MIN,
    line: "Wants to run: ssh deploy@siem-236",
    ...over,
});
const editDetail = {
    kind: "edit",
    files: [
        { path: "a.go", badge: "M", adds: 12, dels: 2, lines: [] },
        { path: "b.go", badge: "A", adds: 6, dels: 0, lines: [] },
    ],
};

const text = (value) => ({ type: "text", value });
const para = (...children) => ({ type: "paragraph", children });
// a reply's blocks, or the inline nodes of its one paragraph
const blocks = (md) => replyTree(md).children;
const inline = (md) => blocks(md)[0].children;

describe("replyTree", () => {
    it("keeps a paragraph's line breaks and splits paragraphs on a blank line", () => {
        expect(blocks("one\ntwo\n\nthree")).toEqual([para(text("one\ntwo")), para(text("three"))]);
    });

    it("reads a fenced block with its language, as before", () => {
        expect(blocks("Run this:\n```bash\ngo test ./pkg/x\n```\nThen commit.")).toEqual([
            para(text("Run this:")),
            { type: "code", lang: "bash", meta: null, value: "go test ./pkg/x" },
            para(text("Then commit.")),
        ]);
        expect(blocks("```\nplain\n```")).toEqual([{ type: "code", lang: null, meta: null, value: "plain" }]);
    });

    it("runs an unclosed fence to the end as code", () => {
        expect(blocks("Start:\n```js\nconst a = 1;\nconst b = 2;")).toEqual([
            para(text("Start:")),
            { type: "code", lang: "js", meta: null, value: "const a = 1;\nconst b = 2;" },
        ]);
    });

    it("reads bold, italic, inline code and struck text", () => {
        expect(inline("**Deny** it, *then* run `go vet` ~~twice~~")).toEqual([
            { type: "strong", children: [text("Deny")] },
            text(" it, "),
            { type: "emphasis", children: [text("then")] },
            text(" run "),
            { type: "inlineCode", value: "go vet" },
            text(" "),
            { type: "delete", children: [text("twice")] },
        ]);
    });

    it("reads headings, a quote and a rule", () => {
        expect(blocks("## Plan\n\n> careful\n\n---")).toMatchObject([
            { type: "heading", depth: 2, children: [text("Plan")] },
            { type: "blockquote", children: [para(text("careful"))] },
            { type: "thematicBreak" },
        ]);
    });

    it("reads bulleted and numbered lists, one nested in the other, and task boxes", () => {
        const [list] = blocks("- one\n  1. first\n  2. second\n- [x] done");
        expect(list).toMatchObject({ type: "list", ordered: false });
        const [one, done] = list.children;
        expect(one.children[0]).toEqual(para(text("one")));
        expect(one.children[1]).toMatchObject({ type: "list", ordered: true, start: 1 });
        expect(one.children[1].children.map((li) => li.children[0])).toEqual([
            para(text("first")),
            para(text("second")),
        ]);
        expect(done).toMatchObject({ type: "listItem", checked: true, children: [para(text("done"))] });
        expect(blocks("3. third")[0]).toMatchObject({ type: "list", ordered: true, start: 3 });
    });

    it("reads a pipe table with its alignment", () => {
        expect(blocks("| a | b |\n|:-|-:|\n| `c` | d |")).toEqual([
            {
                type: "table",
                align: ["left", "right"],
                children: [
                    {
                        type: "tableRow",
                        children: [
                            { type: "tableCell", children: [text("a")] },
                            { type: "tableCell", children: [text("b")] },
                        ],
                    },
                    {
                        type: "tableRow",
                        children: [
                            { type: "tableCell", children: [{ type: "inlineCode", value: "c" }] },
                            { type: "tableCell", children: [text("d")] },
                        ],
                    },
                ],
            },
        ]);
    });

    it("links only http(s) addresses; any other link is its text", () => {
        expect(inline("[docs](https://ex.com/a) and www.ex.com")).toEqual([
            { type: "link", url: "https://ex.com/a", children: [text("docs")] },
            text(" and "),
            { type: "link", url: "http://www.ex.com/", children: [text("www.ex.com")] },
        ]);
        expect(inline("[x](javascript:alert(1)) [y](pkg/x.go) [z](data:text/html,hi)")).toEqual([text("x y z")]);
    });

    it("webHref passes only http and https", () => {
        expect(webHref("https://ex.com")).toBe("https://ex.com/");
        expect(webHref("HTTP://ex.com/a?b")).toBe("http://ex.com/a?b");
        expect(webHref("javascript:alert(1)")).toBeNull();
        expect(webHref("mailto:a@b.c")).toBeNull();
        expect(webHref("/relative")).toBeNull();
    });

    it("gives markup back as the exact text it was, and an image as its alt text", () => {
        const reply = "<img src=x onerror=alert(1)>";
        expect(blocks(reply)).toEqual([para(text(reply))]);
        expect(inline("a <b>bold</b> ![logo](https://ex.com/l.png)")).toEqual([text("a <b>bold</b> logo")]);
    });

    it("draws ==...== as a highlight, across inline marks", () => {
        expect(inline("Read ==this **now**==, then go.")).toEqual([
            text("Read "),
            { type: "highlight", children: [text("this "), { type: "strong", children: [text("now")] }] },
            text(", then go."),
        ]);
        expect(blocks("- ==one==")[0].children[0].children[0].children).toEqual([
            { type: "highlight", children: [text("one")] },
        ]);
    });

    it("leaves == as written where it marks nothing", () => {
        expect(inline("if x == y and z == w")).toEqual([text("if x == y and z == w")]);
        expect(inline("==open only")).toEqual([text("==open only")]);
        expect(inline("a ==== b")).toEqual([text("a ==== b")]);
        expect(inline("`a == b` ==c==")).toEqual([
            { type: "inlineCode", value: "a == b" },
            text(" "),
            { type: "highlight", children: [text("c")] },
        ]);
        expect(blocks("```\n==x==\n```")[0].value).toBe("==x==");
    });

    it("gives nothing for an empty reply", () => {
        expect(blocks("")).toEqual([]);
        expect(blocks(undefined)).toEqual([]);
    });
});

describe("chatItems", () => {
    it("draws users, replies and actions, and leaves out other entries", () => {
        const items = chatItems([
            { kind: "user", text: "add a heartbeat" },
            { kind: "action", verb: "read", target: "handler.go", summary: "193 lines" },
            { kind: "action", verb: "ran", target: "go test ./pkg/remotemode", outcome: "ok", summary: "31 passing" },
            { kind: "action", verb: "ran", target: "go vet", outcome: "fail" },
            { kind: "compaction" },
            { kind: "message", text: "Done." },
        ]);
        expect(items).toEqual([
            { kind: "user", text: "add a heartbeat" },
            { kind: "action", mark: "pending", verb: "Read", target: "handler.go", summary: "193 lines" },
            { kind: "action", mark: "ok", verb: "Ran", target: "go test ./pkg/remotemode", summary: "31 passing" },
            { kind: "action", mark: "fail", verb: "Ran", target: "go vet", summary: "" },
            { kind: "reply", tree: { type: "root", children: [para(text("Done."))] } },
        ]);
    });

    it("carries an edit's adds and dels from its detail", () => {
        const [item] = chatItems([{ kind: "action", verb: "edited", target: "handler.go", detail: editDetail }]);
        expect(item).toMatchObject({ kind: "action", verb: "Edited", target: "handler.go", adds: 18, dels: 2 });
    });

    it("marks an action with no outcome pending", () => {
        const [item] = chatItems([{ kind: "action", verb: "ran", target: "ssh deploy@siem-236" }]);
        expect(item.mark).toBe("pending");
    });

    it("gives a duration as the summary when there is no other", () => {
        const [item] = chatItems([
            { kind: "action", verb: "ran", target: "docker build", outcome: "ok", durationMs: 130_000 },
        ]);
        expect(item.summary).toBe("2m 10s");
    });
});

describe("liveElapsed", () => {
    const START = Date.parse("2026-11-03T12:00:00Z");

    it("counts a running call from its start", () => {
        const [item] = chatItems([{ kind: "action", verb: "ran", target: "go test", startedTs: START }]);
        expect(liveElapsed(item, START + 48_000)).toBe("48s");
        expect(liveElapsed(item, START + 130_000)).toBe("2m 10s");
        expect(liveElapsed(item, START + 3_900_000)).toBe("1h 5m");
    });

    it("shows at least a second when the phone's clock is behind", () => {
        const [item] = chatItems([{ kind: "action", verb: "ran", target: "go test", startedTs: START }]);
        expect(liveElapsed(item, START - 5_000)).toBe("1s");
    });

    it("is empty when the start is unknown", () => {
        const [item] = chatItems([{ kind: "action", verb: "ran", target: "go test" }]);
        expect(liveElapsed(item, START)).toBe("");
    });
});

describe("permissionCard", () => {
    it("shows the whole pending Bash command", () => {
        const cmd = "ssh deploy@siem-236 'sudo systemctl restart ingest && journalctl -u ingest -n 50 --no-pager'";
        const entries = [
            { kind: "action", verb: "ran", target: "docker push", outcome: "ok" },
            { kind: "message", text: "Restarting next." },
            { kind: "action", verb: "ran", target: cmd },
        ];
        expect(permissionCard(entries, agent("permission"))).toEqual({
            tool: "Bash",
            ask: "Wants to run a command",
            target: cmd,
        });
    });

    it("shows a pending edit", () => {
        const entries = [{ kind: "action", verb: "edited", target: "handler.go" }];
        expect(permissionCard(entries, agent("permission"))).toEqual({
            tool: "Edit",
            ask: "Wants to edit a file",
            target: "handler.go",
        });
    });

    it("names another tool by its verb", () => {
        const entries = [{ kind: "action", verb: "webfetch", target: "https://example.test" }];
        expect(permissionCard(entries, agent("permission"))).toEqual({
            tool: "webfetch",
            ask: "Wants to use a tool",
            target: "https://example.test",
        });
    });

    it("falls back to the row's line when no action is pending", () => {
        const entries = [{ kind: "action", verb: "ran", target: "docker push", outcome: "ok" }];
        expect(permissionCard(entries, agent("permission"))).toEqual({
            tool: "",
            ask: "Wants your approval",
            target: "Wants to run: ssh deploy@siem-236",
        });
        expect(permissionCard([], agent("permission")).ask).toBe("Wants your approval");
    });
});

describe("composerFor", () => {
    it("messages an idle agent", () => {
        expect(composerFor(agent("idle"))).toEqual({
            label: "Message phone-chat",
            placeholder: "Message phone-chat",
            disabled: false,
            stop: false,
            permission: false,
        });
    });

    it("adds to a working agent's turn, with Stop", () => {
        expect(composerFor(agent("working"))).toEqual({
            label: "Add to this turn",
            placeholder: "Add to this turn",
            disabled: false,
            stop: true,
            permission: false,
        });
    });

    it("denies with a reason during a permission wait", () => {
        expect(composerFor(agent("permission"))).toEqual({
            label: "Deny and tell phone-chat why",
            placeholder: "Deny and say what to do instead",
            disabled: false,
            stop: false,
            permission: true,
        });
    });

    it("sends needs input to the desk with the box disabled", () => {
        expect(composerFor(agent("input"))).toEqual({
            label: "Message phone-chat",
            placeholder: "Message phone-chat",
            disabled: true,
            note: "Needs input · answer it at the desk",
            stop: false,
            permission: false,
        });
    });

    it("sends a question to the Questions list with the box disabled", () => {
        expect(composerFor(agent("asking"))).toEqual({
            label: "Message phone-chat",
            placeholder: "Message phone-chat",
            disabled: true,
            note: "Asking you · answer it under Questions",
            stop: false,
            permission: false,
        });
    });
});

describe("state labels", () => {
    const cases = [
        ["working", NOW - 1 * MIN, "working 1m", "working 1m"],
        ["idle", NOW - 6 * MIN, "idle 6m", "idle · replied 6m ago"],
        ["permission", NOW - 4 * MIN, "needs approval", "needs approval · 4m"],
        ["input", NOW - 4 * MIN, "needs input", "needs input · 4m"],
        ["asking", NOW - 3 * MIN, "asking you", "asking you · 3m"],
    ];
    it.each(cases)("labels %s", (state, since, row, header) => {
        expect(rowStateLabel(agent(state, { since }), NOW)).toBe(row);
        expect(headerStateLabel(agent(state, { since }), NOW)).toBe(header);
    });

    it("leaves the age out when since is unknown", () => {
        expect(rowStateLabel(agent("working", { since: 0 }), NOW)).toBe("working");
        expect(headerStateLabel(agent("idle", { since: 0 }), NOW)).toBe("idle");
    });
});

describe("endedText", () => {
    it("says why the agent is back at the desk", () => {
        expect(endedText("phone-chat", "taken")).toBe(
            "phone-chat was taken back, here or at the desk, so it no longer takes messages from the phone. Hand it over again from the Agent surface."
        );
        expect(endedText("phone-chat", "exited")).toBe("phone-chat exited, so it is off the phone.");
    });

    it("reads an unknown reason as taken", () => {
        expect(endedText("x", "off")).toBe(endedText("x", "taken"));
    });
});

describe("chatTab", () => {
    it("reads the tab from an agent hash", () => {
        expect(chatTab("#agent/tab-1")).toBe("tab-1");
        expect(chatTab("#agent/a%2Fb")).toBe("a/b");
    });

    it("is null for anything else", () => {
        expect(chatTab("")).toBeNull();
        expect(chatTab("#agent/")).toBeNull();
        expect(chatTab("#other/tab-1")).toBeNull();
    });
});
