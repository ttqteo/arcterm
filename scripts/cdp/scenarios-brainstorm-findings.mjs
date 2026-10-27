// What the agent finds while a question stays open: notes and recon it adds then are out of sight behind the question,
// so they read as new, and the question links to them. kit holds scenarios.mjs's brainstorm helpers.
//
// The fixture plays a mid-brainstorm report: the user asked for current trends, and the agent kept question 2 open
// with a summary in its why and the findings as notes. The pane's first read is what the user has seen.

const TOPIC = "lag-alerts-findings";
const NAME = "brainstorm-new-findings";

const Q2 = {
    n: 2,
    part: "thresholds",
    text: "When should a lag page fire?",
    why: "Lag past 15 minutes loses enrichment for the SOC dashboards; I cannot tell how fast you want to hear.",
    options: [
        { label: "Lag past a fixed line", detail: "Page once lag is past 15 minutes.", pick: true },
        { label: "Lag still growing", detail: "Page when lag has grown for 5 straight minutes." },
    ],
};
const SUMMARY =
    "Most teams now page on lag that keeps growing, not on a fixed line, and alert per partition. That points at the second answer; a fixed line still suits a hard deadline.";
const Q2_REPORTED = { ...Q2, why: `${SUMMARY} ${Q2.why}` };

const PARTS = [
    { id: "intent", title: "Intent and why", state: "yours", body: "The team that owns a consumer group hears first." },
    { id: "thresholds", title: "When it pages", state: "asked", body: "" },
    {
        id: "today",
        title: "What runs today",
        kind: "note",
        from: "recon",
        gist: "kafka-exporter scrapes 14 groups; nothing pages on lag yet.",
        body: "kafka-exporter scrapes 14 consumer groups. There are no lag rules in Alertmanager.",
    },
];
const FINDINGS = [
    {
        id: "trend-growth",
        title: "Paging on growth",
        kind: "note",
        from: "research",
        gist: "Most teams page on lag that keeps growing, not on a fixed line.",
        body: "Burrow and the Grafana Kafka mixin both judge a group by whether its lag keeps rising over a window.",
    },
    {
        id: "trend-partition",
        title: "Per-partition lag",
        kind: "note",
        from: "research",
        gist: "Lag is judged per partition: one stuck partition hides in a group's average.",
        body: "A group average can stay flat while one partition stops; alert on the worst partition.",
    },
];
const RECON_OLD = {
    kind: "recon",
    q: "I offered to look at your Prometheus targets. You said yes.",
    a: "14 consumer groups scraped by kafka-exporter, no lag rules yet.",
    into: ["today"],
};
const RECON_NEW = {
    kind: "recon",
    q: "You asked: research current trends in lag alerting",
    a: "Paging on growth per partition is the common practice now.",
    into: ["trend-growth", "trend-partition"],
};
const Q1 = { kind: "question", n: 1, q: "Who should hear first?", a: "The owning team.", into: ["intent"] };

const file = (over) => ({
    v: 1,
    title: "Consumer lag alerts",
    spec: "docs/superpowers/specs/2026-10-22-lag-alerts-design.md",
    question: Q2,
    working: null,
    parts: PARTS,
    history: [Q1, RECON_OLD],
    done: false,
    check: null,
    run: null,
    ...over,
});
const ASKING = file({});
const REPORTED = file({ question: Q2_REPORTED, parts: [...PARTS, ...FINDINGS], history: [Q1, RECON_OLD, RECON_NEW] });

export default function (kit) {
    const { bsBoardScenario, bsWrite, bsUntil, bsBrief, bsCloseDesign, bsPartSel, polishWaitFor, BS_PANE } = kit;

    const LINK = `${BS_PANE}?.querySelector("[data-brainstorm-new-findings]")`;
    const readMarks = (h) =>
        h.ev(`(() => {
            const flat = (el) => (el?.innerText ?? "").replace(/\\s+/g, " ").trim();
            const pane = ${BS_PANE};
            return {
                link: ${LINK} ? flat(${LINK}) : null,
                back: flat(pane?.querySelector("[data-brainstorm-back]")),
                unseen: [...(pane?.querySelectorAll("[data-brainstorm-part][data-unseen]") ?? [])].map((p) => p.getAttribute("data-brainstorm-part")),
                open: [...(pane?.querySelectorAll("[data-brainstorm-part]") ?? [])]
                    .filter((p) => p.querySelector("[data-brainstorm-row-toggle]")?.getAttribute("aria-expanded") === "true")
                    .map((p) => p.getAttribute("data-brainstorm-part")),
                newTag: [...(pane?.querySelectorAll("[data-brainstorm-part][data-unseen]") ?? [])].every((p) => flat(p).includes("New")),
                recon: [...(pane?.querySelectorAll("[data-brainstorm-history] > div") ?? [])]
                    .filter((r) => flat(r.querySelector("span")).startsWith("Recon"))
                    .map((r) => flat(r.querySelector("span"))),
            };
        })()`);

    return [
        bsBoardScenario(NAME, TOPIC, ASKING, async (h, ctx, rec) => {
            const s1 = await bsUntil(h, ctx, (s) => s.question.includes(Q2.text));
            const m1 = await readMarks(h);
            rec(
                "1. question 2 open, nothing added since the pane first read the file: no New findings link, no recon marked new",
                s1.ok && m1.link === null && JSON.stringify(m1.recon) === JSON.stringify(["Recon"]),
                { ...bsBrief(s1), marks: m1 }
            );

            // the agent answers a request for research: the summary in why, the findings as notes, a recon entry
            bsWrite(ctx, REPORTED);
            const s2 = await bsUntil(h, ctx, (s) => s.why.startsWith(SUMMARY));
            const linked = await polishWaitFor(h, `!!${LINK}`, 3000);
            const m2 = await readMarks(h);
            await h.shot("cdp-shots/brainstorm-new-findings.png");
            rec(
                "2. the question stays open with the summary in its why, New findings · 2 under it, and the new recon marked new in the rail",
                s2.ok &&
                    linked &&
                    s2.view === "design" &&
                    s2.question.includes(Q2.text) &&
                    m2.link === "New findings · 2" &&
                    JSON.stringify(m2.recon) === JSON.stringify(["Recon · new", "Recon"]),
                { ...bsBrief(s2), why: s2.why, marks: m2 }
            );

            await h.ev(`${LINK}?.click()`);
            const opened = await polishWaitFor(h, `!!${BS_PANE}?.querySelector("[data-brainstorm-back]")`, 3000);
            await polishWaitFor(h, `${bsPartSel("trend-partition")}?.querySelector("[data-brainstorm-row-body]") != null`, 3000);
            const m3 = await readMarks(h);
            await h.shot("cdp-shots/brainstorm-new-findings-open.png");
            const ids = FINDINGS.map((p) => p.id);
            rec(
                "3. New findings opens the design over the question with both findings open and marked New; the note seen before is not",
                opened &&
                    m3.back === `Back to question ${Q2.n}` &&
                    ids.every((id) => m3.unseen.includes(id) && m3.open.includes(id)) &&
                    !m3.unseen.includes("today") &&
                    m3.newTag,
                m3
            );

            const closed = await bsCloseDesign(h);
            const m4 = await readMarks(h);
            rec(
                "4. back on the question the marks are cleared: no link, the recon no longer new",
                closed && m4.link === null && JSON.stringify(m4.recon) === JSON.stringify(["Recon", "Recon"]),
                { closed, marks: m4 }
            );
        }),
    ];
}
