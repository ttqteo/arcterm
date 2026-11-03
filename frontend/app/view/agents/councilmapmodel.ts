// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Council's Map tab, as pure models (councilmap.tsx draws them; board Map-tab.dc.html in
// .superpowers/design/council-stronger): the scoreboard of expert cards (`expertCards`), one expert's timeline
// (`timelineRows`), and the words of the Map and the timeline (`mapWords`). The stance matrix is `matrixRows` and
// `byAgreement` in councilmodel.ts, which the Discussion's list and the Report read too.
//
// Every word follows the council's language (`lang`: `en`, or `vi` for a council held in Vietnamese; none reads as
// English). Each word pair sits in one table here, or for the matrix's own words in councilmodel.ts beside `matrixRows`.
// The labels on the evidence bar are counted off what Go set (`label` on a proposal or a reply, `cite` on a piece of
// evidence), never judged here. Pure, no React, no Wave runtime imports (councilmapmodel.test.ts).

import { avatarTone, seatInitials, type AvatarTone } from "./councildiscussionmodel";
import {
    CHECK_LABELS,
    checkLabelOf,
    checkWord,
    councilLang,
    countTokens,
    duration,
    panel,
    roundsOf,
    sentProposals,
    sentReplies,
    wrongCiteWord,
    type CheckLabel,
    type CouncilLang,
} from "./councilmodel";
import { isBrainstorm } from "./councilsummarymodel";

// ---- the words of the Map and the timeline ----

/** The words the Map tab and the timeline show, in one council's language. */
export interface MapWords {
    tab: string; // the third tab: `Map`, `Bản đồ`
    cardsTitle: string;
    cardsHint: string;
    openTimeline: (name: string) => string; // an expert card's accessible name
    running: string; // the working dot's word, when an expert's activity has no text
    matrixTitle: string;
    matrixHint: string;
    headIdea: string;
    headAgreement: string;
    headOutcome: string;
    reasonsTitle: string; // an open row's label, under the idea
    noIdeas: string; // the matrix's line before any idea is sent
    revisedFoot: string; // what a `revised in round N` cell means
    legend: { label: CheckLabel; word: string; meaning: string }[]; // what each badge means
    wrongCite: { word: string; meaning: string };
    reportLink: string; // the Report's line that opens the Map
    timeline: string; // the Seats popover's button
    timelineOf: (name: string) => string; // the timeline's title
    back: string; // the timeline's way back to the list
    noSteps: string;
}

type MapText = Omit<MapWords, "legend" | "wrongCite"> & {
    meaning: Record<CheckLabel, string>;
    wrongCiteMeaning: string;
};

const MAP_TEXT: Record<CouncilLang, MapText> = {
    en: {
        tab: "Map",
        cardsTitle: "Each expert",
        cardsHint: "Click one to see their timeline",
        openTimeline: (name) => `Open ${name}'s timeline`,
        running: "Running",
        matrixTitle: "Who agrees with which idea",
        matrixHint: "Sorted by agreement, highest first · click an idea to see the reasons",
        headIdea: "Idea",
        headAgreement: "Agreement",
        headOutcome: "Outcome",
        reasonsTitle: "Each expert's reason",
        noIdeas: "No ideas yet",
        revisedFoot:
            "A cell that says “revised in round 2” is where the idea's author revised it after that expert doubted it.",
        meaning: {
            ran: "Go ran a command and has the result",
            disproved: "Go ran a command and its result contradicts the claim",
            read: "the code it cites matches",
            guess: "nothing it cites could be checked",
        },
        wrongCiteMeaning: "the file, the line or the quoted text does not match",
        reportLink: "See who agrees with which idea in Map",
        timeline: "Timeline",
        timelineOf: (name) => `Timeline of ${name}`,
        back: "Back to the list",
        noSteps: "No steps yet",
    },
    vi: {
        tab: "Bản đồ",
        cardsTitle: "Từng chuyên gia",
        cardsHint: "Bấm một người để xem dòng thời gian của họ",
        openTimeline: (name) => `Mở dòng thời gian của ${name}`,
        running: "Đang chạy",
        matrixTitle: "Ai đồng ý với ý nào",
        matrixHint: "Xếp theo mức đồng thuận, cao nhất trên cùng · bấm một ý để xem lý do",
        headIdea: "Ý",
        headAgreement: "Đồng thuận",
        headOutcome: "Kết cục",
        reasonsTitle: "Lý do của từng người",
        noIdeas: "Chưa có ý nào",
        revisedFoot: "Ô có chữ “đã sửa ở vòng 2” là chỗ người đưa ra ý đã sửa ý của mình sau khi bị nghi ngờ.",
        meaning: {
            ran: "Go chạy lệnh, thấy kết quả",
            disproved: "Go chạy lệnh và kết quả ngược với nhận định",
            read: "trích dẫn khớp",
            guess: "không có gì để kiểm tra",
        },
        wrongCiteMeaning: "file, dòng hoặc đoạn trích không khớp",
        reportLink: "Xem ai đồng ý với ý nào trong Bản đồ",
        timeline: "Dòng thời gian",
        timelineOf: (name) => `Dòng thời gian của ${name}`,
        back: "Quay lại danh sách",
        noSteps: "Chưa có bước nào",
    },
};

