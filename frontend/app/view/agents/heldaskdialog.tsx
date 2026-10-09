// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A held command's card (`wsh memgate`'s Low RAM) as a dialog over any surface. Mounted once in CockpitShell; it pops
// for the first held ask whose card is not already on screen (heldaskpopup.ts). Later hides it and leaves the ask open
// on the agent's own card; answering or clearing it closes the dialog by itself.

import { ModalShell } from "@/app/modals/modalshell";
import { globalStore } from "@/app/store/jotaiStore";
import { isEditableTarget } from "@/app/store/keybindings/dispatcher";
import { useAtomValue } from "jotai";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { answerDigitTarget, canSubmitAsk, type AgentVM } from "./agentsviewmodel";
import { AskRow, jumpToAgent } from "./channelsprimitives";
import { heldAskDismissedAtom, heldAskKey, heldAskOpenAtom, heldAskToPop } from "./heldaskpopup";

// the card takes focus the moment it pops, so a digit already on its way to a terminal could answer it: digits wait
// this long after it appears
const DIGIT_GRACE_MS = 600;

function later(agent: AgentVM) {
    const prev = globalStore.get(heldAskDismissedAtom);
    globalStore.set(heldAskDismissedAtom, new Set([...prev, heldAskKey(agent)]));
}

// a digit picks that option, as on the agent's card; one that completes the answer sends it
function answerDigit(model: AgentsViewModel, agent: AgentVM, digit: number): boolean {
    const tab = globalStore.get(model.answerTabAtom)[agent.id] ?? 0;
    const target = answerDigitTarget(agent, tab, digit);
    if (target == null) {
        return false;
    }
    model.toggleAnswer(agent.id, target.qi, target.oi);
    const questions = agent.ask?.questions ?? [];
    const sel = globalStore.get(model.answerSelAtom)[agent.id] ?? {};
    const txt = globalStore.get(model.answerTextAtom)[agent.id] ?? {};
    if (!questions[target.qi]?.multiSelect && canSubmitAsk(questions, sel, txt)) {
        model.submitAnswer(agent.id);
    }
    return true;
}

export function HeldAskDialog({ model }: { model: AgentsViewModel }) {
    const agents = useAtomValue(model.agentsAtom);
    const dismissed = useAtomValue(heldAskDismissedAtom);
    const surface = useAtomValue(model.surfaceAtom);
    const focusId = useAtomValue(model.focusIdAtom);
    const agent = heldAskToPop(agents, dismissed, surface === "agent" ? focusId : null);

    const key = agent ? heldAskKey(agent) : null;
    const shownAt = useRef(0);
    useEffect(() => {
        globalStore.set(heldAskOpenAtom, agent?.id ?? null);
        shownAt.current = Date.now();
    }, [agent?.id, key]);

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (agent == null || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target as Element)) {
            return;
        }
        if (Date.now() - shownAt.current < DIGIT_GRACE_MS) {
            return;
        }
        if (/^[1-9]$/.test(e.key) && answerDigit(model, agent, Number(e.key))) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    return (
        <ModalShell
            open={agent != null}
            onClose={() => agent && later(agent)}
            align="center"
            className="w-[min(600px,calc(100vw-32px))]"
        >
            {agent ? (
                <div data-held-ask-dialog={agent.id} onKeyDown={onKeyDown} className="flex flex-col gap-3 p-4">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-secondary">
                            <span className="font-semibold text-asking">Low RAM</span>
                            <span className="text-ink-faint"> · </span>
                            {agent.name}
                        </span>
                        <button
                            type="button"
                            onClick={() => jumpToAgent(model, agent.id)}
                            className="inline-flex cursor-pointer items-center gap-[4px] rounded-[6px] px-[8px] py-[4px] text-[11.5px] font-medium text-secondary hover:bg-surface-hover hover:text-primary"
                        >
                            Open agent
                            <ArrowUpRight size={12} aria-hidden />
                        </button>
                        <button
                            type="button"
                            title="Hide this card; it stays on the agent's own card (Esc)"
                            onClick={() => later(agent)}
                            className="cursor-pointer rounded-[6px] px-[8px] py-[4px] text-[11.5px] font-medium text-muted hover:bg-surface-hover hover:text-primary"
                        >
                            Later
                        </button>
                    </div>
                    <AskRow model={model} agent={agent} alert />
                </div>
            ) : null}
        </ModalShell>
    );
}
