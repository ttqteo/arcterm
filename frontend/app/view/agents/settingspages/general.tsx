// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > General: what opens at launch, when arcterm notifies, and where Jarvis keeps its vault.

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Folder, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { startupMenuEntries, startupSurfaceAtom, vaultPathError } from "../cockpitprefsstore";
import { railVisibleAtom } from "../railstore";
import { vaultStatusLine, vaultSyncButton, vaultSyncFailureNote } from "../settingsmodel";
import {
    CardFooter,
    CommitText,
    Note,
    Select,
    SettingCard,
    SettingRow,
    startupLabel,
    Toggle,
    writeConfig,
} from "../settingsui";

export function GeneralPage() {
    return (
        <>
            <SettingCard id="startup" label="Startup">
                <StartupRows />
            </SettingCard>
            <SettingCard id="notifications" label="Notifications">
                <NotificationRows />
            </SettingCard>
            <VaultCard />
        </>
    );
}

function StartupRows() {
    const [startup, setStartup] = useAtom(startupSurfaceAtom);
    const [railVisible, setRailVisible] = useAtom(railVisibleAtom);
    const items: ContextMenuItem[] = startupMenuEntries(startup).map((e) =>
        "divider" in e
            ? { type: "separator" }
            : {
                  label: startupLabel(e.choice),
                  type: "radio",
                  checked: e.checked,
                  sublabel: e.hint,
                  click: () => setStartup(e.choice),
              }
    );
    return (
        <>
            <SettingRow id="general.startup">
                <Select value={startup} label={startupLabel(startup)} items={items} ariaLabel="Startup surface" />
            </SettingRow>
            <SettingRow id="general.rail">
                <Toggle
                    on={railVisible}
                    onToggle={() => setRailVisible((v) => !v)}
                    label="Show details rail by default"
                />
            </SettingRow>
        </>
    );
}

function NotificationRows() {
    const os = (useAtomValue(getSettingsKeyAtom("notify:os")) as boolean | undefined) ?? true;
    const toast = (useAtomValue(getSettingsKeyAtom("notify:toast")) as boolean | undefined) ?? true;
    const reply = (useAtomValue(getSettingsKeyAtom("notify:reply")) as boolean | undefined) ?? true;
    return (
        <>
            <SettingRow id="notifications.os">
                <Toggle on={os} onToggle={() => writeConfig({ "notify:os": !os })} label="OS notifications" />
            </SettingRow>
            <SettingRow id="notifications.toast">
                <Toggle on={toast} onToggle={() => writeConfig({ "notify:toast": !toast })} label="In-app toasts" />
            </SettingRow>
            <SettingRow id="notifications.reply">
                <Toggle
                    on={reply}
                    onToggle={() => writeConfig({ "notify:reply": !reply })}
                    label="When an agent finishes"
                />
            </SettingRow>
        </>
    );
}

// a waited sync runs a pull and a push; the 5 s default rpc timeout would give up on it mid-run
const VAULT_SYNC_TIMEOUT_MS = 120_000;

