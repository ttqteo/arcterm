import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHARDS, SHARD_MIN_TESTS, countTopLevelTests, dealShards, failedVitestFiles, failedVitestTests, goSummary, goTestEnv, limiter, needsGoGraph, packageResults, partitionPackages, planVerify, readChanged, readChangedFile, reportFlaky, rerunVitestAlone, rerunnableTests, runPattern, testSharded } from "./verify.mjs";

const MOD = "github.com/wavetermdev/waveterm";
const graph = [
    { importPath: `${MOD}/pkg/util`, deps: [], testImports: [] },
    { importPath: `${MOD}/pkg/orchestrate`, deps: [`${MOD}/pkg/util`], testImports: [] },
    { importPath: `${MOD}/pkg/wshrpc`, deps: [`${MOD}/pkg/orchestrate`, `${MOD}/pkg/util`], testImports: [] },
    { importPath: `${MOD}/pkg/jarvis`, deps: [], testImports: [`${MOD}/pkg/testkit`] },
    { importPath: `${MOD}/pkg/testkit`, deps: [`${MOD}/pkg/util`], testImports: [] },
    { importPath: `${MOD}/pkg/filestore`, deps: [`${MOD}/pkg/util`], testImports: [] },
];
const universe = new Set(graph.map((p) => p.importPath).filter((p) => !p.endsWith("filestore") && !p.endsWith("testkit")));

describe("planVerify", () => {
    it("tests a changed package and every package that imports it, within the patterns", () => {
        const plan = planVerify(["pkg/util/strings.go"], graph, universe, MOD);
        expect(plan.goAll).toBe(false);
        expect(plan.goPkgs).toEqual([`${MOD}/pkg/util`, `${MOD}/pkg/orchestrate`, `${MOD}/pkg/wshrpc`, `${MOD}/pkg/jarvis`]);
    });
    it("follows a test-only import to the package whose tests use it", () => {
        expect(planVerify(["pkg/testkit/kit.go"], graph, universe, MOD).goPkgs).toEqual([`${MOD}/pkg/jarvis`]);
    });
    it("runs every pattern when go.mod or go.sum changed", () => {
        expect(planVerify(["go.sum"], graph, universe, MOD).goAll).toBe(true);
    });
    it("tolerates a deleted package", () => {
        expect(planVerify(["pkg/gone/gone.go"], graph, universe, MOD).goPkgs).toEqual([]);
    });
    it("typechecks and runs the related vitest files for a frontend change", () => {
        const plan = planVerify(["frontend/app/view/agents/runmodel.ts"], graph, universe, MOD);
        expect(plan).toMatchObject({ tsc: true, vitest: ["frontend/app/view/agents/runmodel.ts"], goPkgs: [] });
    });
    it("runs all of vitest for a config change", () => {
        expect(planVerify(["package.json"], graph, universe, MOD)).toMatchObject({ tsc: true, vitest: "all" });
    });
    it("runs vitest, not tsc, for a script change", () => {
        expect(planVerify(["scripts/cdp/final-verify.mjs"], graph, universe, MOD)).toMatchObject({ tsc: false, vitest: ["scripts/cdp/final-verify.mjs"] });
    });
    it("maps a non-Go file to the Go package whose directory holds it", () => {
        expect(planVerify(["pkg/util/defaults/settings.json"], graph, universe, MOD).goPkgs).toEqual([`${MOD}/pkg/util`, `${MOD}/pkg/orchestrate`, `${MOD}/pkg/wshrpc`, `${MOD}/pkg/jarvis`]);
    });
    it("tests the Go package that embeds a script, and the script's own tests", () => {
        const plan = planVerify(["pkg/util/ext.ts"], graph, universe, MOD);
        expect(plan).toMatchObject({ tsc: true, vitest: ["pkg/util/ext.ts"] });
        expect(plan.goPkgs).toContain(`${MOD}/pkg/util`);
    });
    it("selects nothing for docs", () => {
        expect(planVerify(["docs/open-issues.md", "AGENTS.md"], graph, universe, MOD)).toEqual({ goAll: false, goPkgs: [], vitest: "none", tsc: false });
    });
});

describe("readChanged", () => {
    it("drops blanks and carriage returns and normalizes slashes", () => {
        expect(readChanged("pkg\\util\\a.go\r\n\r\ndocs/x.md\r\n")).toEqual(["pkg/util/a.go", "docs/x.md"]);
    });
});

