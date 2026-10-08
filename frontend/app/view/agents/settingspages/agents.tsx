// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Agents: the Claude subscription new agents run on, the route new runs take, and the flags every
// launch starts with.

import { ContextMenuModel } from "@/app/store/contextmenu";
import { getSettingsKeyAtom } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Ellipsis } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { AgentsViewModel } from "../agents";
import { defaultAccountName, knownClaudeEmails, quotaLine, restartCandidates, rowQuota } from "../claudeaccount";
import { harnessPreferenceAtom, leadRuntimesAtom, setPreferredRoute } from "../harnessstore";
import { RUNTIME_FLAGS, type Runtime } from "../launch";
import { naFlagsAtom, naRememberFlagsAtom } from "../naflagsstore";
import {
    claudeIdentityAtom,
    claudeQuotaKey,
    identityFromList,
    savedRateLimitsAtom,
    setClaudeIdentity,
} from "../ratelimitstore";
import { RoutePicker } from "../routepicker";
import { flagRowId } from "../settingsmodel";
import { FLAG_RUNTIMES, Note, Segmented, SettingCard, SettingRow, Toggle, writeConfig } from "../settingsui";

export function AgentsPage({
    model,
    runtime,
    onRuntime,
}: {
    model: AgentsViewModel;
    runtime: Runtime;
    onRuntime: (r: Runtime) => void;
}) {
    return (
        <>
            <SettingCard id="claudeaccount" label="Claude account">
                <ClaudeAccountList model={model} />
            </SettingCard>
            <SettingCard id="runs" label="Runs">
                <RunRouteRow />
            </SettingCard>
            <SettingCard id="flags" label="Launch flags">
                <LaunchFlagRows runtime={runtime} onRuntime={onRuntime} />
            </SettingCard>
        </>
    );
}

function LaunchFlagRows({ runtime, onRuntime }: { runtime: Runtime; onRuntime: (r: Runtime) => void }) {
    const [flags, setFlags] = useAtom(naFlagsAtom);
    const [remember, setRemember] = useAtom(naRememberFlagsAtom);
    const catalog = RUNTIME_FLAGS[runtime];
    const runtimeFlags = flags[runtime] ?? {};
    const setFlag = (id: string, on: boolean) =>
        setFlags((prev) => ({ ...prev, [runtime]: { ...prev[runtime], [id]: on } }));
    return (
        <>
            <SettingRow id="newagent.remember">
                <Toggle on={remember} onToggle={() => setRemember((v) => !v)} label="Remember flags" />
            </SettingRow>
            <SettingRow id="newagent.runtime">
                <Segmented
                    options={FLAG_RUNTIMES.map((r) => ({ id: r.id, label: r.name }))}
                    value={runtime}
                    onChange={onRuntime}
                />
            </SettingRow>
            {catalog.length === 0 ? (
                <div className="border-t border-edge-mid px-4 py-3 text-[12px] text-muted">
                    {FLAG_RUNTIMES.find((r) => r.id === runtime)?.name} takes no launch flags.
                </div>
            ) : (
                catalog.map((f) => {
                    const on = !!runtimeFlags[f.id];
                    return (
                        <SettingRow key={f.id} id={flagRowId(runtime, f.id)}>
                            <Toggle on={on} onToggle={() => setFlag(f.id, !on)} label={f.flag} />
                        </SettingRow>
                    );
                })
            )}
        </>
    );
}

function RunRouteRow() {
    const preference = useAtomValue(harnessPreferenceAtom);
    const leadRuntimes = useAtomValue(leadRuntimesAtom);
    return (
        <>
            <SettingRow id="run.route">
                <RoutePicker
                    value={preference.route}
                    canInherit={false}
                    runtimes={leadRuntimes}
                    onChange={(route) => route && setPreferredRoute(route)}
                />
            </SettingRow>
            {preference.error ? (
                <div className="px-4 pb-3">
                    <Note tone="error">{preference.error}</Note>
                </div>
            ) : null}
        </>
    );
}

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

// shell-side: the dialog embeds CockpitFocusPane, which view/agents must not import statically
const ClaudeSigninModal = lazy(() =>
    import("@/app/cockpit/claude-signin-modal").then((m) => ({ default: m.ClaudeSigninModal }))
);

