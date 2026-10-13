// Isolated CDP fixtures for the Setup surface scenarios. A scenario must never reach the real
// agentsync RPCs (write/apply/adopt touch the user's real harness files, vault and skills), so these
// helpers swap RpcApi's mock client for a deterministic in-page simulation of all nine agentsync
// commands, delegate every other command to the original route, and put any source file a scenario
// opens under a temporary folder. Installation is all-or-nothing: a partial install rolls itself back.
//
// Interfaces for the scenario author (scripts/cdp/scenarios.mjs):
//   createSetupFixture(name, tempRoot)  -> fixture (plain data: datasets + files to write)
//   installSetupFixture(h, fixture)     -> handle; throws (after rolling back) if it cannot install
//   restoreSetupFixture(h, handle)      -> restores the prior mock and removes the fixture's files
//   arrangeSetupFixture / teardownSetupFixture wrap temp-root creation + the above for scenario
//   arrange/teardown; assertSetupFixtureInstalled(h) is the hard gate before any mutation click.
//   readSetupFixture(h) / controlSetupFixture(h, op, arg) / callSummary(snapshot) drive and inspect it.
import * as nodeFs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, isAbsolute } from "node:path";

export const SETUP_SCENARIO_NAMES = ["setup-instructions", "setup-skills", "setup-import", "setup-narrow"];

const WINDOW_KEY = "__arcSetupFixture";

export class SetupFixtureError extends Error {
    constructor(message, errors) {
        super(message);
        this.name = "SetupFixtureError";
        this.errors = errors;
    }
}

const msg = (e) => String(e?.message ?? e);

// the primary error plus every failure of its cleanup, so neither is lost
function combine(primary, secondary, label) {
    if (secondary.length === 0) {
        return primary;
    }
    return new SetupFixtureError(`${msg(primary)}; ${label}: ${secondary.map(msg).join("; ")}`, [primary, ...secondary]);
}

// ---- the in-page simulation ----

