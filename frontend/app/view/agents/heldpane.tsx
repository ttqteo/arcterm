// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A held agent in the Agent surface's centre (the `held` mode; parkedmodel.ts says what holding is): it reads as a
// conversation not yet sent. A divider line says when and why it was held and what it costs, the task sits as your
// message, dimmed as a queued one is, with its screenshots, and the bar where the chat box floats holds how the machine
// is now, Remove, the one-click Add to the initiative its task best matches (the chevron picks another), and Start now
// (Enter). Board Main.dc.html of the pending-agent canvas.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { stateRpcTimeoutMs } from "@/app/view/jarvis/briefingstore";
import { InitiativePicker } from "@/app/view/jarvis/initiativepicker";
import { formatChordString } from "@/util/keysym";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { ChevronDown, CirclePause, Flag, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { heldSelAtom, showTerminal } from "./agentcenter";
import type { AgentsViewModel } from "./agents";
import { youBubbleBox } from "./chatconversation";
import { PromptImages } from "./narrationtimeline";
import { heldLine, machineNow, parkedMeta, parkedTitle, suggestInitiative } from "./parkedmodel";
import { parkedLaunchesAtom, parkedToInitiative, removeParkedWithUndo, startHeld, useMachine } from "./parkedstore";
import { runtimeMeta } from "./runtimemeta";
import { formatGB } from "./workercapacity";

const PRIMARY =
    "flex flex-none cursor-pointer items-center gap-[8px] rounded-full border-0 bg-accent px-[16px] py-[7px] text-[12.5px] font-semibold text-background hover:bg-accenthover disabled:cursor-default disabled:opacity-50";
const SECONDARY =
    "flex-none cursor-pointer rounded-full border border-edge-mid bg-transparent px-[12px] py-[6px] text-[12.5px] text-secondary hover:border-edge-strong hover:bg-surface-hover disabled:cursor-default disabled:opacity-50";
const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-300";

// the open initiatives, read once per held agent shown: the suggestion is worked out from them
function useEffortSummaries(key: string): EffortSummary[] | null {
    const [list, setList] = useState<{ key: string; efforts: EffortSummary[] } | null>(null);
    useEffect(() => {
        let live = true;
        RpcApi.EffortListCommand(TabRpcClient, {}, { timeout: stateRpcTimeoutMs })
            .then((rtn) => live && setList({ key, efforts: rtn.efforts ?? [] }))
            .catch(() => live && setList({ key, efforts: [] }));
        return () => {
            live = false;
        };
    }, [key]);
    return list?.key === key ? list.efforts : null;
}

export function HeldPane({ model }: { model: AgentsViewModel }) {
    const id = useAtomValue(heldSelAtom);
    const list = useAtomValue(parkedLaunchesAtom);
    const p = list.find((x) => x.id === id) ?? null;
    // a held agent gone from the list (started, added, removed elsewhere) leaves the centre to the terminal
    useEffect(() => {
        if (p == null) {
            showTerminal();
        }
    }, [p]);
    return p == null ? null : <HeldBody key={p.id} model={model} p={p} />;
}

function HeldBody({ model, p }: { model: AgentsViewModel; p: ParkedLaunch }) {
    const now = useAtomValue(model.nowAtom);
    const machine = useMachine(true);
    const efforts = useEffortSummaries(p.id);
    const suggestion = useMemo(
        () => (efforts == null ? null : suggestInitiative(p.task, p.project, efforts)),
        [efforts, p.task, p.project]
    );
    const [busy, setBusy] = useState<"start" | "add" | null>(null);
    const [picking, setPicking] = useState(false);
    const chevronRef = useRef<HTMLButtonElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    // the pane takes focus when it opens, so Enter starts the agent as it does in New
    useEffect(() => rootRef.current?.focus({ preventScroll: true }), []);

    const line = heldLine(p, now);
    const state = machineNow(machine.busy, machine.free, formatGB);
    const title = parkedTitle(p);
    const images = p.images ?? [];
    const run = (what: "start" | "add", fn: () => Promise<void>) => {
        if (busy != null) {
            return;
        }
        setBusy(what);
        fireAndForget(() => fn().finally(() => setBusy(null)));
    };
    const start = () => run("start", () => startHeld(model, p));
    const addTo = (target: { oref: string; title: string }) => run("add", () => parkedToInitiative(model, p, target));
    // the picker hands back an oref; its title is read from the list the suggestion came from
    const pick = (oref: string) => {
        setPicking(false);
        const e = efforts?.find((x) => x.oref === oref);
        if (e != null) {
            addTo({ oref, title: e.title });
        }
    };
    const chord = formatChordString("Enter");

    return (
        <div
            ref={rootRef}
            data-held-pane={p.id}
            tabIndex={-1}
            onKeyDown={(e) => {
                if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.altKey &&
                    e.target === e.currentTarget
                ) {
                    e.preventDefault();
                    start();
                }
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
        >
            <div className="flex h-[40px] flex-none items-center gap-[10px] border-b border-border px-[18px]">
                <CirclePause size={14} aria-hidden className="flex-none text-secondary" />
                <span className="min-w-0 truncate text-[14px] font-semibold text-primary">{title}</span>
                <span className="flex-none text-[12px] text-secondary">{parkedMeta(p).split(" · ")[0]}</span>
                <span className="flex-none text-[12px] text-muted">
                    {runtimeMeta(p.runtime).label} · {p.project}
                </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-[22px]">
                <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 pt-[28px] pb-4">
                    {/* when and why it was held, as a day break reads in a chat */}
                    <div data-held-line className="mb-[14px] flex items-center gap-3">
                        <span aria-hidden className="h-px flex-1 bg-border" />
                        <span className="flex min-w-0 items-center gap-2 rounded-full border border-dashed border-edge-strong px-[14px] py-[6px] text-[12px] text-muted">
                            <CirclePause size={13} aria-hidden className="flex-none text-secondary" />
                            <span className="flex-none font-medium text-secondary">{line.when}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate">{line.why}</span>
                            <span aria-hidden>·</span>
                            <span className="truncate">{line.cost}</span>
                        </span>
                        <span aria-hidden className="h-px flex-1 bg-border" />
                    </div>
                    {/* the task as your message, not sent yet: dimmed as a queued message is */}
                    <div data-held-task className="flex max-w-[75%] flex-col items-end gap-2 self-end opacity-55">
                        {p.task.trim() !== "" || images.length > 0 ? (
                            <div className={youBubbleBox(false)}>
                                {p.task.trim() !== "" ? (
                                    <div className="whitespace-pre-wrap">{p.task.trim()}</div>
                                ) : null}
                                {images.length > 0 ? <PromptImages paths={images} /> : null}
                            </div>
                        ) : null}
                    </div>
                    <div className="-mt-1 self-end text-[12px] text-muted">
                        {images.length === 0
                            ? "Not sent"
                            : `Not sent · starts with ${images.length === 1 ? "this screenshot" : `these ${images.length} screenshots`}`}
                    </div>
                </div>
            </div>

            <div className="flex-none px-[22px] pb-[22px]">
                <div className="mx-auto flex w-full max-w-[760px] items-center gap-2 rounded-[22px] border border-edge-mid bg-surface-raised py-[10px] pl-[16px] pr-[10px] shadow-popover-soft">
                    <span
                        data-held-now={state?.tone ?? ""}
                        className={cn(
                            "flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px]",
                            state?.tone === "busy" ? "text-warning" : "text-secondary"
                        )}
                    >
                        {state == null ? null : state.tone === "busy" ? (
                            <TriangleAlert size={13} aria-hidden className="flex-none" />
                        ) : (
                            <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-full bg-working" />
                        )}
                        <span className="truncate">{state?.text}</span>
                    </span>
                    <button
                        type="button"
                        data-held-act="remove"
                        disabled={busy != null}
                        onClick={() => fireAndForget(() => removeParkedWithUndo(p))}
                        className={cn(SECONDARY, FOCUS_RING)}
                    >
                        Remove
                    </button>
                    {/* one click adds it to the suggested initiative; the chevron picks another */}
                    <span className="flex flex-none items-stretch overflow-hidden rounded-full border border-edge-mid">
                        <button
                            type="button"
                            data-held-act="add"
                            disabled={busy != null || efforts == null}
                            title={
                                suggestion != null
                                    ? `Add it as a chunk of ${suggestion.title}, the rest of the task and the screenshots in its note`
                                    : "Add it to an initiative"
                            }
                            onClick={() => (suggestion != null ? addTo(suggestion) : setPicking(true))}
                            className={cn(
                                "flex min-w-0 max-w-[300px] cursor-pointer items-center gap-1.5 border-0 bg-transparent py-[6px] pl-[12px] pr-[10px] text-[12.5px] text-secondary hover:bg-surface-hover disabled:cursor-default disabled:opacity-50",
                                FOCUS_RING
                            )}
                        >
                            {busy === "add" ? (
                                <Loader2
                                    size={12}
                                    aria-hidden
                                    className="flex-none animate-spin motion-reduce:animate-none"
                                />
                            ) : (
                                <Flag size={12} aria-hidden className="flex-none" />
                            )}
                            <span className="truncate">
                                {suggestion != null ? `Add to ${suggestion.title}` : "Add to initiative…"}
                            </span>
                        </button>
                        <button
                            ref={chevronRef}
                            type="button"
                            data-held-act="pick"
                            aria-label="Add to another initiative"
                            title="Add to another initiative…"
                            disabled={busy != null}
                            onClick={() => setPicking(true)}
                            className={cn(
                                "flex cursor-pointer items-center border-0 border-l border-edge-mid bg-transparent px-[9px] text-muted hover:bg-surface-hover hover:text-primary disabled:cursor-default disabled:opacity-50",
                                FOCUS_RING
                            )}
                        >
                            <ChevronDown size={12} strokeWidth={2.2} aria-hidden />
                        </button>
                    </span>
                    <button
                        type="button"
                        data-held-act="start"
                        disabled={busy != null}
                        title={`Start it now (${chord})`}
                        onClick={start}
                        className={cn(PRIMARY, FOCUS_RING)}
                    >
                        {busy === "start" ? (
                            <Loader2 size={12} aria-hidden className="animate-spin motion-reduce:animate-none" />
                        ) : null}
                        Start now
                        <span className="font-mono text-[10.5px] opacity-70">{chord}</span>
                    </button>
                </div>
            </div>
            <InitiativePicker
                open={picking}
                anchor={chevronRef.current}
                project={p.project}
                newLabel={null}
                pickVerb="add to"
                onPick={pick}
                onClose={() => setPicking(false)}
            />
        </div>
    );
}
