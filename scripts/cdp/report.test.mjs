import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
    LOAD_WAIT_MS,
    RENDER_WAIT_MS,
    contactSheetHtml,
    exitCode,
    formatResults,
    makeRunReporter,
    renderWait,
    shotsManifest,
    shotsUnder,
    unknownScenarios,
} from "./report.mjs";

const pass = { name: "s1", steps: [{ step: "a", ok: true, detail: "d" }] };
const fail = { name: "s2", steps: [{ step: "b", ok: false, detail: "boom" }] };
const errored = { name: "s3", steps: [], error: "attach failed" };
const skipped = { name: "s4", steps: [{ step: "c", skip: true, detail: "no scan report in this profile" }] };

describe("unknownScenarios", () => {
    const all = [{ name: "chat-redesign" }, { name: "agent-chat" }];
    it("names every asked-for name no scenario has, beside ones that exist", () => {
        expect(unknownScenarios(all, ["agent-chat", "chat-verdict-handoff", "typo"])).toEqual(["chat-verdict-handoff", "typo"]);
    });
    it("is empty when every name exists, or when none is asked for", () => {
        expect(unknownScenarios(all, ["chat-redesign"])).toEqual([]);
        expect(unknownScenarios(all, [])).toEqual([]);
    });
});

describe("exitCode", () => {
    it("is 0 when every step of every scenario passes", () => {
        expect(exitCode([pass, { name: "s1b", steps: [{ step: "x", ok: true }] }])).toBe(0);
    });
    it("is 1 when any step fails", () => {
        expect(exitCode([pass, fail])).toBe(1);
    });
    it("is 1 when a scenario errored", () => {
        expect(exitCode([pass, errored])).toBe(1);
    });
    it("is 0 when a step was skipped rather than run", () => {
        expect(exitCode([pass, skipped])).toBe(0);
    });
    it("still fails when a real failure sits beside a skip", () => {
        expect(exitCode([skipped, fail])).toBe(1);
    });
});

describe("formatResults", () => {
    it("labels PASS/FAIL per step and prints a summary", () => {
        const out = formatResults([pass, fail]);
        expect(out).toContain("PASS  a");
        expect(out).toContain("FAIL  b");
        expect(out).toContain("1/2 steps passed");
    });
    it("surfaces a scenario error", () => {
        expect(formatResults([errored])).toContain("ERROR: attach failed");
    });
    it("labels a skip and keeps it out of the ran total", () => {
        const out = formatResults([pass, skipped]);
        expect(out).toContain("SKIP  c");
        expect(out).toContain("1/1 steps passed, 1 skipped");
    });
    it("says nothing about skips when there are none", () => {
        expect(formatResults([pass, fail])).toContain("1/2 steps passed");
        expect(formatResults([pass, fail])).not.toContain("skipped");
    });
});

describe("contactSheetHtml", () => {
    it("renders one img per shot, its src relative to the sheet's dir", () => {
        const html = contactSheetHtml(
            [
                { name: "cockpit", path: "cdp-shots/cockpit.png" },
                { name: "nested", path: "cdp-shots/nested/a.png" },
                { name: "outside", path: "fixtures/seed.png" },
            ],
            "cdp-shots"
        );
        expect(html).toContain('src="cockpit.png"');
        expect(html).toContain('src="nested/a.png"');
        expect(html).toContain('src="../fixtures/seed.png"');
    });
    it("emits a doctype even when empty", () => {
        expect(contactSheetHtml([], "cdp-shots")).toContain("<!doctype html>");
    });
});