// Serialized with toString() and evaluated in the dev app, so it must stay self-contained: no imports,
// no module-level references. Node tests run the same function directly.
export function createFixtureRuntime(fixture) {
    const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const msg = (e) => String(e?.message ?? e);
    const s = {
        contents: copy(fixture.contents ?? {}),
        status: copy(fixture.status),
        skills: copy(fixture.skills),
        disk: copy(fixture.steering),
        adopt: copy(fixture.adopt),
        variants: copy(fixture.variants ?? {}),
        revision: 0,
        partialApply: null,
        partialAdopt: null,
    };
    const faults = {};
    const delays = {};
    const log = [];
    const diskWrites = [];
    const controls = [];
    let seq = 0;
    let clock = s.disk.mtime || 0;
    let lastMutation = null;

    const note = (entry) => log.push({ seq: ++seq, ...entry });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fnv = (str) => {
        let hsh = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hsh ^= str.charCodeAt(i);
            hsh = Math.imul(hsh, 0x01000193) >>> 0;
        }
        return hsh.toString(16);
    };
    const unique = (list) => [...new Set(list)];
    const presentHarnesses = () => s.status.harnesses.filter((h) => h.present);
    const markStale = () => presentHarnesses().forEach((h) => (h.steering = "stale"));

    // ---- steering ----

    const read = () => {
        note({ kind: "read", command: "agentsyncsteeringread", outcome: "ok" });
        return { path: s.disk.path, content: s.disk.content, exists: s.disk.exists, mtime: s.disk.mtime };
    };

    const write = (d, attempt) => {
        const base = { kind: "write-attempt", data: attempt };
        lastMutation = "save-failed";
        if (d.overwrite !== true) {
            if (d.baseexists === undefined || d.baseexists === null) {
                if (!(d.basemtime > 0)) {
                    note({ ...base, outcome: "error", accepted: false });
                    throw new Error("steering write needs a baseline: read the document first");
                }
            }
            const baseExists = d.baseexists ?? d.basemtime > 0;
            if (baseExists !== s.disk.exists || (s.disk.exists && d.basemtime !== s.disk.mtime)) {
                note({ ...base, outcome: "conflict", accepted: false });
                return { mtime: s.disk.mtime, conflict: true };
            }
        }
        s.disk = { ...s.disk, content: d.content, exists: true, mtime: ++clock };
        diskWrites.push({ content: d.content, mtime: s.disk.mtime, overwrite: d.overwrite === true });
        markStale();
        lastMutation = "save";
        note({ ...base, outcome: "accepted", accepted: true });
        return { mtime: s.disk.mtime, conflict: false };
    };

    // ---- apply ----

    const applyEntry = (d) => ({ kind: "apply", dryrun: d?.dryrun === true, afterSave: lastMutation === "save" });
    const adoptEntry = (d) => ({
        kind: d.apply === true ? "adopt-apply" : "adopt-review",
        names: d.names,
        keep: d.keep ?? {},
        acknowledged: d.acknowledged ?? [],
        apply: d.apply === true,
    });

    const apply = (d) => {
        const dry = d?.dryrun === true;
        const entry = applyEntry(d);
        const present = presentHarnesses();
        const actions = present.map((h) => ({ kind: "write-steering", runtime: h.runtime, path: h.path }));
        if (dry) {
            note({ ...entry, outcome: "ok" });
            return { actions };
        }
        lastMutation = "apply";
        const converge = (h) => {
            h.steering = s.disk.exists && s.disk.content.trim() !== "" ? "current" : "absent";
        };
        if (s.partialApply) {
            const { after, message } = s.partialApply;
            s.partialApply = null;
            present.slice(0, after).forEach(converge);
            note({ ...entry, outcome: "partial", converged: Math.min(after, present.length) });
            throw new Error(message);
        }
        present.forEach(converge);
        // shipped bodies are reseeded into the vault on every apply; the user's .arc deltas are never touched
        for (const [n, body] of Object.entries(s.contents.shipped ?? {})) {
            s.contents.vault[n] = body;
        }
        for (const skill of s.skills.skills ?? []) {
            for (const [rt, state] of Object.entries(skill.states ?? {})) {
                if (state === "differs") {
                    skill.states[rt] = "synced";
                    s.contents.dests[`${skill.name}/${rt}`] = s.contents.vault[skill.name];
                }
            }
        }
        note({ ...entry, outcome: "ok", converged: present.length });
        return { actions };
    };

    // ---- adopt ----

    const unmanaged = () => s.skills.unmanaged ?? [];
    const copiesOf = (name) => unmanaged().filter((m) => m.name === name);
    const declarationsOf = (name) => (s.adopt.declarations ?? []).filter((x) => x.name === name);
    const recomputeUnresolved = () => {
        s.skills.unresolved = unique(unmanaged().filter((m) => m.bodydiff).map((m) => m.name));
    };

    // what each copy holds, so keys/files/bodydiff are derived against whichever copy seeds, not stored
    const treeOf = (c) => (s.adopt.trees ?? {})[`${c.name}/${c.runtime}`] ?? { fm: {}, body: "", files: {} };
    const compare = (seed, c) => {
        const { keys: _k, files: _f, bodydiff: _b, ...base } = c;
        if (c === seed || (c.name === seed.name && c.runtime === seed.runtime)) {
            return { ...base, seed: true, bodydiff: false };
        }
        const a = treeOf(seed);
        const b = treeOf(c);
        const keys = Object.keys(b.fm).filter((k) => a.fm[k] !== b.fm[k]).sort();
        const files = Object.keys(b.files).filter((f) => a.files[f] !== b.files[f]).sort();
        return {
            ...base,
            seed: false,
            ...(keys.length ? { keys } : {}),
            ...(files.length ? { files } : {}),
            bodydiff: a.body.trim() !== b.body.trim(),
        };
    };

    // validates the request and derives the reviewed plan; shared by the dry-run and the apply
    const plan = (d) => {
        const explicit = Array.isArray(d.names);
        const canonical = new Set((s.skills.skills ?? []).map((k) => k.name));
        const selected = explicit
            ? unique(d.names)
            : unique(unmanaged().map((m) => m.name)).filter((n) => declarationsOf(n).length === 0 && !canonical.has(n));
        const keep = d.keep ?? {};
        const acknowledged = d.acknowledged ?? [];
        for (const n of selected) {
            if (canonical.has(n)) {
                throw new Error(`"${n}" is a managed skill; adoption cannot replace it`);
            }
            if (copiesOf(n).length === 0) {
                throw new Error(`unknown skill "${n}"`);
            }
        }
        for (const [n, rt] of Object.entries(keep)) {
            if (!selected.includes(n) || !copiesOf(n).some((c) => c.runtime === rt)) {
                throw new Error(`invalid keep "${rt}" for "${n}"`);
            }
        }
        for (const n of acknowledged) {
            if (!selected.includes(n) || declarationsOf(n).length === 0) {
                throw new Error(`invalid acknowledgement for "${n}"`);
            }
        }
        const moves = [];
        const unresolved = [];
        for (const n of selected) {
            const copies = copiesOf(n);
            // like PlanAdopt: the kept copy (else the first) seeds, every other copy is compared against it
            const seed = copies.find((c) => c.runtime === keep[n]) ?? copies[0];
            const rows = copies.map((c) => compare(seed, c));
            if (!keep[n] && rows.some((r) => r.bodydiff)) {
                unresolved.push(n);
                continue;
            }
            moves.push(...rows);
        }
        const moved = unique(moves.map((m) => m.name));
        const dests = s.adopt.destinations ?? {};
        const targets = [];
        for (const n of moved) {
            for (const col of s.skills.columns ?? []) {
                if (col.present && dests[col.runtime]) {
                    targets.push({ name: n, runtime: col.runtime, path: `${dests[col.runtime]}/${n}` });
                }
            }
        }
        const warnings = selected.flatMap((n) => declarationsOf(n));
        const reviewtoken =
            "rv" +
            fnv(
                JSON.stringify({
                    selected: [...selected].sort(),
                    keep: Object.entries(keep).sort(),
                    moves,
                    canonical: [...canonical].sort(),
                    revision: s.revision,
                })
            );
        return { explicit, selected, acknowledged, moved, result: { moves, unresolved, reviewtoken, warnings, targets } };
    };

    const adopt = (d) => {
        const apply = d.apply === true;
        const entry = adoptEntry(d);
        let p;
        try {
            p = plan(d);
            if (apply && p.selected.length > 0) {
                const missing = p.selected.filter((n) => declarationsOf(n).length > 0 && !p.acknowledged.includes(n));
                if (missing.length > 0) {
                    throw new Error(`"${missing[0]}" declares external management; acknowledge ownership to include it`);
                }
                if (p.explicit && !d.reviewtoken) {
                    throw new Error("review the selection before applying it");
                }
                if (p.explicit && d.reviewtoken !== p.result.reviewtoken) {
                    throw new Error("review changed: the reviewed copies differ now; review the selection again");
                }
            }
        } catch (e) {
            note({ ...entry, outcome: "rejected", reason: msg(e) });
            throw e;
        }
        if (!apply) {
            note({ ...entry, outcome: "ok", reviewtoken: p.result.reviewtoken });
            return p.result;
        }
        if (p.selected.length === 0) {
            note({ ...entry, outcome: "noop" });
            return { moves: [], unresolved: [], reviewtoken: p.result.reviewtoken, warnings: [], targets: [] };
        }
        lastMutation = "adopt";
        const partial = s.partialAdopt;
        s.partialAdopt = null;
        const names = partial ? p.moved.slice(0, partial.after) : p.moved;
        for (const n of names) {
            s.skills.unmanaged = unmanaged().filter((m) => m.name !== n);
            const states = {};
            for (const col of s.skills.columns ?? []) {
                if (col.present) {
                    states[col.runtime] = "synced";
                }
            }
            s.skills.skills.push({
                name: n,
                description: "Adopted by the fixture",
                states,
                sourcekind: "vault",
                sourcepath: `${s.adopt.vaultRoot}/${n}/SKILL.md`,
            });
            s.contents.vault[n] = `adopted ${n}`;
            if (s.skills.piskills) {
                s.skills.piskills.states[n] = "available";
            }
        }
        recomputeUnresolved();
        if (partial) {
            note({ ...entry, outcome: "partial", moved: names });
            throw new Error(partial.message);
        }
        note({ ...entry, outcome: "ok", moved: names });
        return p.result;
    };

    // ---- vault skills: read, write, create (the Skills rail's editor and New skill) ----

    const skillMtimes = {};
    const skillRow = (name) => (s.skills.skills ?? []).find((k) => k.name === name);
    const skillPath = (name) => `${s.adopt.vaultRoot}/${name}/SKILL.md`;
    const markDiffers = (row) =>
        Object.keys(row.states).forEach((rt) => {
            if (row.states[rt] !== "unmanaged") {
                row.states[rt] = "differs";
            }
        });

    const skillRead = (d) => {
        if (!skillRow(d.name)) {
            note({ kind: "read", command: "agentsyncskillread", outcome: "error" });
            throw new Error(`no skill named "${d.name}" in the vault`);
        }
        note({ kind: "read", command: "agentsyncskillread", outcome: "ok" });
        return { path: skillPath(d.name), content: s.contents.vault[d.name] ?? "", mtime: skillMtimes[d.name] ?? 1 };
    };

    const skillWrite = (d) => {
        const entry = { kind: "skill-write", name: d.name, basemtime: d.basemtime };
        const row = skillRow(d.name);
        if (!row || row.shipped) {
            note({ ...entry, outcome: "error" });
            throw new Error(row ? `"${d.name}" ships with arcterm` : `no skill named "${d.name}" in the vault`);
        }
        const mtime = skillMtimes[d.name] ?? 1;
        if (d.basemtime !== 0 && d.basemtime !== mtime) {
            note({ ...entry, outcome: "conflict" });
            return { mtime, conflict: true };
        }
        s.contents.vault[d.name] = d.content;
        skillMtimes[d.name] = ++clock;
        markDiffers(row);
        lastMutation = "skill-write";
        note({ ...entry, outcome: "accepted", content: d.content });
        return { mtime: skillMtimes[d.name], conflict: false };
    };

    const skillCreate = (d) => {
        const entry = { kind: "skill-create", name: d.name, description: d.description };
        const taken = (s.skills.skills ?? []).some((k) => k.name === d.name) || unmanaged().some((m) => m.name === d.name);
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.name ?? "") || !d.description || taken) {
            note({ ...entry, outcome: "error" });
            throw new Error(taken ? `"${d.name}" already exists` : `"${d.name}" is not a skill name`);
        }
        const content = `---\nname: ${d.name}\ndescription: ${d.description}\n---\n\n# ${d.name}\n\n`;
        const states = {};
        for (const col of s.skills.columns ?? []) {
            if (col.present) {
                states[col.runtime] = "differs";
            }
        }
        s.skills.skills.push({ name: d.name, description: d.description, states });
        s.contents.vault[d.name] = content;
        skillMtimes[d.name] = ++clock;
        lastMutation = "skill-create";
        note({ ...entry, outcome: "accepted" });
        return { path: skillPath(d.name), content, mtime: skillMtimes[d.name] };
    };

    // ---- dispatch ----

    const handlers = {
        agentsyncstatus: () => {
            note({ kind: "read", command: "agentsyncstatus", outcome: "ok" });
            return { ...copy(s.status), steeringdoc: s.disk.path };
        },
        agentsyncsteeringread: read,
        agentsyncskills: () => {
            note({ kind: "read", command: "agentsyncskills", outcome: "ok" });
            return copy(s.skills);
        },
        agentsyncsteeringwrite: (d) =>
            write(d, { content: d.content, basemtime: d.basemtime, baseexists: d.baseexists, overwrite: d.overwrite === true }),
        agentsyncapply: apply,
        agentsyncadopt: adopt,
        agentsyncskillread: skillRead,
        agentsyncskillwrite: skillWrite,
        agentsyncskillcreate: skillCreate,
    };

    const call = async (command, data) => {
        if (!Object.prototype.hasOwnProperty.call(handlers, command)) {
            note({ kind: "rejected", command, outcome: "unhandled" });
            throw new Error(`setup fixture: unhandled agentsync command "${command}"`);
        }
        if (delays[command]) {
            await sleep(delays[command]);
        }
        const fault = faults[command];
        if (fault) {
            if (fault.times !== undefined && --fault.times <= 0) {
                delete faults[command];
            }
            // an attempted mutation is logged like any other attempt, so a no-mutation assertion cannot pass falsely
            if (command === "agentsyncsteeringwrite") {
                note({ kind: "write-attempt", data: copy(data), outcome: "error", accepted: false });
                lastMutation = "save-failed";
            } else if (command === "agentsyncapply") {
                note({ ...applyEntry(data), outcome: "error", reason: fault.message });
                lastMutation = "apply";
            } else if (command === "agentsyncadopt") {
                note({ ...adoptEntry(data ?? {}), outcome: "error", reason: fault.message });
            } else {
                note({ kind: "failed", command, outcome: "error" });
            }
            throw new Error(fault.message);
        }
        return handlers[command](copy(data) ?? {});
    };

    // ---- scenario controls (outside the app's own call log) ----

    const ops = {
        setDisk: ({ content = "", exists = true }) => {
            s.disk = { ...s.disk, content, exists, mtime: exists ? ++clock : 0 };
            markStale();
        },
        fail: ({ command, message, times }) => {
            if (message == null) {
                delete faults[command];
            } else {
                faults[command] = { message, times };
            }
        },
        delay: ({ command, ms }) => {
            delays[command] = ms;
        },
        partialApply: (arg) => {
            s.partialApply = arg;
        },
        partialAdopt: (arg) => {
            s.partialAdopt = arg;
        },
        changeReview: () => {
            s.revision++;
        },
        // the skill directory (with its SKILL.md) must already exist in the fixture's files, like every copy
        discoverNew: ({ name, runtime }) => {
            s.skills.unmanaged = [...unmanaged(), { runtime, name, from: `${s.adopt.destinations?.[runtime] ?? ""}/${name}`, seed: false, bodydiff: false }];
        },
        // a canonical edit lands in the vault source; shipped sources are read-only
        editSource: ({ name, content }) => {
            const row = (s.skills.skills ?? []).find((k) => k.name === name);
            if (!row || row.sourcekind !== "vault") {
                throw new Error(`setup fixture: "${name}" is not a user-owned vault skill`);
            }
            s.contents.vault[name] = content;
            // an unmanaged local shadow is not a destination: it keeps its state and its own bytes
            Object.keys(row.states).forEach((rt) => {
                if (row.states[rt] !== "unmanaged") {
                    row.states[rt] = "differs";
                }
            });
        },
        useVariant: ({ key }) => {
            const v = s.variants[key];
            if (!v) {
                throw new Error(`setup fixture: unknown variant "${key}"`);
            }
            if (v.skills) s.skills = copy(v.skills);
            if (v.steering) {
                s.disk = copy(v.steering);
                clock = Math.max(clock, s.disk.mtime || 0);
            }
            if (v.status) s.status = copy(v.status);
        },
        resetLog: () => {
            log.length = 0;
            diskWrites.length = 0;
            lastMutation = null;
        },
    };

    return {
        call,
        control(op, arg) {
            if (!Object.prototype.hasOwnProperty.call(ops, op)) {
                throw new Error(`setup fixture: unknown control "${op}"`);
            }
            ops[op](arg ?? {});
            if (op !== "resetLog") {
                controls.push({ op, arg: copy(arg) });
            }
            return true;
        },
        snapshot() {
            return copy({ log, diskWrites, controls, disk: s.disk, skills: s.skills, status: s.status, contents: s.contents });
        },
    };
}