/** Pure: the words of the Map tab and the timeline in a council's language; a council with none reads as English. */
export function mapWords(c: Pick<Council, "lang"> | null | undefined): MapWords {
    const lang = councilLang(c);
    const { meaning, wrongCiteMeaning, ...words } = MAP_TEXT[lang];
    return {
        ...words,
        legend: CHECK_LABELS.map((label) => ({ label, word: checkWord(label, lang), meaning: meaning[label] })),
        wrongCite: { word: wrongCiteWord(lang), meaning: wrongCiteMeaning },
    };
}

// ---- the expert cards ----

// the card's own words: the evidence bar's counts, the cost, and where an idle seat stands
interface CardWords {
    claims: (n: number) => string;
    evidence: Record<CheckLabel, (n: number) => string>;
    wrongCites: (n: number) => string;
    tokens: (count: string) => string;
    calls: (n: number) => string;
    time: (ms: number) => string;
    doneRound: (round: number) => string;
    done: string;
    waiting: string;
    stopped: string;
    failed: string;
    notStarted: string;
    running: string;
}

const CARD_WORDS: Record<CouncilLang, CardWords> = {
    en: {
        claims: (n) => `${n} ${n === 1 ? "claim" : "claims"}`,
        evidence: {
            ran: (n) => `${n} ran`,
            disproved: (n) => `${n} disproved`,
            read: (n) => `${n} read`,
            guess: (n) => `${n} ${n === 1 ? "guess" : "guesses"}`,
        },
        wrongCites: (n) => `${n} wrong ${n === 1 ? "cite" : "cites"}`,
        tokens: (count) => `${count} tokens`,
        calls: (n) => `${n} ${n === 1 ? "call" : "calls"}`,
        time: duration,
        doneRound: (round) => `Done round ${round}`,
        done: "Done",
        waiting: "Waiting",
        stopped: "Stopped",
        failed: "Failed",
        notStarted: "Not started",
        running: "Running",
    },
    vi: {
        claims: (n) => `${n} nhận định`,
        evidence: {
            ran: (n) => `${n} đã chạy`,
            disproved: (n) => `${n} bị bác`,
            read: (n) => `${n} đã đọc`,
            guess: (n) => `${n} đoán`,
        },
        wrongCites: (n) => `${n} trích sai`,
        tokens: (count) => `${count} token`,
        calls: (n) => `${n} lượt gọi`,
        time: (ms) => {
            const s = Math.round(Math.max(0, ms) / 1000);
            if (s < 60) {
                return `${s} giây`;
            }
            return s % 60 === 0 ? `${Math.floor(s / 60)} phút` : `${Math.floor(s / 60)} phút ${s % 60} giây`;
        },
        doneRound: (round) => `Xong vòng ${round}`,
        done: "Xong",
        waiting: "Đang chờ",
        stopped: "Đã dừng",
        failed: "Bị lỗi",
        notStarted: "Chưa bắt đầu",
        running: "Đang chạy",
    },
};