describe("shotsManifest", () => {
    it("maps pass, fail and skip, keeping step order and details", () => {
        const scenario = {
            name: "runs",
            steps: [
                { step: "a", ok: true, detail: "d" },
                { step: "b", ok: false, detail: "boom" },
                { step: "c", skip: true, detail: "no scan report" },
                { step: "e", ok: true },
            ],
        };
        expect(shotsManifest([scenario], { runs: ["runs.png", "runs-open.png"] })).toEqual([
            {
                name: "runs",
                files: ["runs.png", "runs-open.png"],
                steps: [
                    { step: "a", state: "pass", detail: "d" },
                    { step: "b", state: "fail", detail: "boom" },
                    { step: "c", state: "skip", detail: "no scan report" },
                    { step: "e", state: "pass" },
                ],
            },
        ]);
    });

    it("adds a failing step carrying the error after the steps of a scenario that threw", () => {
        const threw = { name: "s5", steps: [{ step: "a", ok: true }], error: "nav not found" };
        expect(shotsManifest([threw, errored], {})).toEqual([
            {
                name: "s5",
                files: [],
                steps: [
                    { step: "a", state: "pass" },
                    { step: "the scenario threw", state: "fail", detail: "nav not found" },
                ],
            },
            { name: "s3", files: [], steps: [{ step: "the scenario threw", state: "fail", detail: "attach failed" }] },
        ]);
    });

    it("gives a scenario with no shots an empty file list", () => {
        expect(shotsManifest([pass], { other: ["other.png"] })).toEqual([
            { name: "s1", files: [], steps: [{ step: "a", state: "pass", detail: "d" }] },
        ]);
    });
});

describe("shotsUnder", () => {
    it("keeps the shots under the dir, relative to it with forward slashes, in order", () => {
        const shots = [
            { path: "cdp-shots/b.png" },
            { path: "cdp-shots/nested/a.png" },
            { path: join(resolve("cdp-shots"), "abs.png") },
        ];
        expect(shotsUnder(shots, "cdp-shots")).toEqual(["b.png", "nested/a.png", "abs.png"]);
    });

    it("drops a png a scenario wrote outside the dir", () => {
        const shots = [
            { path: "cdp-shots/kept.png" },
            { path: "fixtures/seed.png" },
            { path: "cdp-shots/../escaped.png" },
            { path: "cdp-shots-old/x.png" },
            { path: resolve("elsewhere", "y.png") },
        ];
        expect(shotsUnder(shots, "cdp-shots")).toEqual(["kept.png"]);
    });
});

// a stand-in for spawnSync that keeps each call: the report's JSON is what wavesrv reads, so it is what is asserted
function stubSpawn(result = { status: 0 }) {
    const calls = [];
    const spawn = (cmd, args, opts) => {
        calls.push({ cmd, args, opts, doc: JSON.parse(opts.input) });
        return typeof result === "function" ? result(calls.length) : result;
    };
    return { spawn, calls };
}
const inAgent = { WAVETERM_BLOCKID: "blk-1" };

