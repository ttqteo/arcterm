// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// What Settings > Remote and the footer's remote chip show for a remote mode status. Pure; the atom and
// the RPCs are in remotestore.ts. null is "not loaded yet".

export const REMOTE_SETUP_NOTE = "Fill in the setup below, or run wsh remote setup";
// the line pkg/remotemode prints when cloudflared is not found
export const REMOTE_CLOUDFLARED_NOTE = "Install cloudflared first: winget install --id Cloudflare.cloudflared";

export type RemoteSwitch = { enabled: boolean; on: boolean; note: string | null };

export type RemoteStatusLine = { id: "setup" | "tunnel" | "address" | "phone"; text: string; error?: boolean };

// the stored config's field names (Config.Missing), as the setup flags name them
const MISSING_LABEL: Record<string, string> = {
    tunneltoken: "tunnel token",
    team: "team",
    aud: "audience tag",
    email: "email",
    hostname: "hostname",
    port: "port",
};

export type RemoteSetupField = "tunneltoken" | "team" | "aud" | "email" | "hostname" | "port";

// One Settings field's edit as a RemoteSetup call. Setup keeps every field sent empty, so the others stay as
// stored; for the same reason an emptied field is refused rather than sent, since it would change nothing.
export function remoteSetupPatch(field: RemoteSetupField, value: string): CommandRemoteSetupData | { error: string } {
    const v = value.trim();
    if (v === "") {
        return { error: `${MISSING_LABEL[field]} can't be empty` };
    }
    const data: CommandRemoteSetupData = { tunneltoken: "", team: "", aud: "", email: "", hostname: "" };
    if (field !== "port") {
        data[field] = v;
        return data;
    }
    if (!/^\d+$/.test(v)) {
        return { error: "port must be a whole number" };
    }
    data.port = Number(v);
    return data;
}

const TUNNEL_LABEL: Record<string, string> = {
    off: "Tunnel off",
    starting: "Tunnel starting…",
    up: "Tunnel up",
    down: "Tunnel down",
};

// While on, the switch always turns off, whatever the setup says: off must never be out of reach.
export function remoteSwitch(status: RemoteStatusData | null): RemoteSwitch {
    if (status == null) {
        return { enabled: false, on: false, note: null };
    }
    if (status.on) {
        return { enabled: true, on: true, note: null };
    }
    if ((status.missing?.length ?? 0) > 0) {
        return { enabled: false, on: false, note: REMOTE_SETUP_NOTE };
    }
    if (status.cloudflaredmissing) {
        return { enabled: false, on: false, note: REMOTE_CLOUDFLARED_NOTE };
    }
    return { enabled: true, on: false, note: null };
}

export function remoteStatusLines(status: RemoteStatusData | null): RemoteStatusLine[] {
    if (status == null) {
        return [];
    }
    const missing = status.missing ?? [];
    const lines: RemoteStatusLine[] = [
        {
            id: "setup",
            text:
                missing.length === 0
                    ? "Setup complete"
                    : `Setup incomplete, missing ${missing.map((m) => MISSING_LABEL[m] ?? m).join(", ")}`,
        },
    ];
    const tunnel = TUNNEL_LABEL[status.tunnel] ?? `Tunnel ${status.tunnel}`;
    lines.push({
        id: "tunnel",
        text: status.tunnelerror ? `${tunnel}: ${status.tunnelerror}` : tunnel,
        error: status.tunnelerror ? true : undefined,
    });
    if (status.hostname) {
        lines.push({ id: "address", text: `https://${status.hostname}` });
    }
    const n = status.subscriptions ?? 0;
    lines.push({
        id: "phone",
        text: n === 0 ? "No phone subscribed yet" : n === 1 ? "Phone subscribed" : `${n} phones subscribed`,
    });
    return lines;
}

export type RemoteChip = { tone: "off" | "starting" | "on" | "down"; label: string; title: string };

// The footer chip. Hidden until remote mode can be switched on, so an unconfigured install shows nothing.
export function remoteChip(status: RemoteStatusData | null): RemoteChip | null {
    if (status == null) {
        return null;
    }
    if (!status.on) {
        if (!remoteSwitch(status).enabled) {
            return null;
        }
        return { tone: "off", label: "Remote off", title: "Remote is off. Open Settings > Remote to turn it on" };
    }
    if (status.tunnel === "up") {
        const title = status.hostname ? `Reachable from your phone at https://${status.hostname}` : "Tunnel up";
        return { tone: "on", label: "Remote on", title };
    }
    if (status.tunnel === "down") {
        const title = status.tunnelerror ? `Tunnel down: ${status.tunnelerror}` : "Tunnel down";
        return { tone: "down", label: "Remote down", title };
    }
    return { tone: "starting", label: "Remote starting…", title: "Tunnel starting…" };
}
