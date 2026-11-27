// sessionideas-brief: the Jarvis Brief's From your sessions region (docs/superpowers/specs/2026-11-26-session-ideas-design.md,
// "Where the person sees it"). The module holds the fixture the region's steps run against:
// fixture mode on (the scan reads the seeded sessions below, never ~/.claude, and its model call returns the seeded
// reply and spends nothing), two ideas on a real initiative, one new idea, and the fixture sessions they came from.
// kit is scenarios.mjs's JARVIS_KIT.
//
// Every press of Discuss or Go through runs under the launch hook (sessionideaslaunch.ts), which records the launch and opens
// no agent. No step calls a model or reads a real transcript.

const DAY = 86_400_000;
const TITLE = "SIB initiative";
const PROJECT = "sib-project";
const PROJECT_PATH = "C:\\arc-verify-sib\\project";
// the new idea's gist: Keep makes an idea of this title in the dev store, so the scenario removes it again
const NEW_IDEA = "Let a dropped idea come back from the session list";
// where the Brief keeps the time the person last looked (briefingstore.ts briefingCursorAtom)
const LAST_SEEN_KEY = "jarvis.briefing.lastseen";

const REGION = '[data-jarvis-brief-region="sessions"]';
const row = (id) => `${REGION} [data-jarvis-sessionidea="${id}"]`;
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const today = () => `${MONTHS[new Date().getMonth()]} ${new Date().getDate()}`;

const transcript = (id) => `${PROJECT_PATH}\\.claude\\${id}.jsonl`;

// The seed the Brief's steps share. Sessions s1 and s2 gave the three ideas and carry their marks; s3 is quiet and not yet
// scanned, so a scan the person starts reads it. Write times are back from now, so the deletion days stay ahead of it. The last
// scan ended a day ago, after reading the two, and found the three ideas.
function sessionIdeasBriefSeed(effortoid, now = Date.now()) {
    const session = (n, ageDays, over = {}) => {
        const lastwritets = now - ageDays * DAY;
        return {
            sessionid: `sib-session-${n}`,
            title: `SIB session ${n}`,
            project: PROJECT,
            transcriptpath: transcript(`sib-session-${n}`),
            size: 40_000 + n,
            lastwritets,
            deletests: lastwritets + 90 * DAY,
            outcome: "not-scanned",
            ideas: 0,
            ...over,
        };
    };
    const sessions = [session(1, 20, { outcome: "ideas", ideas: 2 }), session(2, 12, { outcome: "ideas", ideas: 1 }), session(3, 4)];
    const mark = (s, ideas) => ({
        transcriptpath: s.transcriptpath,
        sessionid: s.sessionid,
        sessiontitle: s.title,
        project: PROJECT,
        size: s.size,
        mtimems: s.lastwritets,
        scannedts: now - DAY,
        lastturnts: s.lastwritets,
        ideas,
        outcome: "ideas",
    });
    const idea = (n, s, over) => ({
        id: `sib-idea-${n}`,
        project: PROJECT,
        projectpath: PROJECT_PATH,
        why: "It came up while fixing something else and nobody picked it up.",
        sessionid: s.sessionid,
        sessiontitle: s.title,
        transcriptpath: s.transcriptpath,
        saidts: s.lastwritets - 3_600_000,
        deletests: s.deletests,
        foundts: now - DAY,
        state: "review",
        resolvedts: 0,
        keptas: "",
        ...over,
    });
    const ideas = [
        idea(1, sessions[0], {
            gist: "Show the deletion day beside each session",
            effortoid,
            efforttitle: TITLE,
            quotes: [
                { who: "you", text: "should the list say when a session goes away?" },
                { who: "agent", text: "It could, from the last write plus the cleanup period." },
            ],
        }),
        idea(2, sessions[0], {
            gist: "Fold the coverage bar into the region's header",
            effortoid,
            efforttitle: TITLE,
            quotes: [{ who: "you", text: "maybe the bar belongs up with the count" }],
        }),
        idea(3, sessions[1], {
            gist: NEW_IDEA,
            effortoid: "",
            efforttitle: "",
            quotes: [{ who: "you", text: "what if I drop one by mistake?" }],
        }),
    ];
    const endedts = now - DAY + 600_000;
    return {
        data: {
            ideas,
            marks: [mark(sessions[0], 2), mark(sessions[1], 1)],
            sessions: [],
            lastscants: endedts,
            nextscants: now + 6 * DAY,
            firstscandone: true,
            scan: {
                done: 2,
                total: 2,
                startedts: now - DAY - 600_000,
                endedts,
                forced: false,
                error: "",
                stoppedat: 0,
                newideas: 3,
                tokens: 210_000,
            },
        },
        fixture: true,
        sessions,
        reply: "[]",
    };
}

// the seed with `tweak` applied to it, written with fixture mode on
const reseed = (h, ctx, tweak) => {
    const seed = sessionIdeasBriefSeed(ctx.effortoid);
    tweak?.(seed);
    return h.rpc("sessionideasseed", seed);
};

