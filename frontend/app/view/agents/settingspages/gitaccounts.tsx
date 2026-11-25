// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → Agents → GitHub accounts: each account is tied to one or more root folders, and a repo under a root
// commits with that account's name and email and pushes with its token, wherever git runs. The card draws the list
// the gitaccount RPCs keep (pkg/gitaccount); the rows, token texts, dialog steps and fix list are the pure
// view/agents/gitaccounts.ts. The card makes three kinds of call: the local list, then (after it has drawn) each
// account's token state and one scan of the roots, both of which reach out and may be slow. No token ever comes
// back over the wire.

import { springReveal } from "@/app/element/motiontokens";
import { usePartMotion } from "@/app/element/springbatch";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { Ellipsis, Folder, TriangleAlert } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
    credentialsStripLogin,
    credentialsText,
    emailOk,
    fixAllowed,
    fixDisabledReason,
    fixRows,
    GIT_RPC_OPTS,
    gitRows,
    helperText,
    leakText,
    needsDefaultLogin,
    NO_FOLDER,
    repoCountText,
    scanErrorText,
    scanFor,
    tokenStateText,
    tokenView,
    type AddMode,
    type FixRow,
    type GitRow,
    type ScanStatus,
    type Tone,
} from "../gitaccounts";
import { CardFooter, Note, RowInlineInput, SettingCard } from "../settingsui";
import { FolderField, GitAccountAddModal } from "./gitaccountaddmodal";
import { GitAccountFixModal } from "./gitaccountfixmodal";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

const DOT: Record<Tone, string> = {
    ok: "bg-success",
    warn: "bg-warning",
    error: "bg-error",
    muted: "bg-ink-faint",
};

type AddState = { mode: AddMode; login?: string } | null;
type FixState = { login: string; rows: FixRow[] } | null;
type Editing = { kind: "rename" | "email" | "default" | "root"; id: string } | null;

