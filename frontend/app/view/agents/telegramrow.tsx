// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > General > Notifications > Telegram: the bot token, the switch, the one status line that says what
// to do next (paste a token, pair a chat, or nothing), and, once it is on, when the bot may connect: manual ("on for"
// a while), a weekly schedule, or always. The bot lives in wavesrv (pkg/telebot); this row only writes
// telegram:enabled, :mode, :schedule and :onuntil and the token, and polls TelegramStatusCommand while it is on screen.

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SecretInput, Segmented, SettingRow, Toggle, writeConfig } from "./settingsui";
import {
    DAY_IDS,
    formatSchedule,
    formatWhen,
    ON_FOR_MAX_HOURS,
    ON_FOR_MIN_HOURS,
    onUntilFor,
    parseOnForHours,
    runsPastMidnight,
    scheduleOrOffice,
    telegramView,
    toggleDay,
    type DayId,
    type TelegramSchedule,
    type TelegramView,
} from "./telegrammodel";

// The secret pkg/telebot reads (telebot.TokenSecretName). Underscore, not colon: SetSecret rejects colons.
const TELEGRAM_TOKEN_SECRET = "telegram_bottoken";
const STATUS_POLL_MS = 2000;

const ACTION_BUTTON =
    "h-7 flex-none cursor-pointer rounded-sm border border-edge-mid bg-surface-raised px-3 text-[12px] font-semibold text-muted transition-colors hover:border-edge-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-edge-mid disabled:hover:bg-surface-raised";
// a text-sized field on the card; [color-scheme:dark] keeps the native time and number controls legible on it
const FIELD =
    "h-7 flex-none rounded-sm border border-edge-mid bg-surface px-2 text-[12.5px] tabular-nums text-primary outline-none placeholder:text-ink-faint focus:border-accent-700 [color-scheme:dark]";

type TelegramMode = "manual" | "schedule" | "always";

const MODE_OPTIONS: { id: TelegramMode; label: string; testId: string }[] = [
    { id: "manual", label: "Manual", testId: "telegram-mode-manual" },
    { id: "schedule", label: "Schedule", testId: "telegram-mode-schedule" },
    { id: "always", label: "Always", testId: "telegram-mode-always" },
];

// the stored telegram:mode; unset or unknown is manual, as the bot reads it
const readMode = (stored: string | undefined): TelegramMode =>
    stored === "schedule" || stored === "always" ? stored : "manual";

const DAY_LABEL: Record<DayId, string> = {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
};

export function TelegramRow() {
    const enabled = (useAtomValue(getSettingsKeyAtom("telegram:enabled")) as boolean | undefined) ?? false;
    const mode = readMode(useAtomValue(getSettingsKeyAtom("telegram:mode")) as string | undefined);
    const schedule = (useAtomValue(getSettingsKeyAtom("telegram:schedule")) as string | undefined) ?? "";
    const onUntil = (useAtomValue(getSettingsKeyAtom("telegram:onuntil")) as number | undefined) ?? 0;
    const [status, setStatus] = useState<TelegramStatusData | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            setStatus(await RpcApi.TelegramStatusCommand(TabRpcClient));
            setNow(Date.now());
        } catch (_) {
            // best-effort poll; the line keeps the last status until the next one lands
        }
    }, []);
    useEffect(() => {
        fireAndForget(refresh);
        const timer = setInterval(() => fireAndForget(refresh), STATUS_POLL_MS);
        return () => clearInterval(timer);
    }, [refresh]);

    // Write-only: the UI can ask whether a token exists, never what it is. A null value deletes the secret
    // (wshserver_secrets takes map[string]*string); the generated client types values as string.
    const saveToken = async (token: string): Promise<boolean> => {
        setError(null);
        try {
            await RpcApi.SetSecretsCommand(TabRpcClient, { [TELEGRAM_TOKEN_SECRET]: token });
            await refresh();
            return true;
        } catch (e) {
            setError(String(e));
            return false;
        }
    };
    const act = (call: () => Promise<unknown>) =>
        fireAndForget(async () => {
            setError(null);
            try {
                await call();
            } catch (e) {
                setError(String(e));
            }
            await refresh();
        });
    const removeToken = () =>
        act(() =>
            RpcApi.SetSecretsCommand(TabRpcClient, { [TELEGRAM_TOKEN_SECRET]: null } as unknown as Record<
                string,
                string
            >)
        );
    const pair = () => act(() => RpcApi.TelegramPairCommand(TabRpcClient));
    const unpair = () => act(() => RpcApi.TelegramUnpairCommand(TabRpcClient));

    const hasToken = status?.hastoken ?? false;
    const view = status == null ? null : telegramView(status, now);
    return (
        <SettingRow id="notifications.telegram" stacked>
            <div className="flex items-center gap-2.5">
                <SecretInput
                    placeholder={hasToken ? "••••••••  (paste a new token to replace)" : "Bot token from @BotFather"}
                    onCommit={saveToken}
                />
                <Toggle on={enabled} onToggle={() => writeConfig({ "telegram:enabled": !enabled })} label="Telegram" />
                {hasToken ? (
                    <button
                        type="button"
                        data-testid="telegram-remove-token"
                        onClick={removeToken}
                        className="cursor-pointer text-[12px] text-muted underline decoration-edge-strong underline-offset-2 transition-colors hover:text-error"
                    >
                        Remove token
                    </button>
                ) : null}
            </div>
            {view != null ? (
                <div
                    data-testid="telegram-status"
                    data-telegram-status={view.kind}
                    className="mt-2.5 flex min-h-7 items-center gap-3 text-[12px] leading-[1.5] text-muted"
                >
                    <StatusLine view={view} now={now} onPair={pair} onUnpair={unpair} />
                </div>
            ) : null}
            {hasToken && enabled ? <WhenControls mode={mode} schedule={schedule} onUntil={onUntil} now={now} /> : null}
            {error != null ? (
                <div data-testid="telegram-error" className="mt-2 text-[12px] leading-[1.5] text-error">
                    {error}
                </div>
            ) : null}
        </SettingRow>
    );
}

