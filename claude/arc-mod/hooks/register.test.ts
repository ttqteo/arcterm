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