// a real initiative for the two ideas to sit on, then the seed written with fixture mode on; returns the initiative's oid
async function arrangeSessionIdeasBrief(h, kit) {
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
    await kit.briefDeleteEfforts(h, NEW_IDEA).catch(() => {});
    const effortoid = await kit.briefSeedInitiative(h, TITLE, ["One", "Two"]);
    await h.rpc("sessionideasseed", sessionIdeasBriefSeed(effortoid));
    return effortoid;
}

// the launch hook off and emptied, the store emptied and fixture mode off, the initiative gone and the idea Keep made with
// it, the time of the last look back as it was; each part on its own so one failing leaves the others done
async function teardownSessionIdeasBrief(h, kit) {
    await h.ev(`globalThis.__waveSessionIdeasLaunch?.setHook(false); globalThis.__waveSessionIdeasLaunch?.clear()`).catch(() => {});
    await h.rpc("sessionideasseed", { clear: true }).catch(() => {});
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
    await kit.briefDeleteEfforts(h, NEW_IDEA).catch(() => {});
}

export function sessionIdeasBriefScenarios(kit) {
    const { briefNap, briefViewport, briefReload, polishWaitFor } = kit;

    // the page reads, each through one h.ev
    const exists = (h, sel) => h.ev(`!!${q(sel)}`);
    const textOf = (h, sel) => h.ev(`(${q(sel)}?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
    const click = (h, sel) => h.ev(`(() => { const el = ${q(sel)}; if (el == null) return false; el.click(); return true; })()`);
    const launches = (h) => h.ev(`globalThis.__waveSessionIdeasLaunch?.launches() ?? null`);
    const hook = (h, on) =>
        h.ev(`globalThis.__waveSessionIdeasLaunch?.setHook(${on}); globalThis.__waveSessionIdeasLaunch?.clear(); true`);

    // the region as the page draws it
    const readRegion = (h) =>
        h.ev(`(() => {
            const region = ${q(REGION)};
            if (region == null) return null;
            const t = (el, sel) => (el.querySelector(sel)?.textContent ?? "").replace(/\\s+/g, " ").trim();
            return {
                count: t(region, "[data-jarvis-sessionideas-count]"),
                meta: t(region, "[data-jarvis-sessionideas-meta]"),
                head: [...region.firstElementChild.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
                only: region.querySelector("[data-jarvis-region-only]") != null,
                rows: [...region.querySelectorAll("[data-jarvis-sessionidea]")].map((r) => ({
                    id: r.dataset.jarvisSessionidea,
                    gist: t(r, "[data-jarvis-sessionidea-gist]"),
                    meta: t(r, "[data-jarvis-sessionidea-meta]"),
                    agent: r.dataset.jarvisSessionideaAgent,
                    buttons: [...r.querySelectorAll("button")].map((b) => b.textContent.trim()),
                })),
            };
        })()`);
    const waitRows = (h, ids, ms = 20000) =>
        polishWaitFor(
            h,
            `(() => { const got = [...document.querySelectorAll(${JSON.stringify(REGION + " [data-jarvis-sessionidea]")})].map((r) => r.dataset.jarvisSessionidea); return got.join() === ${JSON.stringify(ids.join())}; })()`,
            ms
        );

    // wavesrv's own view of the store: what a press changed, read without trusting the page
    const ideaStates = async (h) =>
        Object.fromEntries(((await h.rpc("sessionideasget", {}))?.ideas ?? []).map((i) => [i.id, i.state]));

    // the scan a press started has ended: its start is after `after`, and it has an end
    async function waitScan(h, after, ms = 30000) {
        for (let waited = 0; waited < ms; waited += 250) {
            const d = await h.rpc("sessionideasget", {}).catch(() => null);
            if (d?.scan != null && d.scan.startedts > after && d.scan.endedts > 0) return d;
            await briefNap(250);
        }
        return null;
    }

    const stepOf = async (steps, name, run) => {
        try {
            const { ok, detail } = await run();
            steps.push({ step: name, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        } catch (e) {
            steps.push({ step: name, ok: false, detail: String(e?.message ?? e) });
        }
    };

    const sessionIdeasBrief = {
        name: "sessionideas-brief",
        surface: "jarvis",
        async arrange(h) {
            const ctx = {};
            try {
                ctx.effortoid = await arrangeSessionIdeasBrief(h, kit);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            if (ctx.arrangeError != null) {
                steps.push({ step: "0. fixture mode on, the initiative and its ideas seeded", ok: false, detail: ctx.arrangeError });
                return steps;
            }
            await briefViewport(h, 1600, 1000);
            await briefReload(h);
            await h.goto("jarvis");
            await hook(h, true);

            // 1. the region sits with its three ideas, each saying where it would go, and the header says when it scanned and
            // what that cost; the picture the What's new page shows is made here
            await stepOf(steps, "1. the region shows its three ideas with their initiatives, and the header says when it scanned", async () => {
                const found = await waitRows(h, ["sib-idea-1", "sib-idea-2", "sib-idea-3"], 30000);
                await briefNap(500);
                const read = await readRegion(h);
                await h.shot("cdp-shots/sessionideas-brief-region.png");
                let picture = null;
                let pictureError = null;
                try {
                    picture = (await h.whatsnewShot?.("session-ideas", { selector: REGION })) ?? null;
                } catch (e) {
                    pictureError = String(e?.message ?? e);
                }
                const gists = (read?.rows ?? []).map((r) => r.gist);
                const metas = (read?.rows ?? []).map((r) => r.meta);
                return {
                    ok:
                        found &&
                        read != null &&
                        read.count === "3" &&
                        gists.length === 3 &&
                        gists[2] === NEW_IDEA &&
                        metas.join("|") === `${TITLE}|${TITLE}|New idea · ${PROJECT}` &&
                        /^scanned [A-Z][a-z]{2} \d{1,2} · 210k tokens · next by [A-Z][a-z]{2} \d{1,2}$/.test(read.meta) &&
                        read.head.includes("Scan now") &&
                        read.head.includes("Go through 3 with an agent") &&
                        read.only &&
                        picture != null,
                    detail: { found, read, picture, pictureError },
                };
            });

            // 2. What was said opens under the row: the quotes by who said them, the session and the day its transcript is
            // deleted with Open session; pressed again it folds
            await stepOf(steps, "2. What was said opens the quotes, the source session and the deletion day, and folds again", async () => {
                const toggle = `${row("sib-idea-1")} [data-jarvis-sessionidea-said-toggle]`;
                await click(h, toggle);
                const opened = await polishWaitFor(h, `!!${q(`${row("sib-idea-1")} [data-jarvis-sessionidea-said]`)}`, 8000);
                await briefNap(500);
                const said = await textOf(h, `${row("sib-idea-1")} [data-jarvis-sessionidea-said]`);
                const expanded = await h.ev(`${q(toggle)}?.getAttribute("aria-expanded")`);
                const openSession = await exists(h, `${row("sib-idea-1")} [data-jarvis-sessionidea-open-session]`);
                await h.shot("cdp-shots/sessionideas-brief-said.png");
                await click(h, toggle);
                const folded = await polishWaitFor(h, `!${q(`${row("sib-idea-1")} [data-jarvis-sessionidea-said]`)}`, 8000);
                return {
                    ok:
                        opened &&
                        expanded === "true" &&
                        said.includes("You") &&
                        said.includes("should the list say when a session goes away?") &&
                        said.includes("Claude") &&
                        said.includes("It could, from the last write plus the cleanup period.") &&
                        said.includes("SIB session 1") &&
                        /transcript leaves [A-Z][a-z]{2} \d{1,2}/.test(said) &&
                        openSession &&
                        folded,
                    detail: { opened, expanded, said, openSession, folded },
                };
            });

            // 3. Discuss opens one agent for the idea in its project (under the hook: recorded, nothing opened), and its button
            // reads Go to agent while it is open; the others still read Discuss
            await stepOf(steps, "3. Discuss launches the idea's agent in its project and the button reads Go to agent", async () => {
                await hook(h, true);
                await click(h, `${row("sib-idea-1")} [data-jarvis-sessionidea-discuss="start"]`);
                const went = await polishWaitFor(h, `${q(row("sib-idea-1"))}?.dataset.jarvisSessionideaAgent === "open"`, 10000);
                const read = await readRegion(h);
                const made = await launches(h);
                const first = read?.rows.find((r) => r.id === "sib-idea-1");
                const others = (read?.rows ?? []).filter((r) => r.id !== "sib-idea-1").map((r) => r.agent);
                return {
                    ok:
                        went &&
                        first?.buttons.includes("Go to agent") &&
                        others.join() === "none,none" &&
                        read.head.includes("Go through 3 with an agent") &&
                        made?.length === 1 &&
                        made[0].kind === "discuss" &&
                        made[0].ideaIds.join() === "sib-idea-1" &&
                        made[0].projectPath === PROJECT_PATH &&
                        made[0].task.startsWith("[arc:session-ideas]"),
                    detail: { went, first, others, made },
                };
            });

            // 4. Go through N opens one agent in No folder for every idea (the hook recorded one launch there), and the header
            // and each row read Go to agent
            await stepOf(steps, "4. Go through N launches one agent in No folder for all the ideas and the header reads Go to agent", async () => {
                await click(h, `${REGION} [data-jarvis-sessionideas-gothrough="start"]`);
                const went = await polishWaitFor(h, `${q(`${REGION} [data-jarvis-sessionideas-gothrough="open"]`)} != null`, 10000);
                const read = await readRegion(h);
                const made = await launches(h);
                const through = made?.filter((m) => m.kind === "go-through") ?? [];
                return {
                    ok:
                        went &&
                        read.head.includes("Go to agent") &&
                        read.rows.every((r) => r.agent === "open" && r.buttons.includes("Go to agent")) &&
                        through.length === 1 &&
                        through[0].ideaIds.slice().sort().join() === "sib-idea-1,sib-idea-2,sib-idea-3" &&
                        through[0].projectPath !== "" &&
                        through[0].projectPath !== PROJECT_PATH &&
                        through[0].task.startsWith("[arc:session-ideas]"),
                    detail: { went, head: read?.head, agents: read?.rows.map((r) => r.agent), through },
                };
            });

            // 5. Keep of the new idea: its row leaves on the spring, wavesrv marks it kept, and the Ideas column shows it after
            // the next read
            await stepOf(steps, "5. Keep of the new idea: the row leaves and the idea shows in the Ideas column", async () => {
                await hook(h, true);
                await reseed(h, ctx);
                await waitRows(h, ["sib-idea-1", "sib-idea-2", "sib-idea-3"]);
                const before = (await readRegion(h))?.count;
                await click(h, `${row("sib-idea-3")} [data-jarvis-sessionidea-keep]`);
                const left = await waitRows(h, ["sib-idea-1", "sib-idea-2"]);
                const inIdeas = await polishWaitFor(h, `(${q("[data-jarvis-ideas]")}?.textContent ?? "").includes(${JSON.stringify(NEW_IDEA)})`, 20000);
                await h.shot("cdp-shots/sessionideas-brief-kept.png");
                const states = await ideaStates(h);
                const count = (await readRegion(h))?.count;
                return {
                    ok: before === "3" && left && inIdeas && states["sib-idea-3"] === "kept" && count === "2",
                    detail: { before, left, inIdeas, states, count },
                };
            });

            // 6. Drop of an idea on the initiative: the row leaves and wavesrv marks it dropped
            await stepOf(steps, "6. Drop: the row leaves and the idea is dropped", async () => {
                await click(h, `${row("sib-idea-2")} [data-jarvis-sessionidea-drop]`);
                const left = await waitRows(h, ["sib-idea-1"]);
                const states = await ideaStates(h);
                const count = (await readRegion(h))?.count;
                return { ok: left && states["sib-idea-2"] === "dropped" && count === "1", detail: { left, states, count } };
            });

            // 7. Scan now, in fixture mode: the one unscanned fixture session is read with no model and no real transcript, and
            // the header's date and tokens are the new scan's
            await stepOf(steps, "7. Scan now reads the fixture session and the scanned line's date and tokens update", async () => {
                await kit.briefDeleteEfforts(h, NEW_IDEA).catch(() => {});
                await reseed(h, ctx);
                await waitRows(h, ["sib-idea-1", "sib-idea-2", "sib-idea-3"]);
                const seeded = (await h.rpc("sessionideasget", {}))?.scan;
                const metaBefore = (await readRegion(h))?.meta;
                await click(h, `${REGION} [data-jarvis-sessionideas-scan]`);
                const done = await waitScan(h, seeded?.startedts ?? 0);
                const updated = await polishWaitFor(
                    h,
                    `(${q(`${REGION} [data-jarvis-sessionideas-meta]`)}?.textContent ?? "") !== ${JSON.stringify(metaBefore ?? "")}`,
                    10000
                );
                const meta = (await readRegion(h))?.meta ?? "";
                return {
                    ok:
                        done != null &&
                        done.scan.done === 1 &&
                        done.scan.error === "" &&
                        done.scan.tokens > 0 &&
                        done.lastscants > (seeded?.endedts ?? 0) &&
                        updated &&
                        meta.startsWith(`scanned ${today()} · `) &&
                        / \d+k? tokens/.test(meta),
                    detail: { scan: done?.scan, metaBefore, meta, updated },
                };
            });

            // 8. Sessions scanned opens: the coverage bar and its legend say each part with its count, then each session with what
            // it gave
            await stepOf(steps, "8. Sessions scanned opens a coverage bar, its legend and each session with its outcome", async () => {
                await reseed(h, ctx);
                await waitRows(h, ["sib-idea-1", "sib-idea-2", "sib-idea-3"]);
                const folded = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-sessionideas-fold="closed"]`)}`, 10000);
                await click(h, `${REGION} [data-jarvis-sessionideas-fold]`);
                const opened = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-sessionideas-scanned]`)}`, 8000);
                await briefNap(500);
                const read = await h.ev(`(() => {
                    const box = ${q(`${REGION} [data-jarvis-sessionideas-scanned]`)};
                    if (box == null) return null;
                    const t = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
                    return {
                        bar: ${q(`${REGION} [data-jarvis-sessionideas-fold] [role="img"]`)}?.getAttribute("aria-label") ?? null,
                        legend: [...box.querySelectorAll("[data-jarvis-sessionideas-legend]")].map(t),
                        sessions: Object.fromEntries(
                            [...box.querySelectorAll("[data-jarvis-sessionideas-session]")].map((s) => [
                                s.dataset.jarvisSessionideasSession,
                                t(s.querySelector("[data-jarvis-sessionideas-result]")),
                            ])
                        ),
                    };
                })()`);
                await h.shot("cdp-shots/sessionideas-brief-scanned.png");
                return {
                    ok:
                        folded &&
                        opened &&
                        read != null &&
                        /^2 scanned,/.test(read.bar ?? "") &&
                        read.legend.length === 3 &&
                        /^2 scanned$/.test(read.legend[0]) &&
                        /^\d+ not yet$/.test(read.legend[1]) &&
                        /^\d+ leave within 7 days$/.test(read.legend[2]) &&
                        read.sessions["sib-session-1"] === "2 ideas · above" &&
                        read.sessions["sib-session-2"] === "1 idea · above",
                    detail: { folded, opened, read },
                };
            });

            // 9. Before the first scan: no region, the offer card under the Ideas column with what it reads and costs; Not now puts
            // it away. Pressing Scan my sessions is the next step.
            await stepOf(steps, "9. before the first scan the offer sits under Ideas, with no region, and Not now puts it away", async () => {
                await reseed(h, ctx, (seed) => {
                    seed.data.ideas = [];
                    seed.data.marks = [];
                    seed.data.firstscandone = false;
                    seed.data.lastscants = 0;
                    seed.data.nextscants = 0;
                    delete seed.data.scan;
                });
                const OFFER = "[data-jarvis-ideas] [data-jarvis-sessionideas-offer]";
                const shown = await polishWaitFor(h, `!!${q(OFFER)}`, 15000);
                await briefNap(500);
                const text = await textOf(h, OFFER);
                const cost = await textOf(h, `${OFFER} [data-jarvis-sessionideas-offer-cost]`);
                const regionShown = await exists(h, REGION);
                // the first-scan offer's M is the sessions wavesrv lists as not scanned
                const m = ((await h.rpc("sessionideasget", {}))?.sessions ?? []).filter((s) => s.outcome === "not-scanned").length;
                const costOk = m > 0 ? new RegExp(`^haiku · about \\d+k? tokens for ${m} sessions?$`).test(cost) : /no quiet sessions/.test(cost);
                await h.shot("cdp-shots/sessionideas-brief-offer.png");
                await click(h, `${OFFER} [data-jarvis-sessionideas-offer-later]`);
                const away = await polishWaitFor(h, `!${q(OFFER)}`, 8000);
                const scanned = (await h.rpc("sessionideasget", {}))?.scan ?? null;
                return {
                    ok:
                        shown &&
                        !regionShown &&
                        text.includes("Ideas you floated and left") &&
                        text.includes("Scan my sessions") &&
                        text.includes("Not now") &&
                        costOk &&
                        away &&
                        scanned == null,
                    detail: { shown, regionShown, cost, m, away, scanned },
                };
            });

            // 10. Scan my sessions starts the first scan (fixture mode: no model, no real transcript): the offer leaves, the region
            // comes, and with nothing found it says so
            await stepOf(steps, "10. Scan my sessions runs the first scan, and the region says nothing was left open", async () => {
                await reseed(h, ctx, (seed) => {
                    seed.data.ideas = [];
                    seed.data.marks = [];
                    seed.data.firstscandone = false;
                    seed.data.lastscants = 0;
                    seed.data.nextscants = 0;
                    delete seed.data.scan;
                });
                // a reload puts Not now back: the card is on the page again
                await briefReload(h);
                await hook(h, true);
                const OFFER = "[data-jarvis-ideas] [data-jarvis-sessionideas-offer]";
                const shown = await polishWaitFor(h, `!!${q(OFFER)}`, 30000);
                await click(h, `${OFFER} [data-jarvis-sessionideas-offer-scan]`);
                const done = await waitScan(h, 0);
                const empty = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-brief-empty="sessions"]`)}`, 15000);
                const offerGone = await polishWaitFor(h, `!${q(OFFER)}`, 8000);
                const said = await textOf(h, `${REGION} [data-jarvis-brief-empty="sessions"]`);
                return {
                    ok:
                        shown &&
                        done != null &&
                        done.firstscandone === true &&
                        empty &&
                        offerGone &&
                        said === "Nothing left open in the sessions scanned so far.",
                    detail: { shown, scan: done?.scan, empty, offerGone, said },
                };
            });

            // 10b. A scan of one project: with two projects to read the offer carries a project menu; picking one moves the
            // estimate and the button to it, and its scan reads that project alone, scopes the schedule to it and leaves the
            // offer up for the other project, while the region's header says which project it covers
            await stepOf(steps, "10b. the offer scans one project picked from its menu, and stays for the rest", async () => {
                const OTHER_DIR = "C:\\arc-verify-sib\\other\\.claude";
                await reseed(h, ctx, (seed) => {
                    seed.data.ideas = [];
                    seed.data.marks = [];
                    seed.data.firstscandone = false;
                    seed.data.lastscants = 0;
                    seed.data.nextscants = 0;
                    delete seed.data.scan;
                    const base = seed.sessions[2];
                    for (const n of [4, 5]) {
                        seed.sessions.push({
                            ...base,
                            sessionid: `sib-session-${n}`,
                            title: `SIB session ${n}`,
                            project: "sib-other",
                            transcriptpath: `${OTHER_DIR}\\sib-session-${n}.jsonl`,
                            size: 40_000 + n,
                        });
                    }
                });
                await briefReload(h);
                await hook(h, true);
                const OFFER = "[data-jarvis-ideas] [data-jarvis-sessionideas-offer]";
                const MENU = `${OFFER} [data-jarvis-sessionideas-offer-project]`;
                const shown = await polishWaitFor(h, `!!${q(MENU)}`, 30000);
                const before = { button: await textOf(h, `${OFFER} [data-jarvis-sessionideas-offer-scan]`), cost: await textOf(h, `${OFFER} [data-jarvis-sessionideas-offer-cost]`) };
                await click(h, MENU);
                const items = await polishWaitFor(h, `!!${q('[data-context-menu] [data-menu-item="sib-other"]')}`, 5000);
                const listed = await h.ev(`[...document.querySelectorAll("[data-context-menu] [data-menu-item]")].map((el) => el.getAttribute("data-menu-item"))`);
                await h.shot("cdp-shots/sessionideas-brief-offer-project-menu.png");
                await click(h, '[data-context-menu] [data-menu-item="sib-other"]');
                const picked = await polishWaitFor(h, `(${q(`${OFFER} [data-jarvis-sessionideas-offer-scan]`)}?.textContent ?? "").trim() === "Scan sib-other"`, 5000);
                const cost = await textOf(h, `${OFFER} [data-jarvis-sessionideas-offer-cost]`);
                await h.shot("cdp-shots/sessionideas-brief-offer-project.png");
                const started = Date.now();
                await click(h, `${OFFER} [data-jarvis-sessionideas-offer-scan]`);
                const done = await waitScan(h, started - 1000);
                const read = done?.sessions?.filter((s) => s.outcome !== "not-scanned").map((s) => s.sessionid).sort() ?? [];
                const stays = await polishWaitFor(h, `(${q(OFFER)}?.textContent ?? "").includes("Scanned so far: sib-other.")`, 15000);
                const meta = await textOf(h, `${REGION} [data-jarvis-sessionideas-meta]`);
                const button = await textOf(h, `${OFFER} [data-jarvis-sessionideas-offer-scan]`);
                await h.shot("cdp-shots/sessionideas-brief-offer-scoped.png");
                return {
                    ok:
                        shown &&
                        before.button === "Scan my sessions" &&
                        /for 3 sessions$/.test(before.cost) &&
                        items &&
                        JSON.stringify(listed) === JSON.stringify(["all", "sib-other", "sib-project"]) &&
                        picked &&
                        /for 2 sessions$/.test(cost) &&
                        done != null &&
                        done.firstscandone === false &&
                        JSON.stringify(done.scanprojects) === JSON.stringify([OTHER_DIR]) &&
                        JSON.stringify(read) === JSON.stringify(["sib-session-4", "sib-session-5"]) &&
                        stays &&
                        meta.includes("sib-other only") &&
                        button === "Scan my sessions",
                    detail: { shown, before, listed, picked, cost, scan: done?.scan, scanprojects: done?.scanprojects, read, stays, meta, button },
                };
            });

            // 10c. Many projects: the menu opens a picker with a filter field instead of the context menu, each project
            // named by the folder its sessions were started in ("SIEM/src", "~"); typing narrows the list, Enter picks
            // and gives the keys back to the face, Esc closes
            await stepOf(steps, "10c. a long project menu is a picker with a filter field, its projects named by their folders", async () => {
                const PATHS = [
                    "D:\\Workspace\\SIEM\\src",
                    "~",
                    "~\\.arc\\no-folder",
                    "D:\\Workspace\\SIEM\\apps\\website",
                    "D:\\Workspace\\SIEM\\website\\apps\\website",
                    "D:\\work\\vnstock-js",
                    "D:\\work\\portfolio-journal",
                    "D:\\work\\lingua",
                    "D:\\work\\mit-thesis",
                ];
                await reseed(h, ctx, (seed) => {
                    seed.data.ideas = [];
                    seed.data.marks = [];
                    seed.data.firstscandone = false;
                    seed.data.scanprojects = [];
                    seed.data.lastscants = 0;
                    seed.data.nextscants = 0;
                    delete seed.data.scan;
                    const base = seed.sessions[2];
                    PATHS.forEach((projectpath, n) => {
                        seed.sessions.push({
                            ...base,
                            sessionid: `sib-many-${n}`,
                            title: `SIB many ${n}`,
                            project: "",
                            projectpath,
                            transcriptpath: `C:\\arc-verify-sib\\many-${n}\\.claude\\sib-many-${n}.jsonl`,
                            size: 50_000 + n,
                        });
                    });
                });
                await briefReload(h);
                await hook(h, true);
                const OFFER = "[data-jarvis-ideas] [data-jarvis-sessionideas-offer]";
                const FACE = `${OFFER} [data-jarvis-sessionideas-offer-project]`;
                const PICKER = "[data-filter-picker]";
                const items = () => h.ev(`[...document.querySelectorAll("${PICKER} [data-filter-picker-item]")].map((el) => el.getAttribute("data-filter-picker-item"))`);
                const shown = await polishWaitFor(h, `!!${q(FACE)}`, 30000);
                await click(h, FACE);
                const opened = await polishWaitFor(h, `!!${q(PICKER)} && document.activeElement === ${q(`${PICKER} [data-filter-picker-input]`)}`, 5000);
                const noContextMenu = !(await exists(h, "[data-context-menu]"));
                const all = await items();
                await h.shot("cdp-shots/sessionideas-brief-offer-picker.png");
                await h.cdp("Input.insertText", { text: "siem" });
                const narrowed = await polishWaitFor(h, `document.querySelectorAll("${PICKER} [data-filter-picker-item]").length === 3`, 5000);
                const siem = await items();
                await h.shot("cdp-shots/sessionideas-brief-offer-picker-filtered.png");
                await h.cdp("Input.insertText", { text: " src" });
                await polishWaitFor(h, `document.querySelectorAll("${PICKER} [data-filter-picker-item]").length === 1`, 5000);
                for (const type of ["keyDown", "keyUp"]) {
                    await h.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
                }
                const picked = await polishWaitFor(h, `(${q(`${OFFER} [data-jarvis-sessionideas-offer-scan]`)}?.textContent ?? "").trim() === "Scan SIEM/src"`, 5000);
                const closed = await polishWaitFor(h, `!${q(PICKER)}`, 5000);
                const faceFocused = await h.ev(`document.activeElement === ${q(FACE)}`);
                await click(h, FACE);
                const reopened = await polishWaitFor(h, `!!${q(PICKER)}`, 5000);
                for (const type of ["keyDown", "keyUp"]) {
                    await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
                }
                const escClosed = await polishWaitFor(h, `!${q(PICKER)}`, 5000);
                const want = ["all", "SIEM/src", "~", "no-folder", "SIEM/apps/website", "website/apps/website", "vnstock-js"];
                return {
                    ok:
                        shown &&
                        opened &&
                        noContextMenu &&
                        all.length === PATHS.length + 2 &&
                        want.every((l) => all.includes(l)) &&
                        narrowed &&
                        JSON.stringify([...siem].sort()) === JSON.stringify(["SIEM/apps/website", "SIEM/src", "website/apps/website"].sort()) &&
                        picked &&
                        closed &&
                        faceFocused &&
                        reopened &&
                        escClosed,
                    detail: { shown, opened, noContextMenu, all, narrowed, siem, picked, closed, faceFocused, reopened, escClosed },
                };
            });

            // 11. A scan that runs: the progress says which session it is reading, Stop is there, the ideas found stay listed and
            // Scan now is not offered meanwhile
            await stepOf(steps, "11. a scan that runs shows its progress with Stop, and the rows stay", async () => {
                await reseed(h, ctx, (seed) => {
                    seed.data.scan = {
                        done: 1,
                        total: 4,
                        startedts: Date.now() - 30_000,
                        endedts: 0,
                        forced: false,
                        error: "",
                        stoppedat: 0,
                        newideas: 0,
                        tokens: 0,
                    };
                });
                const shown = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-sessionideas-scanning]`)}`, 15000);
                await briefNap(500);
                const text = await textOf(h, `${REGION} [data-jarvis-sessionideas-scanning]`);
                const valuenow = await h.ev(`${q(`${REGION} [role="progressbar"]`)}?.getAttribute("aria-valuenow")`);
                const stop = await exists(h, `${REGION} [data-jarvis-sessionideas-stop]`);
                const read = await readRegion(h);
                await h.shot("cdp-shots/sessionideas-brief-scanning.png");
                return {
                    ok:
                        shown &&
                        text.includes("Reading session 2 of 4") &&
                        valuenow === "25" &&
                        stop &&
                        read.meta === "scanning" &&
                        !read.head.includes("Scan now") &&
                        read.rows.length === 3,
                    detail: { shown, text, valuenow, stop, meta: read?.meta, head: read?.head, rows: read?.rows.length },
                };
            });

            // 12. A scan that stopped part way: the error line says where and why, what it found stays, and Retry goes on (fixture
            // mode: the one unscanned session is read) and clears the line
            await stepOf(steps, "12. a scan that stopped shows where and why, keeps what it found, and Retry goes on", async () => {
                const seeded = Date.now();
                await reseed(h, ctx, (seed) => {
                    seed.data.scan = {
                        done: 1,
                        total: 4,
                        startedts: seeded - 60_000,
                        endedts: seeded - 5_000,
                        forced: false,
                        error: "haiku returned 529 (overloaded)",
                        stoppedat: 1,
                        newideas: 0,
                        tokens: 1000,
                    };
                });
                const shown = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-sessionideas-stopped]`)}`, 15000);
                await briefNap(500);
                const text = await textOf(h, `${REGION} [data-jarvis-sessionideas-stopped]`);
                const kept = (await readRegion(h))?.rows.length;
                await h.shot("cdp-shots/sessionideas-brief-stopped.png");
                await click(h, `${REGION} [data-jarvis-sessionideas-retry]`);
                const done = await waitScan(h, seeded - 60_000);
                const cleared = await polishWaitFor(h, `!${q(`${REGION} [data-jarvis-sessionideas-stopped]`)}`, 10000);
                return {
                    ok:
                        shown &&
                        text.includes("The scan stopped at session 2 of 4: haiku returned 529 (overloaded).") &&
                        text.includes("Retry goes on from session 2.") &&
                        kept === 3 &&
                        done != null &&
                        done.scan.error === "" &&
                        cleared,
                    detail: { shown, text, kept, scan: done?.scan, cleared },
                };
            });

            // 13. Sessions leaving soon unscanned: the warning line says how many and the day. The count is wavesrv's, from the
            // fixture sessions: one unscanned session whose transcript is deleted in 5 days.
            await stepOf(steps, "13. sessions leaving soon unscanned show a warning with the count and the day", async () => {
                await reseed(h, ctx, (seed) => {
                    const now = Date.now();
                    seed.sessions.push({
                        sessionid: "sib-session-4",
                        title: "SIB session 4",
                        project: PROJECT,
                        transcriptpath: transcript("sib-session-4"),
                        size: 40_004,
                        lastwritets: now - 85 * DAY,
                        deletests: now + 5 * DAY,
                        outcome: "not-scanned",
                        ideas: 0,
                    });
                });
                const shown = await polishWaitFor(h, `!!${q(`${REGION} [data-jarvis-sessionideas-leaving]`)}`, 15000);
                const text = await textOf(h, `${REGION} [data-jarvis-sessionideas-leaving]`);
                await h.shot("cdp-shots/sessionideas-brief-leaving.png");
                return {
                    ok: shown && /^1 session is deleted on [A-Z][a-z]{2} \d{1,2} and has not been scanned\.$/.test(text),
                    detail: { shown, text },
                };
            });

            // 14. Since you looked: a scan that ended after the last look reads "Scanned N sessions: K ideas to review" with Review;
            // Review lands on the region, which counts the ideas as looked at
            await stepOf(steps, "14. Since you looked has a Sessions row, and Review lands on the region and marks the ideas seen", async () => {
                const now = Date.now();
                const prior = await h.ev(`localStorage.getItem(${JSON.stringify(LAST_SEEN_KEY)})`);
                try {
                    await h.ev(`localStorage.setItem(${JSON.stringify(LAST_SEEN_KEY)}, ${JSON.stringify(String(now - 6 * 3_600_000))})`);
                    await reseed(h, ctx, (seed) => {
                        seed.data.seents = 0;
                        seed.data.scan = {
                            done: 3,
                            total: 3,
                            startedts: now - 3_600_000 - 300_000,
                            endedts: now - 3_600_000,
                            forced: false,
                            error: "",
                            stoppedat: 0,
                            newideas: 3,
                            tokens: 30_000,
                        };
                        // found while the scan ran
                        seed.data.ideas.forEach((i) => (i.foundts = now - 3_600_000 - 60_000));
                    });
                    await briefReload(h);
                    const SECTION = '[data-jarvis-since-section="sessions"]';
                    const shown = await polishWaitFor(h, `!!${q(`${SECTION} [data-jarvis-brief-row="since-sessions"]`)}`, 30000);
                    const text = await textOf(h, SECTION);
                    await h.shot("cdp-shots/sessionideas-brief-since.png");
                    await click(h, `${SECTION} [data-jarvis-since-sessions-review]`);
                    const seen = await polishWaitFor(h, `!!${q(REGION)}`, 10000);
                    let seents = 0;
                    for (let waited = 0; waited < 10000 && seents === 0; waited += 250) {
                        seents = (await h.rpc("sessionideasget", {}))?.seents ?? 0;
                        if (seents === 0) await briefNap(250);
                    }
                    return {
                        ok:
                            shown &&
                            text.includes("Scanned 3 sessions: 3 ideas to review") &&
                            text.includes("2 on initiatives, 1 new idea") &&
                            text.includes("Review") &&
                            seen &&
                            seents > 0,
                        detail: { shown, text, seen, seents },
                    };
                } finally {
                    await h
                        .ev(
                            prior == null
                                ? `localStorage.removeItem(${JSON.stringify(LAST_SEEN_KEY)})`
                                : `localStorage.setItem(${JSON.stringify(LAST_SEEN_KEY)}, ${JSON.stringify(prior)})`
                        )
                        .catch(() => {});
                }
            });

            return steps;
        },
        async teardown(h) {
            await teardownSessionIdeasBrief(h, kit);
        },
    };
    return [sessionIdeasBrief];
}
