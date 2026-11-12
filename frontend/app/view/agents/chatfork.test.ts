import { describe, expect, it } from "vitest";
import { canForkInChat, chatForkLaunchOpts, forkPointOfProse, forkPointOfYou, runChatFork } from "./chatfork";

describe("canForkInChat", () => {
    it("is a Claude agent with a .jsonl transcript", () => {
        expect(canForkInChat({ agent: "claude", transcriptPath: "C:/x/s.jsonl" })).toBe(true);
        expect(canForkInChat({ agent: "codex", transcriptPath: "C:/x/s.jsonl" })).toBe(false);
        expect(canForkInChat({ agent: "claude" })).toBe(false);
    });
    it("takes an agent with no harness set as Claude, as chatCapable does", () => {
        expect(canForkInChat({ transcriptPath: "C:/x/s.jsonl" })).toBe(true);
        expect(canForkInChat({ agent: "Claude", transcriptPath: "C:/x/s.jsonl" })).toBe(true);
        expect(canForkInChat({})).toBe(false);
    });
    it("needs a .jsonl transcript, not any path", () => {
        expect(canForkInChat({ agent: "claude", transcriptPath: "C:/x/session.json" })).toBe(false);
    });
});

describe("fork points", () => {
    it("forks before your message and puts its text back in the box", () => {
        expect(forkPointOfYou({ kind: "you", key: "you:3", text: "fix it", uuid: "u1" })).toEqual({
            uuid: "u1",
            keep: "before",
            draft: "fix it",
        });
    });
    it("has none for a message with no uuid or a command", () => {
        expect(forkPointOfYou({ kind: "you", key: "you:3", text: "fix it" })).toBeNull();
        expect(forkPointOfYou({ kind: "you", key: "you:4", command: "/model" })).toBeNull();
    });
    it("forks through a reply", () => {
        expect(forkPointOfProse({ kind: "prose", text: "done", uuid: "a1" })).toEqual({ uuid: "a1", keep: "through" });
        expect(forkPointOfProse({ kind: "prose", text: "done" })).toBeNull();
    });
});

describe("chatForkLaunchOpts", () => {
    it("launches the command in the session's folder, named as a fork", () => {
        expect(
            chatForkLaunchOpts(
                { task: "Fix sync", project: "arcterm" },
                { command: 'claude --resume "C:/x.jsonl" --fork-session', projectpath: "D:/work/arcterm" }
            )
        ).toEqual({
            runtime: "claude",
            startupCommand: 'claude --resume "C:/x.jsonl" --fork-session',
            task: "",
            projectPath: "D:/work/arcterm",
            projectName: "arcterm",
            label: "Fix sync (fork)",
        });
    });
    it("names an untitled one Fork and its project after the folder", () => {
        expect(chatForkLaunchOpts({ task: "" }, { command: "c", projectpath: "D:/work/arcterm" })).toMatchObject({
            projectName: "arcterm",
            label: "Fork",
        });
    });
});

describe("runChatFork", () => {
    const agent = { name: "a", task: "Fix sync", project: "arcterm", transcriptPath: "C:/x/s.jsonl" };
    function fakes(fork: (d: unknown) => Promise<{ command: string; projectpath: string }>) {
        const calls = {
            fork: [] as unknown[],
            launch: [] as unknown[],
            draft: [] as unknown[],
            toast: [] as unknown[],
        };
        return {
            calls,
            deps: {
                fork: (d: unknown) => (calls.fork.push(d), fork(d)),
                launch: async (o: unknown) => (calls.launch.push(o), "new-id"),
                setDraft: (id: string, text: string) => void calls.draft.push([id, text]),
                toast: (t: unknown) => void calls.toast.push(t),
            },
        };
    }
    const ok = async () => ({ command: "c", projectpath: "D:/p" });

    it("forks the whole session with no uuid and leaves the box empty", async () => {
        const f = fakes(ok);
        await runChatFork(f.deps, agent);
        expect(f.calls.fork).toEqual([{ transcriptpath: "C:/x/s.jsonl" }]);
        expect(f.calls.launch).toMatchObject([{ startupCommand: "c", label: "Fix sync (fork)" }]);
        expect(f.calls.draft).toEqual([]);
    });
    it("puts your message back in the new tab's box on a fork before it", async () => {
        const f = fakes(ok);
        await runChatFork(f.deps, agent, { uuid: "u2", keep: "before", draft: "fix it" });
        expect(f.calls.fork).toEqual([{ transcriptpath: "C:/x/s.jsonl", uuid: "u2", keep: "before" }]);
        expect(f.calls.draft).toEqual([["new-id", "fix it"]]);
    });
    it("leaves the box empty on a fork through a reply", async () => {
        const f = fakes(ok);
        await runChatFork(f.deps, agent, { uuid: "a1", keep: "through" });
        expect(f.calls.draft).toEqual([]);
    });
    it("shows a failure as a toast and launches nothing", async () => {
        const f = fakes(async () => {
            throw new Error("that message is no longer in the transcript");
        });
        await runChatFork(f.deps, agent, { uuid: "a1", keep: "through" });
        expect(f.calls.launch).toEqual([]);
        expect(f.calls.toast).toMatchObject([
            { title: "Couldn't fork a", message: "that message is no longer in the transcript", level: "error" },
        ]);
    });
});
