// Single source of fake cockpit rosters. Consumed by both gen-cockpit-fixtures.mjs (FE mock)
// and inject-live-agents.mjs (live pipeline). Each scenario is (now) => record[]; records are
// AgentVM-shaped (frontend/app/view/agents/agentsviewmodel.ts). Kept in sync via validate.mjs.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Narration helpers (ported from mockagents.ts). No `now` dependency, so module-level consts.
const detectorNarration = [
    { kind: "message", text: "Validated the committed #39 entropy detector against PROD M0001." },
    { kind: "action", verb: "ran", target: "go test ./pkg/detect/...", outcome: "ok" },
    { kind: "action", verb: "edited", target: "entropy_detector.go", outcome: "ok" },
    { kind: "message", text: "Both PROD-groundable now; #40 DNS-tunneling is the highest net-new value." },
];

const waveNarration = [
    { kind: "user", text: "fix the windows packaging backend gotcha and verify the packaged app boots" },
    { kind: "message", text: "Starting with the asarUnpack mapping — the packaged wavesrv wasn't being found at runtime." },
    { kind: "action", verb: "read", target: "electron-builder.config.cjs" },
    { kind: "action", verb: "read", target: "Taskfile.yml" },
    { kind: "message", text: "Found it: dist/bin/** is unpacked, but an orphaned wavesrv from a prior build was shadowing the fresh one." },
    { kind: "action", verb: "ran", target: "rm -rf dist/bin", outcome: "ok" },
    { kind: "action", verb: "ran", target: "task build:backend", outcome: "ok" },
    { kind: "action", verb: "ran", target: "task package", outcome: "ok" },
    { kind: "message", text: "Package built. Pre-seeding the winCodeSign cache to dodge the symlink-privilege failure." },
    { kind: "action", verb: "ran", target: "pwsh ./scripts/seed-wincodesign.ps1", outcome: "ok" },
    { kind: "action", verb: "ran", target: "task package", outcome: "ok" },
    { kind: "message", text: "Signed build produced. Launching the packaged app to confirm the backend handshakes." },
    { kind: "action", verb: "ran", target: "./dist/win-unpacked/Wave.exe", outcome: "ok" },
    { kind: "action", verb: "read", target: "wavesrv.log" },
    { kind: "message", text: "Backend came up clean — websocket bound, domain socket connected, no orphan process." },
    { kind: "action", verb: "ran", target: "go test ./pkg/...", outcome: "fail" },
    { kind: "message", text: "One flaky reaper test failed; re-running to confirm it's the known race, not a regression." },
    { kind: "action", verb: "ran", target: "go test ./pkg/wcore/ -run Reaper -count=3", outcome: "ok" },
    { kind: "message", text: "Confirmed flaky — passes on retry. Packaging fix is solid; writing up the gotcha now." },
];

const graphifyNarration = [
    { kind: "message", text: "Clustering 1031 nodes into communities." },
    { kind: "action", verb: "ran", target: "louvain pass", outcome: "ok" },
];

const scribeNarration = [
    { kind: "message", text: "Drafted release notes for 0.14.5." },
    { kind: "action", verb: "wrote", target: "CHANGELOG.md", outcome: "ok" },
    { kind: "message", text: "Done — ready for your review." },
];