describe("makeRunReporter", () => {
    it("reports nothing outside an agent's terminal", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: {}, spawn, log: () => {} });
        r.start(["a"], "task verify:ui -- a");
        r.scenarioDone(pass, ["s1.png"]);
        r.end([pass], { s1: ["s1.png"] }, "cdp-shots");
        r.unverified("why");
        expect(calls).toEqual([]);
    });

    it("runs `wsh verify report` with the report on stdin, from WAVETERM_WSHBINDIR when it is set, else from PATH", () => {
        const a = stubSpawn();
        makeRunReporter({ env: { ...inAgent, WAVETERM_WSHBINDIR: join("bin", "dir") }, spawn: a.spawn, platform: "win32" }).start(["x"], "c");
        expect(a.calls[0].cmd).toBe(join("bin", "dir", "wsh.exe"));
        expect(a.calls[0].args).toEqual(["verify", "report"]);

        const b = stubSpawn();
        makeRunReporter({ env: { ...inAgent, WAVETERM_WSHBINDIR: join("bin", "dir") }, spawn: b.spawn, platform: "darwin" }).start(["x"], "c");
        expect(b.calls[0].cmd).toBe(join("bin", "dir", "wsh"));

        const c = stubSpawn();
        makeRunReporter({ env: inAgent, spawn: c.spawn, platform: "win32" }).start(["x"], "c");
        expect(c.calls[0].cmd).toBe("wsh");
    });

    it("start names the scenarios with the process, its directory and the command, and carries no watch list", () => {
        const { spawn, calls } = stubSpawn();
        makeRunReporter({ env: inAgent, spawn }).start(["a", "b"], "task verify:ui -- a b");
        const doc = calls[0].doc;
        expect(doc).toMatchObject({ phase: "start", pid: process.pid, cwd: process.cwd(), command: "task verify:ui -- a b" });
        expect(doc.runid).toMatch(/^[0-9a-f-]{36}$/);
        expect(doc.scenarios).toEqual([
            { name: "a", files: [], steps: [], done: false },
            { name: "b", files: [], steps: [], done: false },
        ]);
        expect(doc).not.toHaveProperty("watch");
        expect(doc).not.toHaveProperty("reason");
    });

    it("keeps one run id for every report of a reporter, and a new one per reporter", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["s1"], "c");
        r.scenarioDone(pass, []);
        r.end([pass], {}, "cdp-shots");
        expect(new Set(calls.map((c) => c.doc.runid)).size).toBe(1);
        const other = stubSpawn();
        makeRunReporter({ env: inAgent, spawn: other.spawn }).start(["s1"], "c");
        expect(other.calls[0].doc.runid).not.toBe(calls[0].doc.runid);
    });

    it("takes the run id and the command Final passes down over its own", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({
            env: { ...inAgent, ARC_VERIFY_RUNID: "final-run", ARC_VERIFY_COMMAND: "node scripts/cdp/final-verify.mjs a" },
            spawn,
        });
        r.start(["a"], "task verify:ui -- a");
        r.end([pass], {}, "cdp-shots");
        expect(calls.map((c) => c.doc.runid)).toEqual(["final-run", "final-run"]);
        expect(calls.map((c) => c.doc.command)).toEqual(["node scripts/cdp/final-verify.mjs a", "node scripts/cdp/final-verify.mjs a"]);
    });

    it("sends progress after each scenario with every scenario so far, finished ones done and carrying their files and steps", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["s1", "s2", "s4"], "c");
        r.scenarioDone(pass, ["s1.png", "s1-open.png"]);
        r.scenarioDone(fail, ["s2.png"]);
        expect(calls.map((c) => c.doc.phase)).toEqual(["start", "progress", "progress"]);
        expect(calls[1].doc.scenarios).toEqual([
            { name: "s1", files: ["s1.png", "s1-open.png"], steps: [{ step: "a", state: "pass", detail: "d" }], done: true },
            { name: "s2", files: [], steps: [], done: false },
            { name: "s4", files: [], steps: [], done: false },
        ]);
        expect(calls[2].doc.scenarios).toEqual([
            { name: "s1", files: ["s1.png", "s1-open.png"], steps: [{ step: "a", state: "pass", detail: "d" }], done: true },
            { name: "s2", files: ["s2.png"], steps: [{ step: "b", state: "fail", detail: "boom" }], done: true },
            { name: "s4", files: [], steps: [], done: false },
        ]);
    });

    it("a scenario that threw reports its failing step, as the manifest does", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["s3"], "c");
        r.scenarioDone(errored, []);
        expect(calls[1].doc.scenarios[0].steps).toEqual([{ step: "the scenario threw", state: "fail", detail: "attach failed" }]);
    });

    it("end sends the final manifest, every scenario done, with the shots dir made absolute", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["s1", "s2", "s4"], "c");
        r.end([pass, fail, skipped], { s1: ["s1.png"], s2: ["s2.png", "s2-b.png"], s4: [] }, "cdp-shots");
        const doc = calls[1].doc;
        expect(doc.phase).toBe("end");
        expect(doc.shotsdir).toBe(resolve("cdp-shots"));
        expect(doc.scenarios).toEqual([
            ...shotsManifest([pass, fail, skipped], { s1: ["s1.png"], s2: ["s2.png", "s2-b.png"], s4: [] }).map((s) => ({ ...s, done: true })),
        ]);
        expect(doc.scenarios[0].files).toEqual(["s1.png"]);
        expect(doc.scenarios[2].steps).toEqual([{ step: "c", state: "skip", detail: "no scan report in this profile" }]);
        expect(doc).not.toHaveProperty("reason");
    });

    it("unverified ends the run with the reason and no steps for the scenarios that never ran", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["a", "b"], "node scripts/cdp/final-verify.mjs a b");
        r.unverified("dev app did not answer on :9230");
        expect(calls[1].doc).toMatchObject({ phase: "end", reason: "dev app did not answer on :9230", command: "node scripts/cdp/final-verify.mjs a b" });
        expect(calls[1].doc.scenarios).toEqual([
            { name: "a", files: [], steps: [], done: false },
            { name: "b", files: [], steps: [], done: false },
        ]);
        expect(calls[1].doc).not.toHaveProperty("shotsdir");
    });

    it("unverified keeps the steps of a scenario that did finish", () => {
        const { spawn, calls } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn });
        r.start(["s1", "s2"], "c");
        r.scenarioDone(pass, ["s1.png"]);
        r.unverified("stopped");
        expect(calls[2].doc.scenarios).toEqual([
            { name: "s1", files: ["s1.png"], steps: [{ step: "a", state: "pass", detail: "d" }], done: true },
            { name: "s2", files: [], steps: [], done: false },
        ]);
    });

    it("logs a failing report once, and later reports still go", () => {
        const logs = [];
        const { spawn, calls } = stubSpawn((n) => ({ status: n === 1 || n === 2 ? 1 : 0, stderr: "wavesrv is not running\nmore" }));
        const r = makeRunReporter({ env: inAgent, spawn, log: (l) => logs.push(l) });
        r.start(["s1"], "c");
        r.scenarioDone(pass, []);
        r.end([pass], {}, "cdp-shots");
        expect(calls).toHaveLength(3);
        expect(logs).toEqual(["verify report: wsh exited 1: wavesrv is not running"]);
    });

    it("logs a spawn that throws or cannot start wsh, never throws itself", () => {
        const logs = [];
        const throwing = makeRunReporter({
            env: inAgent,
            spawn: () => {
                throw new Error("spawn exploded");
            },
            log: (l) => logs.push(l),
        });
        expect(() => {
            throwing.start(["s1"], "c");
            throwing.scenarioDone(pass, []);
            throwing.end([pass], {}, "cdp-shots");
            throwing.unverified("x");
        }).not.toThrow();
        expect(logs).toEqual(["verify report: spawn exploded"]);

        const missing = [];
        const noWsh = makeRunReporter({ env: inAgent, spawn: () => ({ status: null, error: new Error("spawnSync wsh ENOENT") }), log: (l) => missing.push(l) });
        noWsh.start(["s1"], "c");
        noWsh.start(["s1"], "c");
        expect(missing).toEqual(["verify report: spawnSync wsh ENOENT"]);
    });

    it("does not throw when the arguments are not what it expects", () => {
        const { spawn } = stubSpawn();
        const r = makeRunReporter({ env: inAgent, spawn, log: () => {} });
        expect(() => r.end([pass], {}, undefined)).not.toThrow();
        expect(() => r.scenarioDone(undefined, undefined)).not.toThrow();
    });
});

