// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > About: versions of the shell, the backend it spawned, and the coding agents on this machine.

import { formatBuildTime, versionInfoAtom } from "@/app/cockpit/versioninfo";
import { getSettingsKeyAtom } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useContext, useEffect, type ReactNode } from "react";
import { harnessesAtom, loadHarnesses } from "../harnessstore";
import { harnessRowState, rowLabel } from "../harnessupdatemodel";
import { updateHarness, updateRunsAtom } from "../harnessupdatestore";
import { CardWarning, RowCtx, SettingCard, SettingRow, Toggle, writeConfig } from "../settingsui";

// a version number at a row's right edge
function VersionValue({ warn, children }: { warn?: boolean; children: ReactNode }) {
    return <span className={cn("text-[13px] tabular-nums", warn ? "text-warning" : "text-secondary")}>{children}</span>;
}

// One line per installed harness inside the card: its version, and when a newer release is out, an "N available"
// pill and an Update button (harnessupdatemodel.ts). The lines sit straight in the card, so the wrapper that
// carries about.harnesses' data-setting-row and honors the search lays out as nothing.
function HarnessVersions() {
    const ctx = useContext(RowCtx);
    const harnesses = useAtomValue(harnessesAtom);
    const runs = useAtomValue(updateRunsAtom);
    useEffect(() => {
        if (harnesses.length === 0) {
            fireAndForget(() => loadHarnesses());
        }
    }, []);
    if (ctx.visible != null && !ctx.visible.has("about.harnesses")) {
        return null;
    }
    const rows = harnesses.flatMap((h) => {
        const state = harnessRowState(h, runs[h.runtime]);
        return state == null ? [] : [{ h, state }];
    });
    return (
        <div data-setting-row="about.harnesses" className="contents">
            {rows.length === 0 ? (
                <div data-harness-none className="px-4 py-3 text-[12.5px] text-muted">
                    No harness installed.
                </div>
            ) : (
                rows.map(({ h, state }) => (
                    <div
                        key={h.runtime}
                        data-harness-row={h.runtime}
                        className="flex items-center gap-3 border-t border-edge-mid px-4 py-[9px] first:border-t-0"
                    >
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-primary">{h.label}</span>
                        {state.kind === "available" ? (
                            <span
                                title={rowLabel(state)}
                                className="flex-none rounded-full bg-accentbg px-2 text-[11px] font-semibold text-accent-soft"
                            >
                                {rowLabel(state)}
                            </span>
                        ) : state.kind !== "current" ? (
                            <span
                                className={cn(
                                    "max-w-[260px] truncate text-[12px]",
                                    state.kind === "failed" ? "text-error" : "text-accent-soft"
                                )}
                                title={rowLabel(state)}
                            >
                                {rowLabel(state)}
                            </span>
                        ) : null}
                        {state.kind === "available" || state.kind === "failed" ? (
                            <button
                                type="button"
                                data-harness-update={h.runtime}
                                onClick={() => fireAndForget(() => updateHarness(h.runtime))}
                                className="h-6 flex-none cursor-pointer rounded-sm border border-edge-mid bg-surface px-2.5 text-[12px] font-semibold text-secondary transition-colors hover:border-accent hover:text-accent-soft"
                            >
                                Update
                            </button>
                        ) : null}
                        <span className="min-w-[52px] flex-none text-right text-[13px] tabular-nums text-secondary">
                            {state.version}
                        </span>
                    </div>
                ))
            )}
        </div>
    );
}

export function AboutPage() {
    const version = useAtomValue(versionInfoAtom);
    const updateCheck = (useAtomValue(getSettingsKeyAtom("harness:updatecheck")) as boolean) ?? true;
    return (
        <>
            <SettingCard
                id="versions"
                label="Versions"
                header={
                    version.mismatch ? (
                        <CardWarning>
                            The backend does not match the app — dist/bin is stale. Run `task build:backend` and
                            restart.
                        </CardWarning>
                    ) : null
                }
            >
                <SettingRow id="about.app" compact>
                    <VersionValue>{version.app}</VersionValue>
                </SettingRow>
                <SettingRow id="about.server" compact>
                    <VersionValue warn={version.mismatch}>{version.server}</VersionValue>
                </SettingRow>
                <SettingRow id="about.buildtime" compact>
                    <VersionValue>{formatBuildTime(version.buildTime)}</VersionValue>
                </SettingRow>
                <SettingRow id="about.platform" compact>
                    <VersionValue>{version.platform}</VersionValue>
                </SettingRow>
            </SettingCard>
            <SettingCard id="agents" label="Coding agents">
                <HarnessVersions />
                <SettingRow id="about.updatecheck">
                    <Toggle
                        on={updateCheck}
                        onToggle={() => writeConfig({ "harness:updatecheck": !updateCheck })}
                        label="Check for harness updates"
                    />
                </SettingRow>
            </SettingCard>
        </>
    );
}