function mixed(now) {
    return [
        {
            id: "mock-ask-1",
            name: "siem-detector",
            project: "siem-platform",
            task: "Entropy detector for SIEM-1662",
            state: "asking",
            model: "opus",
            blockedMs: 180_000,
            blockId: "mock-blk-1",
            usage: {
                contextpct: 84,
                contextmax: 200000,
                costusd: 4.2,
                fivehourpct: 62,
                fivehourreset: Math.floor(now / 1000) + 7860,
                weekpct: 34,
                weekreset: Math.floor(now / 1000) + 342000,
            },
            previousInfo: detectorNarration,
            ask: {
                askId: "a1",
                oref: "block:mock-blk-1",
                questions: [
                    {
                        header: "NEXT TRACK",
                        question: "Which track should I take next on SIEM-1662?",
                        options: [
                            {
                                label: "finalize #39 + build #40 (Recommended)",
                                description: "validate committed #39, extend the skeleton to #40 DNS-tunneling",
                            },
                            { label: "Prep the SOC batch", description: "assemble #18/#23/#39/#40 into one ask" },
                            { label: "Consolidate & commit", description: "close catalog drift, commit doc work" },
                        ],
                    },
                ],
            },
        },
        {
            id: "mock-ask-2",
            name: "loom",
            project: "waveterm",
            task: "Refactor duplicate-session race",
            state: "asking",
            model: "sonnet",
            blockedMs: 240_000,
            blockId: "mock-blk-2",
            previousInfo: [{ kind: "message", text: "Found the race in the session reaper. Need scope before merge." }],
            ask: {
                askId: "a2",
                oref: "block:mock-blk-2",
                questions: [
                    {
                        header: "PRE-MERGE",
                        question: "Which checks should I run before merging? (pick any)",
                        multiSelect: true,
                        options: [
                            { label: "unit" },
                            { label: "integration" },
                            { label: "lint" },
                            { label: "typecheck" },
                        ],
                    },
                ],
            },
        },
        {
            id: "mock-ask-3",
            name: "obsidian",
            project: "vault",
            task: "Vault sync conflict",
            state: "asking",
            model: "haiku",
            blockedMs: 90_000,
            blockId: "mock-blk-3",
            ask: {
                askId: "a3",
                oref: "block:mock-blk-3",
                questions: [
                    {
                        question: "Keep local or remote version of the daily note?",
                        options: [{ label: "Keep local" }, { label: "Keep remote" }],
                    },
                ],
            },
        },
        {
            id: "mock-ask-multi",
            name: "planner",
            project: "waveterm",
            task: "Plan the v0.15 release cut",
            state: "asking",
            model: "opus",
            blockedMs: 60_000,
            blockId: "mock-blk-8",
            previousInfo: [
                { kind: "message", text: "Scoped the v0.15 cut. A few decisions before I draft the plan." },
                { kind: "action", verb: "read", target: "CHANGELOG.md" },
                { kind: "action", verb: "read", target: "package.json" },
            ],
            ask: {
                askId: "a-multi",
                oref: "block:mock-blk-8",
                questions: [
                    {
                        header: "VERSION",
                        question: "What version number should this release be?",
                        options: [
                            { label: "0.15.0 (Recommended)", description: "minor bump — new Agents tab + tabbed asks" },
                            { label: "0.14.6", description: "treat it as a patch" },
                            { label: "1.0.0", description: "call it stable" },
                        ],
                    },
                    {
                        header: "INCLUDE",
                        question: "Which in-flight features make the cut? (pick any)",
                        multiSelect: true,
                        options: [{ label: "Agents tab" }, { label: "Resizable narration" }, { label: "Tabbed asks" }, { label: "Usage bridge" }],
                    },
                    {
                        header: "CHANNEL",
                        question: "Which release channel?",
                        options: [{ label: "Stable" }, { label: "Beta" }],
                    },
                ],
            },
        },
        {
            id: "mock-ask-two",
            name: "migrator",
            project: "waveterm",
            task: "Migrate config store to v2 schema",
            state: "asking",
            model: "sonnet",
            blockedMs: 30_000,
            blockId: "mock-blk-10",
            previousInfo: [
                { kind: "message", text: "Schema v2 migration is ready. Two calls before I run it." },
                { kind: "action", verb: "read", target: "pkg/wconfig/schema.go" },
                { kind: "action", verb: "ran", target: "go test ./pkg/wconfig/...", outcome: "ok" },
            ],
            ask: {
                askId: "a-two",
                oref: "block:mock-blk-10",
                questions: [
                    {
                        header: "BACKUP",
                        question: "Back up the existing config before migrating?",
                        options: [
                            { label: "Yes, snapshot first (Recommended)", description: "copy config dir to a timestamped backup" },
                            { label: "No, migrate in place", description: "faster, but no rollback" },
                        ],
                    },
                    {
                        header: "ON CONFLICT",
                        question: "If a key can't be mapped, what should I do?",
                        options: [{ label: "Keep old value" }, { label: "Use v2 default" }, { label: "Abort migration" }],
                    },
                ],
            },
        },
        {
            id: "mock-ask-noopts",
            name: "detector",
            project: "siem-platform",
            task: "Check scenario implementation status",
            state: "asking",
            model: "sonnet",
            blockedMs: 45_000,
            blockId: "mock-blk-9",
            replySuggestions: ["Yes, implement them", "No, leave stubbed", "Show me the stubs first"],
            previousInfo: [
                { kind: "message", text: "Checked all 12 scenarios; 9 are implemented and passing." },
                { kind: "action", verb: "ran", target: "go test ./pkg/scenario/...", outcome: "ok" },
                { kind: "message", text: "3 scenarios are still stubbed. I'm blocked at the prompt waiting for direction on whether to implement them now." },
            ],
        },
        {
            id: "mock-work-1",
            name: "waveterm",
            project: "waveterm",
            task: "Windows packaging fix",
            state: "working",
            model: "sonnet",
            activeMs: 120_000,
            blockId: "mock-blk-4",
            usage: { contextpct: 71, contextmax: 200000, costusd: 2.1 },
            previousInfo: waveNarration,
        },
        {
            id: "mock-work-2",
            name: "graphify",
            project: "graphify",
            task: "Cluster communities",
            state: "working",
            model: "haiku",
            activeMs: 45_000,
            blockId: "mock-blk-5",
            previousInfo: graphifyNarration,
        },
        {
            id: "mock-idle-1",
            name: "scribe",
            project: "docs",
            task: "Draft release notes",
            state: "idle",
            model: "opus",
            activeMs: 300_000,
            idleSince: now - 30_000, // within the 5m grace -> renders as a panel with a Dismiss button
            blockId: "mock-blk-6",
            usage: { contextpct: 61, contextmax: 200000, costusd: 1.8 },
            previousInfo: scribeNarration,
        },
        {
            id: "mock-idle-2",
            name: "janitor",
            project: "waveterm",
            task: "",
            state: "idle",
            activity: "stopped without asking",
            idleSince: now - 600_000, // past grace -> collapsed Idle section
            blockId: "mock-blk-7",
        },
    ];
}