// call-log digest for scenario assertions: what the app attempted versus what actually landed
export function callSummary(snapshot) {
    const log = snapshot.log;
    const only = (kind) => log.filter((e) => e.kind === kind);
    const writes = only("write-attempt");
    const applies = only("apply").filter((e) => !e.dryrun);
    const reviews = only("adopt-review");
    const adoptApplies = only("adopt-apply");
    const last = (list) => (list.length ? list[list.length - 1] : null);
    return {
        reads: log.filter((e) => e.kind === "read").reduce((m, e) => ({ ...m, [e.command]: (m[e.command] ?? 0) + 1 }), {}),
        writeAttempts: writes.length,
        writeConflicts: writes.filter((e) => e.outcome === "conflict").length,
        diskWrites: snapshot.diskWrites.length,
        overwriteWrites: snapshot.diskWrites.filter((w) => w.overwrite).length,
        applies: applies.length,
        applyErrors: applies.filter((e) => e.outcome === "error").length,
        adoptErrors: adoptApplies.filter((e) => e.outcome === "error").length,
        applyAfterSave: applies.filter((e) => e.afterSave).length,
        applyOnly: applies.filter((e) => !e.afterSave).length,
        adoptReviews: reviews.length,
        adoptApplies: adoptApplies.length,
        adoptAppliesMoved: adoptApplies.filter((e) => e.outcome === "ok" || e.outcome === "partial").length,
        adoptRejected: adoptApplies.filter((e) => e.outcome === "rejected").length,
        unhandled: only("rejected").length,
        lastWrite: last(writes),
        lastReview: last(reviews),
        lastAdoptApply: last(adoptApplies),
        skillWrites: only("skill-write").filter((e) => e.outcome === "accepted").length,
        skillCreates: only("skill-create").filter((e) => e.outcome === "accepted").length,
        lastSkillWrite: last(only("skill-write")),
    };
}