// A row's in-place field (rename, or the email to tie the account to): Enter commits, Esc cancels, and a blur
// commits what was typed, or cancels when there is nothing new. Its clicks and keys never reach the row, so
// they never select it.
function RowInlineInput({
    initial,
    placeholder,
    label,
    attrs,
    onCommit,
    onCancel,
}: {
    initial: string;
    placeholder: string;
    label: string;
    attrs: Record<string, string>;
    onCommit: (v: string) => void;
    onCancel: () => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState(initial);
    const done = useRef(false);
    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);
    // the unmount that follows a finish can blur the field once more
    const finish = (commit: boolean) => {
        if (done.current) {
            return;
        }
        done.current = true;
        const next = draft.trim();
        if (commit && next !== "" && next !== initial) {
            onCommit(next);
        } else {
            onCancel();
        }
    };
    return (
        <input
            ref={ref}
            type="text"
            {...attrs}
            value={draft}
            placeholder={placeholder}
            aria-label={label}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => finish(true)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                    e.preventDefault();
                    finish(true);
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    finish(false);
                }
            }}
            className="w-[220px] max-w-full rounded border border-edge-mid bg-surface px-2.5 py-[4px] text-[12px] font-normal text-primary outline-none focus:border-accent-700"
        />
    );
}

