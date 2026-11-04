// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Final proposal of a council: the one seat message the person pinned to the Report (`Council.finalpick`, the id of
// an idea or a reply). What the Report's section draws and its Copy puts on the clipboard, and what the chat's Copy
// puts there for any message, derived from a `Council`. Pure, no React, no Wave runtime imports, so every rule here has
// a test (councilfinalmodel.test.ts). `messageMarkdown` writes what Go's `council.MessageMarkdown` writes (the pinned
// message closes `council.Markdown`, the saved document): the two share their test cases.

import { postedAt } from "./councildiscussionmodel";
import { authorName } from "./councilmodel";

/** The pinned message as the Report's Final proposal section reads it. */
export interface FinalProposal {
    id: string; // the idea's id (P1) or the reply's (r3)
    kind: "idea" | "reply";
    seatName: string; // the seat that wrote it, as the chat's byline names it
    at: string; // the time of day it was posted (`14:32`); empty for a message with none
    markdown: string; // messageMarkdown: what Copy puts on the clipboard, and the Report draws
    threadOf: string | null; // a reply: the idea whose thread it sits in; null for an idea and for a reply in the channel
}

// one evidence item's line, the text Go's evidenceText writes for it: a weak one says so and why
function evidenceLine(e: CouncilEvidence): string {
    const ref = e.ref ?? "";
    const note = e.note ?? "";
    if (!e.weak) {
        return ref;
    }
    if (ref !== "" && note !== "") {
        return `${ref} (weak: ${note})`;
    }
    if (ref !== "") {
        return `${ref} (weak)`;
    }
    return note !== "" ? `weak: ${note}` : "weak";
}

// the heading, the argument when it has words, the evidence lines when there are any: one blank line between the parts
// that are there, as Go's MessageMarkdown joins them. A Review idea's runs and check label, and an evidence item's
// quote, cite and region, are not part of the text.
function ideaMarkdown(p: CouncilProposal): string {
    const parts = [`## ${p.title}`];
    const argument = p.argument.trim();
    if (argument !== "") {
        parts.push(argument);
    }
    const evidence = p.evidence ?? [];
    if (evidence.length > 0) {
        parts.push(evidence.map((e) => `- ${evidenceLine(e)}`).join("\n"));
    }
    return parts.join("\n\n");
}

/** Pure: one idea or reply of the council (`id`, P1 or r3) as markdown, or null for an id the council lacks. A reply is
 *  its text, trimmed (empty for one with no words, which is still found); an idea is `## <title>`, a blank line, its
 *  argument (left out, with its blank line, when it has none), then when it has evidence a blank line and a `- ` line
 *  per item (a weak one `- b.go:40 (weak: no test)`). No trailing newline. A held draft is written like any other: it
 *  is wavesrv's pin that refuses an unsent message, as Go's MessageMarkdown does. */
export function messageMarkdown(c: Council, id: string): string | null {
    const idea = (c.proposals ?? []).find((p) => p.id === id);
    if (idea != null) {
        return ideaMarkdown(idea);
    }
    const reply = (c.replies ?? []).find((r) => r.id === id);
    return reply == null ? null : reply.text.trim();
}

/** Pure: the council's Final proposal, or null when nothing is pinned or the pin names nothing the council has. */
export function finalProposal(c: Council): FinalProposal | null {
    const id = c.finalpick ?? "";
    const markdown = id === "" ? null : messageMarkdown(c, id);
    if (markdown == null) {
        return null;
    }
    const idea = (c.proposals ?? []).find((p) => p.id === id);
    if (idea != null) {
        return {
            id,
            kind: "idea",
            seatName: authorName(c, idea.author),
            at: postedAt(c, idea.ts).at,
            markdown,
            threadOf: null,
        };
    }
    const reply = (c.replies ?? []).find((r) => r.id === id);
    if (reply == null) {
        return null;
    }
    return {
        id,
        kind: "reply",
        seatName: authorName(c, reply.author),
        at: postedAt(c, reply.ts).at,
        markdown,
        threadOf: reply.proposalid === "" ? null : reply.proposalid,
    };
}
