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
import { useContext, useEffect, useState, type ReactNode } from "react";
import { harnessPickerItems } from "../harnesspicker";
import { RoutePicker } from "../routepicker";
import {
    OPENROUTER_SECRET_NAME,
    RADAR_AUDIT_MODEL_KEY,
    RADAR_AUDIT_RUNTIME_KEY,
    RADAR_AUDIT_RUNTIMES,
    radarAuditRoute,
} from "../settingsmodel";
import {
    CardWarning,
    ChoiceRow,
    CommitText,
    RowCtx,
    SecretInput,
    SettingCard,
    SettingRow,
    writeConfig,
} from "../settingsui";

type RuntimeStatus = "installed" | "not-installed" | "key-stored" | "key-missing";

const STATUS_WORD: Record<RuntimeStatus, string> = {
    installed: "installed",
    "not-installed": "not installed",
    "key-stored": "default · key stored",
    "key-missing": "default · key missing",
};

const STATUS_TEXT: Record<RuntimeStatus, string> = {
    installed: "text-success",
    "not-installed": "text-muted",
    "key-stored": "text-success",
    "key-missing": "text-warning",
};

const STATUS_DOT: Record<RuntimeStatus, string> = {
    installed: "bg-success",
    "not-installed": "bg-ink-faint",
    "key-stored": "bg-success",
    "key-missing": "bg-warning",
};

// The runtime list is a pick-one list that sits straight in its card (each ChoiceRow draws its own divider),
// so there is no title line to hang the row's hooks on. This wrapper carries data-setting-row and honors the
// search; it lays out as nothing, so the choices stay the card's direct rows.
function RuntimeChoices({ rowId, label, children }: { rowId: string; label: string; children: ReactNode }) {
    const ctx = useContext(RowCtx);
    if (ctx.visible != null && !ctx.visible.has(rowId)) {
        return null;
    }
    return (
        <div data-setting-row={rowId} role="radiogroup" aria-label={label} className="contents">
            {children}
        </div>
    );
}

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
                // best-effort probe; the key warning on the OpenRouter card simply stays "missing" on failure
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
    const options: {
        id: string;
        label: string;
        mono: string;
        selectable: boolean;
        notInstalled: boolean;
        status: RuntimeStatus;
    }[] = [
        {
            id: "openrouter",
            label: "OpenRouter",
            mono: "openrouter",
            selectable: true,
            notInstalled: false,
            status: hasKey ? "key-stored" : "key-missing",
        },
        ...harnessRows.map((h) => {
            const notInstalled = h.unavailableReason === "not-installed";
            return {
                id: h.runtime,
                label: h.label,
                mono: h.runtime,
                selectable: h.selectable,
                notInstalled,
                status: (notInstalled ? "not-installed" : "installed") as RuntimeStatus,
            };
        }),
    ];

    return (
        <>
            <SettingCard id="runtime" label="Runtime" rowId="headless.runtime">
                <RuntimeChoices rowId="headless.runtime" label="headless runtime">
                    {options.map((o) => (
                        <ChoiceRow
                            key={o.id}
                            data-runtime-choice={o.id}
                            selected={o.id === effectiveRuntime}
                            dim={o.notInstalled}
                            disabled={!o.selectable}
                            onPick={() => writeConfig({ "headless:runtime": o.id })}
                        >
                            <span className="min-w-0 truncate text-[13px] font-medium">{o.label}</span>
                            <span className="flex-none font-mono text-[11px] text-ink-faint">{o.mono}</span>
                            <span className="flex-1" />
                            <span
                                className={cn(
                                    "flex flex-none items-center gap-1.5 text-[12px] font-medium",
                                    STATUS_TEXT[o.status]
                                )}
                            >
                                <span className={cn("h-1.5 w-1.5 flex-none rounded-full", STATUS_DOT[o.status])} />
                                {STATUS_WORD[o.status]}
                            </span>
                        </ChoiceRow>
                    ))}
                </RuntimeChoices>
            </SettingCard>
            <SettingCard
                id="openrouter"
                label="OpenRouter"
                header={
                    isOpenRouter && !hasKey ? (
                        <CardWarning>
                            OpenRouter key not set — background AI features stay off until a key is stored.
                        </CardWarning>
                    ) : null
                }
                footer={
                    error != null ? (
                        <div className="border-t border-edge-mid px-4 py-2.5 text-[12px] leading-[1.5] text-error">
                            {error}
                        </div>
                    ) : null
                }
            >
                <SettingRow id="headless.apikey">
                    {hasKey ? <span className="text-[12px] font-semibold text-success">Key stored</span> : null}
                    <SecretInput
                        placeholder={hasKey ? "••••••••  (enter a new key to replace)" : "sk-or-…"}
                        onCommit={saveKey}
                    />
                    {hasKey ? (
                        <button
                            type="button"
                            onClick={clearKey}
                            className="h-7 flex-none cursor-pointer rounded-sm border border-edge-mid px-3 text-[12px] font-semibold text-secondary transition-colors hover:border-error/50 hover:text-error"
                        >
                            Clear
                        </button>
                    ) : null}
                </SettingRow>
                <SettingRow id="headless.cheap">
                    {!isOpenRouter ? <span className="text-[11px] text-ink-faint">openrouter only</span> : null}
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
                        size="select"
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
        </>
    );
}
