// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The reviewer's verdict as a card in Chat (docs/superpowers/specs/2026-11-12-chat-verdict-handoff-design.md, section 2;
// board B-pick-and-send): the verdict, one row per finding, and while the agent waits on you a tick box per finding with
// `Fix N selected` and `Skip the review`, each sending one line. Once sent, or once the agent went on, the card folds in
// place into its ✓ row. What the card is doing is `verdictMode`'s (chatverdict.ts); the lines and the strings are its too.

import { globalStore } from "@/app/store/jotaiStore";
import { cn, fireAndForget } from "@/util/util";
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { ArrowUpRight, SquareCheckBig } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { AgentsViewModel } from "./agents";
import type { AgentVM } from "./agentsviewmodel";
import { ERROR_LINE, useAction } from "./brainstormui";
import { CardShell, DoneRow, FOCUS_RING, PRIMARY_BTN, SMALL_BTN, TickBox, type CardState } from "./chatbrainstormparts";
import {
    fixLabel,
    fixLine,
    initialTicks,
    skipLine,
    verdictChip,
    verdictDoneLine,
    verdictHead,
    type ReviewerCall,
    type Severity,
    type Verdict,
    type VerdictFinding,
    type VerdictMode,
} from "./chatverdict";
import { sendVerdict, type SentVerdict } from "./chatverdictsend";
import { usePathOpener } from "./pathlinkcontext";
import { focusSubagentAtom, refreshSubagents, subagentsByIdAtom } from "./subagentsstore";

// the ticks you changed, by agent and verdict key: a card that remounts (a scroll, a surface switch) keeps them. A verdict
// nobody touched has none and reads `initialTicks`; a sent one drops its entry
const ticksAtom = atom<Record<string, readonly number[]>>({}) as PrimitiveAtom<Record<string, readonly number[]>>;

const SEVERITY_PILL: Record<Severity, string> = {
    Critical: "bg-error/12 text-error",
    Important: "bg-warning/12 text-warning",
    Minor: "bg-surface-selected text-muted",
};

// the file as the finding names it, with its line when it has one
const locOf = (f: VerdictFinding): string => (f.line !== undefined ? `${f.file}:${f.line}` : f.file);

// `file:line` opens the file the way Chat's file pill does (the agent's path link); with no agent around it reads as text
function Loc({ f }: { f: VerdictFinding }) {
    const opener = usePathOpener();
    const cls = "min-w-0 truncate text-left font-mono text-[12px] text-accent-soft";
    if (opener == null) {
        return (
            <span data-chat-vcard-loc className={cls}>
                {locOf(f)}
            </span>
        );
    }
    return (
        <button
            type="button"
            data-chat-vcard-loc
            title={`Open ${locOf(f)} beside the agent`}
            onClick={() => opener.open(f.file, f.line)}
            className={cn(cls, "cursor-pointer border-0 bg-transparent p-0 hover:underline", FOCUS_RING)}
        >
            {locOf(f)}
        </button>
    );
}

// Open the review: the reviewer subagent's own conversation, found by the call that started it. Drawn only when that
// subagent is on disk with a transcript Arc can open (`/code-review` and review-plan run in the agent's own session)
function OpenReview({ agent, reviewer }: { agent: AgentVM; reviewer: ReviewerCall }) {
    const sub = useAtomValue(subagentsByIdAtom)[agent.id]?.find(
        (s) => s.toolUseId === reviewer.toolUseId && s.transcriptPath != null
    );
    // read again on mount: the tree refreshes on transcript activity, which a quiet agent has none of
    useEffect(() => {
        fireAndForget(() => refreshSubagents(agent.id, agent.transcriptPath));
    }, [agent.id, agent.transcriptPath]);
    if (sub == null) {
        return null;
    }
    return (
        <button
            type="button"
            data-chat-vcard-open
            title="Open the reviewer's conversation"
            onClick={() =>
                globalStore.set(focusSubagentAtom, {
                    parentId: agent.id,
                    agentId: sub.id,
                    transcriptPath: sub.transcriptPath!,
                    label: sub.type,
                })
            }
            className={cn(SMALL_BTN, FOCUS_RING)}
        >
            Open the review
            <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        </button>
    );
}