/** One part of an expert card's evidence bar: how many of the seat's claims carry the label, in words. */
export interface EvidenceCount {
    label: CheckLabel;
    n: number;
    text: string; // `2 ran`, `1 guess`
}

/** One expert's card on the Map: the scoreboard line. */
export interface ExpertCard {
    id: string;
    name: string;
    initials: string;
    tone: AvatarTone;
    agent: boolean; // a live agent's seat
    doing: string; // what it does now, or where it stands
    working: boolean; // it is working now: the card shows the working dot
    command: boolean; // what it does now is a verify command running: drawn in mono
    counts: Record<CheckLabel, number> | null; // its claims by label; null in a Brainstorm, which asks for no evidence
    claims: number; // the claims counted; 0 in a Brainstorm
    claimsText: string; // `4 claims`; empty in a Brainstorm
    evidence: EvidenceCount[]; // the bar's four parts in order (ran, disproved, read, guess), empty in a Brainstorm
    wrongCites: number; // its cites Go found wrong; 0 in a Brainstorm
    wrongCitesText: string; // `2 wrong cites`; empty for none
    tokenCount: number;
    ms: number;
    callCount: number;
    tokens: string; // `96k tokens`
    time: string; // `2 min 5 s`
    calls: string; // `3 calls`
}

// where a seat stands while it does nothing: a failed call, a council not started or ended, or a round done
function idleWord(c: Council, id: string, w: CardWords): string {
    if (c.failed?.[id] != null) {
        return w.failed;
    }
    switch (c.state) {
        case "not-run":
        case "queued":
            return w.notStarted;
        case "stopped":
        case "failed":
            return w.stopped;
        case "done":
            return w.done;
    }
    if ((c.stats?.[id]?.calls ?? 0) === 0) {
        return w.waiting;
    }
    return c.round > roundsOf(c) ? w.done : w.doneRound(Math.max(1, c.round));
}

// whether step `i` of a seat's steps is a verify command running now: its newest step is a run with no result yet, in a
// council that runs (a council that ended keeps such a step as written, with no command behind it). The cards and the
// timeline read the one rule.
function isRunningCommand(c: Pick<Council, "state">, steps: readonly CouncilStep[], i: number): boolean {
    return c.state === "running" && i === steps.length - 1 && steps[i]?.kind === "run" && !steps[i].result;
}

// what the seat does now. A verify command runs while the seat's last step is a run with no result yet (the runner sets
// the activity to the command text meanwhile, but the step names it too).
function doingNow(c: Council, id: string, w: CardWords): Pick<ExpertCard, "doing" | "working" | "command"> {
    const steps = c.timeline?.[id] ?? [];
    const last = steps[steps.length - 1];
    const running = c.state === "running";
    const activity = running ? c.activity?.[id] : undefined;
    if (isRunningCommand(c, steps, steps.length - 1)) {
        return { doing: activity?.text || last.target, working: true, command: true };
    }
    if (activity != null) {
        return { doing: activity.text || w.running, working: true, command: false };
    }
    return { doing: idleWord(c, id, w), working: false, command: false };
}

/** Pure: the Map's expert cards, one per seat of the panel (the coordinator writes no claims): who it is, what it does
 *  now, the counts of its claims by what Go checked (ran, disproved, read code, guess) with their words, the cites Go
 *  found wrong, and the tokens, time and calls it spent. A Brainstorm has no counts. Ideas and replies still held for
 *  the person count for nothing, as in the matrix. */
