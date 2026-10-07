import { globalStore } from "@/app/store/jotaiStore";
import { centerModeAtom } from "@/app/view/agents/agentcenter";
import type { AgentsViewModel, SurfaceKey } from "@/app/view/agents/agents";
import type { AgentVM } from "@/app/view/agents/agentsviewmodel";
import { sessionsArchiveAtom, type LiveSession } from "@/app/view/agents/sessionsarchivestore";
import { atom, createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_KIND, type SessionThing } from "./session";

const mk = (over: Partial<LiveSession> = {}): LiveSession => ({
    id: "s1",
    runtime: "claude",
    projectpath: "/p",
    projectname: "proj",
    branch: "main",
    task: "fix it",
    model: "claude",
    tokenstotal: 0,
    lastactivets: 0,
    resumecommand: "claude --resume s1",
    transcriptpath: "/t/s1.jsonl",
    status: "done",
    startedts: 0,
    durationms: 0,
    events: [],
    live: false,
    needsAttention: false,
    ...over,
});
const agent = { id: "tab-1", name: "fixer", state: "working", transcriptPath: "/t/s1.jsonl" } as AgentVM;
const action = (id: string) => SESSION_KIND.actions.find((a) => a.id === id)!;
const thing = (session: LiveSession, a?: AgentVM): SessionThing => ({ session, agent: a });
// `member` seeds sessionsMemberAtom, so a test can tell a member that was left alone from one that was set
const stub = (member = "lead") =>
    ({
        surfaceAtom: atom<SurfaceKey>("cockpit"),
        sessionsSelAtom: atom("all"),
        sessionsMemberAtom: atom(member),
    }) as unknown as AgentsViewModel;

describe("session actions", () => {
    // centerModeAtom is module-level state in the shared globalStore
    beforeEach(() => globalStore.set(centerModeAtom, "terminal"));
    it("resume applies only to an ended session that can be resumed", () => {
        expect(action("session:resume").applies(thing(mk()))).toBe(true);
        expect(action("session:resume").applies(thing(mk({ live: true, liveId: "tab-1" }), agent))).toBe(false);
        expect(action("session:resume").applies(thing(mk({ resumecommand: "" })))).toBe(false);
    });
    it("stop applies only to a live session with a roster agent", () => {
        expect(action("session:stop").applies(thing(mk({ live: true, liveId: "tab-1" }), agent))).toBe(true);
        expect(action("session:stop").applies(thing(mk()))).toBe(false);
        expect(action("session:stop").applies(thing(mk({ live: true, liveId: "tab-gone" })))).toBe(false);
        expect(action("session:stop").destructive).toBe(true);
    });
    it("delete applies only to an ended Claude session", () => {
        expect(action("session:delete").applies(thing(mk()))).toBe(true);
        expect(action("session:delete").applies(thing(mk({ live: true, liveId: "tab-1" }), agent))).toBe(false);
        expect(action("session:delete").applies(thing(mk({ runtime: "pi" })))).toBe(false);
        expect(action("session:delete").applies(thing(mk({ transcriptpath: "" })))).toBe(false);
        expect(action("session:delete").label).toBe("Xoá session");
        expect(action("session:delete").destructive).toBe(true);
    });
    it("open session always applies", () => {
        expect(action("session:open").applies(thing(mk({ resumecommand: "" })))).toBe(true);
    });
    it("open session reads a solo session in the Agent surface's centre", () => {
        const model = stub("t-9");
        action("session:open").run(thing(mk({ id: "s9", runtime: "pi" })), { model });
        expect(globalStore.get(model.sessionsSelAtom)).toBe("pi:s9");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-9");
        expect(globalStore.get(centerModeAtom)).toBe("session");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });
    it("open session reads a live session the same way, as its own session", () => {
        const model = stub();
        action("session:open").run(thing(mk({ live: true, liveId: "tab-1" }), agent), { model });
        expect(globalStore.get(model.sessionsSelAtom)).toBe("claude:s1");
        expect(globalStore.get(centerModeAtom)).toBe("session");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });
    it("open session opens a run's session in the run pane with its member in view", () => {
        const model = stub();
        action("session:open").run(thing(mk({ runid: "r1", role: "worker", taskid: "t-2" })), { model });
        expect(globalStore.get(model.sessionsSelAtom)).toBe("run:r1");
        expect(globalStore.get(model.sessionsMemberAtom)).toBe("t-2");
        expect(globalStore.get(centerModeAtom)).toBe("run");
        expect(globalStore.get(model.surfaceAtom)).toBe("agent");
    });
});

describe("session entries", () => {
    it("lists resumable sessions keyed as the palette row, a live one resolved to its roster agent", () => {
        const store = createStore();
        store.set(sessionsArchiveAtom, [
            mk(),
            mk({ id: "s2", runtime: "pi", task: "", transcriptpath: "/t/s2.jsonl" }),
            mk({ id: "s3", resumecommand: "" }),
        ]);
        const model = { agentsAtom: atom([agent]) } as unknown as AgentsViewModel;
        const entries = SESSION_KIND.entries(store.get, model);
        expect(entries.map((e) => e.key)).toEqual(["session:claude:s1", "session:pi:s2"]);
        expect(entries.map((e) => e.title)).toEqual(["fix it", "(untitled session)"]);
        expect(entries[0].thing.session.live).toBe(true);
        expect(entries[0].thing.agent).toBe(agent);
        expect(entries[1].thing.agent).toBeUndefined();
    });
    it("lists nothing before the archive loads", () => {
        const model = { agentsAtom: atom([]) } as unknown as AgentsViewModel;
        expect(SESSION_KIND.entries(createStore().get, model)).toEqual([]);
    });
});
