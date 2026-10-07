// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The dialog a Claude account switch opens when running agents are still on the old account
// (pushModal("ClaudeAccountRestartModal", { candidates })). The switch has already happened; this only
// offers to resume each agent's session on the new account. "Để sau" leaves them as they are.
// `account` is the id switched to ("" = Default); a respawn reads wavesrv's environment, so nothing is
// restarted until wavesrv reports that account as the one it applied.

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { restartOnAccount, type RestartCandidate } from "./claudeaccount";

const NOTE: Partial<Record<RestartCandidate["state"], string>> = {
    working: "đang làm việc — restart sau khi xong lượt",
    asking: "đang hỏi — restart sẽ bỏ câu hỏi",
};

export function ClaudeAccountRestartModal({
    candidates,
    account,
}: {
    candidates: RestartCandidate[];
    account: string;
}) {
    const [checked, setChecked] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(candidates.map((c) => [c.tabId, c.checked]))
    );
    const [done, setDone] = useState<Record<string, boolean>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [notApplied, setNotApplied] = useState<string | null>(null);
    const close = () => modalsModel.popModal();

    const pending = candidates.filter((c) => checked[c.tabId] && !done[c.tabId]);
    const restart = async () => {
        if (busy || pending.length === 0) {
            return;
        }
        setBusy(true);
        setNotApplied(null);
        try {
            const { active } = await RpcApi.ClaudeAccountListCommand(TabRpcClient);
            if (active !== account) {
                setNotApplied("wavesrv chưa chuyển sang account này (token có còn không?) — chưa restart agent nào.");
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

    return (
        <ModalShell open onClose={close} align="center" className="w-full max-w-[480px]">
            <div data-claude-restart-dialog className="px-[22px] pt-[22px] pb-[18px]">
                <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                    Restart agents trên account mới?
                </h2>
                <div className="mt-[7px] text-[13px] leading-[1.55] text-ink-mid">
                    Các agent này vẫn chạy trên account cũ. Restart sẽ tiếp tục đúng session của chúng trên account mới.
                </div>
                <div className="mt-4 flex flex-col gap-1.5">
                    {candidates.map((c) => {
                        const note = NOTE[c.state];
                        const error = errors[c.tabId];
                        const isDone = done[c.tabId] === true;
                        return (
                            <label
                                key={c.tabId}
                                data-restart-row={c.tabId}
                                className={cn(
                                    "flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-border px-3 py-2.5 transition-colors hover:border-edge-strong",
                                    isDone && "cursor-default opacity-55 hover:border-border"
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={checked[c.tabId] ?? false}
                                    disabled={busy || isDone}
                                    onChange={(e) => setChecked((prev) => ({ ...prev, [c.tabId]: e.target.checked }))}
                                    className="mt-[3px] accent-accent"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] font-semibold text-primary">{c.name}</div>
                                    {isDone ? (
                                        <div className="mt-0.5 text-[11.5px] text-success-soft">đã restart</div>
                                    ) : note ? (
                                        <div className="mt-0.5 text-[11.5px] text-warning-soft">{note}</div>
                                    ) : null}
                                    {error ? (
                                        <div data-restart-error className="mt-0.5 text-[11.5px] text-error">
                                            {error}
                                        </div>
                                    ) : null}
                                </div>
                            </label>
                        );
                    })}
                </div>
                {notApplied ? (
                    <div data-restart-error className="mt-3 text-[12px] leading-[1.5] text-error">
                        {notApplied}
                    </div>
                ) : null}
                <div className="mt-3 text-[12px] leading-[1.5] text-muted">
                    Terminal đang mở vẫn dùng account cũ cho tới khi mở lại.
                </div>
                <div className="mt-[18px] flex justify-end gap-2.5">
                    <DialogButton variant="secondary" hint="esc" onClick={close}>
                        Để sau
                    </DialogButton>
                    <DialogButton
                        variant="primary"
                        disabled={busy || pending.length === 0}
                        onClick={() => void restart()}
                    >
                        Restart đã chọn
                    </DialogButton>
                </div>
            </div>
        </ModalShell>
    );
}

ClaudeAccountRestartModal.displayName = "ClaudeAccountRestartModal";
