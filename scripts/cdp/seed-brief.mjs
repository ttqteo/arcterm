// Seeds the Jarvis Brief design's three initiatives (docs/prototype/jarvis-brief-editing.dc.html,
// seed() L986-1009) into the running dev app's store, so a side-by-side review has the design's data to
// draw. Idempotent: a title that already exists is skipped.
// Usage: node scripts/cdp/seed-brief.mjs   (CDP_PORT=<port> for a worktree dev app)
import { attach } from "./attach.mjs";

// notes are listed oldest first, the order they are appended in
const INITIATIVES = [
    {
        title: "Scenario gate clearance",
        project: "arc-infra",
        ticket: "INF-221",
        status: "active",
        chunks: [
            ["WAF posture scan", "Phase 1 · scan", "done", [
                ["you", "Run against the staging mirror first."],
                ["agent", "Scan finished. 2 findings accepted as known: legacy /healthz path and the admin IP allowlist."],
            ]],
            ["Rule diff vs prod", "Phase 1 · scan", "done"],
            ["N1 box upgrade", "Phase 2 · upgrade", "active", [
                ["agent", "Upgraded 3 of 5 boxes. Waiting on the canary region decision before the last two."],
            ]],
            ["Canary on eu-west", "Phase 2 · upgrade", "blocked"],
            ["Rollback drill", "Phase 2 · upgrade", "pending"],
            ["Gate review with SRE", "Phase 3 · review", "pending"],
        ],
    },
    {
        title: "Cockpit keyboard model",
        project: "waveterm",
        ticket: "WAV-88",
        status: "active",
        chunks: [
            ["Leader-key dispatcher", "Bindings", "done"],
            ["which-key footer", "Bindings", "done"],
            ["Surface list nav", "Bindings", "active", [
                ["agent", "j/k works on Brief and Sessions. Radar still needs the cursor ring."],
            ]],
            ["Cheatsheet modal", "Docs", "pending"],
            ["Chord conflicts audit", "Docs", "deferred"],
        ],
    },
    {
        title: "Usage export to CSV",
        project: "billing-svc",
        ticket: "BIL-19",
        status: "paused",
        chunks: [
            ["Schema for export rows", "", "done"],
            ["Streaming writer", "", "pending"],
            ["Download endpoint", "", "pending"],
        ],
    },
];

// The server attributes a note to "agent" only when the batch names a source block (noteAuthorFor in
// wshserver_effort.go); a block that does not exist still reads as an agent, just with no session or
// run to link. Seeded agent notes therefore show "agent" without "open agent session".
const NO_BLOCK = "block:00000000-0000-0000-0000-000000000000";

const h = await attach(Number(process.env.CDP_PORT) || 9222);
const mutate = (effortoid, ops, extra = {}) => h.rpc("effortmutate", { effortoid, ops, ...extra });

try {
    const { efforts = [] } = (await h.rpc("effortlist", { includearchived: true })) ?? {};
    const existing = new Set(efforts.map((e) => e.title));
    for (const init of INITIATIVES) {
        if (existing.has(init.title)) {
            console.log(`skip   ${init.title} (already exists)`);
            continue;
        }
        const { effortoid } = await h.rpc("effortcreate", {
            title: init.title,
            project: init.project,
            ticket: init.ticket,
            chunks: init.chunks.map(([label]) => ({ label })),
        });

        const shape = init.chunks.flatMap(([chunk, stage, status]) => [
            ...(stage ? [{ op: "setChunkStage", chunk, stage }] : []),
            ...(status !== "pending" ? [{ op: "setChunkStatus", chunk, status }] : []),
        ]);
        const { effort } = await mutate(effortoid, shape);

        // setChunkStage/setChunkStatus leave "stage set to …"/"marked …" trail notes; drop them so each
        // chunk carries only the design's notes. Last first, so earlier indexes stay valid in the batch.
        const trail = effort.chunks.flatMap((c) =>
            (c.notes ?? []).map((n, i) => ({ op: "removeNote", chunk: c.label, at: i + 1, notets: n.ts })).reverse()
        );
        if (trail.length) await mutate(effortoid, trail);

        for (const [chunk, , , notes = []] of init.chunks) {
            for (const [who, note] of notes) {
                const by = who === "you" ? { author: "you" } : { sourceblock: NO_BLOCK };
                await mutate(effortoid, [{ op: "appendNote", chunk, note }], by);
            }
        }
        if (init.status !== "active") await mutate(effortoid, [{ op: "setStatus", status: init.status }]);
        console.log(`seeded ${init.title} (${effortoid.slice(0, 8)})`);
    }
} finally {
    h.close();
}
