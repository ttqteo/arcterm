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

/** Which view the list draws: a failed fetch is unreachable whatever was shown before. */
export function viewState(list, error) {
    if (error) {
        return "unreachable";
    }
    const empty =
        !list ||
        ((list.questions ?? []).length === 0 && (list.handed ?? []).length === 0 && (list.shown ?? []).length === 0);
    return empty ? "empty" : "main";
}

/** The header's counts, e.g. "2 questions to answer · 3 agents handed over · 2 runs held · 1 other". */
export function countsLine(list) {
    const questions = (list?.questions ?? []).length;
    const handed = (list?.handed ?? []).length;
    const shown = list?.shown ?? [];
    const held = shown.filter((s) => s.kind === HELD_KIND).length;
    const other = shown.length - held;
    const parts = [];
    if (questions) {
        parts.push(plural(questions, "question to answer", "questions to answer"));
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