function StatusLine({
    view,
    now,
    onPair,
    onUnpair,
}: {
    view: TelegramView;
    now: number;
    onPair: () => void;
    onUnpair: () => void;
}) {
    switch (view.kind) {
        case "no-token":
            return <span>No bot token yet. Make a bot with @BotFather, then paste its token above.</span>;
        case "off":
            return <span>Off. Turn the switch on to connect.</span>;
        case "error":
            return <span className="text-error">{view.text}</span>;
        case "checking":
            return <span>Checking the token…</span>;
        case "pairing":
            return (
                <>
                    <span
                        data-testid="telegram-pair-code"
                        className="select-all font-mono text-[20px] font-semibold tracking-[0.18em] text-primary"
                    >
                        {view.code}
                    </span>
                    <span>
                        Send /start {view.code}
                        {view.bot !== "" ? ` to @${view.bot}` : ""} in Telegram. The code works for about{" "}
                        <span className="tabular-nums">{view.minutesLeft}</span> min.
                    </span>
                </>
            );
        case "unpaired":
            return (
                <>
                    <span>@{view.bot} · not paired</span>
                    <button type="button" data-testid="telegram-pair" onClick={onPair} className={ACTION_BUTTON}>
                        Pair
                    </button>
                </>
            );
        case "asleep":
            return (
                <PairedLine chat={view.chat} onUnpair={onUnpair}>
                    {view.nextAllowed > 0
                        ? `Off until ${formatWhen(view.nextAllowed, now)}`
                        : "Off — turn it on for a while"}
                </PairedLine>
            );
        case "connected":
            return (
                <PairedLine chat={view.chat} onUnpair={onUnpair}>
                    Connected
                    {view.open > 0 ? ` · ${view.open} ${view.open === 1 ? "question" : "questions"} open` : ""}
                </PairedLine>
            );
        case "idle":
            return (
                <PairedLine chat={view.chat} onUnpair={onUnpair}>
                    connects only when an agent asks
                </PairedLine>
            );
    }
}

// `Paired with <chat> · <what it is doing>` and the Unpair button, which every paired state has.
function PairedLine({ chat, onUnpair, children }: { chat: string; onUnpair: () => void; children: ReactNode }) {
    return (
        <>
            <span>
                Paired with <span className="font-medium text-primary">{chat}</span> · {children}
            </span>
            <button type="button" data-testid="telegram-unpair" onClick={onUnpair} className={ACTION_BUTTON}>
                Unpair
            </button>
        </>
    );
}

// One labelled line of the "when" controls.
function WhenLine({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex min-h-7 flex-wrap items-center gap-2">
            <span className="w-14 flex-none text-[12px] text-muted">{label}</span>
            {children}
        </div>
    );
}

// When the bot may connect: the mode, "on for" a while (Manual and Schedule), and the weekly window (Schedule).
// Inside that time it still connects only while a question is open.
function WhenControls({
    mode,
    schedule,
    onUntil,
    now,
}: {
    mode: TelegramMode;
    schedule: string;
    onUntil: number;
    now: number;
}) {
    return (
        <div data-testid="telegram-when" className="mt-3 flex flex-col gap-2 border-t border-edge-mid pt-3">
            <WhenLine label="Connect">
                <Segmented<TelegramMode>
                    options={MODE_OPTIONS}
                    value={mode}
                    onChange={(m) => writeConfig({ "telegram:mode": m })}
                />
            </WhenLine>
            {mode !== "always" ? <OnFor onUntil={onUntil} now={now} /> : null}
            {mode === "schedule" ? <ScheduleEditor stored={schedule} /> : null}
        </div>
    );
}