// ---- datasets ----

const SKILL_FILE = "SKILL.md";
const skillDoc = (name, body, extra = "") => `---\nname: ${name}\ndescription: ${name} fixture skill\n${extra}---\n\n${body}\n`;

function buildFixture(name, ownedDir) {
    const home = join(ownedDir, "home");
    const vaultRoot = join(ownedDir, "vault", "skills");
    const roots = { claude: join(home, ".claude", "skills"), codex: join(home, ".codex", "skills") };
    const files = [];
    const addFile = (path, content) => files.push({ path, content });
    const posix = (p) => p.replace(/\\/g, "/");

    // content the in-page runtime rewrites on Apply: the vault body, what each harness holds, shipped sources
    const contents = { vault: {}, shipped: {}, dests: {}, deltas: {} };

    // user-owned vault skills are real files so Open source has something canonical to open
    const vaultSkill = (n, over = {}) => {
        const path = join(vaultRoot, n, SKILL_FILE);
        const body = skillDoc(n, `${n} vault source body`);
        addFile(path, body);
        contents.vault[n] = body;
        for (const rt of Object.keys(roots)) {
            contents.dests[`${n}/${rt}`] = over.states?.[rt] === "differs" ? skillDoc(n, `${n} stale harness body`) : body;
        }
        return {
            name: n,
            description: `${n} fixture skill`,
            states: { claude: "synced", codex: "synced" },
            sourcekind: "vault",
            sourcepath: path,
            ...over,
        };
    };
    // the vault holds a stale replica of the shipped body plus the user's .arc deltas; Apply reseeds the
    // body and must leave the deltas alone. sourcepath stays the repository-relative reference.
    const shipped = (n, over = {}) => {
        const stale = skillDoc(n, `${n} shipped body v1`);
        const current = skillDoc(n, `${n} shipped body v2`);
        addFile(join(vaultRoot, n, SKILL_FILE), stale);
        contents.vault[n] = stale;
        contents.shipped[n] = current;
        for (const [rt, files] of Object.entries(over.deltas ?? {})) {
            const sidecarFiles = files.map((f) => [join(vaultRoot, n, ".arc", rt, f), `# ${rt} override for ${n}\n`]);
            sidecarFiles.forEach(([path, text]) => addFile(path, text));
            sidecarFiles.forEach(([path, text]) => (contents.deltas[relative(ownedDir, path)] = text));
            addFile(join(vaultRoot, n, ".arc", `${rt}.yaml`), "model: fixture-model\n");
            contents.deltas[relative(ownedDir, join(vaultRoot, n, ".arc", `${rt}.yaml`))] = "model: fixture-model\n";
        }
        for (const rt of Object.keys(roots)) {
            contents.dests[`${n}/${rt}`] = rt === "claude" ? stale : current;
        }
        return {
            name: n,
            description: `${n} fixture skill`,
            states: { claude: "differs", codex: "synced" },
            shipped: true,
            sourcekind: "shipped",
            sourcepath: `skills/${n}/${SKILL_FILE}`,
            ...over,
        };
    };

    const omitSourceKind = ({ sourcekind: _omitted, ...row }) => row;
    const managed = [
        vaultSkill("commit-helper", { deltas: { claude: ["model"] }, states: { claude: "synced", codex: "unmanaged" } }),
        vaultSkill("vault-drift", { states: { claude: "differs", codex: "synced" } }),
        shipped("design-local", { deltas: { codex: ["agents/openai.yaml"] } }),
        shipped("cockpit-ui"),
        // ownership metadata that is unknown or absent must stay read-only even with a readable source path
        vaultSkill("legacy-notes", { sourcekind: "unknown" }),
        omitSourceKind(vaultSkill("plain-notes")),
    ];

    // moves[].from is the skill directory, as the RPC returns it; the SKILL.md sits beneath it. Bodies are
    // shared unless a copy says otherwise, so bodydiff always matches what the files hold.
    const trees = {};
    const copyOf = (runtime, n, over = {}) => {
        const dir = join(roots[runtime], n);
        const { frontmatter = "", body = `${n} shared body`, extraFiles = {}, ...move } = over;
        addFile(join(dir, SKILL_FILE), skillDoc(n, body, frontmatter));
        for (const [rel, text] of Object.entries(extraFiles)) {
            addFile(join(dir, ...rel.split("/")), text);
        }
        // the page runtime has no file access; it compares these descriptions of the files just written
        const fm = { name: n, description: `${n} fixture skill` };
        for (const line of frontmatter.split("\n").filter(Boolean)) {
            fm[line.slice(0, line.indexOf(":"))] = line;
        }
        trees[`${n}/${runtime}`] = { fm, body, files: extraFiles };
        return { runtime, name: n, from: dir, seed: false, bodydiff: false, ...move };
    };
    const unmanagedCopies = [
        copyOf("claude", "identical-copy"),
        copyOf("codex", "identical-copy"),
        copyOf("claude", "differs-body"),
        copyOf("codex", "differs-body", { bodydiff: true, body: "differs-body codex variant" }),
        copyOf("codex", "codex-only-skill"),
        copyOf("claude", "fm-delta"),
        copyOf("codex", "fm-delta", {
            keys: ["model"],
            files: ["agents/openai.yaml"],
            frontmatter: "model: fixture-model\n",
            extraFiles: { "agents/openai.yaml": "interface:\n  display_name: fixture\n" },
        }),
        copyOf("claude", "ext-managed", { frontmatter: "managed-by: skills-manager\n" }),
        // a local copy under a canonical name: shown as local/blocked, never adoptable over the vault skill
        copyOf("codex", "commit-helper", { body: "commit-helper local shadow body" }),
    ];
    // a shadow's destination holds the user's own bytes, not the vault body: sync must leave them alone
    for (const c of unmanagedCopies) {
        if (contents.vault[c.name] !== undefined) {
            contents.dests[`${c.name}/${c.runtime}`] = files.find((f) => f.path === join(c.from, SKILL_FILE)).content;
        }
    }
    // present on disk but not in the listing until a scenario calls discoverNew
    copyOf("claude", "late-arrival");

    const piskills = {
        sources: [
            { entry: "~/.claude/skills", path: posix(roots.claude), runtime: "claude" },
            { entry: "~/.arc/vault/skills", path: posix(vaultRoot) },
            { entry: "npm:@fixture/pi-skills", path: "" },
        ],
        states: {
            "commit-helper": "available",
            "vault-drift": "not-synced",
            "design-local": "available",
            "cockpit-ui": "available",
            "legacy-notes": "unknown",
            "plain-notes": "excluded",
        },
        note: "Global settings only: package, project and command-line sources are not evaluated here.",
    };

    const columns = [
        { runtime: "claude", label: "Claude Code", present: true, path: posix(roots.claude) },
        { runtime: "codex", label: "Codex", present: true, path: posix(roots.codex) },
        { runtime: "opencode", label: "OpenCode", present: false, path: posix(join(home, ".config", "opencode", "skills")) },
    ];
    const skills = {
        skills: managed,
        columns,
        skillsroot: vaultRoot,
        unmanaged: unmanagedCopies,
        unresolved: ["differs-body"],
        piskills,
    };
    const harness = (runtime, label, rel, present, steering) => ({
        runtime,
        label,
        path: join(home, ...rel),
        present,
        steering,
        skillsmanaged: 4,
        skillsunmanaged: 2,
    });
    const status = {
        harnesses: [
            harness("claude", "Claude Code", [".claude", "CLAUDE.md"], true, "current"),
            harness("codex", "Codex", [".codex", "AGENTS.md"], true, "stale"),
            harness("opencode", "OpenCode", [".config", "opencode", "AGENTS.md"], false, "absent"),
        ],
        steeringdoc: join(ownedDir, "vault", "AGENTS.md"),
        skillsroot: vaultRoot,
    };
    const longDoc = Array.from({ length: 60 }, (_, i) => `- rule ${i + 1}: keep changes small and verify them`).join("\n") + "\n";
    const steering = {
        path: status.steeringdoc,
        content: name === "setup-narrow" ? longDoc : "# Shared instructions\n\nPrefer small diffs. Verify before claiming done.\n",
        exists: true,
        mtime: 1000,
    };

    const patchSkills = (mutate) => {
        const c = JSON.parse(JSON.stringify(skills));
        mutate(c);
        return c;
    };
    const variants = {
        "no-skills": { skills: patchSkills((c) => Object.assign(c, { skills: [], unmanaged: [], unresolved: [], piskills: { sources: [], states: {}, note: "No skills." } })) },
        "unavailable-column": { skills: patchSkills((c) => c.columns.forEach((col) => (col.present = false))) },
        "pi-direct-vault": {
            skills: patchSkills((c) => {
                c.piskills.sources = [{ entry: posix(vaultRoot), path: posix(vaultRoot) }];
                Object.keys(c.piskills.states).forEach((k) => (c.piskills.states[k] = "available"));
            }),
        },
        "pi-excluded-unknown": {
            skills: patchSkills((c) => {
                Object.keys(c.piskills.states).forEach((k, i) => (c.piskills.states[k] = i % 2 ? "unknown" : "excluded"));
                c.piskills.note = "settings.json could not be parsed; availability is unknown.";
            }),
        },
        "pi-unavailable": {
            skills: patchSkills((c) => Object.keys(c.piskills.states).forEach((k) => (c.piskills.states[k] = "unavailable"))),
        },
        "pi-absent": { skills: patchSkills((c) => delete c.piskills) },
        "doc-absent": { steering: { ...steering, content: "", exists: false, mtime: 0 } },
        "long-doc": { steering: { ...steering, content: longDoc } },
    };

    return {
        name,
        ownedDir,
        files,
        contents,
        status,
        steering,
        skills,
        adopt: {
            trees,
            vaultRoot: posix(vaultRoot),
            destinations: { claude: posix(roots.claude), codex: posix(roots.codex) },
            declarations: [
                {
                    name: "ext-managed",
                    runtime: "claude",
                    path: posix(join(roots.claude, "ext-managed", SKILL_FILE)),
                    declaration: "managed-by: skills-manager",
                },
            ],
        },
        variants,
    };
}

