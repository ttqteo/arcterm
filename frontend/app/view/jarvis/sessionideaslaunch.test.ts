// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchAgent = vi.hoisted(() => vi.fn());
const ensureNoFolder = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock("@/app/cockpit/cockpit-actions", () => ({ launchAgent: (...a: unknown[]) => launchAgent(...a) }));
vi.mock("@/app/cockpit/notificationstore", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: { EnsureNoFolderCommand: (...a: unknown[]) => ensureNoFolder(...a) },
}));
vi.mock("@/app/store/wshrpcutil", () => ({ TabRpcClient: {} }));

import { HOME_NAME } from "@/app/view/agents/launcher";
import {
    discussIdea,
    discussPrompt,
    goThroughIdeas,
    goThroughPrompt,
    ideaLaunchesAtom,
    launchedFor,
    openTabIds,
    SESSION_IDEAS_MARKER,
} from "./sessionideaslaunch";

const NO_FOLDER_PATH = "C:/Users/me/.arc/no-folder";
const model = {} as any;

function idea(over: Partial<SessionIdea> & { id: string }): SessionIdea {
    return {
        gist: "Let Sprout read the queue aloud",
        project: "arcterm",
        projectpath: "D:/work/arcterm",
        effortoid: "e-1",
        efforttitle: "Sprout voice",
        quotes: [
            { who: "you", text: "maybe Sprout could read the queue out loud" },
            { who: "agent", text: "That would need a speech queue first." },
        ],
        why: "The session moved on to the voice settings.",
        sessionid: "c0781a87-db5e-4b73-8913-4ca9eb9a8f2c",
        sessiontitle: "Voice settings",
        transcriptpath: "C:/Users/me/.claude/projects/x/c0781a87.jsonl",
        saidts: Date.UTC(2026, 10, 20, 9, 30),
        deletests: 0,
        foundts: 0,
        state: "review",
        resolvedts: 0,
        keptas: "",
        ...over,
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    ensureNoFolder.mockResolvedValue({ path: NO_FOLDER_PATH, channelid: "nf-ch" });
    launchAgent.mockResolvedValue("tab-1");
    globalStore.set(ideaLaunchesAtom, {});
});

afterEach(() => {
    (globalThis as any).__waveSessionIdeasLaunch?.setHook(false);
    (globalThis as any).__waveSessionIdeasLaunch?.clear();
});

describe("discussPrompt", () => {
    const text = discussPrompt(idea({ id: "i-1" }));
    const lines = text.split("\n");

    it("starts with the marker the scan skips the session by, alone on its line", () => {
        expect(lines[0]).toBe("[arc:session-ideas]");
        expect(SESSION_IDEAS_MARKER).toBe("[arc:session-ideas]");
    });

    it("gives the gist, the quotes, the initiative and the why", () => {
        expect(text).toContain("Let Sprout read the queue aloud");
        expect(text).toContain("> You: maybe Sprout could read the queue out loud");
        expect(text).toContain("> Claude: That would need a speech queue first.");
        expect(text).toContain("Sprout voice");
        expect(text).toContain("effort:e-1");
        expect(text).toContain("The session moved on to the voice settings.");
    });

    it("names the source session, how to read more of it, and never to resume it", () => {
        expect(text).toContain("c0781a87-db5e-4b73-8913-4ca9eb9a8f2c");
        expect(text).toContain("`wsh read session:c0781a87-db5e-4b73-8913-4ca9eb9a8f2c`");
        expect(text).toContain("2026-11-20");
        expect(text).toMatch(/never resume/i);
    });

    it("says how to record a decision on this idea", () => {
        expect(text).toContain('`wsh sessionideas keep i-1 [--label "<chunk label>"]`');
        expect(text).toContain("`wsh sessionideas drop i-1`");
    });

    it("says a new idea belongs to no initiative, and leaves out what an idea does not carry", () => {
        const fresh = discussPrompt(
            idea({ id: "i-2", effortoid: "", efforttitle: "", why: "", quotes: [], saidts: 0 })
        );
        expect(fresh).toContain("New idea");
        expect(fresh).not.toContain("effort:");
        expect(fresh).not.toContain("Why it stayed open");
        expect(fresh).not.toContain("What was said");
        expect(fresh).not.toContain("undefined");
    });
});

