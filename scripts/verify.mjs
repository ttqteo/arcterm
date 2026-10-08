// Verify for this repo's engine plans. At each merge the engine sets ARC_VERIFY_CHANGED to a file listing the
// paths the merge changed; this tests only what those paths can break. Unset (the final stage, or a human), it
// runs everything the patterns name. A failed Go or vitest test that passes when rerun alone is flaky: the run
// passes, and the test is appended to the file ARC_VERIFY_FLAKY names, so the engine reports it instead of a clean
// pass.
//
// usage: node scripts/verify.mjs <go package pattern>...

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// a change to one of these can move any test's outcome
const FRONTEND_CONFIG = new Set(["package.json", "package-lock.json", "vitest.config.ts", "tsconfig.json"]);
const TS_FILE = /\.(ts|tsx)$/;
const JS_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// the module's Go packages live under these; a path elsewhere cannot change what a Go test sees
const GO_DIRS = /^(pkg|cmd|db)\//;
// a package with at least this many top-level tests is split across processes: here those take 2.6 to 110 s, and
// below it all but one run in seconds
export const SHARD_MIN_TESTS = 100;
// pkg/orchestrate took ~100 s in one process, 37-52 s in 4, and 33 s in 6
export const SHARDS = 4;
// the sharded packages share this many test processes at once: two packages' shards overlap fully, and on this
// 12-core machine the rest stays with the run's workers, which compete for the same cores
export const MAX_TEST_PROCESSES = 2 * SHARDS;
const TOP_LEVEL_TEST = /^func (Test[A-Z0-9_]\w*)\s*\(/gm;
const LISTED_TEST = /^(Test|Example|Fuzz)\w*$/;

// needsGoGraph reports whether a Go package can hold one of the paths: listing the module's graph takes tens of
// seconds, and a merge of docs or frontend files cannot reach a Go test.
export function needsGoGraph(changed) {
    return changed.some((p) => p.endsWith(".go") || GO_DIRS.test(p));
}

// readChangedFile reads the engine's list, or returns null when it cannot, so Verify runs unscoped, never fails.
export function readChangedFile(path) {
    try {
        return readChanged(readFileSync(path, "utf8"));
    } catch (e) {
        console.error(`verify: could not read the changed-path list ${path}: ${e.message}; running everything`);
        return null;
    }
}

export function readChanged(text) {
    return text
        .split("\n")
        .map((l) => l.replace(/\r$/, "").trim().replace(/\\/g, "/"))
        .filter(Boolean);
}

export function planVerify(changed, graph, universe, modulePath) {
    const plan = { goAll: false, goPkgs: [], vitest: "none", tsc: false };
    const changedPkgs = new Set();
    const related = [];
    const pkgs = new Set(graph.map((p) => p.importPath));
    for (const path of changed) {
        if (path === "go.mod" || path === "go.sum") {
            plan.goAll = true;
            continue;
        }
        if (!path.endsWith(".go")) {
            // an embedded file (a migration, a default config, a script wsh ships) changes the package holding it
            const owner = owningPackage(path, pkgs, modulePath);
            if (owner) {
                changedPkgs.add(owner);
            }
        }
        if (path.endsWith(".go")) {
            const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
            changedPkgs.add(dir ? `${modulePath}/${dir}` : modulePath);
        } else if (FRONTEND_CONFIG.has(path)) {
            plan.tsc = true;
            plan.vitest = "all";
        } else if (JS_FILE.test(path)) {
            plan.tsc ||= TS_FILE.test(path);
            related.push(path);
        }
    }
    if (plan.vitest !== "all" && related.length > 0) {
        plan.vitest = related;
    }
    if (!plan.goAll) {
        // deps are transitive, so one pass finds every package a change reaches; test imports are direct only,
        // so they are matched against that reached set
        const reached = new Set(graph.filter((p) => changedPkgs.has(p.importPath) || p.deps.some((d) => changedPkgs.has(d))).map((p) => p.importPath));
        plan.goPkgs = graph
            .filter((p) => universe.has(p.importPath) && (reached.has(p.importPath) || p.testImports.some((i) => reached.has(i))))
            .map((p) => p.importPath);
    }
    return plan;
}

// owningPackage is the Go package in the nearest directory above path, never the module root, which would
// claim every file in the repo.
function owningPackage(path, pkgs, modulePath) {
    let dir = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
    while (dir) {
        if (pkgs.has(`${modulePath}/${dir}`)) {
            return `${modulePath}/${dir}`;
        }
        dir = dir.slice(0, Math.max(dir.lastIndexOf("/"), 0));
    }
    return null;
}

export function countTopLevelTests(source) {
    return [...source.matchAll(TOP_LEVEL_TEST)].filter((m) => m[1] !== "TestMain").length;
}

export function dealShards(names, n) {
    const shards = Array.from({ length: Math.min(n, names.length) }, () => []);
    names.forEach((name, i) => shards[i % shards.length].push(name));
    return shards;
}

export function runPattern(names) {
    return `^(${names.join("|")})$`;
}

export function goSummary(pkg, ok, seconds) {
    return `${ok ? "ok  " : "FAIL"}\t${pkg}\t${seconds.toFixed(3)}s`;
}

// a top-level test's failure; a subtest's line is indented, and rerunning its parent reruns it
const FAILED_TEST = /^--- FAIL: (\S+) \(/gm;
// a failure that stopped the process, so the tests after it never ran and a rerun of the named ones proves nothing
const PROCESS_DIED = /^panic: |^\*\*\* Test killed|test timed out after/m;
const PACKAGE_RESULT = /^(ok\s*|FAIL)\t(\S+)/;

// rerunnableTests names the failed tests of one package's output when rerunning them alone can settle a flake, or
// returns null: a build error, a panic or a timeout names no test to rerun, or stopped the tests after it.
export function rerunnableTests(output) {
    if (PROCESS_DIED.test(output)) {
        return null;
    }
    const names = [...output.matchAll(FAILED_TEST)].map((m) => m[1]);
    return names.length > 0 ? names : null;
}

// packageResults splits go test's output into each package's lines, ending at its ok or FAIL line.
export function packageResults(output) {
    const results = [];
    let lines = [];
    for (const line of output.split("\n")) {
        lines.push(line);
        const m = line.match(PACKAGE_RESULT);
        if (m) {
            results.push({ pkg: m[2], ok: m[1].trim() === "ok", output: lines.join("\n") });
            lines = [];
        }
    }
    return results;
}

// partitionPackages splits the packages into those whose tests are dealt across SHARDS processes and those run by
// one plain go test. a package go list could not resolve has no dir; go test reports why.
export function partitionPackages(pkgs, countOf) {
    const sharded = pkgs.filter((p) => p.dir && countOf(p.dir) >= SHARD_MIN_TESTS);
    const plain = pkgs.filter((p) => !sharded.includes(p));
    return { sharded, plain };
}

// goTestEnv turns cgo on for go test: the store's tests need sqlite, and without a C compiler on PATH go falls back
// to cgo off and every one of them panics. On Windows the compiler is zig, the same one the Taskfile builds wavesrv
// with; a CC the caller set wins.
export function goTestEnv(env, platform, arch) {
    if (platform !== "win32" || env.CC) {
        return env;
    }
    const target = arch === "arm64" ? "aarch64-windows-gnu" : "x86_64-windows-gnu";
    return { ...env, CGO_ENABLED: "1", CC: `zig cc -target ${target}` };
}

// runStatus runs cmd with its output streamed and returns its exit status; a command that could not start ends Verify.
function runStatus(cmd, args, env = process.env) {
    console.log(`verify: ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { stdio: "inherit", env });
    if (r.error) {
        console.error(`verify: could not run ${cmd}: ${r.error.message}`);
        process.exit(1);
    }
    return r.status ?? 1;
}

function run(cmd, args, env = process.env) {
    const status = runStatus(cmd, args, env);
    if (status !== 0) {
        process.exit(status);
    }
}

function goList(args) {
    const r = spawnSync("go", ["list", "-e", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
        console.error(`verify: go list ${args.join(" ")} failed:\n${r.stderr}`);
        process.exit(1);
    }
    return r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

function goGraph() {
    const sep = "\t";
    const fmt = `{{.ImportPath}}${sep}{{join .Deps " "}}${sep}{{join .TestImports " "}} {{join .XTestImports " "}}`;
    return goList(["-f", fmt, "./..."]).map((line) => {
        const [importPath, deps = "", tests = ""] = line.split(sep);
        return { importPath, deps: deps.split(" ").filter(Boolean), testImports: tests.split(" ").filter(Boolean) };
    });
}

function goPackages(args) {
    return goList(["-f", "{{.ImportPath}}\t{{.Dir}}", ...args]).map((line) => {
        const [importPath, dir = ""] = line.split("\t");
        return { importPath, dir };
    });
}

function testSource(dir) {
    return readdirSync(dir)
        .filter((f) => f.endsWith("_test.go"))
        .map((f) => readFileSync(join(dir, f), "utf8"))
        .join("\n");
}

// goTest runs the packages like go test, except that a package with many tests is built once and its tests are
// dealt across SHARDS processes; go test runs one package's tests in one process however many cores are idle.
// The sharded packages run even when a plain one failed, so the fix round sees every failure.
async function goTest(args) {
    const env = goTestEnv(process.env, process.platform, process.arch);
    const { sharded, plain } = partitionPackages(goPackages(args), (dir) => countTopLevelTests(testSource(dir)));
    const flaky = [];
    let ok = plain.length === 0 || (await goTestPlain(plain.map((p) => p.importPath), env, flaky));
    if (sharded.length > 0) {
        const tmp = mkdtempSync(join(tmpdir(), "arc-verify-"));
        try {
            console.log(`verify: testing ${sharded.map((p) => p.importPath).join(" ")} at once, at most ${MAX_TEST_PROCESSES} test processes`);
            const write = (s) => process.stdout.write(s);
            ok = (await testSharded(sharded, MAX_TEST_PROCESSES, shardProcs(tmp, env), write, flaky)) && ok;
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    }
    if (flaky.length > 0) {
        console.log(`verify: flaky, failed and then passed when rerun alone: ${flaky.join(", ")}`);
    }
    if (!ok) {
        process.exit(1);
    }
    reportFlaky(flaky, process.env);
}

// reportFlaky appends each flaky test, one per line, to the file the engine names in ARC_VERIFY_FLAKY, so the run
// names them among what it did not verify instead of reading as a clean pass. A human's run has no file to write.
export function reportFlaky(flaky, env) {
    const file = env.ARC_VERIFY_FLAKY;
    if (!file || flaky.length === 0) {
        return;
    }
    appendFileSync(file, flaky.map((name) => `${name}\n`).join(""));
}

const OUTPUT_MAX = 256 * 1024 * 1024;

// rerunAlone reruns a package's failed tests once, in one process. Passing alone, they failed on what another test
// left behind or on load, so they are reported as flaky rather than failing the merge and costing a fix round;
// failing again, the failure is real. rerun resolves to { ok, output }; write takes what the rerun printed.
async function rerunAlone(pkg, names, flaky, rerun, write) {
    if (names == null) {
        return false;
    }
    write(`verify: rerunning ${names.join(", ")} of ${pkg} alone\n`);
    const r = await rerun(runPattern(names));
    write(r.output);
    if (!r.ok) {
        return false;
    }
    flaky.push(...names.map((n) => `${pkg} ${n}`));
    return true;
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const XML_ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const TESTCASE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

function unescapeXml(s) {
    return s.replace(XML_ENTITY, (m, e) => {
        if (e[0] !== "#") {
            return XML_ENTITIES[e.toLowerCase()];
        }
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code <= 0x10ffff ? String.fromCodePoint(code) : m;
    });
}

function xmlAttr(attrs, name) {
    const m = attrs.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? unescapeXml(m[1]) : null;
}

// failedVitestTests reads vitest's JUnit report for the test cases that failed, each { file, name }, or returns
// null when rerunning them alone cannot settle the failure: the report is missing or not XML, it names no failed
// case (a crash, or a failure outside any test), or a failed case is a whole file's (vitest reports a collection
// error as a case named for its file), so a rerun of the other files would hide it.
export function failedVitestTests(xml) {
    if (typeof xml !== "string") {
        return null;
    }
    const failed = [];
    for (const m of xml.matchAll(TESTCASE)) {
        if (!/<(failure|error)\b/.test(m[2] ?? "")) {
            continue;
        }
        const file = xmlAttr(m[1], "classname");
        const name = xmlAttr(m[1], "name");
        if (!file || !name || name === file) {
            return null;
        }
        failed.push({ file, name });
    }
    return failed.length > 0 ? failed : null;
}

// failedVitestFiles is the test files of failedVitestTests, each once, or null when the failure is not one to rerun.
export function failedVitestFiles(xml) {
    const failed = failedVitestTests(xml);
    return failed ? [...new Set(failed.map((t) => t.file))] : null;
}

// rerunVitestAlone is rerunAlone for vitest: it reruns the files of the failed tests once, in one process. Passing
// alone, the tests timed out or collided with another file's on a loaded machine, so they are reported as flaky
// rather than failing the merge; failing again, the failure is real. rerun takes the files and returns { ok }.
export function rerunVitestAlone(failed, flaky, rerun, write) {
    if (failed == null) {
        return false;
    }
    const files = [...new Set(failed.map((t) => t.file))];
    write(`verify: rerunning ${files.join(", ")} alone\n`);
    if (!rerun(files).ok) {
        return false;
    }
    flaky.push(...failed.map((t) => `${t.file} > ${t.name}`));
    return true;
}

async function goTestPlain(pkgs, env, flaky) {
    console.log(`verify: go test ${pkgs.join(" ")}`);
    const r = spawnSync("go", ["test", ...pkgs], { env, encoding: "utf8", maxBuffer: OUTPUT_MAX });
    if (r.error) {
        console.error(`verify: could not run go: ${r.error.message}`);
        return false;
    }
    process.stdout.write(r.stdout);
    process.stderr.write(r.stderr);
    if (r.status === 0) {
        return true;
    }
    const failures = packageResults(r.stdout).filter((p) => !p.ok);
    const rerun = (pkg) => (pattern) => {
        const again = spawnSync("go", ["test", "-count=1", "-run", pattern, pkg], { env, encoding: "utf8", maxBuffer: OUTPUT_MAX });
        const output = again.error ? `verify: could not run go: ${again.error.message}\n` : again.stdout + again.stderr;
        return { ok: !again.error && again.status === 0, output };
    };
    for (const p of failures) {
        if (!(await rerunAlone(p.pkg, rerunnableTests(p.output), flaky, rerun(p.pkg), (s) => process.stdout.write(s)))) {
            return false;
        }
    }
    return failures.length > 0;
}

// limiter runs at most n of the tasks handed to it at once, and the rest in the order they arrived.
export function limiter(n) {
    let active = 0;
    const waiting = [];
    const next = () => {
        while (active < n && waiting.length > 0) {
            active++;
            waiting.shift()();
        }
    };
    return (task) =>
        new Promise((resolve, reject) => {
            waiting.push(() =>
                task()
                    .then(resolve, reject)
                    .finally(() => {
                        active--;
                        next();
                    })
            );
            next();
        });
}

// testSharded runs the sharded packages at the same time: each is built at once, and their test processes (list,
// shards and reruns) share limit slots. A package's output is written in one piece when it finishes, ending with
// its ok or FAIL line, so the engine reads each package as it reads go test's. proc.build(pkg) and
// proc.run(pkg, args) resolve to { ok, output }, run's also with stdout alone.
export async function testSharded(pkgs, limit, proc, write, flaky) {
    const slot = limiter(limit);
    const run = (pkg, args) => slot(() => proc.run(pkg, args));
    const results = await Promise.all(
        pkgs.map(async (pkg) => {
            const out = [];
            const ok = await testOneSharded(pkg, proc.build, run, (s) => out.push(s), flaky);
            write(out.join(""));
            return ok;
        })
    );
    return results.every(Boolean);
}

async function testOneSharded(pkg, build, run, write, flaky) {
    const start = Date.now();
    const built = await build(pkg);
    write(built.output);
    if (!built.ok) {
        write(`verify: could not build the tests of ${pkg.importPath}\nFAIL\t${pkg.importPath} [build failed]\n`);
        return false;
    }
    // a TestMain logs to stderr, so stdout holds only the names
    const listed = await run(pkg, ["-test.list", "."]);
    if (!listed.ok) {
        write(`verify: could not list the tests of ${pkg.importPath}:\n${listed.output}`);
        write(`${goSummary(pkg.importPath, false, (Date.now() - start) / 1000)}\n`);
        return false;
    }
    const names = listed.stdout.split("\n").map((l) => l.trim()).filter((l) => LISTED_TEST.test(l));
    const results = await Promise.all(dealShards(names, SHARDS).map((shard) => run(pkg, ["-test.run", runPattern(shard), "-test.timeout=10m"])));
    for (const r of results) {
        write(r.output);
    }
    let ok = true;
    for (const r of results.filter((r) => !r.ok)) {
        const rerun = (pattern) => run(pkg, ["-test.run", pattern, "-test.timeout=10m"]);
        if (!(await rerunAlone(pkg.importPath, rerunnableTests(r.output), flaky, rerun, write))) {
            ok = false;
            break;
        }
    }
    write(`${goSummary(pkg.importPath, ok, (Date.now() - start) / 1000)}\n`);
    return ok;
}

// shardProcs builds each package's tests into tmp with go test -c, and runs the binary in the package's
// directory, as go test does.
function shardProcs(tmp, env) {
    const bins = new Map();
    const exe = process.platform === "win32" ? ".exe" : "";
    return {
        build: (pkg) => {
            const bin = join(tmp, `${bins.size}.test${exe}`);
            bins.set(pkg.importPath, bin);
            return capture("go", ["test", "-c", "-o", bin, pkg.importPath], { env });
        },
        run: (pkg, args) => capture(bins.get(pkg.importPath), args, { cwd: pkg.dir }),
    };
}

// capture runs cmd to its end and resolves to its exit status, its stdout, and its stdout and stderr as they
// interleaved.
function capture(cmd, args, opts) {
    return new Promise((done) => {
        const stdout = [];
        const all = [];
        const child = spawn(cmd, args, opts);
        child.stdout.on("data", (c) => {
            stdout.push(c);
            all.push(c);
        });
        child.stderr.on("data", (c) => all.push(c));
        child.on("error", (e) => done({ ok: false, stdout: "", output: `verify: could not run ${cmd}: ${e.message}\n` }));
        child.on("close", (code) =>
            done({ ok: code === 0, stdout: Buffer.concat(stdout).toString("utf8"), output: Buffer.concat(all).toString("utf8") })
        );
    });
}

const VITEST = ["node_modules/vitest/vitest.mjs", "run"];
const TSC = ["--stack-size=4000", "node_modules/typescript/lib/tsc.js", "--noEmit"];
// vitest.config.ts has vitest write this JUnit report at the repo root
const VITEST_REPORT = "test-results.xml";

// runVitest runs vitest with args, its output streamed. A failed run is judged by the JUnit report: the failed test
// files are rerun once, and passing alone they are reported as flaky, not as a failure.
function runVitest(args) {
    // a report left by an earlier run must not name the failures of this one
    rmSync(VITEST_REPORT, { force: true });
    const status = runStatus("node", args);
    if (status === 0) {
        return;
    }
    // read before the rerun overwrites it
    let xml = null;
    try {
        xml = readFileSync(VITEST_REPORT, "utf8");
    } catch {}
    const flaky = [];
    const rerun = (files) => ({ ok: runStatus("node", [...VITEST, ...files]) === 0 });
    if (!rerunVitestAlone(failedVitestTests(xml), flaky, rerun, (s) => process.stdout.write(s))) {
        process.exit(status);
    }
    console.log(`verify: flaky, failed and then passed when rerun alone: ${flaky.join(", ")}`);
    reportFlaky(flaky, process.env);
}

async function main(patterns) {
    if (patterns.length === 0) {
        console.error("usage: node scripts/verify.mjs <go package pattern>...");
        process.exit(2);
    }
    const listFile = process.env.ARC_VERIFY_CHANGED;
    const changed = listFile ? readChangedFile(listFile) : null;
    if (!changed) {
        await goTest(patterns);
        runVitest(VITEST);
        return;
    }
    const modulePath = readFileSync("go.mod", "utf8").match(/^module\s+(\S+)/m)[1];
    const goChanged = needsGoGraph(changed);
    const graph = goChanged ? goGraph() : [];
    const universe = goChanged ? new Set(goList(patterns)) : new Set();
    const plan = planVerify(changed, graph, universe, modulePath);
    const goArgs = plan.goAll ? patterns : plan.goPkgs;
    if (goArgs.length === 0 && plan.vitest === "none" && !plan.tsc) {
        console.log(`verify: nothing to test for the ${changed.length} changed path(s)`);
        return;
    }
    if (goArgs.length > 0) {
        await goTest(goArgs);
    }
    if (plan.tsc) {
        run("node", TSC);
    }
    if (plan.vitest === "all") {
        runVitest(VITEST);
    } else if (Array.isArray(plan.vitest)) {
        // vitest related takes source files and runs the tests that import them; a deleted file is in no import
        // graph, so the tests that imported it are found only by running everything
        const present = plan.vitest.filter((p) => existsSync(p));
        if (present.length < plan.vitest.length) {
            runVitest(VITEST);
        } else {
            runVitest(["node_modules/vitest/vitest.mjs", "related", "--run", ...present]);
        }
    }
}

// run as a script, not when the test imports it; Windows may differ in the drive letter's case
const self = fileURLToPath(import.meta.url).toLowerCase();
if (process.argv[1] && resolve(process.argv[1]).toLowerCase() === self) {
    main(process.argv.slice(2)).catch((e) => {
        console.error(`verify: ${e.stack ?? e}`);
        process.exit(1);
    });
}
