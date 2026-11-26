// sessionideas-pet: Sprout's popup and the Waiting line for session ideas (docs/superpowers/specs/2026-11-26-session-ideas-design.md,
// plan docs/superpowers/plans/2026-11-26-session-ideas.md). The module holds the fixture the popup's steps run against:
// fixture mode on (the scan reads the seeded sessions below, never ~/.claude, and its model call returns the seeded
// reply and spends nothing), two ideas on a real initiative, one new idea, and the fixture sessions they came from.
// kit is scenarios.mjs's JARVIS_KIT. The Brief's own module (sessionideas-brief-scenarios.mjs) seeds the same shape under
// its own titles, so the two never share an initiative.

const DAY = 86_400_000;
const TITLE = "SIP initiative";
const PROJECT = "sip-project";
const PROJECT_PATH = "C:\\arc-verify-sip\\project";

const transcript = (id) => `${PROJECT_PATH}\\.claude\\${id}.jsonl`;

// The seed the popup's steps share. Sessions s1 and s2 gave the three ideas and carry their marks; s3 is quiet and not yet
// scanned. Write times are back from now, so the deletion days stay ahead of it (s1's is the nearest).
function sessionIdeasPetSeed(effortoid, now = Date.now()) {
    const session = (n, ageDays, over = {}) => {
        const lastwritets = now - ageDays * DAY;
        return {
            sessionid: `sip-session-${n}`,
            title: `SIP session ${n}`,
            project: PROJECT,
            transcriptpath: transcript(`sip-session-${n}`),
            size: 30_000 + n,
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
        id: `sip-idea-${n}`,
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
            gist: "Let the popup list the ideas that lose their transcript first",
            effortoid,
            efforttitle: TITLE,
            quotes: [{ who: "you", text: "which of these goes away soonest?" }],
        }),
        idea(2, sessions[0], {
            gist: "Say how many ideas are waiting under the updates",
            effortoid,
            efforttitle: TITLE,
            quotes: [{ who: "agent", text: "A single line under the updates would do." }],
        }),
        idea(3, sessions[1], {
            gist: "Offer a quick pass through every idea in one agent",
            effortoid: "",
            efforttitle: "",
            quotes: [{ who: "you", text: "one agent could walk them with me" }],
        }),
    ];
    return {
        data: {
            ideas,
            marks: [mark(sessions[0], 2), mark(sessions[1], 1)],
            sessions: [],
            lastscants: now - DAY,
            nextscants: now + 6 * DAY,
            firstscandone: true,
        },
        fixture: true,
        sessions,
        reply: "[]",
    };
}

// a real initiative for the two ideas to sit on, then the seed written with fixture mode on; returns the initiative's oid
async function arrangeSessionIdeasPet(h, kit) {
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
    const effortoid = await kit.briefSeedInitiative(h, TITLE, ["One", "Two"]);
    await h.rpc("sessionideasseed", sessionIdeasPetSeed(effortoid));
    return effortoid;
}

// the store emptied and fixture mode off, the initiative gone; each part on its own so one failing leaves the other done
async function teardownSessionIdeasPet(h, kit) {
    await h.rpc("sessionideasseed", { clear: true }).catch(() => {});
    await kit.briefDeleteEfforts(h, TITLE).catch(() => {});
}

export function sessionIdeasPetScenarios(kit) {
    const sessionIdeasPet = {
        name: "sessionideas-pet",
        surface: "agent",
        async arrange(h) {
            const ctx = {};
            try {
                ctx.effortoid = await arrangeSessionIdeasPet(h, kit);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },
        async assert(h, ctx) {
            const steps = [];
            if (ctx.arrangeError != null) {
                steps.push({ step: "0. fixture mode on, the initiative and its ideas seeded", ok: false, detail: ctx.arrangeError });
            }
            return steps;
        },
        async teardown(h) {
            await teardownSessionIdeasPet(h, kit);
        },
    };
    return [sessionIdeasPet];
}