const ON_FOR_HOURS = [1, 2, 4];

// "On for": the buttons and the custom hours each write telegram:onuntil, and while one is live it says until when
// and offers Turn off now.
function OnFor({ onUntil, now }: { onUntil: number; now: number }) {
    const [custom, setCustom] = useState("");
    const hours = parseOnForHours(custom);
    const start = (h: number) => writeConfig({ "telegram:onuntil": onUntilFor(h, Date.now()) });
    return (
        <WhenLine label="On for">
            {ON_FOR_HOURS.map((h) => (
                <button
                    key={h}
                    type="button"
                    data-testid={`telegram-on-${h}h`}
                    onClick={() => start(h)}
                    className={ACTION_BUTTON}
                >
                    {h}h
                </button>
            ))}
            <input
                type="number"
                data-testid="telegram-on-custom"
                aria-label="Hours to stay on"
                placeholder="hours"
                min={ON_FOR_MIN_HOURS}
                max={ON_FOR_MAX_HOURS}
                step={0.25}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && hours != null) {
                        start(hours);
                    }
                }}
                className={cn(FIELD, "w-[72px]")}
            />
            <button
                type="button"
                data-testid="telegram-on-start"
                disabled={hours == null}
                onClick={() => hours != null && start(hours)}
                className={ACTION_BUTTON}
            >
                Start
            </button>
            {onUntil > now ? (
                <>
                    <span data-testid="telegram-on-until" className="text-[12px] tabular-nums text-primary">
                        On until {formatWhen(onUntil, now)}
                    </span>
                    <button
                        type="button"
                        data-testid="telegram-turn-off"
                        onClick={() => writeConfig({ "telegram:onuntil": null })}
                        className={ACTION_BUTTON}
                    >
                        Turn off now
                    </button>
                </>
            ) : null}
        </WhenLine>
    );
}

// The weekly window: the days it starts on and its from and to times, in local time. The draft is what the
// controls show; each change writes the whole schedule, and a stored change from elsewhere replaces the draft, so a
// controlled time field never snaps back to the old value while its write is in flight. An unset (or unreadable)
// schedule shows as office hours, which is what the bot reads it as.
function ScheduleEditor({ stored }: { stored: string }) {
    const [draft, setDraft] = useState<TelegramSchedule>(() => scheduleOrOffice(stored));
    useEffect(() => setDraft(scheduleOrOffice(stored)), [stored]);
    const commit = (next: TelegramSchedule) => {
        setDraft(next);
        writeConfig({ "telegram:schedule": formatSchedule(next) });
    };
    // a time field reports "" while it is half edited: wait for a whole time
    const setTime = (edge: "from" | "to", value: string) => {
        if (value !== "" && value !== draft[edge]) {
            commit({ ...draft, [edge]: value });
        }
    };
    return (
        <>
            <WhenLine label="Days">
                {DAY_IDS.map((d) => (
                    <button
                        key={d}
                        type="button"
                        data-testid={`telegram-day-${d}`}
                        aria-pressed={draft.days.includes(d)}
                        onClick={() => commit(toggleDay(draft, d))}
                        className={cn(
                            "h-7 w-[42px] flex-none cursor-pointer rounded-sm border text-[12px] font-semibold transition-colors",
                            draft.days.includes(d)
                                ? "border-edge-strong bg-surface-selected text-primary"
                                : "border-edge-mid text-muted hover:border-edge-strong hover:text-primary"
                        )}
                    >
                        {DAY_LABEL[d]}
                    </button>
                ))}
            </WhenLine>
            <WhenLine label="Hours">
                <input
                    type="time"
                    data-testid="telegram-from"
                    aria-label="From"
                    value={draft.from}
                    onChange={(e) => setTime("from", e.target.value)}
                    className={FIELD}
                />
                <span className="text-[12px] text-muted">to</span>
                <input
                    type="time"
                    data-testid="telegram-to"
                    aria-label="To"
                    value={draft.to}
                    onChange={(e) => setTime("to", e.target.value)}
                    className={FIELD}
                />
                <button
                    type="button"
                    data-testid="telegram-office-hours"
                    onClick={() => commit(scheduleOrOffice(""))}
                    className={ACTION_BUTTON}
                >
                    Office hours
                </button>
                {runsPastMidnight(draft) ? (
                    <span data-testid="telegram-past-midnight" className="text-[12px] text-muted">
                        Runs past midnight
                    </span>
                ) : null}
            </WhenLine>
        </>
    );
}
