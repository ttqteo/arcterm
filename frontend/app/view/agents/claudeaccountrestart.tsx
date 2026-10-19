// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The dialog a Claude account switch opens when running agents are still on the old account
// (pushModal("ClaudeAccountRestartModal", { candidates })). The switch has already happened; this only
// offers to resume each agent's session on the new account. "Later" leaves them as they are.
// `account` is the id switched to ("" = Default) and `accountName` its name for the title; a respawn
// reads wavesrv's environment, so nothing is restarted until wavesrv reports that account as the one
// it applied.
//
// The agents are a tree (groupRestartCandidates): a folder per project, its plain agents, then a section per
// orchestrator run holding the run's lead and workers. Every folder and run has a checkbox for all under it, and
// Select all heads the list. Only the list scrolls, so a long roster never pushes the buttons off screen.

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
    groupCheckState,
    groupRestartCandidates,
    restartOnAccount,
    toggleGroup,
    type CheckState,
    type RestartCandidate,
} from "./claudeaccount";

const STATE_TAG: Partial<Record<RestartCandidate["state"], string>> = {
    working: "working",
    asking: "asking",
};

function TriCheck({
    state,
    disabled,
    onToggle,
    label,
}: {
    state: CheckState;
    disabled?: boolean;
    onToggle: () => void;
    label: string;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) {
            ref.current.indeterminate = state === "some";
        }
    }, [state]);
    return (
        <input
            ref={ref}
            type="checkbox"
            aria-label={label}
            checked={state === "all"}
            disabled={disabled}
            onChange={onToggle}
            className="shrink-0 accent-accent"
        />
    );
}