// The account list and the tokens live behind the claudeaccount RPCs, not in settings; only the active
// id is a setting (claude:activeaccount). wavesrv applies that setting to its own environment before it
// broadcasts the change, so re-listing whenever the setting moves reads back what was actually applied —
// `active` falls back to Default when the account's token is gone, and the radios show that, not the
// setting.
function ClaudeAccountList({ model }: { model: AgentsViewModel }) {
    const setting = (useAtomValue(getSettingsKeyAtom("claude:activeaccount")) as string) ?? "";
    const saved = useAtomValue(savedRateLimitsAtom);
    const identity = useAtomValue(claudeIdentityAtom);
    const [list, setList] = useState<CommandClaudeAccountListRtnData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signinOpen, setSigninOpen] = useState(false);
    // the account whose name is an input now, and the one whose "Other email…" input is open
    const [renaming, setRenaming] = useState<string | null>(null);
    const [emailing, setEmailing] = useState<string | null>(null);
    const known = useMemo(() => knownClaudeEmails(saved, identity), [saved, identity]);

    const reload = () =>
        fireAndForget(async () => {
            try {
                const next = await RpcApi.ClaudeAccountListCommand(TabRpcClient);
                setList(next);
                // snapshots are filed under the accounts' emails: every add, rename, remove and set-email
                // lands here, so the rest of the app learns the new identity too
                setClaudeIdentity(identityFromList(next));
            } catch (e) {
                setError(errorText(e));
            }
        });
    useEffect(() => {
        reload();
    }, [setting]);

    const active = list?.active ?? null;
    const select = (id: string) => {
        if (id === active) {
            return;
        }
        setError(null);
        writeConfig({ "claude:activeaccount": id });
        setList((prev) => (prev == null ? prev : { ...prev, active: id }));
        const candidates = restartCandidates(globalStore.get(model.agentsAtom), id);
        if (candidates.length > 0) {
            const accountName =
                id === ""
                    ? defaultAccountName(identity.loginEmail)
                    : (list?.accounts.find((a) => a.id === id)?.label ?? id);
            modalsModel.pushModal("ClaudeAccountRestartModal", { candidates, account: id, accountName });
        }
    };
    const rename = (id: string, label: string) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.ClaudeAccountRenameCommand(TabRpcClient, { id, label });
            } catch (e) {
                setError(errorText(e));
            }
            reload();
        });
    const setEmail = (id: string, email: string) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.ClaudeAccountSetEmailCommand(TabRpcClient, { id, email });
            } catch (e) {
                setError(errorText(e));
            }
            reload();
        });
    // the backend switches to Default first when the account is the active one
    const remove = (a: ClaudeAccountData) =>
        modalsModel.pushModal("ConfirmModal", {
            title: "Remove account",
            message: `Remove "${a.label}" from this machine? Its token is deleted with it.${a.id === active ? " New agents will run on your /login account." : ""}`,
            confirmLabel: "Remove",
            destructive: true,
            onConfirm: () =>
                fireAndForget(async () => {
                    setError(null);
                    try {
                        await RpcApi.ClaudeAccountRemoveCommand(TabRpcClient, { id: a.id });
                    } catch (e) {
                        setError(errorText(e));
                    }
                    reload();
                }),
        });
    const showAccountMenu = (a: ClaudeAccountData, e: React.MouseEvent) => {
        const current = (a.email ?? "").toLowerCase();
        // an email typed under "Other email…" that arcterm has not seen still gets its check
        const emails = current === "" || known.includes(current) ? known : [...known, current].sort();
        const items: ContextMenuItem[] = [
            { label: "Rename", click: () => setRenaming(a.id) },
            {
                label: "Same account as…",
                type: "submenu",
                submenu: [
                    ...emails.map((email) => ({
                        label: email,
                        type: "checkbox" as const,
                        checked: email.toLowerCase() === current,
                        click: () => setEmail(a.id, email),
                    })),
                    ...(emails.length > 0 ? [{ type: "separator" as const }] : []),
                    { label: "Other email…", click: () => setEmailing(a.id) },
                    {
                        label: "None",
                        type: "checkbox" as const,
                        checked: current === "",
                        click: () => setEmail(a.id, ""),
                    },
                ],
            },
            { type: "separator" },
            { label: "Remove", danger: true, click: () => remove(a) },
        ];
        ContextMenuModel.getInstance().showContextMenu(items, e);
    };

    const now = Date.now();
    const rows: { id: string; account?: ClaudeAccountData }[] = [
        { id: "" },
        ...(list?.accounts ?? []).map((a) => ({ id: a.id, account: a })),
    ];
    return (
        <div className="p-3">
            <div role="radiogroup" aria-label="claude account" className="flex flex-col gap-1.5">
                {rows.map(({ id, account }) => {
                    const on = id === active;
                    const quota = quotaLine(rowQuota(saved, claudeQuotaKey(id, identity), now), now);
                    return (
                        <div
                            key={id || "default"}
                            role="radio"
                            aria-checked={on}
                            tabIndex={0}
                            data-claude-account-row={id || "default"}
                            onClick={() => select(id)}
                            onKeyDown={(e) => {
                                if (e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) {
                                    e.preventDefault();
                                    select(id);
                                }
                            }}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border p-[10px] text-left transition-colors",
                                on ? "border-accent-700 bg-surface-hover" : "border-border hover:border-edge-strong"
                            )}
                        >
                            <span
                                className={cn(
                                    "flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 transition-colors",
                                    on ? "border-accent" : "border-edge-strong"
                                )}
                            >
                                {on ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                {account != null && renaming === id ? (
                                    <RowInlineInput
                                        initial={account.label}
                                        placeholder="Account name"
                                        label="Account name"
                                        attrs={{ "data-claude-account-rename-input": id }}
                                        onCommit={(v) => {
                                            setRenaming(null);
                                            rename(id, v);
                                        }}
                                        onCancel={() => setRenaming(null)}
                                    />
                                ) : (
                                    <span
                                        data-claude-account-name={id || "default"}
                                        className={cn(
                                            "truncate text-[13px] font-semibold",
                                            on ? "text-primary" : "text-secondary"
                                        )}
                                    >
                                        {account == null ? defaultAccountName(identity.loginEmail) : account.label}
                                        {account == null ? (
                                            <span
                                                data-claude-account-login-tag
                                                className="ml-1.5 rounded border border-edge-mid px-1 align-middle text-[10.5px] font-normal text-muted"
                                            >
                                                /login
                                            </span>
                                        ) : null}
                                    </span>
                                )}
                                {account != null && emailing === id ? (
                                    <RowInlineInput
                                        initial=""
                                        placeholder="name@example.com"
                                        label="Account email"
                                        attrs={{ "data-claude-account-email-input": id }}
                                        onCommit={(v) => {
                                            setEmailing(null);
                                            setEmail(id, v);
                                        }}
                                        onCancel={() => setEmailing(null)}
                                    />
                                ) : account?.email ? (
                                    <span data-claude-account-email={id} className="truncate text-[11px] text-muted">
                                        {account.email}
                                    </span>
                                ) : null}
                            </span>
                            <span
                                data-claude-account-quota={id || "default"}
                                className={cn(
                                    "flex-none text-[11px] tabular-nums",
                                    quota.warn ? "text-warning" : "text-muted"
                                )}
                            >
                                {quota.text}
                            </span>
                            {account != null ? (
                                <button
                                    type="button"
                                    data-claude-account-menu={id}
                                    aria-label="Account actions"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        showAccountMenu(account, e);
                                    }}
                                    className="flex h-6 w-6 flex-none cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                                >
                                    <Ellipsis size={14} aria-hidden />
                                </button>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <div className="mt-3">
                <button
                    type="button"
                    data-claude-account-add
                    onClick={() => setSigninOpen(true)}
                    className="cursor-pointer rounded border border-edge-mid px-3 py-[6px] text-[12px] font-semibold text-secondary transition-colors hover:border-edge-strong hover:text-primary"
                >
                    + Add account
                </button>
            </div>
            {error ? <Note tone="error">{error}</Note> : null}
            {signinOpen ? (
                <Suspense fallback={null}>
                    <ClaudeSigninModal onClose={() => setSigninOpen(false)} onAdded={reload} />
                </Suspense>
            ) : null}
        </div>
    );
}