function VaultCard() {
    const stored = (useAtomValue(getSettingsKeyAtom("memory:vaultpath")) as string) ?? "";
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<VaultStatusRtnData | null>(null);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [clicking, setClicking] = useState(false);
    const reloadStatus = async (): Promise<VaultStatusRtnData | null> => {
        try {
            const s = await RpcApi.VaultStatusCommand(TabRpcClient);
            setStatus(s);
            return s;
        } catch (e) {
            setRemoteError(String(e));
            return null;
        }
    };
    const loadStatus = () => fireAndForget(reloadStatus);
    useEffect(() => {
        loadStatus();
    }, []);
    const setRemote = (url: string) =>
        fireAndForget(async () => {
            setRemoteError(null);
            try {
                await RpcApi.VaultSetRemoteCommand(TabRpcClient, { url: url.trim() });
            } catch (e) {
                setRemoteError(String(e));
            }
            loadStatus();
        });
    const syncNow = () =>
        fireAndForget(async () => {
            setRemoteError(null);
            setClicking(true);
            try {
                await RpcApi.VaultSyncCommand(TabRpcClient, { wait: true }, { timeout: VAULT_SYNC_TIMEOUT_MS });
                await reloadStatus();
            } catch (e) {
                const note = vaultSyncFailureNote(String(e), await reloadStatus());
                if (note != null) {
                    setRemoteError(note);
                }
            } finally {
                setClicking(false);
            }
        });
    // a click shows as running before the reloaded status can say so
    const shown = clicking && status != null ? { ...status, running: true } : status;
    const statusLine = vaultStatusLine(shown);
    const syncButton = vaultSyncButton(status, clicking);
    // validate before persisting: an empty path clears the override (falls back to the default vault),
    // otherwise the folder must exist and be a directory. reuses FileInfoCommand (bare local path, ~
    // expanded by the backend) instead of a dedicated RPC — mirrors the New Project picker's stat check.
    const commit = (path: string) =>
        fireAndForget(async () => {
            setError(null);
            if (path !== "") {
                try {
                    const info = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path } });
                    const err = vaultPathError(info);
                    if (err) {
                        setError(err);
                        return;
                    }
                } catch (e) {
                    setError(String(e));
                    return;
                }
            }
            writeConfig({ "memory:vaultpath": path });
        });
    // native OS folder picker (Tauri dialog plugin), mirroring newprojectmodal's browse. dynamic import
    // keeps non-Tauri contexts (preview, vitest) clean.
    const browse = () =>
        fireAndForget(async () => {
            try {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const picked = await open({ directory: true, multiple: false, title: "Select vault folder" });
                if (typeof picked === "string" && picked) {
                    commit(picked);
                }
            } catch (e) {
                console.error("vault folder picker failed", e);
            }
        });
    return (
        <SettingCard
            id="vault"
            label="Vault & sync"
            footer={
                statusLine ? (
                    <CardFooter dot>
                        <span
                            data-testid="vault-sync-status"
                            role="status"
                            aria-live="polite"
                            className={cn("tabular-nums", shown?.lasterror && !shown.running ? "text-error" : null)}
                        >
                            {statusLine}
                        </span>
                    </CardFooter>
                ) : undefined
            }
        >
            <SettingRow id="memory.vaultpath">
                <CommitText value={stored} placeholder="~/vault" onCommit={commit}>
                    <button
                        type="button"
                        onClick={browse}
                        title="Browse for folder"
                        aria-label="Browse for folder"
                        className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface-hover hover:text-primary"
                    >
                        <Folder size={14} />
                    </button>
                </CommitText>
            </SettingRow>
            {error ? (
                <div className="px-4 pb-3">
                    <Note tone="error">{error}</Note>
                </div>
            ) : null}
            <SettingRow id="memory.remote">
                <CommitText value={status?.remoteurl ?? ""} placeholder="git@host:you/vault.git" onCommit={setRemote} />
                <button
                    type="button"
                    data-testid="vault-sync-now"
                    disabled={!syncButton.enabled}
                    onClick={syncNow}
                    className={cn(
                        "flex w-[96px] flex-none items-center justify-center gap-1.5 rounded border py-[7px] text-[12px] font-semibold transition-colors",
                        syncButton.enabled
                            ? "cursor-pointer border-edge-mid text-secondary hover:border-edge-strong hover:text-primary"
                            : "cursor-not-allowed border-edge-faint text-ink-faint"
                    )}
                >
                    {syncButton.enabled ? <RefreshCw size={12} aria-hidden /> : null}
                    {syncButton.label}
                </button>
            </SettingRow>
            {remoteError ? (
                <div className="px-4 pb-3">
                    <Note tone="error" testId="vault-sync-error">
                        {remoteError}
                    </Note>
                </div>
            ) : null}
        </SettingCard>
    );
}
