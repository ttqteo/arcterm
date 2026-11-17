// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Remote: remote mode's switch, its status, and the tunnel and Access details (pkg/remotemode). The status
// comes from the cockpit root's remote:status subscription (RemoteStatusPoller); a switch change lands there too.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { remoteSetupPatch, remoteStatusLines, remoteSwitch, type RemoteSetupField } from "../remotemodel";
import { remoteStatusAtom, saveRemoteSetup, setRemoteOn } from "../remotestore";
import { CommitText, Note, SecretInput, SettingCard, SettingRow, Toggle } from "../settingsui";

export function RemotePage() {
    const status = useAtomValue(remoteStatusAtom);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const sw = remoteSwitch(status);
    const lines = remoteStatusLines(status);
    const toggle = () =>
        fireAndForget(async () => {
            setError(null);
            setBusy(true);
            try {
                await setRemoteOn(!sw.on);
            } catch (e) {
                setError(String(e));
            } finally {
                setBusy(false);
            }
        });
    const save = async (field: RemoteSetupField, value: string): Promise<boolean> => {
        setError(null);
        const patch = remoteSetupPatch(field, value);
        if ("error" in patch) {
            setError(patch.error);
            return false;
        }
        setBusy(true);
        try {
            await saveRemoteSetup(patch);
            return true;
        } catch (e) {
            setError(String(e));
            return false;
        } finally {
            setBusy(false);
        }
    };
    const field = (id: Exclude<RemoteSetupField, "tunneltoken">, value: string, placeholder: string) => (
        <SettingRow id={`remote.${id}`}>
            <CommitText
                value={value}
                placeholder={placeholder}
                disabled={busy}
                onCommit={(v) => fireAndForget(() => save(id, v))}
            />
        </SettingRow>
    );
    const tokenStored = status != null && !(status.missing ?? []).includes("tunneltoken");
    return (
        <>
            <SettingCard id="remotemode" label="Remote mode">
                <SettingRow id="remote.mode">
                    <Toggle on={sw.on} onToggle={toggle} label="Remote mode" disabled={!sw.enabled || busy} />
                </SettingRow>
                {sw.note ? (
                    <Note testId="remote-switch-note">
                        <span className="font-mono">{sw.note}</span>
                    </Note>
                ) : null}
                {error ? (
                    <Note tone="error" testId="remote-error">
                        {error}
                    </Note>
                ) : null}
                <SettingRow id="remote.status" stacked>
                    <div role="status" aria-live="polite" className="flex flex-col gap-1 font-mono text-[12px]">
                        {lines.map((l) => (
                            <div
                                key={l.id}
                                data-remote-line={l.id}
                                className={l.error ? "text-error" : "text-secondary"}
                            >
                                {l.text}
                            </div>
                        ))}
                    </div>
                </SettingRow>
            </SettingCard>
            <SettingCard id="remotesetup" label="Tunnel & Access">
                <SettingRow id="remote.tunneltoken">
                    <SecretInput
                        placeholder={tokenStored ? "Stored. Paste a new one to replace it" : "Paste the tunnel token"}
                        onCommit={(v) => save("tunneltoken", v)}
                    />
                </SettingRow>
                {field("hostname", status?.hostname ?? "", "arc.example.com")}
                {field("port", String(status?.port ?? ""), "")}
                {field("team", status?.team ?? "", "acme")}
                {field("aud", status?.aud ?? "", "Access application AUD tag")}
                {field("email", status?.email ?? "", "you@example.com")}
            </SettingCard>
        </>
    );
}
