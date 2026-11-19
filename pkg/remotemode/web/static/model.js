// Pure logic of the phone page, with no DOM, so model.test.js can cover it; phone.js draws from it.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const HELD_KIND = "run-land-held";
const SHOWN_WORDS = {
    "run-land-held": "Held",
    "dag-blocked": "Blocked",
    escalation: "Escalated",
    "run-unverified": "Unverified",
    "workflow-scan": "Workflow scan",
};

// claude code has no separate "recommended" flag: by convention it appends this marker to the label
const RECOMMENDED_SUFFIX = /\s*\(recommended\)\s*$/i;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// the states of an agent that waits on the owner and that the owner can only clear at the desk or by
// approving: an asking agent is counted through its question instead
const NEEDS_YOU_STATES = new Set(["permission", "input"]);

// A run's counts line reads what is running first, then what waits, idle last ("3 working · 1 needs
// approval"). Each entry words one state for a count.
const COUNT_WORDS = {
    working: () => "working",
    asking: () => "asking",
    permission: (n) => (n === 1 ? "needs approval" : "need approval"),
    input: (n) => (n === 1 ? "needs input" : "need input"),
    idle: () => "idle",
};

/** Which view the list draws: a failed fetch is unreachable whatever was shown before. */
export function viewState(list, error) {
    if (error) {
        return "unreachable";
    }
    const empty =
        !list ||
        ((list.questions ?? []).length === 0 &&
            (list.handed ?? []).length === 0 &&
            (list.shown ?? []).length === 0 &&
            (list.runs ?? []).length === 0 &&
            listedAgents(list).length === 0);
    return empty ? "empty" : "main";
}

/**
 * Every agent that needs approval or input, once per tab, as a map from the tab to its state (the first state
 * seen when a tab appears twice). The agents come from Handed over, the listed agents (which repeat the handed
 * ones) and every run's workers. An asking agent is left out: its question is counted instead. The title's
 * count and the counts line both read this, so they cannot disagree about who waits.
 */
function needYouTabs(list) {
    const tabs = new Map();
    const note = (a) => {
        if (NEEDS_YOU_STATES.has(a?.state) && !tabs.has(a.tab)) {
            tabs.set(a.tab, a.state);
        }
    };
    (list?.handed ?? []).forEach(note);
    (list?.agents ?? []).forEach(note);
    for (const run of list?.runs ?? []) {
        (run.workers ?? []).forEach(note);
    }
    return tabs;
}

/**
 * How many things need the owner: the open questions, the shown attention items, and every agent that needs
 * approval or input, counted once per tab (see needYouTabs).
 */
export function needYouCount(list) {
    return (list?.questions ?? []).length + (list?.shown ?? []).length + needYouTabs(list).size;
}

/** The header's title: "2 need you", "1 needs you" or "Nothing waits on you". */
export function needYouTitle(list) {
    const n = needYouCount(list);
    if (n === 0) {
        return "Nothing waits on you";
    }
    return n === 1 ? "1 needs you" : `${n} need you`;
}

/** An agent's project, only when it differs from its name (an agent's default name is its project). */
export function agentProject(agent) {
    const project = (agent?.project ?? "").trim();
    const name = (agent?.name ?? "").trim();
    return project && project.toLowerCase() !== name.toLowerCase() ? project : "";
}

/** A run row's counts line from its workers' states, e.g. "3 working · 1 needs approval". */
export function runCounts(run) {
    const counts = new Map();
    for (const w of run?.workers ?? []) {
        counts.set(w.state, (counts.get(w.state) ?? 0) + 1);
    }
    const known = Object.keys(COUNT_WORDS).filter((s) => counts.has(s));
    const other = [...counts.keys()].filter((s) => !Object.hasOwn(COUNT_WORDS, s));
    return [...known, ...other]
        .map((s) => {
            const n = counts.get(s);
            return `${n} ${Object.hasOwn(COUNT_WORDS, s) ? COUNT_WORDS[s](n) : s}`;
        })
        .join(" · ");
}

/** A run worker's line under its run: its label and what it is doing. */
export function runWorkerText(worker) {
    return [worker?.label, worker?.line].filter(Boolean).join(" · ");
}

/**
 * Why a phone post failed, in words: the server's own reason when it sent one, else what happened. A null
 * status is no answer at all, 0 a redirect to the login (an expired access session).
 */
export function failReason(status, reason) {
    if (reason) {
        return reason;
    }
    if (status == null) {
        return "arcterm is not reachable";
    }
    return status === 0 ? "the login expired, reload the page" : `arcterm answered ${status}`;
}

/** The line under an agent row whose take was refused or failed. Only a 409 carries a reason worth quoting. */
export function takeNotice(status, reason) {
    return `Not taken: ${failReason(status, status === 409 ? reason : "")}`;
}

