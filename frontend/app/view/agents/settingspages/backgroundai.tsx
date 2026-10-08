// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Background AI: the runtime behind session classify, continuity, the volunteer judge and pi
// titles, and the route Radar audits run on.

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { harnessPickerItems } from "../harnesspicker";
import { RoutePicker } from "../routepicker";
import {
    OPENROUTER_SECRET_NAME,
    RADAR_AUDIT_MODEL_KEY,
    RADAR_AUDIT_RUNTIME_KEY,
    RADAR_AUDIT_RUNTIMES,
    radarAuditRoute,
} from "../settingsmodel";
import { CommitText, Note, SecretInput, SettingCard, SettingRow, writeConfig } from "../settingsui";

export function BackgroundAIPage() {
    const runtime = (useAtomValue(getSettingsKeyAtom("headless:runtime")) as string) ?? "";
    const cheapModel = (useAtomValue(getSettingsKeyAtom("headless:openroutercheapmodel")) as string) ?? "";
    const auditRuntime = (useAtomValue(getSettingsKeyAtom(RADAR_AUDIT_RUNTIME_KEY)) as string) ?? "";
    const auditModel = (useAtomValue(getSettingsKeyAtom(RADAR_AUDIT_MODEL_KEY)) as string) ?? "";

    const [hasKey, setHasKey] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [harnesses, setHarnesses] = useState<HarnessInfo[]>([]);
    useEffect(() => {
        fireAndForget(async () => {
            try {
                const names = await RpcApi.GetSecretsNamesCommand(TabRpcClient);
                setHasKey((names ?? []).includes(OPENROUTER_SECRET_NAME));
            } catch (_) {
                // best-effort probe; the key warning below simply stays "missing" on failure
            }
        });
        fireAndForget(async () => {
            try {
                const rtn = await RpcApi.ListHarnessesCommand(TabRpcClient);
                setHarnesses(rtn?.harnesses ?? []);
            } catch (_) {
                // best-effort probe; a failed catalog leaves the selector with openrouter only
            }
        });
    }, []);

    // Write-only in both directions: the UI can ask whether a key exists, never what it is.
    const saveKey = async (key: string): Promise<boolean> => {
        setError(null);
        try {
            await RpcApi.SetSecretsCommand(TabRpcClient, { [OPENROUTER_SECRET_NAME]: key });
            setHasKey(true);
            return true;
        } catch (e) {
            setError(String(e));
            return false;
        }
    };

    // A null value deletes the secret (wshserver_secrets takes map[string]*string). The generated client
    // types values as string, so expressing "delete" needs the cast.
    const clearKey = () =>
        fireAndForget(async () => {
            setError(null);
            try {
                await RpcApi.SetSecretsCommand(TabRpcClient, { [OPENROUTER_SECRET_NAME]: null } as unknown as Record<
                    string,
                    string
                >);
                setHasKey(false);
            } catch (e) {
                setError(String(e));
            }
        });

    // empty setting means openrouter (the backend default); only openrouter reads the model keys.
    const isOpenRouter = runtime === "" || runtime === "openrouter";
    const effectiveRuntime = isOpenRouter ? "openrouter" : runtime;

    const harnessRows = harnessPickerItems(harnesses, effectiveRuntime, "consult");
    const options = [
        {
            id: "openrouter",
            label: "OpenRouter",
            mono: "openrouter",
            selectable: true,
            isDefault: true,
            notInstalled: false,
        },
        ...harnessRows.map((h) => ({
            id: h.runtime,
            label: h.label,
            mono: h.runtime,
            selectable: h.selectable,
            isDefault: false,
            notInstalled: h.unavailableReason === "not-installed",
        })),
    ];

    return (
        <>
            <SettingCard id="runtime" label="Runtime">
                {/* stacked: the runtime list carries an install/key status per option, which does not fit a
                    right-hand control slot. */}
                <SettingRow id="headless.runtime" stacked>
                    <div role="radiogroup" aria-label="headless runtime" className="flex flex-col gap-1.5">
                        {options.map((o) => {
                            const on = o.id === effectiveRuntime;
                            return (
                                <button
                                    key={o.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    disabled={!o.selectable}
                                    onClick={() => writeConfig({ "headless:runtime": o.id })}
                                    className={cn(
                                        "flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border p-[10px] text-left transition-colors",
                                        on
                                            ? "border-accent-700 bg-surface-hover"
                                            : "border-border hover:border-edge-strong",
                                        !o.selectable && "cursor-not-allowed opacity-55 hover:border-border"
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
                                    <span
                                        className={cn(
                                            "min-w-0 flex-1 truncate text-[13px] font-semibold",
                                            on ? "text-primary" : "text-secondary"
                                        )}
                                    >
                                        {o.label}
                                    </span>
                                    <span className="text-[10.5px] font-normal tracking-[0.02em] text-muted">
                                        {o.mono}
                                    </span>
                                    <span
                                        className={cn(
                                            "flex flex-none items-center gap-1.5 text-[11px] font-semibold",
                                            o.isDefault
                                                ? hasKey
                                                    ? "text-accent-soft"
                                                    : "text-warning-soft"
                                                : o.notInstalled
                                                  ? "text-muted"
                                                  : "text-success-soft"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "h-1.5 w-1.5 rounded-full",
                                                o.isDefault
                                                    ? hasKey
                                                        ? "bg-accent"
                                                        : "bg-warning"
                                                    : o.notInstalled
                                                      ? "bg-ink-faint"
                                                      : "bg-success"
                                            )}
                                        />
                                        {o.isDefault
                                            ? hasKey
                                                ? "default · key stored"
                                                : "default · key missing"
                                            : o.notInstalled
                                              ? "not installed"
                                              : "installed"}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </SettingRow>
            </SettingCard>
            <SettingCard id="openrouter" label="OpenRouter">
                <SettingRow id="headless.apikey">
                    <span className={cn("text-[12px] font-semibold", hasKey ? "text-success-soft" : "text-muted")}>
                        {hasKey ? "A key is stored." : "No key stored."}
                    </span>
                    <SecretInput
                        placeholder={hasKey ? "••••••••  (enter a new key to replace)" : "sk-or-…"}
                        onCommit={saveKey}
                    />
                    {hasKey ? (
                        <button
                            type="button"
                            onClick={clearKey}
                            className="flex-none cursor-pointer rounded-sm border border-edge-mid px-3 py-[5px] text-[12px] font-semibold text-secondary transition-colors hover:border-error/50 hover:text-error"
                        >
                            Clear
                        </button>
                    ) : null}
                </SettingRow>
                <SettingRow id="headless.cheap">
                    {!isOpenRouter ? (
                        <span className="text-[10.5px] tracking-[0.02em] text-muted">openrouter only</span>
                    ) : null}
                    <CommitText
                        value={cheapModel}
                        placeholder="deepseek/deepseek-v4-flash"
                        disabled={!isOpenRouter}
                        onCommit={(v) => writeConfig({ "headless:openroutercheapmodel": v })}
                    />
                </SettingRow>
            </SettingCard>
            <SettingCard id="radar" label="Radar">
                <SettingRow id="headless.radaraudit">
                    <RoutePicker
                        value={radarAuditRoute(auditRuntime, auditModel)}
                        title="Radar audit route"
                        runtimes={RADAR_AUDIT_RUNTIMES}
                        onChange={(route) =>
                            route &&
                            writeConfig({
                                [RADAR_AUDIT_RUNTIME_KEY]: route.runtime,
                                [RADAR_AUDIT_MODEL_KEY]: route.model ?? null,
                            })
                        }
                    />
                </SettingRow>
            </SettingCard>
            {isOpenRouter && !hasKey ? (
                <Note>OpenRouter key not set — background AI features stay off until a key is stored.</Note>
            ) : null}
            {error ? <Note tone="error">{error}</Note> : null}
        </>
    );
}
