import { describe, expect, it, vi } from "vitest";

// the Claude Code runtime module register.ts imports; only claude provides it
vi.mock("claude-code", () => ({ atom: () => ({}), read: () => undefined, update: () => undefined }));

import { register } from "./register";

type Handler = (...args: any[]) => Promise<unknown>;

function registered(): Map<string, Handler> {
    const handlers = new Map<string, Handler>();
    register(((event: string, filterOrHandler: unknown, handler?: Handler) => {
        const tool = handler ? (filterOrHandler as { tool?: string }).tool : undefined;
        handlers.set(tool ? `${event}:${tool}` : event, handler ?? (filterOrHandler as Handler));
    }) as never);
    return handlers;
}

// an engine inside an arcterm block whose wsh answers every jobslot with {"run":true}
function arcEngine(spawned: string[][]) {
    return {
        env: { get: async (k: string) => (k === "WAVETERM_BLOCKID" || k === "WAVETERM_JWT" ? "x" : undefined) },
        session: { cwd: async () => "/repo", append: async () => ({}) },
        fs: { exists: async () => false, list: async () => [], read: async () => "" },
        ui: { log: () => undefined, toast: () => undefined },
        process: {
            spawn: ({ argv }: { argv: string[] }) => {
                spawned.push(argv);
                const lines = argv[1] === "jobslot" ? ['{"run":true}\n'] : [];
                return (async function* () {
                    for (const text of lines) {
                        yield { stream: "stdout", text };
                    }
                })();
            },
            run: async () => ({ code: 0, stdout: "", stderr: "" }),
        },
    };
}

describe("shell tool calls", () => {
    for (const tool of ["Bash", "PowerShell"]) {
        it(`${tool} waits for a job slot before it runs`, async () => {
            const handlers = registered();
            const spawned: string[][] = [];
            const $ = arcEngine(spawned);
            await handlers.get("session.start")!($, { cwd: "/repo" }, async () => undefined);
            const next = vi.fn(async () => "ran");
            const out = await handlers.get(`tool.call:${tool}`)!($, { command: "task check:ts" }, next);
            expect(out).toBe("ran");
            expect(spawned).toContainEqual(["__WSH_PATH__", "jobslot", "--", "task check:ts"]);
        });
    }
});

// an engine in arcterm's repo (or another, isArcRepo false) whose git moves HEAD from a1 to b2 on a commit and
// lists files as the commit's paths
function repoEngine(files: string[], isArcRepo = true) {
    let head = "a1";
    const ran: string[][] = [];
    const $ = {
        ...arcEngine([]),
        fs: { exists: async (p: string) => isArcRepo && p === "scripts/cdp/scenarios.mjs" },
        process: {
            ...arcEngine([]).process,
            run: async (argv: string[]) => {
                ran.push(argv);
                const stdout = argv[1] === "rev-parse" ? `${head}\n` : files.join("\n") + "\n";
                return { exitCode: 0, stdout, stderr: "" };
            },
        },
    };
    const commit = vi.fn(async () => {
        head = head === "a1" ? "b2" : "c3";
        return { result: { stdout: "[main b2] fix" }, text: "[main b2] fix" };
    });
    return { $, ran, commit };
}

describe("the ui check after a commit", () => {
    const ui = ["frontend/app/cockpit/traypage.tsx", "CHANGELOG.md"];

    it("reminds the model when the commit changed UI no one tried in the app", async () => {
        const handlers = registered();
        const { $, commit } = repoEngine(ui);
        const out = (await handlers.get("tool.call:Bash")!($, { command: 'git commit -m "x" -- a' }, commit)) as {
            context?: string[];
            text: string;
        };
        expect(out.text).toBe("[main b2] fix");
        expect(out.context).toHaveLength(1);
        expect(out.context![0]).toContain("frontend/app/cockpit/traypage.tsx");
    });

    it("lets a commit pass after a live check, then asks again for the next UI commit", async () => {
        const handlers = registered();
        const { $, commit } = repoEngine(ui);
        const bash = handlers.get("tool.call:PowerShell")!;
        await bash($, { command: "node scripts/cdp-shot.mjs tray.png" }, async () => ({ result: {}, text: "ok" }));
        const first = (await bash($, { command: "git commit -- a" }, commit)) as { context?: string[] };
        expect(first.context).toBeUndefined();
        const second = (await bash($, { command: "git commit -- a" }, commit)) as { context?: string[] };
        expect(second.context).toHaveLength(1);
    });

    it("stays out of another repo and runs no git there", async () => {
        const handlers = registered();
        const { $, ran, commit } = repoEngine(ui, false);
        const out = (await handlers.get("tool.call:Bash")!($, { command: "git commit -- a" }, commit)) as {
            context?: string[];
        };
        expect(out.context).toBeUndefined();
        expect(ran).toEqual([]);
    });
});