/** The Agents section's rows: every agent the server lists but the ones already under Handed over. */
export function listedAgents(list) {
    const handed = new Set((list?.handed ?? []).map((a) => a.tab));
    return (list?.agents ?? []).filter((a) => !handed.has(a.tab));
}

/**
 * The header's counts, e.g. "2 questions to answer · 1 needs approval · 3 agents handed over · 2 runs held ·
 * 1 other". Every number but the hand-overs (who may work or idle, and repeat agents already counted) is a part
 * of needYouCount, so the line accounts for the title above it.
 */
export function countsLine(list) {
    const questions = (list?.questions ?? []).length;
    let approval = 0;
    let input = 0;
    for (const state of needYouTabs(list).values()) {
        if (state === "permission") {
            approval++;
        } else {
            input++;
        }
    }
    const handed = (list?.handed ?? []).length;
    const shown = list?.shown ?? [];
    const held = shown.filter((s) => s.kind === HELD_KIND).length;
    const other = shown.length - held;
    const parts = [];
    if (questions) {
        parts.push(plural(questions, "question to answer", "questions to answer"));
    }
    if (approval) {
        parts.push(`${approval} ${COUNT_WORDS.permission(approval)}`);
    }
    if (input) {
        parts.push(`${input} ${COUNT_WORDS.input(input)}`);
    }
    if (handed) {
        parts.push(plural(handed, "agent handed over", "agents handed over"));
    }
    if (held) {
        parts.push(plural(held, "run held", "runs held"));
    }
    if (other) {
        parts.push(`${other} other`);
    }
    return parts.length ? parts.join(" · ") : "Nothing waiting";
}

/** A wait as "12m", "2h 14m" or "3d". */
export function formatAge(ms) {
    const t = Math.max(0, ms);
    if (t >= DAY) {
        return `${Math.floor(t / DAY)}d`;
    }
    if (t >= HOUR) {
        const m = Math.floor((t % HOUR) / MINUTE);
        return m ? `${Math.floor(t / HOUR)}h ${m}m` : `${Math.floor(t / HOUR)}h`;
    }
    return t < MINUTE ? "<1m" : `${Math.floor(t / MINUTE)}m`;
}

/** The card's foot line for a waiting question: its option count, or how many questions it asks. */
export function optionCountLine(q) {
    const questions = q.questions ?? [];
    if (questions.length > 1) {
        return `${questions.length} questions`;
    }
    const first = questions[0];
    const n = (first?.options ?? []).length;
    if (n === 0) {
        return "Type an answer";
    }
    const count = plural(n, "option", "options");
    return first.multiselect ? `${count} · pick any` : count;
}

/** An option label without the "(Recommended)" marker, and whether it carried one. */
export function splitRecommended(label) {
    return { label: label.replace(RECOMMENDED_SUFFIX, ""), recommended: RECOMMENDED_SUFFIX.test(label) };
}

/**
 * One AgentAnswerItem per question, or null while any question has neither a typed answer nor a pick.
 * Typed text wins over a pick; a prose ask has no native picker, so a pick sends its label as text, as the
 * cockpit's answer bar does. picks[qi] is the array of picked option indexes, texts[qi] the typed line.
 */
export function buildAnswers(questions, picks, texts, prose = false) {
    const answers = [];
    for (let qi = 0; qi < questions.length; qi++) {
        const text = (texts[qi] ?? "").trim();
        const picked = [...(picks[qi] ?? [])].sort((a, b) => a - b);
        if (text) {
            answers.push({ text });
        } else if (picked.length === 0) {
            return null;
        } else if (prose) {
            answers.push({ text: questions[qi].options?.[picked[0]]?.label ?? "" });
        } else {
            answers.push({ selectedindexes: picked });
        }
    }
    return answers;
}

/** What was sent, as the "Sent to <agent>: ..." line shows it. */
export function answerText(questions, answers) {
    return answers
        .flatMap((a, qi) =>
            a.text
                ? [a.text]
                : (a.selectedindexes ?? []).map(
                      (oi) => splitRecommended(questions[qi].options?.[oi]?.label ?? "").label
                  )
        )
        .filter(Boolean)
        .join(", ");
}

/**
 * Whether the page was loaded from another build than the one now serving it: Arc was updated while the
 * page stayed open, so its code is old. An unknown build on either side is not a change.
 */
export function pageOutdated(loadedBuild, build) {
    return Boolean(loadedBuild) && Boolean(build) && loadedBuild !== build;
}

/** The word a shown-only row leads with. */
export function shownWord(kind) {
    return SHOWN_WORDS[kind] ?? kind;
}

/** A base64url string (the VAPID public key) as the bytes pushManager.subscribe takes. */
export function base64UrlToBytes(s) {
    const b64 = s
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(s.length / 4) * 4, "=");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
