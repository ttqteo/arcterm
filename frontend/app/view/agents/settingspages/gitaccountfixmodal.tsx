// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → GitHub accounts → the warning strip's fix button: every repo the fix would change, each with a tick to
// clear, and one Apply. Token rows (a token in the remote URL) and the ~/.git-credentials row start ticked; a repo
// whose own name or email differs from the account starts unticked, since it may be on purpose. Apply sends the
// ticked paths in one call; the backend backs each config up first and reports a result per row, so a failure on one
// repo shows on its row and the rest are fixed. The modal then stays open with those results until Close.

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { cn } from "@/util/util";
import { useState } from "react";
import { defaultTicks, fixPayload, fixResultsByKey, GIT_RPC_OPTS, type FixRow } from "../gitaccounts";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

const KIND_NOTE: Record<FixRow["kind"], string> = {
    token: "Remove the token from its remote URL",
    identity: "Unset the repo's own name and email",
    credentials: "Delete the github.com lines",
};

export function GitAccountFixModal({
    login,
    rows,
    onClose,
    onApplied,
}: {
    login: string;
    rows: FixRow[];
    onClose: () => void;
    // after a fix call came back (some rows may have failed): the card rescans
    onApplied: () => void;
}) {
    const [ticked, setTicked] = useState<Set<string>>(() => defaultTicks(rows));
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<Map<string, GitFixResultData> | null>(null);
    const [error, setError] = useState<string | null>(null);

    const toggle = (key: string) =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });
    const count = ticked.size;
    const failed = results == null ? 0 : [...results.values()].filter((r) => (r.error ?? "") !== "").length;

    const apply = async () => {
        if (busy || results != null || count === 0) {
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const rtn = await RpcApi.GitAccountFixCommand(TabRpcClient, fixPayload(login, rows, ticked), GIT_RPC_OPTS);
            setResults(fixResultsByKey(rtn.results ?? []));
            onApplied();
        } catch (e) {
            // a refusal (the token is gone or refused) changes nothing: the list stays as it was
            setError(errorText(e));
        }
        setBusy(false);
    };

    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={() => void apply()}
            dismissOnBackdrop={false}
            className="w-full max-w-[640px]"
        >
            <div data-git-fix-modal="" data-login={login} className="flex flex-col px-[22px] pt-[22px] pb-[18px]">
                <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                    Fix repos for {login}
                </h2>
                <div className="mt-[7px] text-[13px] leading-[1.55] text-ink-mid">
                    {results == null
                        ? "Clear a tick to leave that one as it is. arcterm saves a copy of each file before it changes it."
                        : failed > 0
                          ? `${failed} failed. The rest are fixed.`
                          : "Everything ticked is fixed."}
                </div>
                <div className="mt-3 max-h-[360px] overflow-y-auto rounded border border-edge-mid">
                    {rows.map((r, i) => {
                        const result = results?.get(r.key);
                        const failedRow = result != null && (result.error ?? "") !== "";
                        return (
                            <label
                                key={r.key}
                                data-git-fix-row={r.key}
                                className={cn(
                                    "flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-surface-hover",
                                    i > 0 && "border-t border-edge-mid",
                                    results != null && "cursor-default hover:bg-transparent"
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={ticked.has(r.key)}
                                    disabled={busy || results != null}
                                    onChange={() => toggle(r.key)}
                                    aria-label={`${KIND_NOTE[r.kind]}: ${r.title}`}
                                    className="mt-[3px] shrink-0 accent-accent"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[13px] text-primary" title={r.title}>
                                        {r.title}
                                    </div>
                                    <div className="truncate text-[11.5px] text-muted" title={r.detail}>
                                        {r.detail}
                                    </div>
                                    {result != null ? (
                                        <div
                                            data-git-fix-result={r.key}
                                            data-ok={failedRow ? "false" : "true"}
                                            className={cn(
                                                "mt-0.5 text-[11.5px]",
                                                failedRow ? "text-error" : "text-success-soft"
                                            )}
                                        >
                                            {failedRow ? result.error : "Fixed"}
                                        </div>
                                    ) : (
                                        <div className="text-[11.5px] text-ink-faint">{KIND_NOTE[r.kind]}</div>
                                    )}
                                </div>
                            </label>
                        );
                    })}
                </div>
                {error ? (
                    <div data-git-fix-error="" className="mt-3 text-[12px] leading-[1.55] text-error">
                        {error}
                    </div>
                ) : null}
                <div className="flex justify-end gap-2.5 pt-[18px]">
                    <DialogButton variant="secondary" hint={formatChordString("Escape")} onClick={onClose}>
                        {results == null ? "Cancel" : "Close"}
                    </DialogButton>
                    {results == null ? (
                        <DialogButton
                            variant="primary"
                            data-git-fix-apply=""
                            disabled={busy || count === 0}
                            onClick={() => void apply()}
                        >
                            {busy ? "Fixing…" : `Fix ${count} ${count === 1 ? "item" : "items"}`}
                        </DialogButton>
                    ) : null}
                </div>
            </div>
        </ModalShell>
    );
}

GitAccountFixModal.displayName = "GitAccountFixModal";
