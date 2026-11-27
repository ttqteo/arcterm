// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The answer a person gives a sleeping agent's kept question (spec 2026-11-27-sleep-keeps-ask-design.md). wavesrv holds
// it and hands it to the agent in the nudge of its wake (agentask.HoldAnswer / jarvis.SleptNudge); it does not wake the
// agent. Chat shows what was answered with a line saying it goes in when the agent wakes, from this per-block atom: it
// is kept past a surface switch (Chat unmounts, and the answer is no longer in the registry the ask card reads), and it
// is dropped once the agent is awake, which is when the answer went in. The line logic is pure and tested beside this
// file; the atom is the one piece of state.

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import type { AgentAskQuestion, AgentVM } from "./agentsviewmodel";

/** One answered question, as the agent's nudge words it: what was asked and what the person picked or typed. */
export interface HeldLine {
    question: string;
    answers: string[];
}

/** What a sleeping agent will be told when it wakes. `since` is the sleep it was given in (`AgentVM.sleeping.since`),
 *  which is what ties it to that sleep and no later one. */
export interface HeldAnswer {
    since: number;
    lines: HeldLine[];
}

/** Pure: what each answer says, as wavesrv records it (agentask answerTexts): the typed text when there is any, else the
 *  labels of the options picked. A question with no answer sent has no line; an option index the question does not have
 *  is skipped. */
export function heldLines(questions: readonly AgentAskQuestion[], answers: readonly AgentAnswerItem[]): HeldLine[] {
    const lines: HeldLine[] = [];
    questions.forEach((q, i) => {
        const a = answers[i];
        if (a == null) {
            return;
        }
        const text = (a.text ?? "").trim();
        const picked = (a.selectedindexes ?? [])
            .map((n) => q.options?.[n]?.label)
            .filter((l): l is string => l != null);
        lines.push({ question: q.question, answers: text !== "" ? [text] : picked });
    });
    return lines;
}

const oneLine = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");

/** Pure: a line as Chat prints it: "Guard the nil case? → Yes", the question on one line. With no answer read, the
 *  question alone. */
export function heldLineText(line: HeldLine): string {
    const question = oneLine(line.question);
    return line.answers.length > 0 ? `${question} → ${line.answers.join(", ")}` : question;
}

/** Pure: the line under a held answer that says when it reaches the agent. */
export function wakesLine(name: string): string {
    return `Goes in when ${name} wakes`;
}

/** Pure: what the empty box says on a sleeping agent whose question is kept: what is typed answers it (it does not wake
 *  the agent), and the agent reads it when it wakes. */
export function answerWhileAsleepPlaceholder(agentName: string): string {
    return `answer ${agentName}'s question; it reads it when it wakes… (Enter)`;
}

/** Pure: the answer to keep for an answer just sent to `agent`, or null when wavesrv does not hold it. It holds one for
 *  an agent put to sleep while it asked (`sleeping.asking`): an awake agent's answer is typed into its terminal, and a
 *  held card (`ask.hold`, the Token burn card) is answered on its dialog. */
export function heldFor(
    agent: Pick<AgentVM, "sleeping" | "ask">,
    answers: readonly AgentAnswerItem[]
): HeldAnswer | null {
    const ask = agent.ask;
    if (agent.sleeping?.asking !== true || ask == null || ask.hold) {
        return null;
    }
    return { since: agent.sleeping.since, lines: heldLines(ask.questions, answers) };
}

/** Pure: `prev` with `next` added. A second answer of the same sleep joins the first; one of a later sleep replaces
 *  what an earlier one held (that one went in with its wake). */
export function mergeHeld(prev: HeldAnswer | null | undefined, next: HeldAnswer): HeldAnswer {
    return prev != null && prev.since === next.since
        ? { since: next.since, lines: [...prev.lines, ...next.lines] }
        : next;
}

/** Pure: the kept answer Chat shows: while the agent is still in the sleep it was given in. Awake, or asleep in a later
 *  sleep, it shows nothing: the answer went in with the wake. */
export function heldShown(held: HeldAnswer | null | undefined, sleeping: AgentVM["sleeping"]): HeldAnswer | null {
    return held != null && sleeping != null && sleeping.since === held.since ? held : null;
}

/** Pure: whether the kept answer is dropped from the atom: there is one, and it is no longer shown. */
export function heldCleared(held: HeldAnswer | null | undefined, sleeping: AgentVM["sleeping"]): boolean {
    return held != null && heldShown(held, sleeping) == null;
}

// keyed by the block's oref ("block:<id>"), as the ask is; one atom per block, so a surface switch finds the answer again
const heldAtoms = new Map<string, PrimitiveAtom<HeldAnswer | null>>();

export function getHeldAnswerAtom(oref: string): PrimitiveAtom<HeldAnswer | null> {
    let a = heldAtoms.get(oref);
    if (a == null) {
        a = atom(null) as PrimitiveAtom<HeldAnswer | null>;
        heldAtoms.set(oref, a);
    }
    return a;
}

/** Keeps `held` for the block's agent (an answer wavesrv accepted for its wake). */
export function keepHeldAnswer(oref: string, held: HeldAnswer): void {
    const a = getHeldAnswerAtom(oref);
    globalStore.set(a, mergeHeld(globalStore.get(a), held));
}

/** Forgets the block's kept answer. */
export function dropHeldAnswer(oref: string): void {
    globalStore.set(getHeldAnswerAtom(oref), null);
}