describe("goThroughPrompt", () => {
    const a = idea({ id: "i-1" });
    const b = idea({ id: "i-2", gist: "Pin a chunk to the tab bar", effortoid: "", efforttitle: "", quotes: [] });
    const text = goThroughPrompt([a, b]);

    it("starts with the marker, alone on its line", () => {
        expect(text.split("\n")[0]).toBe("[arc:session-ideas]");
    });

    it("asks to walk the ideas one at a time and to leave an idea that needs code read for Discuss", () => {
        expect(text).toMatch(/one at a time/i);
        expect(text).toMatch(/Discuss/);
    });

    it("lists every idea with its id, gist and initiative or new-idea line", () => {
        expect(text).toContain("i-1");
        expect(text).toContain("Let Sprout read the queue aloud");
        expect(text).toContain("Sprout voice");
        expect(text).toContain("i-2");
        expect(text).toContain("Pin a chunk to the tab bar");
        expect(text).toContain("New idea");
    });

    it("gives each idea's quote and source session, so the agent need not read the transcript for a quick pass", () => {
        expect(text).toContain("> You: maybe Sprout could read the queue out loud");
        expect(text).toContain("`wsh read session:c0781a87-db5e-4b73-8913-4ca9eb9a8f2c`");
    });

    it("says how to record a decision, for any listed idea", () => {
        expect(text).toContain('`wsh sessionideas keep <id> [--label "<chunk label>"]`');
        expect(text).toContain("`wsh sessionideas drop <id>`");
        expect(text).toMatch(/never resume/i);
    });
});

describe("discussIdea", () => {
    it("opens a sonnet claude agent in the idea's project, with the prompt, and remembers its tab", async () => {
        const i = idea({ id: "i-1" });
        expect(await discussIdea(model, i)).toBe("tab-1");
        expect(launchAgent).toHaveBeenCalledTimes(1);
        const [m, opts] = launchAgent.mock.calls[0];
        expect(m).toBe(model);
        expect(opts).toMatchObject({
            runtime: "claude",
            startupCommand: "claude",
            extraArgs: ["--model", "sonnet"],
            projectPath: "D:/work/arcterm",
            projectName: "arcterm",
            task: discussPrompt(i),
        });
        expect(opts.label).toContain("Let Sprout read the queue aloud");
        expect(globalStore.get(ideaLaunchesAtom)).toEqual({ "i-1": "tab-1" });
        expect(ensureNoFolder).not.toHaveBeenCalled();
    });

    it("opens in No folder when the idea carries no project path, as a launch with no folder would open in the wrong place", async () => {
        await discussIdea(model, idea({ id: "i-1", projectpath: "", project: "" }));
        expect(launchAgent.mock.calls[0][1]).toMatchObject({ projectPath: NO_FOLDER_PATH, projectName: HOME_NAME });
    });

    it("starts one agent for two presses made while the first is starting, and gives both its tab", async () => {
        let release!: (tab: string) => void;
        launchAgent.mockReturnValue(new Promise<string>((r) => (release = r)));
        const first = discussIdea(model, idea({ id: "i-1" }));
        const second = discussIdea(model, idea({ id: "i-1" }));
        release("tab-9");
        expect(await first).toBe("tab-9");
        // the second press opened nothing, but an agent is open for it: a caller reading null as a failure would be wrong
        expect(await second).toBe("tab-9");
        expect(launchAgent).toHaveBeenCalledTimes(1);
    });

    it("gives a press made while a launch that then fails was starting the same null, with one toast", async () => {
        let fail!: (e: Error) => void;
        launchAgent.mockReturnValueOnce(new Promise<string>((_, r) => (fail = r)));
        const first = discussIdea(model, idea({ id: "i-1" }));
        const second = discussIdea(model, idea({ id: "i-1" }));
        fail(new Error("no active workspace"));
        expect(await first).toBeNull();
        expect(await second).toBeNull();
        expect(pushToast).toHaveBeenCalledTimes(1);
        // once it has settled, the next press starts a launch of its own
        expect(await discussIdea(model, idea({ id: "i-1" }))).toBe("tab-1");
        expect(launchAgent).toHaveBeenCalledTimes(2);
    });

    it("starts the Discuss of another idea while one is starting", async () => {
        let release!: (tab: string) => void;
        launchAgent.mockReturnValueOnce(new Promise<string>((r) => (release = r)));
        const first = discussIdea(model, idea({ id: "i-1" }));
        expect(await discussIdea(model, idea({ id: "i-2" }))).toBe("tab-1");
        expect(launchAgent).toHaveBeenCalledTimes(2);
        release("tab-9");
        expect(await first).toBe("tab-9");
    });

    it("says why on a toast, remembers nothing, and lets the next press try again", async () => {
        launchAgent.mockRejectedValueOnce(new Error("no active workspace"));
        expect(await discussIdea(model, idea({ id: "i-1" }))).toBeNull();
        expect(pushToast).toHaveBeenCalledWith(
            expect.objectContaining({ level: "error", message: expect.stringContaining("no active workspace") })
        );
        expect(globalStore.get(ideaLaunchesAtom)).toEqual({});
        expect(await discussIdea(model, idea({ id: "i-1" }))).toBe("tab-1");
    });
});