describe("needsGoGraph", () => {
    it("lists the Go graph only for paths a Go package can hold", () => {
        expect(needsGoGraph(["docs/a.md", "frontend/app/x.ts", "package.json"])).toBe(false);
        expect(needsGoGraph(["db/migrations-wstore/000001_init.up.sql"])).toBe(true);
        expect(needsGoGraph(["pkg/util/a.go"])).toBe(true);
    });
});

describe("readChangedFile", () => {
    it("returns null for a list it cannot read, so Verify runs unscoped", () => {
        expect(readChangedFile(join(tmpdir(), "no-such-arc-verify-list.txt"))).toBeNull();
    });
});

describe("sharding", () => {
    it("counts top-level tests, not TestMain, helpers or methods", () => {
        const src = [
            "func TestMain(m *testing.M) {}",
            "func TestA(t *testing.T) {}",
            "func Test_b(t *testing.T) {}",
            "func Testhelper(t *testing.T) {}",
            "func (s *suite) TestC(t *testing.T) {}",
            "  func TestIndented(t *testing.T) {}",
            "func TestD (t *testing.T) {}",
        ].join("\n");
        expect(countTopLevelTests(src)).toBe(3);
    });
    it("deals names round robin and keeps order within a shard", () => {
        expect(dealShards(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "c", "e"], ["b", "d"]]);
    });
    it("makes no empty shard when there are fewer names than shards", () => {
        expect(dealShards(["a", "b"], SHARDS)).toEqual([["a"], ["b"]]);
    });
    it("anchors the run pattern so TestA does not also run TestAB", () => {
        expect(runPattern(["TestA", "TestB"])).toBe("^(TestA|TestB)$");
    });
    it("summarizes a package like go test, so the engine's excerpt finds FAIL", () => {
        expect(goSummary("example.com/m/pkg/a", true, 1.5)).toBe("ok  \texample.com/m/pkg/a\t1.500s");
        expect(goSummary("example.com/m/pkg/a", false, 2)).toBe("FAIL\texample.com/m/pkg/a\t2.000s");
    });
    it("shards a package at the threshold and runs one below it plain", () => {
        const pkgs = [
            { importPath: "m/pkg/a", dir: "/a" },
            { importPath: "m/pkg/b", dir: "/b" },
        ];
        const counts = { "/a": SHARD_MIN_TESTS, "/b": SHARD_MIN_TESTS - 1 };
        const { sharded, plain } = partitionPackages(pkgs, (dir) => counts[dir]);
        expect(sharded.map((p) => p.importPath)).toEqual(["m/pkg/a"]);
        expect(plain.map((p) => p.importPath)).toEqual(["m/pkg/b"]);
    });
    it("runs a package go list could not resolve plain, without counting its tests", () => {
        const seen = [];
        const { sharded, plain } = partitionPackages([{ importPath: "m/pkg/gone", dir: "" }], (dir) => {
            seen.push(dir);
            return SHARD_MIN_TESTS;
        });
        expect(sharded).toEqual([]);
        expect(plain.map((p) => p.importPath)).toEqual(["m/pkg/gone"]);
        expect(seen).toEqual([]);
    });
});

describe("rerunning a failure alone", () => {
    it("names the failed top-level tests, not their subtests", () => {
        const out = [
            "--- FAIL: TestABatchOfOneFailsWithoutBisecting (0.41s)",
            "    verifybisect_test.go:129: today's wake, got []",
            "--- FAIL: TestTable (0.00s)",
            "    --- FAIL: TestTable/empty (0.00s)",
            "FAIL",
        ].join("\n");
        expect(rerunnableTests(out)).toEqual(["TestABatchOfOneFailsWithoutBisecting", "TestTable"]);
    });
    it("reruns nothing when the process died, since the tests after the failure never ran", () => {
        expect(rerunnableTests("--- FAIL: TestA (0.00s)\npanic: runtime error [recovered]\nFAIL")).toBeNull();
        expect(rerunnableTests("panic: test timed out after 10m0s\nrunning tests:\n\tTestA (10m0s)")).toBeNull();
    });
    it("reruns nothing for a failure with no failed test, such as a build error", () => {
        expect(rerunnableTests("# m/pkg/a\npkg/a/a.go:3:1: syntax error\nFAIL\tm/pkg/a [build failed]")).toBeNull();
    });
    it("splits go test's output into each package's result", () => {
        const out = [
            "ok  \tm/pkg/a\t0.5s",
            "--- FAIL: TestB (0.00s)",
            "FAIL",
            "FAIL\tm/pkg/b\t1.2s",
            "ok  \tm/pkg/c\t(cached)",
            "FAIL",
        ].join("\n");
        const results = packageResults(out);
        expect(results.map((r) => [r.pkg, r.ok])).toEqual([
            ["m/pkg/a", true],
            ["m/pkg/b", false],
            ["m/pkg/c", true],
        ]);
        expect(rerunnableTests(results[1].output)).toEqual(["TestB"]);
    });
});

