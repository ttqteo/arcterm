// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The lead asks for approval of its spec, and of its round-2 plan, as an ordinary ask under a known header
// (pkg/jarvis/leadprompt.go): one question whose first line is the document's path, before "- " lines that
// each name a decision or finding; a Spec review settled by a mockup names the mockup's .dc.html board instead.
// That ask opens as a review dialog; an ask that misses the convention stays an ordinary question.
//
// A worker agent that finishes a section of a paper (.tex) or a note (.md) asks a `Doc review` under the same
// convention; it opens as the review view that replaces the agent's terminal, never as the dialog.

import { atom, type PrimitiveAtom } from "jotai";
import type { AgentAsk, AgentVM } from "./agentsviewmodel";

export const DOC_REVIEW_HEADERS = { spec: "Spec review", plan: "Plan review", doc: "Doc review" } as const;

export type DocReviewKind = keyof typeof DOC_REVIEW_HEADERS;

// what the path names: a markdown document, a design-local canvas board (.dc.html), or a LaTeX source
export type DocReviewDoc = "markdown" | "canvas" | "latex";

export interface DocReview {
    kind: DocReviewKind;
    path: string;
    doc: DocReviewDoc;
    intro: string[];
    items: string[];
    approveIndex: number;
    requestIndex: number;
    // a Doc review's `Pages: N` line: the page count the PDF tab warns past
    pageLimit?: number;
}

const ITEM_PREFIX = "- ";
const REQUEST_LABEL = "request changes";
const RECOMMENDED = /\s*\(recommended\)\s*/i;
const PAGES_LINE = /^pages:\s*([1-9]\d*)$/i;
const NUMBERED_ITEM = /^(\d+):\s+(\S[\s\S]*)$/;
const MARKDOWN: [RegExp, DocReviewDoc] = [/\.md$/i, "markdown"];
// which files each header may name: a Doc review reads papers and notes, the other two read specs and mockups
const DOC_PATH: Record<DocReviewKind, [RegExp, DocReviewDoc][]> = {
    spec: [MARKDOWN, [/\.dc\.html$/i, "canvas"]],
    plan: [MARKDOWN, [/\.dc\.html$/i, "canvas"]],
    doc: [MARKDOWN, [/\.tex$/i, "latex"]],
};

export interface FocusItem {
    n: number | null;
    text: string;
}

// A focus item that starts `<n>:` is the agent's reply to its own comment n, and renders as a numbered line; any
// other (`§5.2: rewritten`, `5.: tightened`) is a chip.
export function focusItem(item: string): FocusItem {
    const m = NUMBERED_ITEM.exec(item);
    return m ? { n: Number(m[1]), text: m[2].trim() } : { n: null, text: item };
}

const kindOf = (header: string | undefined): DocReviewKind | null => {
    const h = header?.trim().toLowerCase();
    return (
        (Object.keys(DOC_REVIEW_HEADERS) as DocReviewKind[]).find((k) => DOC_REVIEW_HEADERS[k].toLowerCase() === h) ??
        null
    );
};

export function parseDocReview(ask: AgentAsk | undefined): DocReview | null {
    const qs = ask?.questions ?? [];
    if (qs.length !== 1) {
        return null;
    }
    const kind = kindOf(qs[0].header);
    if (!kind) {
        return null;
    }
    const lines = qs[0].question
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const path = (lines[0] ?? "").replace(/^`|`$/g, "");
    const doc = DOC_PATH[kind].find(([re]) => re.test(path))?.[1];
    if (!doc) {
        return null;
    }
    const all = lines.slice(1);
    // the page limit is a line of its own, kept out of the intro; only a Doc review has one
    const pagesAt = kind === "doc" ? all.findIndex((l) => !l.startsWith(ITEM_PREFIX) && PAGES_LINE.test(l)) : -1;
    const pageLimit = pagesAt < 0 ? undefined : Number(PAGES_LINE.exec(all[pagesAt])?.[1]);
    const rest = pagesAt < 0 ? all : all.filter((_, i) => i !== pagesAt);
    const firstItem = rest.findIndex((l) => l.startsWith(ITEM_PREFIX));
    const introLines = firstItem < 0 ? rest : rest.slice(0, firstItem);
    const items = rest.filter((l) => l.startsWith(ITEM_PREFIX)).map((l) => l.slice(ITEM_PREFIX.length).trim());
    const labels = (qs[0].options ?? []).map((o) => o.label.replace(RECOMMENDED, " ").trim().toLowerCase());
    const requestIndex = labels.findIndex((l) => l.startsWith(REQUEST_LABEL));
    const approveIndex = labels.findIndex((_, i) => i !== requestIndex);
    const review: DocReview = { kind, path, doc, intro: introLines, items, approveIndex, requestIndex };
    if (pageLimit != null) {
        review.pageLimit = pageLimit;
    }
    return review;
}

// the id of the agent whose doc-review ask the dialog shows; null = closed
export const docReviewAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;

// askIds that already auto-opened this session, so closing the dialog keeps it closed
export const autoOpenedAskIdsAtom = atom<Set<string>>(new Set<string>()) as PrimitiveAtom<Set<string>>;

export function shouldAutoOpen(input: {
    surface: string;
    focusedId: string | undefined;
    agent: AgentVM | undefined;
    opened: Set<string>;
    editable: boolean;
}): boolean {
    const { surface, focusedId, agent, opened, editable } = input;
    if (surface !== "agent" || editable || !agent || agent.id !== focusedId) {
        return false;
    }
    const askId = agent.ask?.askId;
    return !!askId && !opened.has(askId) && parseDocReview(agent.ask) != null;
}
