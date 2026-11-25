// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → GitHub accounts → "+ Add account" and ⋯ → "Replace token". One dialog, two modes. "add" asks for the
// login and a token, checks it with GitHub, then asks for the commit email, the first folder and (for the first
// account) the machine's default login, and saves. "token" has the login fixed and asks for the token only: a good
// check stores it. The steps are the pure addStep (view/agents/gitaccounts.ts). A refused check stays on the token
// step with its reason; no token comes back from the backend, and the dialog clears its field once it is stored.

import { DialogButton } from "@/app/modals/dialogbutton";
import { ModalShell } from "@/app/modals/modalshell";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { formatChordString } from "@/util/keysym";
import { useReducer, useState } from "react";
import {
    addPayload,
    addStep,
    addStepInit,
    canCheck,
    canSave,
    GIT_RPC_OPTS,
    type AddAction,
    type AddForm,
    type AddMode,
    type AddStep,
} from "../gitaccounts";

function errorText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

const FIELD_CLASS =
    "rounded border border-edge-mid bg-surface-raised px-2.5 py-[6px] text-[13px] text-primary outline-none focus:border-accent-700";

// The native OS folder picker (Tauri dialog plugin), loaded on use so a non-Tauri context (preview, vitest) stays
// clean. The browser build has no picker: its stand-in resolves nothing, and the field is what a person types into.
export async function pickFolder(title: string): Promise<string | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title });
    return typeof picked === "string" && picked !== "" ? picked : null;
}

// A path field with a Browse… button. `attrs` lands on the input (the data-* hooks the scenarios type into).
export function FolderField({
    value,
    onChange,
    onEnter,
    onEscape,
    onError,
    attrs,
    placeholder,
    autoFocus,
    title,
    readOnly,
}: {
    value: string;
    onChange: (v: string) => void;
    onEnter?: () => void;
    onEscape?: () => void;
    onError: (message: string) => void;
    attrs: Record<string, string>;
    placeholder: string;
    autoFocus?: boolean;
    title: string;
    readOnly?: boolean;
}) {
    const browse = async () => {
        try {
            const picked = await pickFolder(title);
            if (picked != null) {
                onChange(picked);
            }
        } catch (e) {
            onError(`The folder picker failed: ${errorText(e)}`);
        }
    };
    return (
        <div className="flex min-w-0 items-center gap-2">
            <input
                type="text"
                {...attrs}
                autoFocus={autoFocus}
                value={value}
                readOnly={readOnly}
                placeholder={placeholder}
                aria-label={title}
                spellCheck={false}
                onChange={(e) => onChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        e.preventDefault();
                        onEnter?.();
                    } else if (e.key === "Escape" && onEscape != null) {
                        e.preventDefault();
                        onEscape();
                    }
                }}
                className={`min-w-0 flex-1 ${FIELD_CLASS}`}
            />
            <button
                type="button"
                disabled={readOnly}
                onClick={() => void browse()}
                className="flex-none cursor-pointer rounded text-[12px] font-semibold text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
            >
                Browse…
            </button>
        </div>
    );
}