describe("goThroughIdeas", () => {
    it("opens one sonnet claude agent in No folder for every idea, and remembers its tab for each", async () => {
        const a = idea({ id: "i-1" });
        const b = idea({ id: "i-2", project: "loom", projectpath: "D:/work/loom" });
        expect(await goThroughIdeas(model, [a, b])).toBe("tab-1");
        expect(launchAgent).toHaveBeenCalledTimes(1);
        const opts = launchAgent.mock.calls[0][1];
        expect(opts).toMatchObject({
            runtime: "claude",
            startupCommand: "claude",
            extraArgs: ["--model", "sonnet"],
            projectPath: NO_FOLDER_PATH,
            projectName: HOME_NAME,
            task: goThroughPrompt([a, b]),
        });
        expect(opts.label).toContain("2");
        expect(globalStore.get(ideaLaunchesAtom)).toEqual({ "i-1": "tab-1", "i-2": "tab-1" });
    });

    it("opens nothing for no ideas", async () => {
        expect(await goThroughIdeas(model, [])).toBeNull();
        expect(launchAgent).not.toHaveBeenCalled();
    });

    it("says on a toast when No folder cannot be set up, and opens nothing", async () => {
        ensureNoFolder.mockResolvedValue({ path: "", channelid: "" });
        expect(await goThroughIdeas(model, [idea({ id: "i-1" })])).toBeNull();
        expect(launchAgent).not.toHaveBeenCalled();
        expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
    });
});

describe("launchedFor", () => {
    const launches = { "i-1": "tab-1" };

    it("is the tab of the agent opened for the idea while that tab is on the roster", () => {
        expect(launchedFor("i-1", launches, openTabIds([{ id: "tab-1" }], []))).toBe("tab-1");
    });

    it("counts a tab still booting: a launch is pending until its tab reports in", () => {
        expect(launchedFor("i-1", launches, openTabIds([], [{ tabId: "tab-1" }]))).toBe("tab-1");
    });

    it("is nothing once the tab has closed, or for an idea no agent was opened for", () => {
        expect(launchedFor("i-1", launches, openTabIds([{ id: "tab-2" }], []))).toBeUndefined();
        expect(launchedFor("i-2", launches, openTabIds([{ id: "tab-1" }], []))).toBeUndefined();
    });
});

describe("the launch hook", () => {
    function hook() {
        return (globalThis as any).__waveSessionIdeasLaunch as {
            setHook(on: boolean): void;
            launches(): unknown[];
            clear(): void;
        };
    }

    it("is there in a dev build", () => {
        expect(typeof hook().setHook).toBe("function");
    });

    it("records a Discuss and opens no agent, and gives launchedFor a tab that reads as open", async () => {
        hook().setHook(true);
        const i = idea({ id: "i-1" });
        const tab = await discussIdea(model, i);
        expect(launchAgent).not.toHaveBeenCalled();
        expect(hook().launches()).toEqual([
            { kind: "discuss", ideaIds: ["i-1"], projectPath: "D:/work/arcterm", task: discussPrompt(i) },
        ]);
        expect(tab).toBeTruthy();
        expect(launchedFor("i-1", globalStore.get(ideaLaunchesAtom), openTabIds([], []))).toBe(tab);
    });

    it("records a Go through with the No folder path, the ideas in order", async () => {
        hook().setHook(true);
        const a = idea({ id: "i-1" });
        const b = idea({ id: "i-2" });
        await goThroughIdeas(model, [a, b]);
        expect(launchAgent).not.toHaveBeenCalled();
        expect(hook().launches()).toEqual([
            { kind: "go-through", ideaIds: ["i-1", "i-2"], projectPath: NO_FOLDER_PATH, task: goThroughPrompt([a, b]) },
        ]);
    });

    it("opens a real agent again once it is off, and clear forgets what it recorded", async () => {
        hook().setHook(true);
        await discussIdea(model, idea({ id: "i-1" }));
        hook().clear();
        expect(hook().launches()).toEqual([]);
        hook().setHook(false);
        globalStore.set(ideaLaunchesAtom, {});
        await discussIdea(model, idea({ id: "i-1" }));
        expect(launchAgent).toHaveBeenCalledTimes(1);
        // the fake tab is gone with the hook: it does not read as open
        expect(openTabIds([], []).size).toBe(0);
    });
});
