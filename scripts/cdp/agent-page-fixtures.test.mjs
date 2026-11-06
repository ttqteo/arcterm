import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    agentPage,
    assistantText,
    focusAgent,
    interrupted,
    makeQuiet,
    quietUntil,
    restoreRoster,
    setRoster,
    tabFixtures,
    taskNotification,
    toolResult,
    toolUse,
    usage,
    userText,
    writeSubagent,
    writeTranscript,
} from "./agent-page-fixtures.mjs";

const dirs = [];
const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), "arc-agent-fixtures-"));
    dirs.push(dir);
    return dir;
};
afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe("record builders", () => {
    it("each builder emits one parseable JSON line", () => {
        const lines = [
            userText("hi"),
            assistantText("hello"),
            toolUse("toolu_1", "Bash", { command: "ls" }),
            toolResult("toolu_1", "ok"),
            taskNotification({ taskId: "t1", toolUseId: "toolu_1", status: "completed", summary: "done" }),
            interrupted(),
            usage({ input: 1, output: 2 }),
        ];
        for (const line of lines) {
            expect(line).not.toContain("\n");
            const rec = JSON.parse(line);
            expect(rec.timestamp).toBeTruthy();
            expect(rec.cwd).toBeTruthy();
            expect(rec.sessionId).toBeTruthy();
        }
    });

    it("honours the cwd, sessionId and ts options", () => {
        const rec = JSON.parse(userText("hi", { cwd: "C:\\x", sessionId: "s1", ts: "2026-11-05T00:00:00.000Z" }));
        expect(rec).toMatchObject({ cwd: "C:\\x", sessionId: "s1", timestamp: "2026-11-05T00:00:00.000Z" });
    });

    it("taskNotification carries task-id, tool-use-id and status", () => {
        const text = JSON.parse(
            taskNotification({ taskId: "t1", toolUseId: "toolu_9", status: "killed", summary: "stopped" })
        ).message.content;
        expect(text).toContain("<task-notification>");
        expect(text).toContain("<task-id>t1</task-id>");
        expect(text).toContain("<tool-use-id>toolu_9</tool-use-id>");
        expect(text).toContain("<status>killed</status>");
        expect(text).toContain("<summary>stopped</summary>");
    });

    it("toolResult keeps toolUseResult", () => {
        const rec = JSON.parse(toolResult("toolu_1", "ack", { toolUseResult: { agentId: "a1" }, isError: true }));
        expect(rec.toolUseResult).toEqual({ agentId: "a1" });
        expect(rec.message.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1", is_error: true });
        expect(JSON.parse(toolResult("toolu_1", "ack"))).not.toHaveProperty("toolUseResult");
    });

    it("usage carries the token counts and model", () => {
        const rec = JSON.parse(usage({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, model: "m" }));
        expect(rec.message.model).toBe("m");
        expect(rec.message.usage).toEqual({
            input_tokens: 1,
            output_tokens: 2,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
        });
    });
});

describe("writers", () => {
    it("writeTranscript writes <dir>/<name>.jsonl", () => {
        const dir = tmp();
        const path = writeTranscript(dir, "parent", [userText("a"), assistantText("b")]);
        expect(path).toBe(join(dir, "parent.jsonl"));
        expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    });

    it("writeSubagent puts the child under <name>/subagents", () => {
        const dir = tmp();
        const path = writeSubagent(dir, "parent", "a1", [userText("child")]);
        expect(path).toBe(join(dir, "parent", "subagents", "agent-a1.jsonl"));
        expect(JSON.parse(readFileSync(path, "utf8").trim()).message.content).toBe("child");
    });
});

// A fake page: h.ev records each expression and answers it. The expressions are page code that only the dev app can
// run, so what these tests can pin is that each one parses (a template-literal escape slip would not) and that the
// values a scenario passes reach it as JSON.
function fakePage(answer = () => true) {
    const exprs = [];
    return {
        exprs,
        ev: async (expr) => {
            exprs.push(expr);
            return answer(expr);
        },
        rpc: vi.fn(async (command) => (command === "workspacelist" ? [] : null)),
    };
}
const parses = (expr) => expect(() => new Function(`return ${expr}`)).not.toThrow();

describe("page helpers", () => {
    it("agentPage wraps the body in an async function after the module lookup and the model finder", () => {
        const h = fakePage();
        void agentPage(h, "return 1;");
        const [expr] = h.exprs;
        parses(expr);
        expect(expr).toContain('mod("app/store/jotaiStore.ts")');
        expect(expr).toContain("const agentsModel = ()");
        expect(expr.indexOf("return 1;")).toBeGreaterThan(expr.indexOf("agentsModel"));
        // the whitespace regex survives the template literal as \s, not as a bare s
        expect(expr).toContain('.replace(/\\s+/g, " ")');
    });

    it("setRoster puts the roster on the dev mock atom and keeps the first roster to restore", () => {
        const h = fakePage();
        const roster = [{ id: "fx-1", name: "one's agent", task: 'say "hi"', state: "idle" }];
        void setRoster(h, roster);
        const [expr] = h.exprs;
        parses(expr);
        expect(expr).toContain('mod("app/view/agents/devmock.ts")');
        expect(expr).toContain(`globalStore.set(D.devMockAgentsAtom, ${JSON.stringify(roster)})`);
        expect(expr).toContain('if (!("__agentFixturePrev" in window))');
    });

    it("restoreRoster puts back the saved roster and forgets it", () => {
        const h = fakePage();
        void restoreRoster(h);
        parses(h.exprs[0]);
        expect(h.exprs[0]).toContain("globalStore.set(D.devMockAgentsAtom, window.__agentFixturePrev)");
        expect(h.exprs[0]).toContain("delete window.__agentFixturePrev");
    });

    it("focusAgent focuses the id on the Agent surface", () => {
        const h = fakePage();
        void focusAgent(h, 'fx-"1"');
        parses(h.exprs[0]);
        expect(h.exprs[0]).toContain('globalStore.set(model.focusIdAtom, "fx-\\"1\\"")');
        expect(h.exprs[0]).toContain('globalStore.set(model.surfaceAtom, "agent")');
    });

    it("makeQuiet stamps the block's last output back and sets the structural clock with it", () => {
        const h = fakePage();
        void makeQuiet(h, "blk-1", 7);
        parses(h.exprs[0]);
        expect(h.exprs[0]).toContain('mod("app/view/agents/agentcontrollerstore.ts")');
        expect(h.exprs[0]).toContain('getLastOutputAtom("blk-1")');
        expect(h.exprs[0]).toContain("globalStore.set(stamp, now - 7 * 60000)");
        expect(h.exprs[0]).toContain("globalStore.set(agentsModel().structuralNowAtom, now)");
    });

    it("quietUntil stamps again until seen() holds, and stops at three attempts", async () => {
        let seenAfter = 2;
        const h = fakePage();
        expect(await quietUntil(h, "b", 5, async () => --seenAfter <= 0)).toBe(2);
        expect(h.exprs).toHaveLength(2);

        const never = fakePage();
        expect(await quietUntil(never, "b", 5, async () => false)).toBe(3);
        expect(never.exprs).toHaveLength(3);
    });
});

describe("tabFixtures", () => {
    it("needs the kit's waveService", () => {
        expect(() => tabFixtures({})).toThrow(/waveService/);
    });

    // the wavesrv service route, answered by method
    function fakeService() {
        const calls = [];
        const fn = async (_h, service, method, args) => {
            calls.push([service, method, args]);
            if (method === "CreateTab") return `tab-${calls.filter((c) => c[1] === "CreateTab").length}`;
            if (method === "GetObject") return { blockids: [`blk-of-${args[0].slice(4)}`] };
            return null;
        };
        return { calls, fn };
    }
    const pageFor = () => {
        const h = fakePage((expr) => (expr.includes("TabRpcClient.routeId") ? "tab:boot" : true));
        h.rpc = vi.fn(async (command) =>
            command === "workspacelist"
                ? [
                      { workspacedata: { oid: "ws-other", tabids: ["x"] } },
                      { workspacedata: { oid: "ws-boot", tabids: ["boot"] } },
                  ]
                : null
        );
        return h;
    };

    it("makeTab creates the tab in the workspace of the page's own tab, then sets block and tab meta", async () => {
        const svc = fakeService();
        const { makeTab } = tabFixtures({ waveService: svc.fn });
        const h = pageFor();
        const ctx = {};
        const made = await makeTab(h, ctx, { label: "fx-proj", tabMeta: { "session:label": "L" } });
        expect(made).toEqual({ tabId: "tab-1", blockId: "blk-of-tab-1" });
        expect(ctx).toEqual({ workspaceId: "ws-boot", tabIds: ["tab-1"] });
        expect(svc.calls[0]).toEqual(["workspace", "CreateTab", ["ws-boot", "fx-proj", false]]);
        expect(h.rpc).toHaveBeenCalledWith("setmeta", { oref: "block:blk-of-tab-1", meta: { view: "term" } });
        expect(h.rpc).toHaveBeenCalledWith("setmeta", {
            oref: "tab:tab-1",
            meta: { "session:agent": "claude", "session:project": "fx-proj", "session:label": "L" },
        });
        // no pending launch unless asked, and the block is reloaded so the roster sees its meta
        const page = h.exprs.at(-1);
        parses(page);
        expect(page).toContain('WOS.reloadWaveObject(WOS.makeORef("block", "blk-of-tab-1"))');
        expect(page).toContain("if (false) {");
    });

    it("makeTab with pending adds a launch shaped like PendingLaunch, with no runtime field", async () => {
        const { makeTab } = tabFixtures({ waveService: fakeService().fn });
        const h = pageFor();
        await makeTab(h, {}, { label: "booting", pending: true });
        const page = h.exprs.at(-1);
        parses(page);
        expect(page).toContain("if (true) {");
        expect(page).toContain('const launch = { tabId: "tab-1", blockId: "blk-of-tab-1", name: "booting"');
        expect(page).toContain("ts: Date.now() };");
        expect(page).not.toContain("runtime");
    });

    it("makeTab looks the workspace up once for a ctx and reuses it", async () => {
        const svc = fakeService();
        const { makeTab } = tabFixtures({ waveService: svc.fn });
        const h = pageFor();
        const ctx = {};
        await makeTab(h, ctx, { label: "a" });
        await makeTab(h, ctx, { label: "b" });
        expect(h.rpc.mock.calls.filter(([c]) => c === "workspacelist")).toHaveLength(1);
        expect(ctx.tabIds).toEqual(["tab-1", "tab-2"]);
    });

    it("makeTab fails when the new tab has no block", async () => {
        const { makeTab } = tabFixtures({ waveService: async (_h, _s, method) => (method === "CreateTab" ? "t" : {}) });
        await expect(makeTab(pageFor(), {}, { label: "empty" })).rejects.toThrow(/has no block/);
    });

    it("closeTabs drops the pending launches, closes every tab and clears the list; one failure strands none", async () => {
        const closed = [];
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { closeTabs } = tabFixtures({
            waveService: async (_h, _s, method, args) => {
                if (method === "CloseTab") {
                    closed.push(args[1]);
                    if (args[1] === "t1") throw new Error("already gone");
                }
                return null;
            },
        });
        const h = fakePage();
        const ctx = { workspaceId: "ws", tabIds: ["t1", "t2"] };
        await closeTabs(h, ctx);
        expect(closed).toEqual(["t1", "t2"]);
        expect(ctx.tabIds).toEqual([]);
        parses(h.exprs[0]);
        expect(h.exprs[0]).toContain('const ids = ["t1","t2"];');
        expect(console.error).toHaveBeenCalledTimes(1);
    });

    it("closeTabs with no tabs made is a no-op that still resolves", async () => {
        const { closeTabs } = tabFixtures({ waveService: async () => null });
        const ctx = {};
        await closeTabs(fakePage(), ctx);
        expect(ctx.tabIds).toEqual([]);
    });
});
