// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings > Remote: remote mode's switch, its status, and how the phone connects: tailscale serve, or a Cloudflare
// tunnel behind Access (pkg/remotemode). The status
// comes from the cockpit root's remote:status subscription (RemoteStatusPoller); a switch change lands there too.

import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useState } from "react";
import {
    remoteProvider,
    remoteProviderPatch,
    remoteSetupPatch,
    remoteStatusLines,
    remoteSwitch,
    type RemoteProvider,
    type RemoteSetupField,
} from "../remotemodel";
import { remoteStatusAtom, saveRemoteSetup, setRemoteOn } from "../remotestore";
import { CommitText, Note, SecretInput, Segmented, SettingCard, SettingRow, Toggle } from "../settingsui";

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
    const provider = remoteProvider(status);
    // one setup call; Setup keeps every field the patch leaves empty
    const send = async (patch: CommandRemoteSetupData): Promise<boolean> => {
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
    const save = async (field: RemoteSetupField, value: string): Promise<boolean> => {
        setError(null);
        const patch = remoteSetupPatch(field, value);
        if ("error" in patch) {
            setError(patch.error);
            return false;
        }
        return send(patch);
    };
    const pickProvider = (next: RemoteProvider) => {
        if (next !== provider) {
            setError(null);
            fireAndForget(() => send(remoteProviderPatch(next)));
        }
    };
    const field = (
        id: Exclude<RemoteSetupField, "tunneltoken">,
        value: string,
        placeholder: string,
        rowId: string = `remote.${id}`
    ) => (
        <SettingRow id={rowId}>
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
            <SettingCard id="remotesetup" label="Connection">
                <SettingRow id="remote.provider">
                    <Segmented<RemoteProvider>
                        options={[
                            { id: "tailscale", label: "Tailscale", testId: "remote-provider-tailscale" },
                            { id: "cloudflare", label: "Cloudflare", testId: "remote-provider-cloudflare" },
                        ]}
                        value={provider}
                        onChange={pickProvider}
                    />
                </SettingRow>
                {provider === "tailscale" ? (
                    <>
                        {field("hostname", status?.hostname ?? "", "read from tailscale status", "remote.tshostname")}
                        {field("email", status?.email ?? "", "read from tailscale status", "remote.tslogin")}
                        {field("port", String(status?.port ?? ""), "")}
                    </>
                ) : (
                    <>
                        <SettingRow id="remote.tunneltoken">
                            <SecretInput
                                placeholder={
                                    tokenStored ? "Stored. Paste a new one to replace it" : "Paste the tunnel token"
                                }
                                onCommit={(v) => save("tunneltoken", v)}
                            />
                        </SettingRow>
                        {field("hostname", status?.hostname ?? "", "arc.example.com")}
                        {field("port", String(status?.port ?? ""), "")}
                        {field("team", status?.team ?? "", "acme")}
                        {field("aud", status?.aud ?? "", "Access application AUD tag")}
                        {field("email", status?.email ?? "", "you@example.com")}
                    </>
                )}
            </SettingCard>
        </>
    );
}