// junit builds the part of vitest's JUnit report the parser reads: one testcase per [file, name, verdict], where a
// verdict of "failure" or "error" gives the case that child and anything else leaves it passing (a skipped case too).
function junit(cases) {
    const body = cases.map(([file, name, verdict]) => {
        const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        const child = verdict === "failure" || verdict === "error" ? `\n            <${verdict} message="boom" type="Error">\nError: boom\n            </${verdict}>\n        ` : verdict === "skipped" ? "<skipped/>" : "\n        ";
        return `        <testcase classname="${esc(file)}" name="${esc(name)}" time="0.001">${child}</testcase>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" ?>\n<testsuites name="vitest tests">\n    <testsuite name="x">\n${body.join("\n")}\n    </testsuite>\n</testsuites>\n`;
}

describe("rerunning failed vitest files alone", () => {
    const A = "scripts/cdp-shot.test.mjs";
    const B = "frontend/app/view/agents/gridstore.persist.test.ts";
    it("names each file with a failed case once, across files", () => {
        const xml = junit([
            [A, "exits nonzero with an actionable message when the port is closed", "failure"],
            [A, "passes", "pass"],
            [B, "gridstore > starts empty for a profile that never stored a grid", "failure"],
        ]);
        expect(failedVitestFiles(xml)).toEqual([A, B]);
    });
    it("names a file once when two of its cases failed", () => {
        const xml = junit([
            [B, "first", "failure"],
            [B, "second", "error"],
            [A, "passes", "pass"],
        ]);
        expect(failedVitestFiles(xml)).toEqual([B]);
    });
    it("names the failed cases, with the report's escapes undone", () => {
        const xml = junit([
            [A, "suite > takes <a> & \"b\"", "failure"],
            [A, "passes", "pass"],
        ]);
        expect(failedVitestTests(xml)).toEqual([{ file: A, name: 'suite > takes <a> & "b"' }]);
    });
    it("has nothing to rerun for a report that passed or skipped everything", () => {
        expect(failedVitestFiles(junit([[A, "a", "pass"], [B, "b", "skipped"]]))).toBeNull();
        expect(failedVitestFiles(junit([]))).toBeNull();
    });
    it("has nothing to rerun for text that is not a report, or no report", () => {
        expect(failedVitestFiles("RUN v3.0.0\n FAIL scripts/a.test.mjs\n")).toBeNull();
        expect(failedVitestFiles("")).toBeNull();
        expect(failedVitestFiles(null)).toBeNull();
    });
    it("calls a collection error real, even beside a failed test, since a rerun of the other files would hide it", () => {
        // vitest reports a file that failed to load as a case named for the file itself
        const xml = junit([
            [A, "flaky one", "failure"],
            [B, B, "failure"],
        ]);
        expect(failedVitestFiles(xml)).toBeNull();
        expect(failedVitestFiles(junit([[B, B, "failure"]]))).toBeNull();
    });
    it("reads a self-closing passing case and a failed case after it", () => {
        const xml = `<testsuite><testcase classname="${A}" name="ok" time="0"/><testcase classname="${A}" name="bad" time="0"><failure message="x"></failure></testcase></testsuite>`;
        expect(failedVitestTests(xml)).toEqual([{ file: A, name: "bad" }]);
    });

    const run = (failed, ok) => {
        const calls = [];
        const flaky = [];
        const out = [];
        const result = rerunVitestAlone(failed, flaky, (files) => (calls.push(files), { ok }), (s) => out.push(s));
        return { result, calls, flaky, out: out.join("") };
    };
    const failed = [
        { file: A, name: "exits nonzero" },
        { file: B, name: "starts empty" },
        { file: B, name: "other" },
    ];
    it("records the tests as flaky when the files pass alone, rerunning each file once in one process", () => {
        const { result, calls, flaky, out } = run(failed, true);
        expect(result).toBe(true);
        expect(calls).toEqual([[A, B]]);
        expect(flaky).toEqual([`${A} > exits nonzero`, `${B} > starts empty`, `${B} > other`]);
        expect(out).toContain(`verify: rerunning ${A}, ${B} alone`);
    });
    it("fails, recording nothing, when the files fail again alone", () => {
        const { result, calls, flaky } = run(failed, false);
        expect(result).toBe(false);
        expect(calls).toEqual([[A, B]]);
        expect(flaky).toEqual([]);
    });
    it("reruns nothing when the failure names no test to rerun", () => {
        const { result, calls, flaky } = run(null, true);
        expect(result).toBe(false);
        expect(calls).toEqual([]);
        expect(flaky).toEqual([]);
    });
    it("hands the flaky tests to reportFlaky as the lines the engine lists", () => {
        const { flaky } = run(failed, true);
        const file = join(mkdtempSync(join(tmpdir(), "verify-flaky-")), "flaky.txt");
        writeFileSync(file, "");
        reportFlaky(flaky, { ARC_VERIFY_FLAKY: file });
        expect(readFileSync(file, "utf8")).toBe(`${A} > exits nonzero\n${B} > starts empty\n${B} > other\n`);
    });
});

describe("goTestEnv", () => {
    it("turns cgo on with zig on Windows, so the sqlite tests run", () => {
        expect(goTestEnv({ PATH: "p" }, "win32", "x64")).toEqual({
            PATH: "p",
            CGO_ENABLED: "1",
            CC: "zig cc -target x86_64-windows-gnu",
        });
        expect(goTestEnv({}, "win32", "arm64").CC).toBe("zig cc -target aarch64-windows-gnu");
    });

    it("leaves a caller's CC and other platforms alone", () => {
        const env = { CC: "gcc" };
        expect(goTestEnv(env, "win32", "x64")).toBe(env);
        const linux = { PATH: "p" };
        expect(goTestEnv(linux, "linux", "x64")).toBe(linux);
    });
});

describe("reportFlaky", () => {
    it("appends each flaky test on its own line to the file ARC_VERIFY_FLAKY names", () => {
        const file = join(mkdtempSync(join(tmpdir(), "verify-flaky-")), "flaky.txt");
        writeFileSync(file, "");
        reportFlaky([`${MOD}/pkg/orchestrate TestA`, `${MOD}/pkg/jarvis TestB`], { ARC_VERIFY_FLAKY: file });
        expect(readFileSync(file, "utf8")).toBe(`${MOD}/pkg/orchestrate TestA\n${MOD}/pkg/jarvis TestB\n`);
    });
    it("writes nothing for a clean pass", () => {
        const file = join(mkdtempSync(join(tmpdir(), "verify-flaky-")), "flaky.txt");
        writeFileSync(file, "");
        reportFlaky([], { ARC_VERIFY_FLAKY: file });
        expect(readFileSync(file, "utf8")).toBe("");
    });
    it("needs no file when the engine did not name one", () => {
        expect(() => reportFlaky(["TestA"], {})).not.toThrow();
    });
});

// fakeProcs stands in for go test -c and the test binaries. Each package lists `tests` tests; a test in `fails`
// fails every run, one in `failsOnce` fails its first run only, and a package in `broken` does not build. Each run
// waits a few timers, so runs of different packages finish interleaved.
function fakeProcs({ tests = 6, fails = [], failsOnce = [], broken = [] } = {}) {
    const stats = { active: 0, max: 0, runs: 0 };
    const ran = new Set();
    const tick = (n) => new Promise((r) => setTimeout(r, n));
    const proc = {
        build: async (pkg) => {
            await tick(1);
            return broken.includes(pkg.importPath) ? { ok: false, output: `# ${pkg.importPath}\nsyntax error\n` } : { ok: true, output: "" };
        },
        run: async (pkg, args) => {
            stats.active++;
            stats.max = Math.max(stats.max, stats.active);
            stats.runs++;
            await tick(1 + (stats.runs % 3));
            stats.active--;
            const names = Array.from({ length: tests }, (_, i) => `Test${pkg.tag}${i}`);
            if (args[0] === "-test.list") {
                return { ok: true, stdout: names.join("\n"), output: names.join("\n") };
            }
            const lines = [];
            let ok = true;
            for (const name of args[1].slice(2, -2).split("|")) {
                const failed = fails.includes(name) || (failsOnce.includes(name) && !ran.has(name));
                ran.add(name);
                ok &&= !failed;
                lines.push(failed ? `--- FAIL: ${name} (0.00s)\n    ${pkg.tag}_test.go:1: broke\n` : `=== ${pkg.tag} ran ${name}\n`);
            }
            return { ok, stdout: "", output: lines.join("") + (ok ? "PASS\n" : "FAIL\n") };
        },
    };
    return { proc, stats };
}

const pkgsNamed = (...tags) => tags.map((tag) => ({ importPath: `m/pkg/${tag}`, dir: `/${tag}`, tag }));

async function runAll(pkgs, limit, fake) {
    const writes = [];
    const flaky = [];
    const ok = await testSharded(pkgs, limit, fake.proc, (s) => writes.push(s), flaky);
    return { ok, writes, flaky, out: writes.join("") };
}

describe("limiter", () => {
    it("runs at most n tasks at once and all of them in the end", async () => {
        const slot = limiter(2);
        let active = 0;
        let max = 0;
        const task = (v) => async () => {
            active++;
            max = Math.max(max, active);
            await new Promise((r) => setTimeout(r, 1));
            active--;
            return v;
        };
        expect(await Promise.all([1, 2, 3, 4, 5].map((v) => slot(task(v))))).toEqual([1, 2, 3, 4, 5]);
        expect(max).toBe(2);
    });
    it("frees the slot of a task that failed", async () => {
        const slot = limiter(1);
        await expect(slot(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
        expect(await slot(async () => "next")).toBe("next");
    });
});

describe("testSharded", () => {
    it("overlaps the packages' test processes, never more than the limit at once", async () => {
        const fake = fakeProcs();
        const { ok } = await runAll(pkgsNamed("a", "b", "c"), SHARDS + 2, fake);
        expect(ok).toBe(true);
        // one package at a time would peak at SHARDS
        expect(fake.stats.max).toBe(SHARDS + 2);
        // a list and SHARDS shards per package
        expect(fake.stats.runs).toBe(3 * (1 + SHARDS));
    });
    it("writes each package's output in one piece, ending with its ok line", async () => {
        const pkgs = pkgsNamed("a", "b", "c");
        const { writes, out } = await runAll(pkgs, SHARDS + 2, fakeProcs());
        expect(writes).toHaveLength(pkgs.length);
        for (const w of writes) {
            const [, tag] = w.match(/^ok  \tm\/pkg\/(\w)\t/m);
            expect(w.trimEnd().split("\n").at(-1)).toMatch(new RegExp(`^ok  \tm/pkg/${tag}\t`));
            expect(w.match(/^=== (\w) ran /gm).every((l) => l === `=== ${tag} ran `)).toBe(true);
            expect(w.match(/^=== \w ran /gm)).toHaveLength(6);
        }
        expect(packageResults(out).map((r) => r.pkg).sort()).toEqual(pkgs.map((p) => p.importPath));
    });
    it("fails when one package fails and still reports the ones that passed", async () => {
        const { ok, out, flaky } = await runAll(pkgsNamed("a", "b"), SHARDS + 2, fakeProcs({ fails: ["Testa3"] }));
        expect(ok).toBe(false);
        expect(flaky).toEqual([]);
        const results = packageResults(out);
        expect(results.map((r) => [r.pkg, r.ok]).sort()).toEqual([
            ["m/pkg/a", false],
            ["m/pkg/b", true],
        ]);
        const a = results.find((r) => r.pkg === "m/pkg/a").output;
        expect(a).toContain("--- FAIL: Testa3 (0.00s)\n    a_test.go:1: broke\n");
        expect(a).toContain("verify: rerunning Testa3 of m/pkg/a alone");
        expect(rerunnableTests(a)).toEqual(["Testa3", "Testa3"]);
    });
    it("reports a failed test that passes alone as flaky and passes the package", async () => {
        const fake = fakeProcs({ failsOnce: ["Testb1"] });
        const { ok, out, flaky } = await runAll(pkgsNamed("a", "b"), SHARDS + 2, fake);
        expect(ok).toBe(true);
        expect(flaky).toEqual(["m/pkg/b Testb1"]);
        expect(packageResults(out).every((r) => r.ok)).toBe(true);
        expect(fake.stats.runs).toBe(2 * (1 + SHARDS) + 1);
    });
    it("fails a package that does not build and still tests the others", async () => {
        const { ok, out } = await runAll(pkgsNamed("a", "b"), SHARDS + 2, fakeProcs({ broken: ["m/pkg/a"] }));
        expect(ok).toBe(false);
        expect(out).toContain("# m/pkg/a\nsyntax error\n");
        expect(packageResults(out).map((r) => [r.pkg, r.ok]).sort()).toEqual([
            ["m/pkg/a", false],
            ["m/pkg/b", true],
        ]);
    });
});
