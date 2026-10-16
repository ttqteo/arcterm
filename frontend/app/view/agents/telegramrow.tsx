// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > General > Notifications > Telegram: the bot token, the switch, and the one status line that says what
// to do next (paste a token, pair a chat, or nothing). The bot lives in wavesrv (pkg/telebot); this row only
// writes the token and telegram:enabled, and polls TelegramStatusCommand while it is on screen.

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { SecretInput, SettingRow, Toggle, writeConfig } from "./settingsui";
import { telegramView, type TelegramView } from "./telegrammodel";

// The secret pkg/telebot reads (telebot.TokenSecretName). Underscore, not colon: SetSecret rejects colons.
const TELEGRAM_TOKEN_SECRET = "telegram_bottoken";
const STATUS_POLL_MS = 2000;

const ACTION_BUTTON =
    "h-7 flex-none cursor-pointer rounded-sm border border-edge-mid bg-surface-raised px-3 text-[12px] font-semibold text-muted transition-colors hover:border-edge-strong hover:bg-surface-hover";

export function TelegramRow() {
    const enabled = (useAtomValue(getSettingsKeyAtom("telegram:enabled")) as boolean | undefined) ?? false;
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
                    <StatusLine view={view} onPair={pair} onUnpair={unpair} />
                </div>
            ) : null}
            {error != null ? (
                <div data-testid="telegram-error" className="mt-2 text-[12px] leading-[1.5] text-error">
                    {error}
                </div>
            ) : null}
        </SettingRow>
    );
}

function StatusLine({ view, onPair, onUnpair }: { view: TelegramView; onPair: () => void; onUnpair: () => void }) {
    switch (view.kind) {
        case "no-token":
            return <span>No bot token yet. Make a bot with @BotFather, then paste its token above.</span>;
        case "off":
            return <span>Off. Turn the switch on to connect.</span>;
        case "error":
            return <span className="text-error">{view.text}</span>;
        case "connecting":
            return <span>Connecting to Telegram…</span>;
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
                    <span>{view.bot !== "" ? `Connected as @${view.bot}. ` : ""}Not paired with a chat yet.</span>
                    <button type="button" data-testid="telegram-pair" onClick={onPair} className={ACTION_BUTTON}>
                        Pair
                    </button>
                </>
            );
        case "paired":
            return (
                <>
                    <span>
                        Paired with <span className="font-medium text-primary">{view.chat}</span>
                    </span>
                    <button type="button" data-testid="telegram-unpair" onClick={onUnpair} className={ACTION_BUTTON}>
                        Unpair
                    </button>
                </>
            );
    }
}