export function GitAccountsCard() {
    const [list, setList] = useState<GitAccountListRtnData | null>(null);
    // the token state each account's check came back with; no entry = the check has not come back yet
    const [tokens, setTokens] = useState<Record<string, GitAccountTokenStateData>>({});
    const [scan, setScan] = useState<GitAccountScanRtnData | null>(null);
    const [scanStatus, setScanStatus] = useState<ScanStatus>("running");
    const [scanError, setScanError] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing>(null);
    const [rootDraft, setRootDraft] = useState("");
    const [add, setAdd] = useState<AddState>(null);
    const [fix, setFix] = useState<FixState>(null);
    const row = usePartMotion(springReveal);
    // a scan that is overtaken by a newer one is dropped, so a slow walk never overwrites a fresh answer
    const scanSeq = useRef(0);

    const loadList = async (): Promise<GitAccountListRtnData | null> => {
        try {
            const next = await RpcApi.GitAccountListCommand(TabRpcClient);
            setList(next);
            return next;
        } catch (e) {
            setError(`Couldn't read the GitHub accounts: ${errorText(e)}`);
            return null;
        }
    };
    const loadTokens = (logins: string[]) => {
        setTokens((prev) => Object.fromEntries(Object.entries(prev).filter(([l]) => !logins.includes(l))));
        for (const login of logins) {
            fireAndForget(async () => {
                let state: GitAccountTokenStateData;
                try {
                    state = await RpcApi.GitAccountTokenStateCommand(TabRpcClient, { login }, GIT_RPC_OPTS);
                } catch (e) {
                    state = { state: "failed", detail: errorText(e) };
                }
                setTokens((prev) => ({ ...prev, [login]: state }));
            });
        }
    };
    const loadScan = () =>
        fireAndForget(async () => {
            const seq = ++scanSeq.current;
            setScanStatus("running");
            setScanError(null);
            try {
                const next = await RpcApi.GitAccountScanCommand(TabRpcClient, GIT_RPC_OPTS);
                if (seq === scanSeq.current) {
                    setScan(next);
                    setScanStatus("done");
                }
            } catch (e) {
                if (seq === scanSeq.current) {
                    setScanError(errorText(e));
                    setScanStatus("failed");
                }
            }
        });

    // the card draws from the local list first; the checks that reach out follow, once each per mount
    useEffect(() => {
        fireAndForget(async () => {
            const first = await loadList();
            if (first != null) {
                loadTokens(first.accounts.map((a) => a.login));
                loadScan();
            }
        });
    }, []);

    // run one change, show what it lost when it fails, and refresh what it moved
    const act = (call: () => Promise<unknown>, then: (() => void) | null) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await call();
            } catch (e) {
                setError(errorText(e));
                return;
            } finally {
                setEditing(null);
            }
            await loadList();
            then?.();
        });

    const rename = (login: string, name: string) =>
        act(() => RpcApi.GitAccountUpdateCommand(TabRpcClient, { login, name }), null);
    const changeEmail = (login: string, email: string) => {
        if (!emailOk(email)) {
            setEditing(null);
            setError(`"${email}" is not an email address.`);
            return;
        }
        act(() => RpcApi.GitAccountUpdateCommand(TabRpcClient, { login, email }), null);
    };
    const setDefault = (login: string) => act(() => RpcApi.GitAccountSetDefaultCommand(TabRpcClient, { login }), null);
    const addRoot = (login: string, root: string) => {
        if (root.trim() === "") {
            setEditing(null);
            return;
        }
        act(() => RpcApi.GitAccountAddRootCommand(TabRpcClient, { login, root: root.trim() }), loadScan);
    };
    const removeRoot = (login: string, root: string) =>
        act(() => RpcApi.GitAccountRemoveRootCommand(TabRpcClient, { login, root }), loadScan);
    const removeAccount = (login: string) =>
        modalsModel.pushModal("ConfirmModal", {
            title: "Remove account",
            message: `Remove "${login}" from this machine? Its token is deleted from the credential store, and its folders go back to the default account. Repos keep their remote URLs as they are.`,
            confirmLabel: "Remove",
            destructive: true,
            onConfirm: () =>
                act(
                    () => RpcApi.GitAccountRemoveCommand(TabRpcClient, { login }),
                    () => {
                        setTokens((prev) => Object.fromEntries(Object.entries(prev).filter(([l]) => l !== login)));
                        loadScan();
                    }
                ),
        });

    const startRoot = (login: string) => {
        setRootDraft("");
        setEditing({ kind: "root", id: login });
    };
    const showAccountMenu = (login: string, roots: string[], e: React.MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            [
                { label: "Rename", click: () => setEditing({ kind: "rename", id: login }) },
                { label: "Change email", click: () => setEditing({ kind: "email", id: login }) },
                { label: "Replace token", click: () => setAdd({ mode: "token", login }) },
                { type: "separator" },
                { label: "Add folder", click: () => startRoot(login) },
                ...(roots.length > 0
                    ? [
                          {
                              label: "Remove folder",
                              type: "submenu" as const,
                              submenu: roots.map((r) => ({ label: r, click: () => removeRoot(login, r) })),
                          },
                      ]
                    : []),
                { type: "separator" },
                { label: "Remove account", danger: true, click: () => removeAccount(login) },
            ],
            e
        );
    const showDefaultMenu = (e: React.MouseEvent) =>
        ContextMenuModel.getInstance().showContextMenu(
            [{ label: "Change default login", click: () => setEditing({ kind: "default", id: "default" }) }],
            e
        );
    // + Add folder in the footer: with one account it is that account's, otherwise the person picks
    const footerAddFolder = (e: React.MouseEvent) => {
        const accounts = list?.accounts ?? [];
        if (accounts.length === 1) {
            startRoot(accounts[0].login);
            return;
        }
        ContextMenuModel.getInstance().showContextMenu(
            accounts.map((a) => ({ label: a.login, click: () => startRoot(a.login) })),
            e
        );
    };

    const empty = list != null && list.accounts.length === 0;
    // no account yet: the card is one line, not a Default row beside nothing
    const rows = list == null || empty ? [] : gitRows(list);
    const credentialsLines = scan?.credentialslines ?? 0;
    // the one account row that carries the strip when ~/.git-credentials is all there is to fix
    const credentialsLogin = credentialsStripLogin(list, scan);

    const openFix = (login: string) => setFix({ login, rows: fixRows(scanFor(scan, login), credentialsLines) });

    const draw = (r: GitRow, i: number) => {
        const login = r.login;
        const account = r.kind === "account" ? r : null;
        const s = account == null ? null : scanFor(scan, login);
        const view = account == null ? null : tokenView(tokens[login]);
        const token = view == null ? null : tokenStateText(view);
        const fixable = fixRows(s, credentialsLines);
        const leaks = account != null && scanStatus === "done" ? leakText(s, account.roots) : "";
        const credentialsOnly = leaks === "" && account != null && scanStatus === "done" && login === credentialsLogin;
        const strip = credentialsOnly ? credentialsText(credentialsLines) : leaks;
        const edit = editing?.id === r.id ? editing.kind : null;
        return (
            <motion.div key={r.id} {...row} className="overflow-hidden">
                {/* the rule and the padding sit on the inner box: a box folded to height 0 cannot be shorter than its padding */}
                <div data-git-account-row={r.id} className={cn(i > 0 && "border-t border-edge-mid")}>
                    <div className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex min-h-[20px] flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="truncate text-[13px] font-semibold text-primary">{r.label}</span>
                                {account == null ? (
                                    <span className="rounded bg-pill px-1.5 text-[11px] text-ink-mid">Default</span>
                                ) : null}
                                {account != null && edit === "rename" ? (
                                    <RowInlineInput
                                        initial={account.name}
                                        placeholder="Commit name"
                                        label="Commit name"
                                        attrs={{ "data-git-account-rename-input": login }}
                                        onCommit={(v) => rename(login, v)}
                                        onCancel={() => setEditing(null)}
                                    />
                                ) : account != null && edit === "email" ? (
                                    <RowInlineInput
                                        initial={account.address}
                                        placeholder="name@example.com"
                                        label="Commit email"
                                        attrs={{ "data-git-account-email-input": login }}
                                        onCommit={(v) => changeEmail(login, v)}
                                        onCancel={() => setEditing(null)}
                                    />
                                ) : account == null && edit === "default" ? (
                                    <RowInlineInput
                                        initial={login}
                                        placeholder="GitHub login"
                                        label="Default GitHub login"
                                        attrs={{ "data-git-default-input": "" }}
                                        onCommit={(v) => setDefault(v)}
                                        onCancel={() => setEditing(null)}
                                    />
                                ) : r.email !== "" ? (
                                    <span className="truncate text-[11.5px] text-muted">{r.email}</span>
                                ) : null}
                            </div>
                            <div className="mt-[7px] flex flex-wrap items-center gap-x-[18px] gap-y-1 text-[11.5px] text-muted">
                                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                                    <Folder size={13} strokeWidth={1.8} aria-hidden className="flex-none" />
                                    {account == null ? (
                                        <span className="text-ink-mid">Every other folder</span>
                                    ) : account.roots.length === 0 ? (
                                        <span data-git-account-root="" className="text-ink-mid">
                                            {NO_FOLDER}
                                        </span>
                                    ) : (
                                        account.roots.map((root) => (
                                            <span
                                                key={root}
                                                data-git-account-root={root}
                                                className="truncate text-ink-mid"
                                            >
                                                {root}
                                            </span>
                                        ))
                                    )}
                                </span>
                                {account == null ? (
                                    <span className="flex items-center gap-1.5">
                                        <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-ink-faint" />
                                        <span data-git-default-helper="">
                                            {helperText(r.kind === "default" ? r.helper : "")}
                                        </span>
                                    </span>
                                ) : token != null && view != null ? (
                                    <>
                                        <span
                                            data-git-account-token={login}
                                            data-state={view}
                                            className="flex items-center gap-1.5"
                                        >
                                            <span
                                                aria-hidden
                                                className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT[token.tone])}
                                            />
                                            <span title={tokens[login]?.detail}>{token.text}</span>
                                        </span>
                                        <span data-git-account-repos={login} className="tabular-nums">
                                            {repoCountText(scanStatus, s)}
                                        </span>
                                    </>
                                ) : null}
                            </div>
                            {editing?.kind === "root" && editing.id === r.id ? (
                                <div className="mt-2 max-w-[420px]">
                                    <FolderField
                                        value={rootDraft}
                                        onChange={setRootDraft}
                                        onEnter={() => addRoot(login, rootDraft)}
                                        onEscape={() => setEditing(null)}
                                        onError={setError}
                                        attrs={{ "data-git-root-input": login }}
                                        placeholder="/path/to/a/folder"
                                        title={`Select a folder for ${login}`}
                                        autoFocus
                                    />
                                </div>
                            ) : null}
                        </div>
                        <button
                            type="button"
                            data-git-account-menu={r.id}
                            aria-label={`${r.label} actions`}
                            onClick={(e) =>
                                account != null ? showAccountMenu(login, account.roots, e) : showDefaultMenu(e)
                            }
                            className="-my-0.5 flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-edge-mid hover:text-primary"
                        >
                            <Ellipsis size={14} aria-hidden />
                        </button>
                    </div>
                    {strip !== "" && view != null ? (
                        <div
                            data-git-account-leaks={login}
                            data-git-account-leaks-kind={credentialsOnly ? "credentials" : undefined}
                            className="flex items-center gap-3 border-t border-edge-mid bg-askingbg px-4 py-2.5"
                        >
                            <TriangleAlert size={14} aria-hidden className="flex-none text-warning" />
                            <span className="min-w-0 flex-1 text-[12px] leading-[1.5] text-warning-soft">{strip}</span>
                            <button
                                type="button"
                                data-git-account-fix={login}
                                disabled={!fixAllowed(view, fixable)}
                                title={fixDisabledReason(view, fixable)}
                                onClick={() => openFix(login)}
                                className="flex-none cursor-pointer rounded border border-edge-mid bg-surface-raised px-2.5 py-1 text-[12px] text-secondary transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
                            >
                                {credentialsOnly
                                    ? "Review file"
                                    : (s?.tokenrepos?.length ?? 0) > 0
                                      ? "Remove tokens from URLs"
                                      : "Review repos"}
                            </button>
                        </div>
                    ) : null}
                </div>
            </motion.div>
        );
    };

    return (
        <SettingCard
            id="gitaccounts"
            label="GitHub accounts"
            footer={
                <CardFooter>
                    <button
                        type="button"
                        data-git-account-add=""
                        onClick={() => setAdd({ mode: "add" })}
                        className="cursor-pointer rounded text-[12px] font-semibold text-secondary transition-colors hover:text-primary"
                    >
                        + Add account
                    </button>
                    {list != null && !empty ? (
                        <>
                            <button
                                type="button"
                                data-git-account-add-root=""
                                onClick={footerAddFolder}
                                className="ml-3 cursor-pointer rounded text-[12px] font-semibold text-secondary transition-colors hover:text-primary"
                            >
                                + Add folder
                            </button>
                            <span className="flex-1" />
                            <span className="text-[11.5px] text-muted">
                                Name, email and token follow the folder a repo is in.
                            </span>
                        </>
                    ) : null}
                </CardFooter>
            }
        >
            {empty ? (
                <div data-git-accounts-empty="" className="px-4 py-3 text-[13px] leading-[1.55] text-ink-mid">
                    Tie a GitHub account to a folder: every repo under it commits with that account's name and email and
                    pushes with its token, in any terminal, with or without arcterm running.
                </div>
            ) : null}
            {list != null ? <AnimatePresence initial={false}>{rows.map(draw)}</AnimatePresence> : null}
            {scanStatus === "failed" || scanErrorText(scan) !== "" ? (
                <div data-git-accounts-scan-error="" className="px-4 pb-3">
                    <Note tone="warning">
                        <span>
                            {scanStatus === "failed"
                                ? `Couldn't scan the folders for repos: ${scanError}. Repo counts and fixes wait for a scan.`
                                : `The scan skipped some folders: ${scanErrorText(scan)}`}
                        </span>
                    </Note>
                </div>
            ) : null}
            {error ? (
                <div data-git-accounts-error="" className="px-4 pb-3">
                    <Note tone="error">
                        <span>{error}</span>
                    </Note>
                </div>
            ) : null}
            {add != null ? (
                <GitAccountAddModal
                    mode={add.mode}
                    login={add.login}
                    needsDefault={needsDefaultLogin(list)}
                    onClose={() => setAdd(null)}
                    onDone={(login) =>
                        fireAndForget(async () => {
                            await loadList();
                            loadTokens([login]);
                            if (add.mode === "add") {
                                loadScan();
                            }
                        })
                    }
                />
            ) : null}
            {fix != null ? (
                <GitAccountFixModal
                    login={fix.login}
                    rows={fix.rows}
                    onClose={() => setFix(null)}
                    onApplied={loadScan}
                />
            ) : null}
        </SettingCard>
    );
}
