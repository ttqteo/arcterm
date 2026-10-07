// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → Claude account → "+ Đăng nhập account": a small live terminal running `claude setup-token`.
// The user signs in in the browser as the account to add; the token setup-token prints is read out of the
// pty output (TokenScanner), stored, and only a label is asked for. The terminal lives in a helper tab
// marked session:helper (the session sidebar skips it), not in an agent launch, and the tab is closed on
// every exit path — its `term` block file holds the token. It sits shell-side because it embeds
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
import { setupTokenCommand, TokenScanner } from "@/app/view/agents/setuptokenscan";
import { base64ToString, fireAndForget } from "@/util/util";
import { useEffect, useRef, useState } from "react";

type Phase =
    | { kind: "starting" }
    | { kind: "running"; tabId: string; blockId: string }
    | { kind: "saving" }
    | { kind: "label"; account: ClaudeAccountData }
    | { kind: "error"; message: string };

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

export function ClaudeSigninModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
    const [phase, setPhase] = useState<Phase>({ kind: "starting" });
    const [label, setLabel] = useState("");
    const [labelError, setLabelError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const onAddedRef = useRef(onAdded);
    onAddedRef.current = onAdded;

    useEffect(() => {
        let closed = false;
        let wsId: string | null = null;
        let tabId: string | null = null;
        let subject: SubjectWithRef<WSFileEventData> | null = null;
        // every exit ends here (token found, Cancel, Escape, unmount, a failed setup): closing the helper tab
        // destroys the block, which kills the command and deletes its term file
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
        const onToken = async (token: string) => {
            teardown();
            setPhase({ kind: "saving" });
            try {
                const account = await RpcApi.ClaudeAccountAddCommand(TabRpcClient, { label: "", token });
                setLabel(account.label);
                setPhase({ kind: "label", account });
                onAddedRef.current();
            } catch (e) {
                setPhase({ kind: "error", message: errorText(e) });
            }
        };

        fireAndForget(async () => {
            wsId = globalStore.get(atoms.workspace)?.oid ?? null;
            if (wsId == null) {
                setPhase({ kind: "error", message: "no active workspace" });
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
                    const token = scanner.push(base64ToString(msg.data64) ?? "");
                    if (token != null) {
                        fireAndForget(() => onToken(token));
                    }
                });
                started = true;
                setPhase({ kind: "running", tabId, blockId });
            } catch (e) {
                if (!closed) {
                    setPhase({ kind: "error", message: errorText(e) });
                }
            } finally {
                if (!started) {
                    teardown();
                }
            }
        });
        return teardown;
    }, []);

    const save = async () => {
        if (phase.kind !== "label" || busy) {
            return;
        }
        const next = label.trim();
        if (next === "" || next === phase.account.label) {
            onClose();
            return;
        }
        setBusy(true);
        setLabelError(null);
        try {
            await RpcApi.ClaudeAccountRenameCommand(TabRpcClient, { id: phase.account.id, label: next });
        } catch (e) {
            setLabelError(errorText(e));
            setBusy(false);
            return;
        }
        onAddedRef.current();
        onClose();
    };

    const signingIn = phase.kind === "starting" || phase.kind === "running" || phase.kind === "saving";
    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={phase.kind === "label" ? () => void save() : undefined}
            dismissOnBackdrop={false}
            className="w-full max-w-[720px]"
        >
            <div data-claude-signin-modal className="flex min-h-[420px] flex-col px-[22px] pt-[22px] pb-[18px]">
                <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                    {phase.kind === "label" ? "Đặt tên account" : "Đăng nhập Claude account"}
                </h2>
                {signingIn ? (
                    <>
                        <div className="mt-[7px] text-[13px] leading-[1.55] text-ink-mid">
                            Trình duyệt sẽ mở: đăng nhập bằng account muốn thêm rồi cho phép. arcterm tự lấy token khi{" "}
                            <span className="font-mono">claude setup-token</span> in ra — không cần copy.
                        </div>
                        <div
                            data-claude-signin-term
                            className="mt-4 flex h-[260px] min-h-0 min-w-0 overflow-hidden rounded-[10px] border border-border bg-background p-1.5"
                        >
                            {phase.kind === "running" ? (
                                <CockpitFocusPane blockId={phase.blockId} tabId={phase.tabId} />
                            ) : (
                                <div className="m-auto text-[12px] text-muted">
                                    {phase.kind === "saving" ? "Đang lưu token…" : "Đang mở terminal…"}
                                </div>
                            )}
                        </div>
                    </>
                ) : phase.kind === "label" ? (
                    <div className="mt-[7px] flex flex-col gap-2.5">
                        <div className="text-[13px] leading-[1.55] text-ink-mid">
                            Đã lưu token. Agent mới chạy trên account này khi bạn chọn nó trong Settings.
                        </div>
                        <input
                            type="text"
                            data-claude-signin-label
                            autoFocus
                            value={label}
                            placeholder={phase.account.label}
                            spellCheck={false}
                            onChange={(e) => setLabel(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    void save();
                                }
                            }}
                            className="w-[280px] rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[13px] text-primary outline-none focus:border-accent-700"
                        />
                        {labelError ? <div className="text-[12px] text-error">{labelError}</div> : null}
                    </div>
                ) : (
                    <div data-claude-signin-error className="mt-[7px] text-[13px] leading-[1.55] text-error">
                        {phase.message}
                    </div>
                )}
                <div className="mt-auto flex justify-end gap-2.5 pt-[18px]">
                    {phase.kind === "label" ? (
                        <DialogButton variant="primary" hint="⏎" disabled={busy} onClick={() => void save()}>
                            Lưu
                        </DialogButton>
                    ) : (
                        <DialogButton variant="secondary" hint="esc" data-claude-signin-cancel onClick={onClose}>
                            {phase.kind === "error" ? "Đóng" : "Cancel"}
                        </DialogButton>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}

ClaudeSigninModal.displayName = "ClaudeSigninModal";
