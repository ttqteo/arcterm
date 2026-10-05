// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The run sheet's composer (design L579-586): steer-only, in the sheet's footer under the dock. It exists
// on a live run with a reachable worker and nowhere else (briefcomposertarget.ts), and its words come from
// resolveComposerLabels, so nothing here can describe it differently from briefcompose's tests. The Ask
// thread a finished run had in the design was retired 2026-09-23 (docs/deferred.md).

import type { AgentsViewModel } from "@/app/view/agents/agents";
import { steerWorker } from "@/app/view/agents/channelactions";
import { channelProjectLabel } from "@/app/view/agents/projectlabel";
import { projectsAtom } from "@/app/view/agents/projectsstore";
import { getJarvisProfile, refreshResolvedProfile, setChannelProfile } from "@/app/view/agents/runactions";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { useState } from "react";
import { resolveComposerLabels } from "./briefcompose";
import { resolveBriefComposerTarget } from "./briefcomposertarget";
import { briefDraftAtom } from "./briefingstore";
import { reducePrinciplePatch } from "./profilemodel";

export function RunComposer({
    model,
    channel,
    run,
    onClose,
}: {
    model: AgentsViewModel;
    channel: Channel;
    run: Run;
    onClose: () => void;
}) {
    const agents = useAtomValue(model.agentsAtom);
    const projects = useAtomValue(projectsAtom);
    const [draft, setDraft] = useAtom(briefDraftAtom);
    // a directive lands in a terminal, not a thread, so its outcome is said here or nowhere
    const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
    const project = channelProjectLabel(channel, projects);
    // this renders inside an open run sheet, so the face is that sheet's by construction
    const target = resolveBriefComposerTarget({
        sheetOpen: true,
        face: { kind: "channel", channelId: channel.oid, body: "run" },
        run,
        agents,
        projectName: project,
    });
    if (target == null) {
        return null;
    }
    const labels = resolveComposerLabels(project);
    const orchestrator = run.mode === "orchestrator";
    const canSend = draft.trim() !== "";

    const submit = () => {
        if (!canSend) {
            return;
        }
        const text = draft.trim();
        setDraft("");
        setStatus(null);
        fireAndForget(async () => {
            const sent = await steerWorker({
                channelId: target.channelId,
                workerORef: target.workerORef,
                agents,
                text,
            });
            if (!sent) {
                // the roster moved between render and send: give the words back rather than eat them
                setDraft(text);
                setStatus({ tone: "error", text: `${target.workerName} is no longer live — nothing was sent.` });
            }
        });
    };

    // ⇧⏎: the standing rule the composer offers on a session sheet. It is a principle on the channel's
    // profile — the same list the profile modal edits — so the rule outlives the session that prompted it.
    const addStandingRule = () => {
        const text = draft.trim();
        if (text === "") {
            return;
        }
        const { channelId, sessionName } = target;
        setDraft("");
        setStatus(null);
        fireAndForget(async () => {
            try {
                const profile = await getJarvisProfile(channelId);
                const override = profile.override ?? {};
                const principles = reducePrinciplePatch(override.principles, {
                    type: "add",
                    principle: { id: `project-${crypto.randomUUID()}`, text },
                });
                await setChannelProfile(channelId, { ...override, principles });
                // the resolved cache is what future runs read; a stale one would describe a rule that is
                // saved but not yet in force.
                await refreshResolvedProfile(channelId);
                setStatus({ tone: "ok", text: `Standing rule saved for ${sessionName}. It applies to future runs.` });
            } catch (e) {
                setDraft(text);
                setStatus({ tone: "error", text: String(e) });
            }
        });
    };

    // local to the field, never a window listener: the Brief adds no global chord of its own. Escape is
    // claimed here so one press closes the sheet rather than the sheet's own listener racing this one.
    const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
            return;
        }
        // gated on the label, not on the target, so the offer and the behaviour cannot disagree
        if (e.key === "Enter" && e.shiftKey && labels.alt != null) {
            e.preventDefault();
            addStandingRule();
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    const placeholder = orchestrator ? "Message the lead of this session" : "Message the worker on this run";
    return (
        <div
            data-jarvis-brief-band="composer"
            className="flex flex-col gap-1.5 border-t border-edge-faint px-4 pb-3 pt-2.5"
        >
            <div className="flex items-center gap-2 text-[10.5px]">
                <span className="text-success">{orchestrator ? "lead" : target.workerName}</span>
                <span data-jarvis-brief-composer="scope" className="text-muted">
                    {labels.scope}
                </span>
                {labels.alt != null ? (
                    <span data-jarvis-brief-composer="alt" className="ml-auto text-muted">
                        {labels.alt}
                    </span>
                ) : null}
            </div>
            <div className="flex items-end gap-2 rounded-[8px] border border-edge-mid bg-background py-[7px] pl-2.5 pr-[7px] focus-within:border-edge-strong">
                <textarea
                    data-jarvis-brief-composer="input"
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={placeholder}
                    aria-label="Message this session"
                    className="min-w-0 flex-1 resize-none bg-transparent text-[12.5px] leading-[1.55] text-primary outline-none placeholder:text-muted"
                />
                <button
                    type="button"
                    data-jarvis-brief-composer="send"
                    onClick={submit}
                    disabled={!canSend}
                    className={cn(
                        "flex-none rounded-[6px] px-[11px] py-[5px] text-[11px] font-bold",
                        canSend ? "cursor-pointer bg-accent text-background" : "bg-border text-muted"
                    )}
                >
                    {labels.action}
                </button>
            </div>
            {status != null ? (
                <span
                    data-jarvis-brief-composer="status"
                    aria-live="polite"
                    className={cn("text-[11.5px]", status.tone === "ok" ? "text-success" : "text-error")}
                >
                    {status.text}
                </span>
            ) : null}
        </div>
    );
}