// plain data, no side effects: the files are written and the mock installed by installSetupFixture
export function createSetupFixture(name, tempRoot) {
    if (!SETUP_SCENARIO_NAMES.includes(name)) {
        throw new Error(`unknown setup fixture "${name}"; expected one of ${SETUP_SCENARIO_NAMES.join(", ")}`);
    }
    if (!tempRoot) {
        throw new Error("createSetupFixture needs a temp root: fixture files must never live in real user paths");
    }
    return buildFixture(name, join(tempRoot, `setup-fixture-${name}`));
}

// ---- installation ----

const DISCOVER_SCRIPT = `(() => {
    const hits = performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\\/wshclientapi\\.ts(\\?|$)/.test(n));
    return hits.length ? hits[hits.length - 1] : null;
})()`;

function installScript(url, fixture) {
    const { files: _files, ...pageFixture } = fixture;
    return `(async () => {
    const mod = await import(${JSON.stringify(url)});
    const api = mod.RpcApi;
    if (!api || typeof api.setMockRpcClient !== "function") throw new Error("setup fixture: RpcApi not found at " + ${JSON.stringify(url)});
    if (window.${WINDOW_KEY}) throw new Error("setup fixture: already installed");
    const runtime = (${createFixtureRuntime.toString()})(${JSON.stringify(pageFixture)});
    const prev = api.mockClient ?? null;
    const isAgentSync = (c) => typeof c === "string" && c.startsWith("agentsync");
    const mock = {
        mockWshRpcCall(client, command, data, opts) {
            if (isAgentSync(command)) return runtime.call(command, data);
            return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
        },
        mockWshRpcStream(client, command, data, opts) {
            if (isAgentSync(command)) throw new Error("setup fixture: agentsync stream " + command + " is not simulated");
            return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
        },
    };
    window.${WINDOW_KEY} = { api, prev, mock, runtime };
    api.setMockRpcClient(mock);
    return true;
})()`;
}