function allAsking(now) {
    const base = (id, name, project, question, options) => ({
        id,
        name,
        task: question,
        state: "asking",
        model: "sonnet",
        blockedMs: 60_000,
        blockId: `fake-blk-${id}`,
        previousInfo: [{ kind: "message", text: `Working in ${project}; need a decision.` }],
        ask: { askId: id, oref: `block:fake-blk-${id}`, questions: [{ question, options }] },
    });
    return [
        base("aa-1", "siem", "siem-platform", "Which detector to build next?", [
            { label: "DNS tunneling (Recommended)", description: "highest net-new value" },
            { label: "Beaconing" },
            { label: "Lateral movement" },
        ]),
        base("aa-2", "loom", "waveterm", "Run the full suite before merge?", [{ label: "Yes" }, { label: "No, unit only" }]),
        base("aa-3", "obsidian", "vault", "Keep local or remote note?", [{ label: "Local" }, { label: "Remote" }]),
        base("aa-4", "planner", "release", "Cut 0.15 now?", [{ label: "Cut now" }, { label: "Wait for tabbed asks" }]),
        base("aa-5", "migrator", "config", "Back up before migrating?", [{ label: "Snapshot first" }, { label: "In place" }]),
    ];
}

function heavy(now) {
    const states = ["working", "working", "asking", "idle"];
    const projects = ["waveterm", "siem-platform", "vault"];
    return Array.from({ length: 12 }, (_, i) => {
        const state = states[i % states.length];
        const id = `heavy-${i}`;
        const project = projects[i % projects.length];
        const rec = {
            id,
            name: `agent-${i}`,
            task: `Task ${i} in ${project}`,
            state,
            model: ["opus", "sonnet", "haiku"][i % 3],
            blockId: `fake-blk-${id}`,
            previousInfo: Array.from({ length: 6 }, (_, k) =>
                k % 2 === 0
                    ? { kind: "message", text: `Step ${k} of task ${i}: reasoning about the change.` }
                    : { kind: "action", verb: "ran", target: `go test ./pkg/x${k}/...`, outcome: k % 4 === 1 ? "fail" : "ok" }
            ),
        };
        if (state === "working") {
            rec.activeMs = 30_000 + i * 5_000;
        } else if (state === "idle") {
            rec.idleSince = now - (i + 1) * 60_000;
        } else {
            rec.blockedMs = 45_000;
            rec.ask = { askId: id, oref: `block:fake-blk-${id}`, questions: [{ question: `Proceed with task ${i}?`, options: [{ label: "Yes" }, { label: "No" }] }] };
        }
        return rec;
    });
}

function empty() {
    return [];
}

// Two agents asking a Doc review, one on a paper (.tex) and one on a note (.md), each an absolute path to a sample
// in this repo (scripts/cockpit-fixtures/doc-review/); focusing either opens the review in place of its terminal.
// The samples are committed, so the review diffs them against HEAD: edit one locally to see changes. The CDP
// scenario doc-review-mode (scripts/cdp/scenarios.mjs) writes its own, larger roster over a temp repo instead
// (paper-writer, notes-writer and gone-writer; the PDF tab adds chapter-writer).
function docReviewMode() {
    const sample = (name) => join(dirname(fileURLToPath(import.meta.url)), "doc-review", name);
    const asker = (id, name, task, question) => ({
        id,
        name,
        project: "waveterm",
        task,
        state: "asking",
        agent: "claude",
        model: "opus",
        blockedMs: 60_000,
        blockId: `fake-blk-${id}`,
        previousInfo: [{ kind: "message", text: `${task}. Asking for a review.` }],
        ask: {
            askId: `${id}-1`,
            oref: `block:fake-blk-${id}`,
            questions: [
                {
                    header: "Doc review",
                    question,
                    options: [{ label: "Approve" }, { label: "Request changes" }],
                },
            ],
        },
    });
    return [
        asker(
            "dr-paper",
            "paper-writer",
            "Rewrite the method section",
            [
                sample("main.tex"),
                "Rewrote §2 around the review loop and tightened §3.",
                "Pages: 8",
                "- §2.1 Overview: rewritten",
                "- §3 Results: one sentence tightened",
            ].join("\n")
        ),
        asker(
            "dr-notes",
            "notes-writer",
            "Update the next-step note",
            [sample("next_step.md"), "Added the links and the image.", "- 2. Links: three new items", "- 3. An image"].join(
                "\n"
            )
        ),
    ];
}

export const SCENARIOS = {
    mixed,
    "all-asking": allAsking,
    heavy,
    empty,
    "doc-review-mode": docReviewMode,
};