function VerdictBody({
    verdictKey,
    verdict,
    state,
    agent,
    reviewer,
}: {
    verdictKey: string;
    verdict: Verdict;
    state: CardState;
    agent?: AgentVM;
    reviewer?: ReviewerCall | null;
}) {
    const act = useAction();
    const [stored, setStored] = useAtom(ticksAtom);
    const waiting = state === "waiting";
    const tickKey = `${agent?.id ?? ""}/${verdictKey}`;
    const ticked = new Set((stored[tickKey] ?? [...initialTicks(verdict)]).filter((i) => i < verdict.findings.length));
    const toggle = (i: number): void =>
        setStored((prev) => {
            const next = new Set(prev[tickKey] ?? initialTicks(verdict));
            if (!next.delete(i)) {
                next.add(i);
            }
            return { ...prev, [tickKey]: [...next].sort((a, b) => a - b) };
        });
    // a send that fails shows on the card and leaves the ticks; one that goes through folds the card, whose ticks are done
    const send = (outcome: SentVerdict, line: string): void => {
        if (agent == null) {
            return;
        }
        void act.run(async () => {
            await sendVerdict(agent, verdictKey, outcome, line);
            setStored(({ [tickKey]: _sent, ...rest }) => rest);
        });
    };
    const off = act.busy || agent == null;
    const approved = verdict.pass;
    return (
        <CardShell
            kind="verdict"
            state={state}
            head={verdictHead(verdict)}
            icon={<SquareCheckBig size={14} strokeWidth={2} className="flex-none" aria-hidden />}
            chip={
                <span
                    data-chat-vcard-chip={approved ? "approved" : "changes"}
                    className={cn(
                        "ml-[6px] flex-none rounded-full px-[8px] py-[2px] font-semibold",
                        approved ? "bg-success/12 text-success" : "bg-warning/12 text-warning"
                    )}
                >
                    {verdictChip(verdict)}
                </span>
            }
            action={
                agent != null && reviewer?.toolUseId != null ? <OpenReview agent={agent} reviewer={reviewer} /> : null
            }
            extra={{ "data-chat-vcard": verdictKey }}
        >
            {verdict.note !== "" ? (
                <div data-chat-vcard-note className="text-[13.5px] leading-[1.55] text-primary">
                    {verdict.note}
                </div>
            ) : null}
            {verdict.findings.length > 0 ? (
                <div role="group" aria-label="Findings" className="flex flex-col gap-[6px]">
                    {verdict.findings.map((f, i) => (
                        <div
                            key={i}
                            data-chat-vcard-finding={i}
                            data-severity={f.severity}
                            className="flex min-w-0 items-stretch overflow-hidden rounded-[10px] border border-edge-mid bg-surface"
                        >
                            {waiting ? (
                                <TickBox
                                    i={i}
                                    on={ticked.has(i)}
                                    disabled={off}
                                    onToggle={() => toggle(i)}
                                    attrs={{ "data-chat-vcard-tick": "" }}
                                    label={`Select finding ${i + 1}`}
                                />
                            ) : null}
                            <div className="flex min-w-0 flex-1 items-start gap-[10px] px-[12px] py-[9px]">
                                <span
                                    className={cn(
                                        "mt-[1px] flex-none rounded-[6px] px-[7px] py-[1px] text-[11px] font-semibold",
                                        SEVERITY_PILL[f.severity]
                                    )}
                                >
                                    {f.severity}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                                    {f.file !== "" ? <Loc f={f} /> : null}
                                    <span data-chat-vcard-summary className="text-[13px] leading-[1.5] text-secondary">
                                        {f.summary}
                                    </span>
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            ) : null}
            {waiting ? (
                <div className="flex flex-wrap items-center gap-[8px] border-t border-edge-mid pt-[10px]">
                    <button
                        type="button"
                        data-chat-vcard-fix
                        disabled={off || ticked.size === 0}
                        onClick={() =>
                            send(
                                { kind: "fix", fixed: ticked.size },
                                fixLine(
                                    verdict,
                                    [...ticked].sort((a, b) => a - b)
                                )
                            )
                        }
                        className={cn(PRIMARY_BTN, FOCUS_RING)}
                    >
                        {fixLabel(ticked.size)}
                    </button>
                    <button
                        type="button"
                        data-chat-vcard-skip
                        disabled={off}
                        onClick={() => send({ kind: "skip" }, skipLine())}
                        className={cn(SMALL_BTN, FOCUS_RING)}
                    >
                        Skip the review
                    </button>
                    <span className="ml-auto text-[12px] text-muted">Or type below what to change</span>
                </div>
            ) : null}
            {act.error ? (
                <div role="alert" data-chat-vcard-error className={ERROR_LINE}>
                    {act.error}
                </div>
            ) : null}
        </CardShell>
    );
}

/** The verdict as Chat draws it: a card while it waits on you or while the agent works or has exited, its ✓ row once it
 *  folds (`mode`, from `verdictMode`). `verdictKey` is the part's key, which the send record names; `agent` takes the
 *  Fix and Skip lines and opens the files; `reviewer` is the call the block judges, which Open the review resolves to a
 *  subagent. `model` is the cockpit's view model, as the other cards take it: this card reaches the files through the
 *  agent's own path links and needs nothing from it. */
export function ChatVerdictCard(p: {
    verdictKey: string;
    verdict: Verdict;
    mode: VerdictMode;
    agent?: AgentVM;
    model?: AgentsViewModel;
    reviewer?: ReviewerCall | null;
}): ReactNode {
    const { mode } = p;
    if (mode.mode === "folded") {
        return <DoneRow kind="verdict" head={verdictDoneLine(p.verdict, mode.outcome)} />;
    }
    return (
        <VerdictBody
            verdictKey={p.verdictKey}
            verdict={p.verdict}
            state={mode.mode}
            agent={p.agent}
            reviewer={p.reviewer}
        />
    );
}