export function expertCards(c: Council): ExpertCard[] {
    const lang = councilLang(c);
    const w = CARD_WORDS[lang];
    const brainstorm = isBrainstorm(c);
    const said = [...sentProposals(c), ...sentReplies(c)];
    return panel(c).map((e): ExpertCard => {
        const stat = c.stats?.[e.id];
        const mine = said.filter((x) => x.author === e.id);
        const counts: Record<CheckLabel, number> = { ran: 0, disproved: 0, read: 0, guess: 0 };
        for (const x of mine) {
            const label = checkLabelOf(x);
            if (label !== "") {
                counts[label]++;
            }
        }
        const claims = CHECK_LABELS.reduce((n, label) => n + counts[label], 0);
        const wrongCites = mine.reduce((n, x) => n + (x.evidence ?? []).filter((ev) => ev.cite === "wrong").length, 0);
        const tokenCount = stat?.tokens ?? 0;
        const ms = stat?.ms ?? 0;
        const callCount = stat?.calls ?? 0;
        return {
            id: e.id,
            name: e.name,
            initials: seatInitials(c, e.id),
            tone: avatarTone(c, e.id),
            agent: !!e.agent,
            ...doingNow(c, e.id, w),
            counts: brainstorm ? null : counts,
            claims: brainstorm ? 0 : claims,
            claimsText: brainstorm ? "" : w.claims(claims),
            evidence: brainstorm
                ? []
                : CHECK_LABELS.map((label) => ({ label, n: counts[label], text: w.evidence[label](counts[label]) })),
            wrongCites: brainstorm ? 0 : wrongCites,
            wrongCitesText: brainstorm || wrongCites === 0 ? "" : w.wrongCites(wrongCites),
            tokenCount,
            ms,
            callCount,
            tokens: w.tokens(countTokens(tokenCount)),
            time: w.time(ms),
            calls: w.calls(callCount),
        };
    });
}

// ---- the timeline ----

const STEP_WORDS: Record<CouncilLang, { kinds: Record<string, string>; pass: string; fail: string }> = {
    en: {
        kinds: { read: "Read", search: "Search", run: "Ran command", propose: "Proposed", reply: "Replied" },
        pass: "Passed",
        fail: "Failed",
    },
    vi: {
        kinds: { read: "Đọc", search: "Tìm", run: "Chạy lệnh", propose: "Đưa ra ý", reply: "Trả lời" },
        pass: "Đạt",
        fail: "Thất bại",
    },
};

/** One row of an expert's timeline. */
export interface TimelineRow {
    ts: number;
    time: string; // the clock time it happened, `14:32:05`
    kind: string; // the step's kind as Go wrote it
    kindWord: string; // `Read`, `Search`, `Ran command`, `Proposed`, `Replied`; a kind the cockpit does not know keeps its own word
    target: string; // the file, the pattern, the command, the idea or reply
    result: string; // `Passed`, `Failed`, or what Go wrote (`3 matches`); empty for none
    outcome: "pass" | "fail" | ""; // a command's result, for the row's mark beside its word
    mono: boolean; // a command: drawn in mono
    running: boolean; // the command Go runs now: the seat's newest step, a run with no result yet, in a council that runs
}

function clockSeconds(ms: number): string {
    const d = new Date(ms);
    const two = (n: number) => String(n).padStart(2, "0");
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Pure: one expert's timeline as rows, oldest first as the runner keeps it. Empty for a seat with no steps. */
export function timelineRows(c: Council, expertId: string): TimelineRow[] {
    const w = STEP_WORDS[councilLang(c)];
    const steps = c.timeline?.[expertId] ?? [];
    return steps.map((s, i): TimelineRow => {
        const result = s.result ?? "";
        return {
            ts: s.ts,
            time: clockSeconds(s.ts),
            kind: s.kind,
            kindWord: w.kinds[s.kind] ?? s.kind,
            target: s.target,
            result: result === "pass" ? w.pass : result === "fail" ? w.fail : result,
            outcome: result === "pass" || result === "fail" ? result : "",
            mono: s.kind === "run",
            running: isRunningCommand(c, steps, i),
        };
    });
}