export function GitAccountAddModal({
    mode,
    login: fixedLogin,
    needsDefault,
    onClose,
    onDone,
}: {
    mode: AddMode;
    // Replace token: the account whose token this is
    login?: string;
    // the first account also asks which login git uses outside every root
    needsDefault: boolean;
    onClose: () => void;
    // the login that was added (or whose token was replaced), for the card to refresh from
    onDone: (login: string) => void;
}) {
    const [step, dispatch] = useReducer<AddStep, [AddAction]>(addStep, addStepInit);
    const [form, setForm] = useState<AddForm>({
        login: fixedLogin ?? "",
        token: "",
        email: "",
        root: "",
        defaultLogin: "",
    });
    const set = (patch: Partial<AddForm>) => setForm((f) => ({ ...f, ...patch }));
    const [pickError, setPickError] = useState<string | null>(null);

    const busy = step.kind === "token" ? step.busy : step.kind === "details" ? step.busy : false;
    const login = (mode === "token" ? fixedLogin : form.login.trim()) ?? "";

    // GitHub must accept the token and say it is the login typed here; only then does the dialog go on (add) or
    // store it (replace)
    const check = async () => {
        if (step.kind !== "token" || !canCheck(form, mode, busy)) {
            return;
        }
        dispatch({ type: "checking" });
        try {
            const user = await RpcApi.GitAccountCheckTokenCommand(
                TabRpcClient,
                { login, token: form.token.trim() },
                GIT_RPC_OPTS
            );
            if (mode === "token") {
                await RpcApi.GitAccountSetTokenCommand(TabRpcClient, { login, token: form.token.trim() }, GIT_RPC_OPTS);
                set({ token: "" });
                dispatch({ type: "saved" });
                onDone(login);
                onClose();
                return;
            }
            set({ email: form.email !== "" ? form.email : (user.email ?? "") });
            dispatch({ type: "checked", user });
        } catch (e) {
            dispatch({ type: "refused", message: errorText(e) });
        }
    };

    const save = async () => {
        if (step.kind !== "details" || !canSave(form, needsDefault, step.busy)) {
            return;
        }
        dispatch({ type: "saving" });
        try {
            const account = await RpcApi.GitAccountAddCommand(
                TabRpcClient,
                addPayload(form, step.user, needsDefault),
                GIT_RPC_OPTS
            );
            set({ token: "" });
            dispatch({ type: "saved" });
            onDone(account.login);
            onClose();
        } catch (e) {
            dispatch({ type: "failed", message: errorText(e) });
        }
    };

    const error = step.kind === "token" || step.kind === "details" ? step.error : null;
    return (
        <ModalShell
            open
            onClose={onClose}
            onSubmit={step.kind === "details" ? () => void save() : () => void check()}
            dismissOnBackdrop={false}
            className="w-full max-w-[520px]"
        >
            <div data-git-add-modal="" data-mode={mode} className="flex flex-col px-[22px] pt-[22px] pb-[18px]">
                <h2 className="text-[16px] font-bold leading-[1.3] tracking-[-0.015em] text-primary">
                    {mode === "token"
                        ? `Replace the token for ${fixedLogin ?? ""}`
                        : step.kind === "details"
                          ? "Name, email and folder"
                          : "Add a GitHub account"}
                </h2>
                {step.kind === "details" ? (
                    <div className="mt-[7px] flex flex-col gap-3">
                        <div className="text-[13px] leading-[1.55] text-ink-mid">
                            GitHub accepted the token for <span className="font-semibold">{step.user.login}</span>.
                            Repos under the folder commit with this email and push with that token.
                        </div>
                        <label className="flex flex-col gap-1">
                            <span className="text-[12px] text-muted">Commit email</span>
                            <input
                                type="email"
                                data-git-add-email=""
                                autoFocus
                                value={form.email}
                                placeholder="name@example.com"
                                spellCheck={false}
                                readOnly={step.busy}
                                onChange={(e) => set({ email: e.target.value })}
                                className={`w-full ${FIELD_CLASS}`}
                            />
                        </label>
                        <div className="flex flex-col gap-1">
                            <span className="text-[12px] text-muted">First folder</span>
                            <FolderField
                                value={form.root}
                                onChange={(v) => {
                                    set({ root: v });
                                    setPickError(null);
                                }}
                                onError={setPickError}
                                attrs={{ "data-git-add-root": "" }}
                                placeholder="/path/to/the/folder/holding/its/repos"
                                title="Select the folder"
                                readOnly={step.busy}
                            />
                        </div>
                        {needsDefault ? (
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] text-muted">
                                    The GitHub login git uses in every other folder
                                </span>
                                <input
                                    type="text"
                                    data-git-add-default=""
                                    value={form.defaultLogin}
                                    placeholder="your login on this machine"
                                    spellCheck={false}
                                    readOnly={step.busy}
                                    onChange={(e) => set({ defaultLogin: e.target.value })}
                                    className={`w-full ${FIELD_CLASS}`}
                                />
                            </label>
                        ) : null}
                    </div>
                ) : (
                    <div className="mt-[7px] flex flex-col gap-3">
                        <div className="text-[13px] leading-[1.55] text-ink-mid">
                            A GitHub token for the account. arcterm asks GitHub whose it is before it keeps it, and
                            stores it in this computer's credential store, never in a repo.
                        </div>
                        {mode === "add" ? (
                            <label className="flex flex-col gap-1">
                                <span className="text-[12px] text-muted">GitHub login</span>
                                <input
                                    type="text"
                                    data-git-add-login=""
                                    autoFocus
                                    value={form.login}
                                    placeholder="octocat"
                                    spellCheck={false}
                                    readOnly={busy}
                                    onChange={(e) => set({ login: e.target.value })}
                                    className={`w-full ${FIELD_CLASS}`}
                                />
                            </label>
                        ) : null}
                        <label className="flex flex-col gap-1">
                            <span className="text-[12px] text-muted">Token</span>
                            <input
                                type="password"
                                data-git-add-token=""
                                autoFocus={mode === "token"}
                                autoComplete="off"
                                value={form.token}
                                placeholder="github_pat_… or ghp_…"
                                spellCheck={false}
                                readOnly={busy}
                                onChange={(e) => set({ token: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void check();
                                    }
                                }}
                                className={`w-full font-mono ${FIELD_CLASS}`}
                            />
                        </label>
                        <div className="text-[12px] leading-[1.55] text-muted">
                            A fine-grained token covers one owner (you or one organization), so an account that pushes
                            to an organization's repos needs a classic token or one made for that organization.
                        </div>
                    </div>
                )}
                {error ? (
                    <div data-git-add-error="" className="mt-3 text-[12px] leading-[1.55] text-error">
                        {error}
                    </div>
                ) : pickError ? (
                    <div className="mt-3 text-[12px] leading-[1.55] text-error">{pickError}</div>
                ) : null}
                <div className="flex justify-end gap-2.5 pt-[18px]">
                    <DialogButton variant="secondary" hint={formatChordString("Escape")} onClick={onClose}>
                        Cancel
                    </DialogButton>
                    {step.kind === "details" ? (
                        <DialogButton
                            variant="primary"
                            data-git-add-save=""
                            disabled={!canSave(form, needsDefault, step.busy)}
                            onClick={() => void save()}
                        >
                            {step.busy ? "Saving…" : "Save"}
                        </DialogButton>
                    ) : (
                        <DialogButton
                            variant="primary"
                            data-git-add-check=""
                            disabled={!canCheck(form, mode, busy)}
                            onClick={() => void check()}
                        >
                            {busy ? "Checking…" : "Check token"}
                        </DialogButton>
                    )}
                </div>
            </div>
        </ModalShell>
    );
}

GitAccountAddModal.displayName = "GitAccountAddModal";
