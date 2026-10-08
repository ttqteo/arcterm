// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > About: versions of the shell, the backend it spawned, and the coding agents on this machine.

import { formatBuildTime, versionInfoAtom } from "@/app/cockpit/versioninfo";
import { getSettingsKeyAtom } from "@/app/store/global";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { harnessesAtom, loadHarnesses } from "../harnessstore";
import { harnessRowState, rowLabel } from "../harnessupdatemodel";
import { updateHarness, updateRunsAtom } from "../harnessupdatestore";
import { Note, SettingCard, SettingRow, Toggle, Value, writeConfig } from "../settingsui";

// one row per installed harness: its version, and when a newer release is out, an Update button (harnessupdatemodel.ts)
function HarnessVersions() {
    const harnesses = useAtomValue(harnessesAtom);
    const runs = useAtomValue(updateRunsAtom);
    useEffect(() => {
        if (harnesses.length === 0) {
            fireAndForget(() => loadHarnesses());
        }
    }, []);
    const rows = harnesses.flatMap((h) => {
        const state = harnessRowState(h, runs[h.runtime]);
        return state == null ? [] : [{ h, state }];
    });
    if (rows.length === 0) {
        return (
            <span data-harness-none className="text-[12.5px] text-muted">
                No harness installed.
            </span>
        );
    }
    return (
        <div className="flex flex-col divide-y divide-border rounded border border-edge-mid bg-surface">
            {rows.map(({ h, state }) => (
                <div key={h.runtime} data-harness-row={h.runtime} className="flex items-center gap-3 px-3 py-[7px]">
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-primary">{h.label}</span>
                    <span className="text-[12px] tabular-nums text-muted">{state.version}</span>
                    {state.kind !== "current" ? (
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
                            className="flex-none cursor-pointer rounded-[6px] border border-edge-strong bg-surface px-[10px] py-[3px] text-[12px] font-semibold text-secondary hover:border-accent hover:text-accent-soft"
                        >
                            Update
                        </button>
                    ) : null}
                </div>
            ))}
        </div>
    );
}

export function AboutPage() {
    const version = useAtomValue(versionInfoAtom);
    const updateCheck = (useAtomValue(getSettingsKeyAtom("harness:updatecheck")) as boolean) ?? true;
    return (
        <>
            <SettingCard id="versions" label="Versions">
                <SettingRow id="about.app" compact>
                    <Value>{version.app}</Value>
                </SettingRow>
                <SettingRow id="about.server" compact>
                    <Value warn={version.mismatch}>{version.server}</Value>
                </SettingRow>
                <SettingRow id="about.buildtime" compact>
                    <span className="text-[12.5px] tabular-nums text-secondary">
                        {formatBuildTime(version.buildTime)}
                    </span>
                </SettingRow>
                <SettingRow id="about.platform" compact>
                    <Value>{version.platform}</Value>
                </SettingRow>
            </SettingCard>
            <SettingCard id="agents" label="Coding agents">
                <SettingRow id="about.harnesses" stacked>
                    <HarnessVersions />
                </SettingRow>
                <SettingRow id="about.updatecheck">
                    <Toggle
                        on={updateCheck}
                        onToggle={() => writeConfig({ "harness:updatecheck": !updateCheck })}
                        label="Check for harness updates"
                    />
                </SettingRow>
            </SettingCard>
            {version.mismatch ? (
                <Note>
                    The backend does not match the app — dist/bin is stale. Run `task build:backend` and restart.
                </Note>
            ) : null}
        </>
    );
}
