// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → Claude account → "+ Add account": one dialog for both ways in. It opens on sign-in, a small live
// terminal running `claude setup-token`: the user signs in in the browser as the account to add, and the token
// setup-token prints is read out of the pty output (TokenScanner) and stored. "Have a token already? Paste it"
// swaps the terminal for a token field. Both paths end on the same Name step. The steps are the pure
// addAccountStep (view/agents/claudeaccount.ts). The terminal lives in a helper tab marked session:helper (the
// session sidebar skips it), not in an agent launch, and the tab is closed on every exit path — leaving sign-in
// included — because its `term` block file holds the token. It sits shell-side because it embeds
// CockpitFocusPane, which view/agents must not import; the Settings section loads it with a lazy import().

import { CockpitFocusPane } from "@/app/cockpit/focus-pane";
import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { WorkspaceService } from "@/app/store/services";
import * as WOS from "@/app/store/wos";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { addAccountStep, knownClaudeEmails, type AddAction, type AddStep } from "@/app/view/agents/claudeaccount";
import { claudeIdentityAtom, savedRateLimitsAtom } from "@/app/view/agents/ratelimitstore";
import { setupTokenCommand, TokenScanner } from "@/app/view/agents/setuptokenscan";
import { base64ToString, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

// the sign-in terminal's own state, used only while the step is sign-in
type Term = { kind: "starting" } | { kind: "running"; tabId: string; blockId: string } | { kind: "saving" };

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function devOverride(): string | null {
    try {
        return localStorage.getItem("arc:dev:setuptoken-cmd");
    } catch {
        return null;
    }
}

const FIELD_CLASS =
    "rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[13px] text-primary outline-none focus:border-accent-700";

export function ClaudeSigninModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
    const [step, dispatch] = useReducer<AddStep, undefined, [AddAction]>(addAccountStep, undefined, () =>
        addAccountStep(undefined, { type: "init" })
    );
    const [term, setTerm] = useState<Term>({ kind: "starting" });
    // bumped on every "Back to sign-in": a fresh attempt is a fresh helper tab
    const [signinAttempt, setSigninAttempt] = useState(0);
    const [token, setToken] = useState("");
    const [label, setLabel] = useState("");
    const [sameEmail, setSameEmail] = useState("");
    const [nameError, setNameError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const saved = useAtomValue(savedRateLimitsAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const emails = useMemo(() => knownClaudeEmails(saved, identity), [saved, identity]);
    const onAddedRef = useRef(onAdded);
    onAddedRef.current = onAdded;

    // The sign-in terminal runs while the step is sign-in and is torn down when the step leaves it (paste,
    // an added account, an error) or the dialog unmounts. Its dependency is the attempt number while on
    // sign-in and -1 off it, so leaving closes the helper tab and coming back (a new attempt) opens a fresh one.
    useEffect(() => {
        if (step.kind !== "signin") {
            return;
        }
        let closed = false;
        let wsId: string | null = null;
        let tabId: string | null = null;
        let subject: SubjectWithRef<WSFileEventData> | null = null;
        // every exit ends here (token found, Cancel, Escape, unmount, Paste, a failed setup): closing the helper
        // tab destroys the block, which kills the command and deletes its term file
        const teardown = () => {
            closed = true;
            subject?.release();
            subject = null;
            const id = tabId;
            tabId = null;
            if (id != null && wsId != null) {
                const ws = wsId;
                fireAndForget(() => WorkspaceService.CloseTab(ws, id));
            }
        };
        const onToken = async (found: string) => {
            teardown();
            setTerm({ kind: "saving" });
            try {
                const account = await RpcApi.ClaudeAccountAddCommand(TabRpcClient, { label: "", token: found });
                setLabel(account.label);
                dispatch({ type: "added", account });
                onAddedRef.current();
            } catch (e) {
                dispatch({ type: "failed", message: errorText(e) });
            }
        };

        fireAndForget(async () => {
            wsId = globalStore.get(atoms.workspace)?.oid ?? null;
            if (wsId == null) {
                dispatch({ type: "failed", message: "no active workspace" });
                return;
            }
            let started = false;
            try {
                tabId = await WorkspaceService.CreateTab(wsId, "Claude sign-in", false);
                if (closed) {
                    return;
                }
                const tabORef = WOS.makeORef("tab", tabId);
                await RpcApi.SetMetaCommand(TabRpcClient, { oref: tabORef, meta: { "session:helper": true } });
                const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(tabORef));
                const blockId = tab?.blockids?.[0];
                if (blockId == null) {
                    throw new Error("new tab has no block");
                }
                const { cmd, args } = setupTokenCommand(import.meta.env.DEV, devOverride());
                const blockORef = WOS.makeORef("block", blockId);
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: blockORef,
                    meta: { view: "term", controller: "cmd", cmd, "cmd:args": args, "cmd:shell": false },
                });
                // getWaveObjectAtom is a one-time fetch: reload so the pane starts the command, not the shell
                await WOS.reloadWaveObject(blockORef);
                if (closed) {
                    return;
                }
                // subscribed before the pane mounts, which is what starts the command
                const scanner = new TokenScanner();
                subject = getFileSubject(blockId, "term");
                subject.subscribe((msg) => {
                    if (msg.fileop !== "append") {
                        return;
                    }
                    const found = scanner.push(base64ToString(msg.data64) ?? "");
                    if (found != null) {
                        fireAndForget(() => onToken(found));
                    }
                });
                started = true;
                setTerm({ kind: "running", tabId, blockId });
            } catch (e) {
                if (!closed) {
                    dispatch({ type: "failed", message: errorText(e) });
                }
            } finally {
                if (!started) {
                    teardown();
                }
            }
        });
        return teardown;
    }, [step.kind === "signin" ? signinAttempt : -1]);

    const showPaste = () => dispatch({ type: "paste" });
    const backToSignin = () => {
        setToken("");
        setTerm({ kind: "starting" });
        setSigninAttempt((n) => n + 1);
        dispatch({ type: "back" });
    };

    // write-only: the token never comes back. A refused one stays in the field, with the reason under it.
    const savePaste = async () => {
        const pasted = token.trim();
        if (step.kind !== "paste" || step.busy || pasted === "") {
            return;
        }
        dispatch({ type: "saving" });
        try {
            const account = await RpcApi.ClaudeAccountAddCommand(TabRpcClient, { label: "", token: pasted });
            setToken("");
            setLabel(account.label);
            dispatch({ type: "added", account });
            onAddedRef.current();
        } catch (e) {
            dispatch({ type: "refused", message: errorText(e) });
        }
    };

    const done = async () => {
        if (step.kind !== "name" || busy) {
            return;
        }
        const next = label.trim();
        setBusy(true);
        setNameError(null);
        try {
            if (next !== "" && next !== step.account.label) {
                await RpcApi.ClaudeAccountRenameCommand(TabRpcClient, { id: step.account.id, label: next });
            }
            if (sameEmail !== "") {
                await RpcApi.ClaudeAccountSetEmailCommand(TabRpcClient, { id: step.account.id, email: sameEmail });
            }
        } catch (e) {
            setNameError(errorText(e));
            setBusy(false);
            return;
        }
        onAddedRef.current();
        onClose();
    };

    const onSubmit =
        step.kind === "name" ? () => void done() : step.kind === "paste" ? () => void savePaste() : undefined;
    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={onSubmit}
            dismissOnBackdrop={false}
            className="w-full max-w-[720px]"
        >
            <div data-claude-signin-modal className="flex min-h-[420px] flex-col px-[22px] pt-[22px] pb-[18px]">
                <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                    {step.kind === "name" ? "Name this account" : "Add a Claude account"}
                </h2>
                {step.kind === "signin" ? (
                    <>
                        <div className="mt-[7px] text-[13px] leading-[1.55] text-ink-mid">
                            Sign in in the browser as the account to add. arcterm picks up the token itself.
                        </div>
                        <div
                            data-claude-signin-term
                            className="mt-4 flex h-[260px] min-h-0 min-w-0 overflow-hidden rounded-[10px] border border-border bg-background p-1.5"
                        >
                            {term.kind === "running" ? (
                                <CockpitFocusPane blockId={term.blockId} tabId={term.tabId} />
                            ) : (
                                <div className="m-auto text-[12px] text-muted">
                                    {term.kind === "saving" ? "Saving token…" : "Opening terminal…"}
                                </div>
                            )}
                        </div>
                        <div className="mt-2.5">
                            <button
                                type="button"
                                data-claude-signin-paste
                                disabled={term.kind === "saving"}
                                onClick={showPaste}
                                className="cursor-pointer text-[12px] font-semibold text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                Have a token already? Paste it
                            </button>
                        </div>
                    </>
                ) : step.kind === "paste" ? (
                    <div className="mt-[7px] flex flex-col gap-2.5">
                        <div className="text-[13px] leading-[1.55] text-ink-mid">
                            A token from <span className="font-mono">claude setup-token</span> (starts with{" "}
                            <span className="font-mono">sk-ant-oat</span>).
                        </div>
                        <div className="flex items-center gap-2.5">
                            <input
                                type="password"
                                data-claude-signin-token
                                autoFocus
                                autoComplete="off"
                                value={token}
                                placeholder="sk-ant-oat01-…"
                                spellCheck={false}
                                readOnly={step.busy}
                                onChange={(e) => setToken(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void savePaste();
                                    }
                                }}
                                className={`min-w-0 flex-1 font-mono ${FIELD_CLASS}`}
                            />
                            <DialogButton
                                variant="primary"
                                data-claude-signin-save
                                disabled={step.busy || token.trim() === ""}
                                onClick={() => void savePaste()}
                            >
                                Save
                            </DialogButton>
                        </div>
                        {step.error ? (
                            <div data-claude-signin-paste-error className="text-[12px] leading-[1.55] text-error">
                                {step.error}
                            </div>
                        ) : null}
                        <div>
                            <button
                                type="button"
                                data-claude-signin-back
                                onClick={backToSignin}
                                className="cursor-pointer text-[12px] font-semibold text-muted transition-colors hover:text-primary"
                            >
                                Back to sign-in
                            </button>
                        </div>
                    </div>
                ) : step.kind === "name" ? (
                    <div className="mt-[7px] flex flex-col gap-2.5">
                        <div className="text-[13px] leading-[1.55] text-ink-mid">
                            Token saved. Select it in Settings to run new agents on it.
                        </div>
                        <label className="flex flex-col gap-1">
                            <span className="text-[12px] text-muted">Name</span>
                            <input
                                type="text"
                                data-claude-signin-label
                                autoFocus
                                value={label}
                                placeholder={step.account.label}
                                spellCheck={false}
                                onChange={(e) => setLabel(e.target.value)}
                                onFocus={(e) => e.currentTarget.select()}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void done();
                                    }
                                }}
                                className={`w-[280px] ${FIELD_CLASS}`}
                            />
                        </label>
                        {emails.length > 0 ? (
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] text-muted">Same account as</span>
                                <select
                                    data-claude-signin-same
                                    value={sameEmail}
                                    onChange={(e) => setSameEmail(e.target.value)}
                                    className={`w-[280px] ${FIELD_CLASS}`}
                                >
                                    <option value="">None</option>
                                    {emails.map((email) => (
                                        <option key={email} value={email}>
                                            {email}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}
                        {nameError ? <div className="text-[12px] text-error">{nameError}</div> : null}
                    </div>
                ) : (
                    <div data-claude-signin-error className="mt-[7px] text-[13px] leading-[1.55] text-error">
                        {step.message}
                    </div>
                )}
                <div className="mt-auto flex justify-end gap-2.5 pt-[18px]">
                    {step.kind === "name" ? (
                        <DialogButton variant="primary" hint="⏎" disabled={busy} onClick={() => void done()}>
                            Done
                        </DialogButton>
                    ) : (
                        <DialogButton variant="secondary" hint="esc" data-claude-signin-cancel onClick={onClose}>
                            {step.kind === "error" ? "Close" : "Cancel"}
                        </DialogButton>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}

ClaudeSigninModal.displayName = "ClaudeSigninModal";
