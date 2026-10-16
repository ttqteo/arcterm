// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The "Needs you" rows and what their buttons do, shared by the Cockpit's strip (needsyoustrip.tsx) and the Office's
// notice board. The rows are needsyoustripmodel.ts's; each act is the Brief's own (attentionact.ts, attentionrun.ts), a
// learned rule's is LearnDecide, and Open goes to the agent's card, the initiative or the run. A caller with no mouse
// event (the board, from a keypress) passes none: a Ctrl-click peek only exists for a click.

import { pushToast } from "@/app/cockpit/notificationstore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { AttentionAct } from "@/app/view/jarvis/attentionact";
import { runAttentionAct } from "@/app/view/jarvis/attentionrun";
import { workOnDueChunk } from "@/app/view/jarvis/initiativeworkaction";
import { openOrPeek } from "@/app/view/jarvis/openref";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useMemo, useState, type MouseEvent } from "react";
import type { AgentsViewModel } from "./agents";
import { attentionAtom, attentionFixtureAtom, loadAttention } from "./attentionstore";
import { channelMessagesAtom, channelsAtom } from "./channelsstore";
import { buildNeedsYouRows, channelProjects, type StripRow } from "./needsyoustripmodel";
import { projectsAtom } from "./projectsstore";

const feedback = {
    done: (title: string) => pushToast({ title, message: "", level: "info" }),
    fail: (title: string) => pushToast({ title, message: "", level: "error" }),
};

export interface NeedsYou {
    rows: StripRow[];
    now: number;
    // rows whose call is in flight: the list reloads only once it lands, and a second press would send it twice
    busy: ReadonlySet<string>;
    open: (row: StripRow, e?: MouseEvent) => void;
    act: (row: StripRow, which: AttentionAct, e?: MouseEvent) => void;
    // resolves true once the call went through, so a failed accept (a skill at its 20 additions) leaves the card as it was
    decideLearn: (row: StripRow, accept: boolean, text?: string) => Promise<boolean>;
}

export function useNeedsYou(
    model: AgentsViewModel,
    // an escalation's Open, when its asking agent is in the roster: the Cockpit knows where that card is
    onFocusAgent: (agentId: string) => void
): NeedsYou {
    const live = useAtomValue(attentionAtom);
    const fixture = useAtomValue(attentionFixtureAtom);
    const attention = fixture ?? live;
    const channels = useAtomValue(channelsAtom);
    const registry = useAtomValue(projectsAtom);
    const channelMessages = useAtomValue(channelMessagesAtom);
    const roster = useAtomValue(model.agentsAtom);
    const filter = useAtomValue(model.projectFilterAtom);
    const now = useAtomValue(model.structuralNowAtom);
    const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
    const channelProject = useMemo(() => channelProjects(channels, registry), [channels, registry]);
    const rows = useMemo(
        () => buildNeedsYouRows({ attention, filter, channelProject, channelMessages, roster }),
        [attention, filter, channelProject, channelMessages, roster]
    );

    const open = (row: StripRow, e?: MouseEvent) => {
        const to = row.open;
        if (to == null) {
            return;
        }
        if (to.kind === "agent") {
            onFocusAgent(to.agentId);
            return;
        }
        if (to.kind === "effort") {
            fireAndForget(() => openOrPeek(model, { kind: "effort", effortId: to.effortId }, e));
            return;
        }
        fireAndForget(() =>
            openOrPeek(model, { kind: "channel", channelId: to.channelId, runId: to.runId ?? undefined }, e)
        );
    };
    const setRowBusy = (key: string, on: boolean) =>
        setBusy((cur) => {
            const next = new Set(cur);
            if (on) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    const decideLearn = async (row: StripRow, accept: boolean, text?: string): Promise<boolean> => {
        if (row.learnId == null) {
            return false;
        }
        setRowBusy(row.key, true);
        try {
            await RpcApi.LearnDecideCommand(TabRpcClient, { id: row.learnId, accept, ...(text ? { text } : {}) });
        } catch (e) {
            // the card stays: a skill at its 20 additions, or one removed since, says why in the error
            feedback.fail(e instanceof Error ? e.message : String(e));
            return false;
        } finally {
            setRowBusy(row.key, false);
        }
        await loadAttention();
        feedback.done(accept ? `Learned: ${row.text}` : "Learned rule dismissed");
        return true;
    };
    const act = (row: StripRow, which: AttentionAct, e?: MouseEvent) => {
        if (which.kind === "open") {
            open(row, e);
            return;
        }
        if (which.kind === "work-on") {
            if (row.open?.kind === "effort") {
                const effortId = row.open.effortId;
                fireAndForget(() => workOnDueChunk(model, "effort:" + effortId, row.text));
            }
            return;
        }
        setRowBusy(row.key, true);
        fireAndForget(async () => {
            try {
                await runAttentionAct(which, row.run, feedback);
            } finally {
                setRowBusy(row.key, false);
            }
        });
    };

    return { rows, now, busy, open, act, decideLearn };
}
