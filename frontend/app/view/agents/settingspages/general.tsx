// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > General: what opens at launch, when arcterm notifies, and where Jarvis keeps its vault.

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { startupSurfaceAtom, startupSurfaceOptions, vaultPathError, type StartupSurface } from "../cockpitprefsstore";
import { railVisibleAtom } from "../railstore";
import { vaultStatusLine } from "../settingsmodel";
import {
    CardFooter,
    CommitText,
    Note,
    Segmented,
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
    const options = startupSurfaceOptions();
    return (
        <>
            {/* stacked: the startup choices are a row of seven; as a right-hand group they would push the
                title off the card on a narrow window. */}
            <SettingRow id="general.startup" stacked>
                <Segmented<StartupSurface>
                    options={options.map((k) => ({ id: k, label: startupLabel(k) }))}
                    value={startup}
                    onChange={setStartup}
                />
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

function VaultCard() {
    const stored = (useAtomValue(getSettingsKeyAtom("memory:vaultpath")) as string) ?? "";
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<VaultStatusRtnData | null>(null);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const loadStatus = () =>
        fireAndForget(async () => {
            try {
                setStatus(await RpcApi.VaultStatusCommand(TabRpcClient));
            } catch (e) {
                setRemoteError(String(e));
            }
        });
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
    const statusLine = vaultStatusLine(status);
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
                        <span className="tabular-nums">{statusLine}</span>
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
            </SettingRow>
            {remoteError ? (
                <div className="px-4 pb-3">
                    <Note tone="error">{remoteError}</Note>
                </div>
            ) : null}
        </SettingCard>
    );
}