function Fold({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
    const Icon = open ? ChevronDown : ChevronRight;
    return (
        <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            onClick={onToggle}
            className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded text-ink-faint hover:text-primary"
        >
            <Icon size={13} />
        </button>
    );
}

export function ClaudeAccountRestartModal({
    candidates,
    account,
    accountName,
}: {
    candidates: RestartCandidate[];
    account: string;
    accountName: string;
}) {
    const [checked, setChecked] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(candidates.map((c) => [c.tabId, c.checked]))
    );
    const [done, setDone] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [notApplied, setNotApplied] = useState<string | null>(null);
    // folded project folders and run sections, by "p:<project>" / "r:<runId>"; all start open
    const [folded, setFolded] = useState<Record<string, boolean>>({});
    const close = () => modalsModel.popModal();

    const groups = useMemo(() => groupRestartCandidates(candidates), [candidates]);
    const allIds = useMemo(() => candidates.map((c) => c.tabId), [candidates]);
    const openCount = allIds.filter((id) => !done[id]).length;
    const pending = candidates.filter((c) => checked[c.tabId] && !done[c.tabId]);
    const anyBusyAgent = candidates.some((c) => STATE_TAG[c.state] != null && !done[c.tabId]);
    // headers only earn their place when there is more than one folder or a run to set apart
    const flat = groups.length === 1 && groups[0].runs.length === 0;

    const toggle = (ids: string[]) => setChecked((prev) => toggleGroup(ids, prev, done));
    const fold = (key: string) => setFolded((prev) => ({ ...prev, [key]: !prev[key] }));
    const stateOf = (ids: string[]) => groupCheckState(ids, checked, done);
    const allDone = (ids: string[]) => ids.every((id) => done[id]);

    const restart = async () => {
        if (busy || pending.length === 0) {
            return;
        }
        setBusy(true);
        setNotApplied(null);
        try {
            const { active } = await RpcApi.ClaudeAccountListCommand(TabRpcClient);
            if (active !== account) {
                setNotApplied(
                    "arcterm has not switched to this account yet (is its token still valid?). No agent was resumed."
                );
                setBusy(false);
                return;
            }
        } catch (e) {
            setNotApplied(String(e instanceof Error ? e.message : e));
            setBusy(false);
            return;
        }
        const results = await Promise.allSettled(pending.map((c) => restartOnAccount(c)));
        const nextDone = { ...done };
        const nextErrors: Record<string, string> = {};
        results.forEach((r, i) => {
            const id = pending[i].tabId;
            if (r.status === "fulfilled") {
                nextDone[id] = true;
            } else {
                nextErrors[id] = String(r.reason?.message ?? r.reason);
            }
        });
        setDone(nextDone);
        setErrors(nextErrors);
        setBusy(false);
        if (Object.keys(nextErrors).length === 0) {
            close();
        }
    };

    const row = (c: RestartCandidate) => {
        const tag = STATE_TAG[c.state];
        const error = errors[c.tabId];
        const isDone = done[c.tabId] === true;
        return (
            <label
                key={c.tabId}
                data-restart-row={c.tabId}
                className={cn(
                    "flex cursor-pointer flex-col rounded-[7px] px-2 py-[5px] transition-colors hover:bg-hoverbg",
                    isDone && "cursor-default opacity-55 hover:bg-transparent"
                )}
            >
                <div className="flex min-w-0 items-center gap-2.5">
                    <input
                        type="checkbox"
                        checked={checked[c.tabId] ?? false}
                        disabled={busy || isDone}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [c.tabId]: e.target.checked }))}
                        className="shrink-0 accent-accent"
                    />
                    {c.role ? <span className="shrink-0 font-mono text-[11px] text-ink-faint">{c.role}</span> : null}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-primary">{c.name}</span>
                    {isDone ? (
                        <span className="shrink-0 text-[11.5px] text-success-soft">resumed</span>
                    ) : tag ? (
                        <span className="shrink-0 text-[11.5px] text-warning-soft">{tag}</span>
                    ) : null}
                </div>
                {error ? (
                    <div data-restart-error className="mt-0.5 pl-[23px] text-[11.5px] text-error">
                        {error}
                    </div>
                ) : null}
            </label>
        );
    };

    const header = (key: string, title: string, ids: string[], kind: "project" | "run") => {
        const open = !folded[key];
        const n = ids.filter((id) => checked[id] && !done[id]).length;
        return (
            <div
                data-restart-group={key}
                className={cn(
                    "flex min-w-0 items-center gap-1.5 rounded-[7px] py-[5px] pr-2",
                    kind === "run" && "pl-1"
                )}
            >
                <Fold open={open} onToggle={() => fold(key)} label={`${open ? "Fold" : "Unfold"} ${title}`} />
                <TriCheck
                    state={stateOf(ids)}
                    disabled={busy || allDone(ids)}
                    onToggle={() => toggle(ids)}
                    label={`Select every agent in ${title}`}
                />
                <button
                    type="button"
                    onClick={() => fold(key)}
                    className={cn(
                        "ml-1 min-w-0 flex-1 cursor-pointer truncate text-left",
                        kind === "project"
                            ? "text-[12px] font-semibold text-ink-mid"
                            : "text-[12.5px] font-medium text-primary"
                    )}
                >
                    {kind === "run" ? <span className="mr-1.5 text-[11px] font-normal text-ink-faint">run</span> : null}
                    {title}
                </button>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {n}/{ids.length}
                </span>
            </div>
        );
    };

    return (
        <ModalShell open onClose={close} align="center" className="w-full max-w-[520px]">
            <div data-claude-restart-dialog className="flex max-h-[min(86vh,760px)] flex-col pt-[22px] pb-[18px]">
                <div className="px-[22px]">
                    <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                        {`Resume agents on ${accountName}?`}
                    </h2>
                    <div className="mt-[7px] text-[13px] leading-[1.55] text-ink-mid">
                        These agents still run on the previous account. Resuming continues each one's session on the new
                        one.
                    </div>
                </div>
                <div className="mx-[22px] mt-4 flex items-center gap-2.5 border-b border-border px-2 pb-2">
                    <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] font-medium text-primary">
                        <TriCheck
                            state={stateOf(allIds)}
                            disabled={busy || openCount === 0}
                            onToggle={() => toggle(allIds)}
                            label="Select all"
                        />
                        Select all
                    </label>
                    <span className="ml-auto text-[11.5px] tabular-nums text-muted">
                        {pending.length} of {openCount} selected
                    </span>
                </div>
                <div data-restart-list className="mt-1.5 min-h-0 flex-1 overflow-y-auto px-[22px]">
                    {groups.map((g) => {
                        const pKey = `p:${g.project}`;
                        const title = g.project || "No project";
                        const ids = [...g.agents, ...g.runs.flatMap((r) => r.items)].map((c) => c.tabId);
                        const open = flat || !folded[pKey];
                        return (
                            <div key={pKey} className="py-0.5">
                                {flat ? null : header(pKey, title, ids, "project")}
                                {open ? (
                                    <div className={cn(!flat && "pl-[18px]")}>
                                        {g.agents.map(row)}
                                        {g.runs.map((r) => {
                                            const rKey = `r:${r.id}`;
                                            const runIds = r.items.map((c) => c.tabId);
                                            return (
                                                <div key={rKey}>
                                                    {header(rKey, r.title, runIds, "run")}
                                                    {!folded[rKey] ? (
                                                        <div className="ml-[11px] border-l border-border pl-[10px]">
                                                            {r.items.map(row)}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
                <div className="px-[22px]">
                    {notApplied ? (
                        <div data-restart-error className="mt-3 text-[12px] leading-[1.5] text-error">
                            {notApplied}
                        </div>
                    ) : null}
                    <div className="mt-3 border-t border-border pt-3 text-[12px] leading-[1.5] text-muted">
                        {anyBusyAgent ? (
                            <div>
                                Working and asking agents start unchecked: resuming cuts a turn short or drops the
                                question.
                            </div>
                        ) : null}
                        <div>Open terminals keep the previous account until they are reopened.</div>
                    </div>
                    <div className="mt-[18px] flex justify-end gap-2.5">
                        <DialogButton variant="secondary" hint="esc" onClick={close}>
                            Later
                        </DialogButton>
                        <DialogButton
                            variant="primary"
                            disabled={busy || pending.length === 0}
                            onClick={() => void restart()}
                        >
                            Resume selected
                        </DialogButton>
                    </div>
                </div>
            </div>
        </ModalShell>
    );
}

ClaudeAccountRestartModal.displayName = "ClaudeAccountRestartModal";
