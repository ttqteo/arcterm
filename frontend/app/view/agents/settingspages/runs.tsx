// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Runs & limits: the route new runs take and how many run at once, what keeps the Mac working while
// they do, and when a costly agent spawn asks first.

import { PACE_CHOICES, paceOfSettings, pacePatch } from "@/app/cockpit/jobqueue";
import { getSettingsKeyAtom } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { harnessPreferenceAtom, leadRuntimesAtom, setPreferredRoute } from "../harnessstore";
import { RoutePicker } from "../routepicker";
import {
    RUNS_MAX_ACTIVE,
    stepWithin,
    TOKENGATE_AGENTS,
    TOKENGATE_DEFAULTS,
    TOKENGATE_PCT,
    type StepBounds,
} from "../settingsmodel";
import { CardFooter, Note, Segmented, SettingCard, SettingRow, Stepper, Toggle, writeConfig } from "../settingsui";

const PACE_OPTIONS = PACE_CHOICES.map((c) => ({ id: c.value, label: c.label }));

export function RunsPage() {
    return (
        <>
            <SettingCard id="runs" label="Runs">
                <RunRouteRow />
                <MaxActiveRow />
                <WakeOriginRow />
            </SettingCard>
            <SettingCard id="whilework" label="While work runs">
                <KeepAwakeRow />
                <HeavyJobsRow />
            </SettingCard>
            <SettingCard id="tokenburn" label="Token burn" footer={<CardFooter>0 turns a check off.</CardFooter>}>
                <TokenGateRows />
            </SettingCard>
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
                    size="select"
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

function MaxActiveRow() {
    const value = (useAtomValue(getSettingsKeyAtom("runs:maxactive")) as number | undefined) ?? RUNS_MAX_ACTIVE.default;
    return (
        <SettingRow id="runs.maxactive">
            <Stepper
                value={value}
                onStep={(dir) => {
                    const next = stepWithin(value, dir, RUNS_MAX_ACTIVE);
                    if (next !== value) {
                        writeConfig({ "runs:maxactive": next });
                    }
                }}
                ariaLabel="active runs at once"
            />
        </SettingRow>
    );
}

function WakeOriginRow() {
    const on = (useAtomValue(getSettingsKeyAtom("runs:wakeorigin")) as boolean | undefined) ?? true;
    return (
        <SettingRow id="runs.wakeorigin">
            <Toggle
                on={on}
                onToggle={() => writeConfig({ "runs:wakeorigin": !on })}
                label="Tell the session that started a run"
            />
        </SettingRow>
    );
}

function KeepAwakeRow() {
    const on = (useAtomValue(getSettingsKeyAtom("power:keepawake")) as boolean | undefined) ?? true;
    return (
        <SettingRow id="runs.keepawake">
            <Toggle on={on} onToggle={() => writeConfig({ "power:keepawake": !on })} label="Keep the Mac awake" />
        </SettingRow>
    );
}

function HeavyJobsRow() {
    const mode = useAtomValue(getSettingsKeyAtom("jobs:mode")) as string | undefined;
    const slots = useAtomValue(getSettingsKeyAtom("jobs:slots")) as number | undefined;
    return (
        <SettingRow id="runs.heavyjobs">
            <Segmented
                options={PACE_OPTIONS}
                value={paceOfSettings(mode, slots)}
                onChange={(value) => writeConfig(pacePatch(value))}
            />
        </SettingRow>
    );
}

// one threshold row: a stepper inside the bounds, dimmed while the gate is off
function ThresholdRow({
    id,
    settingKey,
    bounds,
    fallback,
    gateOn,
    percent,
    ariaLabel,
}: {
    id: string;
    settingKey: string;
    bounds: StepBounds;
    fallback: number;
    gateOn: boolean;
    percent?: boolean;
    ariaLabel: string;
}) {
    const value =
        (useAtomValue(getSettingsKeyAtom(settingKey as keyof SettingsType)) as number | undefined) ?? fallback;
    return (
        <SettingRow id={id}>
            <div className={cn("flex items-center gap-2", !gateOn && "opacity-50")}>
                <Stepper
                    value={value}
                    onStep={(dir) => {
                        const next = stepWithin(value, dir, bounds);
                        if (next !== value) {
                            writeConfig({ [settingKey]: next });
                        }
                    }}
                    ariaLabel={ariaLabel}
                />
                {percent ? <span className="text-[12px] text-muted">%</span> : null}
            </div>
        </SettingRow>
    );
}

function TokenGateRows() {
    const gateOn = (useAtomValue(getSettingsKeyAtom("tokengate:enabled")) as boolean | undefined) ?? true;
    const d = TOKENGATE_DEFAULTS;
    return (
        <>
            <SettingRow id="tokengate.enabled">
                <Toggle
                    on={gateOn}
                    onToggle={() => writeConfig({ "tokengate:enabled": !gateOn })}
                    label="Ask before a costly spawn"
                />
            </SettingRow>
            <ThresholdRow
                id="tokengate.sharepct"
                settingKey="tokengate:sharepct"
                bounds={TOKENGATE_PCT}
                fallback={d.sharepct}
                gateOn={gateOn}
                percent
                ariaLabel="percent of the 5-hour window one spawn may take"
            />
            <ThresholdRow
                id="tokengate.windowpct"
                settingKey="tokengate:windowpct"
                bounds={TOKENGATE_PCT}
                fallback={d.windowpct}
                gateOn={gateOn}
                percent
                ariaLabel="percent of the 5-hour window used"
            />
            <ThresholdRow
                id="tokengate.agents"
                settingKey="tokengate:agents"
                bounds={TOKENGATE_AGENTS}
                fallback={d.agents}
                gateOn={gateOn}
                ariaLabel="agents started together"
            />
            <ThresholdRow
                id="tokengate.weekpct"
                settingKey="tokengate:weekpct"
                bounds={TOKENGATE_PCT}
                fallback={d.weekpct}
                gateOn={gateOn}
                percent
                ariaLabel="percent of the week used"
            />
            <ThresholdRow
                id="tokengate.sessionpct"
                settingKey="tokengate:sessionpct"
                bounds={TOKENGATE_PCT}
                fallback={d.sessionpct}
                gateOn={gateOn}
                percent
                ariaLabel="percent of the 5-hour window the asking session used"
            />
        </>
    );
}