// a real call through RpcApi proves the app's own module instance routes to the simulation
const PROBE_SCRIPT = `(async () => {
    const f = window.${WINDOW_KEY};
    if (!f) return "missing";
    if (f.api.mockClient !== f.mock) return "replaced";
    const status = await f.api.AgentSyncStatusCommand(window.TabRpcClient ?? null);
    if (!status || !Array.isArray(status.harnesses)) return "not-intercepted";
    f.runtime.control("resetLog");
    return "ok";
})()`;

const CHECK_SCRIPT = `(() => {
    const f = window.${WINDOW_KEY};
    if (!f) return "missing";
    return f.api.mockClient === f.mock ? "ok" : "replaced";
})()`;

const restoreScript = (tolerateMissing) => `(() => {
    const f = window.${WINDOW_KEY};
    if (!f) {
        if (${tolerateMissing}) return "absent";
        throw new Error("setup fixture: interception is gone (page reloaded?); the safety boundary dropped mid-scenario");
    }
    if (f.api.mockClient !== f.mock && f.api.mockClient !== f.prev) {
        throw new Error("setup fixture: RpcApi mock was replaced by something else; not restoring over it");
    }
    f.api.setMockRpcClient(f.prev);
    if (f.api.mockClient !== f.prev) throw new Error("setup fixture: prior RpcApi mock was not restored");
    delete window.${WINDOW_KEY};
    return "restored";
})()`;

