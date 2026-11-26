// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What a pair's pause says and offers, pure (spec docs/superpowers/specs/2026-11-26-pair-judge-ux-design.md, "A summary at
// each pause" and "Resume"): the words of the pause card's head, the card itself (the snapshot the server wrote on the
// pause message, with the live answer laid over the asks), and which of Resume, Judge again and the "Message to go on"
// hint a stopped pair offers. The conversation (pairpausecard.tsx), the Library page and the tree's pair row draw from
// here, so the three places never word it differently.
//
// The words are Vietnamese when the person's own messages in the pair read Vietnamese (writesVietnamese, the rule Chat's
// judge line uses), else English; a pair with no message of the person's is English.

import { writesVietnamese } from "./chatsuggest";

export type PauseSectionKind = "asks" | "open" | "agreed";

export type PauseSection = {
    kind: PauseSectionKind;
    /** "Waits on you", "Still open" or "Agreed" (VI: "Chờ bạn", "Còn mở", "Đã thống nhất") */
    label: string;
    items: PairItem[];
};

export type PauseCard = {
    /** why the pair paused (pauseHead) */
    head: string;
    /** the judges-gone pause's line, that Add judge pairs one again; "" on every other pause */
    note: string;
    /** the judge's few sentences that sum the pair up, "" when it wrote none */
    summary: string;
    /** in the order Waits on you, Still open, Agreed; a section with no items is left out */
    sections: PauseSection[];
};

export type PauseActions = {
    /** the Resume button's words, null when the pair offers none */
    resume: string | null;
    /** the Judge again button's words, null when the pair offers none */
    judgeAgain: string | null;
    /** "Message to go on": nothing would be delivered on a resume, so a message from the person is the way on */
    hint: string | null;
};

/** The pair's cap as the server's Paused line writes it: millions with one decimal ("3.0M"); "" when it has none. */
export function capLabel(tokens: number | undefined | null): string {
    return tokens != null && tokens > 0 ? `${(tokens / 1e6).toFixed(1)}M` : "";
}

/** The card's head words for a stop reason, the one source of them (the header's state line uses it too). A token-cap head
 *  names the cap only when `cap` (capLabel's text) is given. A reason it does not know says only that the pair paused. */
export function pauseHead(reason: string, vietnamese: boolean, cap?: string): string {
    switch (reason) {
        case "no-new-points":
            return vietnamese ? "Tạm dừng: judge không còn ý mới" : "Paused: the judge has no new points";
        case "settled":
            return vietnamese ? "Tạm dừng: hai bên đã thống nhất" : "Paused: both agree";
        case "token-cap": {
            const head = vietnamese ? "Tạm dừng: chạm trần token" : "Paused: token cap reached";
            return cap != null && cap !== "" ? `${head} (${cap})` : head;
        }
        case "judges-gone":
            return vietnamese ? "Tạm dừng: không còn judge" : "Paused: no judge is left";
        default:
            return vietnamese ? "Tạm dừng" : "Paused";
    }
}

/** Whether the pair's own words are Vietnamese: any message of the person's in it has a letter only Vietnamese writes. */
export function pairVietnamese(view: Pick<PairView, "messages">): boolean {
    return writesVietnamese((view.messages ?? []).filter((m) => m.from === "person").map((m) => m.text));
}

const SECTION_LABEL: Record<PauseSectionKind, [string, string]> = {
    asks: ["Waits on you", "Chờ bạn"],
    open: ["Still open", "Còn mở"],
    agreed: ["Agreed", "Đã thống nhất"],
};

/** The pause card of a message that carries a pause, null for one that does not (a "Paused: …" line from before the
 *  snapshot, or any other message). The items are the snapshot's; an ask still in the live list shows the live answer,
 *  matched by its number, so a chip the person pressed since reads as answered. */
export function pauseCardOf(
    view: Pick<PairView, "messages" | "decided" | "tokencap">,
    msg: { pause?: PairPause | null }
): PauseCard | null {
    const pause = msg.pause;
    if (pause == null) {
        return null;
    }
    const vi = pairVietnamese(view);
    const live = new Map((view.decided?.asks ?? []).map((item) => [item.num, item]));
    const lists: Record<PauseSectionKind, PairItem[]> = {
        asks: (pause.decided?.asks ?? []).map((item) => {
            const now = live.get(item.num);
            return now != null ? { ...item, answer: now.answer } : item;
        }),
        open: pause.decided?.open ?? [],
        agreed: pause.decided?.agreed ?? [],
    };
    const sections: PauseSection[] = [];
    for (const kind of ["asks", "open", "agreed"] as const) {
        if (lists[kind].length > 0) {
            sections.push({ kind, label: SECTION_LABEL[kind][vi ? 1 : 0], items: lists[kind] });
        }
    }
    return {
        head: pauseHead(pause.reason, vi, pause.reason === "token-cap" ? capLabel(view.tokencap) : undefined),
        note:
            pause.reason === "judges-gone"
                ? vi
                    ? "Bấm Add judge ở đầu trang để thêm judge"
                    : "Add judge in the header pairs one again"
                : "",
        summary: (pause.summary ?? "").trim(),
        sections,
    };
}

/** What a pair offers the person: only a stopped pair of this machine offers anything (not an ended, a relaying or a
 *  synced one, and `local` false when the page knows the pair is not this machine's); a "no judge is left" pause offers
 *  nothing but its card's note.
 *  - Resume, when `canresume` says something would be delivered; after a token cap it names the cap that counts again.
 *  - Judge again, after no new points or both agree.
 *  - The hint, when nothing would be delivered, since a message from the person already resumes the pair. */
export function pauseActions(view: PairView, opts: { local: boolean }): PauseActions {
    const none: PauseActions = { resume: null, judgeAgain: null, hint: null };
    if (!opts.local || view.synced === true || view.state !== "stopped" || view.stopreason === "judges-gone") {
        return none;
    }
    const vi = pairVietnamese(view);
    const reason = view.stopreason;
    const cap = reason === "token-cap" ? capLabel(view.tokencap) : "";
    const canResume = view.canresume === true;
    const plain = vi ? "Chạy tiếp" : "Resume";
    return {
        resume: canResume ? (cap !== "" ? `${plain} · ${vi ? "thêm " : ""}${cap}${vi ? "" : " more"}` : plain) : null,
        judgeAgain: reason === "no-new-points" || reason === "settled" ? (vi ? "Judge tiếp" : "Judge again") : null,
        hint: canResume ? null : vi ? "Nhắn để bàn tiếp" : "Message to go on",
    };
}

/** The id of the newest message that carries a pause, null when none does. Only that card of a stopped pair has controls. */
export function newestPauseId(view: Pick<PairView, "messages">): string | null {
    const messages = view.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].pause != null) {
            return messages[i].id;
        }
    }
    return null;
}

/** The pair composer's placeholder: what a message with no @ does, and how to ask the judge now. */
export function composerPlaceholder(view: Pick<PairView, "messages">): string {
    return pairVietnamese(view)
        ? "Gửi cả hai: worker trả lời trước, judge chấm câu trả lời · @judge để hỏi judge ngay"
        : "To both: the worker answers, then the judge judges it · @judge to ask the judge now";
}