describe("renderWait", () => {
    const start = 1_000_000;
    it("is rendered as soon as the nav is up", () => {
        expect(renderWait({ now: start + 5, start, startedAt: null, rendered: true, error: null })).toBe("rendered");
    });
    it("keeps waiting while the app's code has not started, past the render deadline", () => {
        expect(renderWait({ now: start + RENDER_WAIT_MS + 30_000, start, startedAt: null, rendered: false, error: null })).toBe("wait");
    });
    it("gives up as not loaded when the app's code has not started by the load deadline", () => {
        expect(renderWait({ now: start + LOAD_WAIT_MS, start, startedAt: null, rendered: false, error: null })).toBe("not-loaded");
    });
    it("starts the render deadline when the app's code starts", () => {
        const startedAt = start + 150_000;
        expect(renderWait({ now: startedAt + RENDER_WAIT_MS - 1, start, startedAt, rendered: false, error: null })).toBe("wait");
        expect(renderWait({ now: startedAt + RENDER_WAIT_MS, start, startedAt, rendered: false, error: null })).toBe("not-rendered");
    });
    it("an app that started but never renders fails even past the load deadline", () => {
        const startedAt = start + LOAD_WAIT_MS - 10_000;
        expect(renderWait({ now: start + LOAD_WAIT_MS + RENDER_WAIT_MS, start, startedAt, rendered: false, error: null })).toBe("not-rendered");
    });
    it("a boot error fails at once, started or not", () => {
        expect(renderWait({ now: start + 1, start, startedAt: null, rendered: false, error: "SyntaxError: x" })).toBe("boot-error");
        expect(renderWait({ now: start + 1, start, startedAt: start, rendered: false, error: "BOOT ERROR" })).toBe("boot-error");
    });
});