// the hard gate before any mutation interaction: throws unless the app's RpcApi is routed to the fixture
export async function assertSetupFixtureInstalled(h) {
    const state = await h.ev(CHECK_SCRIPT);
    if (state !== "ok") {
        throw new Error(`setup fixture is not intercepting agentsync (${state}); refusing to touch the app`);
    }
}

function assertOwned(fixture) {
    for (const f of fixture.files) {
        const rel = relative(fixture.ownedDir, f.path);
        if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
            throw new Error(`setup fixture file ${f.path} is outside its temporary folder ${fixture.ownedDir}`);
        }
    }
}

async function runCleanup(cleanup) {
    const errors = [];
    for (const item of [...cleanup].reverse()) {
        try {
            await item.run();
            cleanup.splice(cleanup.indexOf(item), 1);
        } catch (e) {
            errors.push(new Error(`${item.label}: ${msg(e)}`));
        }
    }
    return errors;
}

export async function installSetupFixture(h, fixture, deps = {}) {
    const fs = deps.fs ?? nodeFs;
    // each obligation is recorded before the side effect it undoes
    const cleanup = [];
    try {
        assertOwned(fixture);
        const url = await h.ev(DISCOVER_SCRIPT);
        if (typeof url !== "string" || !url) {
            throw new Error("setup fixture: cannot find the app's wshclientapi module URL (is the dev app loaded?)");
        }
        // rolling back must never restore over an install this call did not make
        if ((await h.ev(CHECK_SCRIPT)) !== "missing") {
            throw new Error("setup fixture: already installed in this page; restore it first");
        }
        cleanup.push({ label: "remove fixture files", run: () => fs.rmSync(fixture.ownedDir, { recursive: true, force: true }) });
        for (const f of fixture.files) {
            fs.mkdirSync(dirname(f.path), { recursive: true });
            fs.writeFileSync(f.path, f.content);
        }
        cleanup.push({ label: "restore RpcApi mock", run: () => h.ev(restoreScript(true)) });
        await h.ev(installScript(url, fixture));
        const probe = await h.ev(PROBE_SCRIPT);
        if (probe !== "ok") {
            throw new Error(`setup fixture: installation probe failed (${probe})`);
        }
    } catch (e) {
        const rollback = await runCleanup(cleanup);
        throw combine(e, rollback, "rollback failed");
    }
    // after a successful install a missing marker is a dropped boundary, not a no-op
    cleanup.find((c) => c.label === "restore RpcApi mock").run = () => h.ev(restoreScript(false));
    return { name: fixture.name, ownedDir: fixture.ownedDir, cleanup };
}

