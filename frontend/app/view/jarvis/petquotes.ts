// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Now and then, a well-known line about programming. This is the one thing the creature says that the system does
// not know: the pet spec's rule is to speak only of committed state (2026-08-04-jarvis-pet-design.md §2), and its
// user chose this exception on 2026-10-09. It is kept from costing the rule anything: a quote speaks only when the
// creature has nothing else to say and you are in the window, it leaves no unread marker, and the popup never lists
// it. Settings → Appearance turns it off. Pure; petview.tsx runs the timer.
//
// Every line is a well-documented quote with its author, verbatim, and short enough for the bubble.

import type { PetExpression, PetPosture } from "./petcondition";
import type { PetEvent } from "./petvoice";

export interface Quote {
    text: string;
    author: string;
}

export const QUOTES: readonly Quote[] = [
    { text: "Premature optimization is the root of all evil.", author: "Donald Knuth" },
    { text: "Beware of bugs in the above code; I have only proved it correct, not tried it.", author: "Donald Knuth" },
    {
        text: "Computers are good at following instructions, but not at reading your mind.",
        author: "Donald Knuth",
    },
    {
        text: "Program testing can be used to show the presence of bugs, but never to show their absence!",
        author: "Edsger W. Dijkstra",
    },
    { text: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" },
    {
        text: "The question of whether a computer can think is no more interesting than the question of whether a submarine can swim.",
        author: "Edsger W. Dijkstra",
    },
    {
        text: "The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise.",
        author: "Edsger W. Dijkstra",
    },
    { text: "Adding manpower to a late software project makes it later.", author: "Fred Brooks" },
    { text: "Plan to throw one away; you will, anyhow.", author: "Fred Brooks" },
    {
        text: "The bearing of a child takes nine months, no matter how many women are assigned.",
        author: "Fred Brooks",
    },
    { text: "Controlling complexity is the essence of computer programming.", author: "Brian Kernighan" },
    { text: "Talk is cheap. Show me the code.", author: "Linus Torvalds" },
    {
        text: "Programs must be written for people to read, and only incidentally for machines to execute.",
        author: "Harold Abelson",
    },
    {
        text: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.",
        author: "Martin Fowler",
    },
    { text: "When in doubt, use brute force.", author: "Ken Thompson" },
    { text: "The best way to predict the future is to invent it.", author: "Alan Kay" },
    {
        text: "A language that doesn't affect the way you think about programming is not worth knowing.",
        author: "Alan Perlis",
    },
    { text: "Simplicity does not precede complexity, but follows it.", author: "Alan Perlis" },
    { text: "Fancy algorithms are slow when n is small, and n is usually small.", author: "Rob Pike" },
    { text: "Clear is better than clever.", author: "Rob Pike" },
    { text: "Don't communicate by sharing memory, share memory by communicating.", author: "Rob Pike" },
    {
        text: "Perfection is achieved, not when there is nothing more to add, but when there is nothing left to take away.",
        author: "Antoine de Saint-Exupéry",
    },
    {
        text: "The cheapest, fastest, and most reliable components are those that aren't there.",
        author: "Gordon Bell",
    },
    {
        text: "Walking on water and developing software from a specification are easy if both are frozen.",
        author: "Edward V. Berard",
    },
    { text: "Optimism is an occupational hazard of programming: feedback is the treatment.", author: "Kent Beck" },
    { text: "Make it work, make it right, make it fast.", author: "Kent Beck" },
    { text: "I'm not a great programmer; I'm just a good programmer with great habits.", author: "Kent Beck" },
    {
        text: "There are only two hard things in Computer Science: cache invalidation and naming things.",
        author: "Phil Karlton",
    },
    { text: "Algorithms + Data Structures = Programs.", author: "Niklaus Wirth" },
    { text: "Easy things should be easy, and hard things should be possible.", author: "Larry Wall" },
    {
        text: "The three chief virtues of a programmer are: Laziness, Impatience and Hubris.",
        author: "Larry Wall",
    },
    { text: "Real programmers can write assembly code in any language.", author: "Larry Wall" },
    {
        text: "Should array indices start at 0 or 1? My compromise of 0.5 was rejected without, I thought, proper consideration.",
        author: "Stan Kelly-Bootle",
    },
    { text: "Any sufficiently advanced technology is indistinguishable from magic.", author: "Arthur C. Clarke" },
    {
        text: 'Some people, when confronted with a problem, think "I know, I\'ll use regular expressions." Now they have two problems.',
        author: "Jamie Zawinski",
    },
    { text: "Linux is only free if your time has no value.", author: "Jamie Zawinski" },
    {
        text: "It always takes longer than you expect, even when you take into account Hofstadter's Law.",
        author: "Douglas Hofstadter",
    },
    { text: "Be conservative in what you do, be liberal in what you accept from others.", author: "Jon Postel" },
    {
        text: "The rules of optimization. Rule 1: Don't do it. Rule 2 (for experts only): Don't do it yet.",
        author: "Michael A. Jackson",
    },
    {
        text: "The function of good software is to make the complex appear to be simple.",
        author: "Grady Booch",
    },
];

// a moment that was not quiet is tried again this much later, rather than waiting out a whole delay
export const QUOTE_RETRY_MS = 5 * 60_000;

// 45 to 90 minutes between quotes: rare enough to stay a surprise
export function quoteDelayMs(rand: number): number {
    return (45 + 45 * rand) * 60_000;
}

export interface QuoteMoment {
    enabled: boolean;
    expression: PetExpression["kind"];
    posture: PetPosture;
    speaking: boolean; // a bubble is up
    peekOpen: boolean;
    focused: boolean;
}

// A quote never speaks over what the creature has to say, nor into a window you are not looking at.
export function canQuote(m: QuoteMoment): boolean {
    return m.enabled && m.expression === "at-rest" && m.posture === "none" && !m.speaking && !m.peekOpen && m.focused;
}

// The quote a random number lands on, stepping past the last one said so none comes twice in a row.
export function pickQuote(rand: number, last: number): number {
    const i = Math.min(QUOTES.length - 1, Math.floor(rand * QUOTES.length));
    return i === last ? (i + 1) % QUOTES.length : i;
}

export function quoteEvent(index: number, nowMs: number): PetEvent {
    const q = QUOTES[index];
    return { id: `quote:${nowMs}`, at: nowMs, kind: "quote", text: `“${q.text}”`, detail: q.author };
}