export async function restoreSetupFixture(h, handle) {
    const errors = await runCleanup(handle.cleanup);
    if (errors.length > 0) {
        throw new SetupFixtureError(`setup fixture restore failed: ${errors.map(msg).join("; ")}`, errors);
    }
}

export async function readSetupFixture(h) {
    await assertSetupFixtureInstalled(h);
    return h.ev(`window.${WINDOW_KEY}.runtime.snapshot()`);
}

export async function controlSetupFixture(h, op, arg) {
    await assertSetupFixtureInstalled(h);
    await h.ev(`window.${WINDOW_KEY}.runtime.control(${JSON.stringify(op)}, ${JSON.stringify(arg ?? {})})`);
}

// ---- scenario wrappers ----

// creates the temp root, installs, and on any failure removes what it created: the runner cannot tear
// down a context that arrange never returned
export async function arrangeSetupFixture(h, name, deps = {}) {
    const fs = deps.fs ?? nodeFs;
    const root = fs.mkdtempSync(join(deps.tmpdir ?? tmpdir(), "arc-setup-fixture-"));
    try {
        const fixture = createSetupFixture(name, root);
        const handle = await installSetupFixture(h, fixture, deps);
        return { root, fixture, handle };
    } catch (e) {
        const errors = [];
        try {
            fs.rmSync(root, { recursive: true, force: true });
        } catch (r) {
            errors.push(r);
        }
        throw combine(e, errors, "temp root cleanup failed");
    }
}

export async function teardownSetupFixture(h, ctx, deps = {}) {
    const fs = deps.fs ?? nodeFs;
    const errors = [];
    try {
        await restoreSetupFixture(h, ctx.handle);
    } catch (e) {
        errors.push(e);
    }
    try {
        fs.rmSync(ctx.root, { recursive: true, force: true });
    } catch (e) {
        errors.push(e);
    }
    if (errors.length > 0) {
        throw new SetupFixtureError(`setup fixture teardown failed: ${errors.map(msg).join("; ")}`, errors);
    }
}
