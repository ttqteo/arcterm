// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    REMOTE_CLOUDFLARED_NOTE,
    REMOTE_SETUP_NOTE,
    REMOTE_TAILSCALE_NOTE,
    remoteChip,
    remoteProvider,
    remoteProviderPatch,
    remoteSetupPatch,
    remoteStatusLines,
    remoteSwitch,
} from "./remotemodel";

const UNSET: RemoteStatusData = {
    on: false,
    missing: ["tunneltoken", "team", "aud", "email", "hostname"],
    tunnel: "off",
    subscriptions: 0,
};
const OFF: RemoteStatusData = { on: false, hostname: "arc.example.com", port: 8765, tunnel: "off", subscriptions: 0 };
const UP: RemoteStatusData = { ...OFF, on: true, tunnel: "up", subscriptions: 1 };
const DOWN: RemoteStatusData = { ...UP, tunnel: "down", tunnelerror: "connection refused" };
const NO_CLOUDFLARED: RemoteStatusData = { ...OFF, cloudflaredmissing: true };

const texts = (s: RemoteStatusData | null) => remoteStatusLines(s).map((l) => l.text);

describe("remoteSwitch", () => {
    it("is disabled with no note before the status loads", () => {
        expect(remoteSwitch(null)).toEqual({ enabled: false, on: false, note: null });
    });

    it("is disabled and points at setup while setup is missing", () => {
        expect(remoteSwitch(UNSET)).toEqual({ enabled: false, on: false, note: REMOTE_SETUP_NOTE });
    });

    it("names setup before cloudflared when both are missing", () => {
        expect(remoteSwitch({ ...UNSET, cloudflaredmissing: true }).note).toBe(REMOTE_SETUP_NOTE);
    });

    it("is disabled with the winget line while cloudflared is missing", () => {
        expect(remoteSwitch(NO_CLOUDFLARED)).toEqual({ enabled: false, on: false, note: REMOTE_CLOUDFLARED_NOTE });
        expect(REMOTE_CLOUDFLARED_NOTE).toContain("winget install --id Cloudflare.cloudflared");
    });

    it("is enabled and off once set up", () => {
        expect(remoteSwitch(OFF)).toEqual({ enabled: true, on: false, note: null });
    });

    it("is enabled and on while on, tunnel up or down", () => {
        expect(remoteSwitch(UP)).toEqual({ enabled: true, on: true, note: null });
        expect(remoteSwitch(DOWN)).toEqual({ enabled: true, on: true, note: null });
    });

    it("can still turn off when cloudflared went missing while on", () => {
        expect(remoteSwitch({ ...DOWN, cloudflaredmissing: true })).toEqual({ enabled: true, on: true, note: null });
    });
});

describe("remoteStatusLines", () => {
    it("is empty before the status loads", () => {
        expect(remoteStatusLines(null)).toEqual([]);
    });

    it("names every missing setup field, with no address", () => {
        expect(texts(UNSET)).toEqual([
            "Setup incomplete, missing tunnel token, team, audience tag, email, hostname",
            "Tunnel off",
            "No phone subscribed yet",
        ]);
    });

    it("shows setup complete, the address and no phone when set but off", () => {
        expect(texts(OFF)).toEqual([
            "Setup complete",
            "Tunnel off",
            "https://arc.example.com",
            "No phone subscribed yet",
        ]);
    });

    it("shows the tunnel up and the phone subscribed when on", () => {
        expect(texts(UP)).toEqual(["Setup complete", "Tunnel up", "https://arc.example.com", "Phone subscribed"]);
        expect(remoteStatusLines(UP).some((l) => l.error)).toBe(false);
    });

    it("marks the down line with its error", () => {
        const tunnel = remoteStatusLines(DOWN).find((l) => l.id === "tunnel");
        expect(tunnel).toEqual({ id: "tunnel", text: "Tunnel down: connection refused", error: true });
    });

    it("counts more than one phone", () => {
        expect(texts({ ...UP, subscriptions: 3 })).toContain("3 phones subscribed");
    });
});

describe("remoteChip", () => {
    it("is hidden until remote mode can be switched on", () => {
        expect(remoteChip(null)).toBeNull();
        expect(remoteChip(UNSET)).toBeNull();
        expect(remoteChip(NO_CLOUDFLARED)).toBeNull();
    });

    it("shows off once set up", () => {
        expect(remoteChip(OFF)).toMatchObject({ tone: "off", label: "Remote off" });
    });

    it("shows on with the phone address while the tunnel is up", () => {
        expect(remoteChip(UP)).toEqual({
            tone: "on",
            label: "Remote on",
            title: "Reachable from your phone at https://arc.example.com",
        });
    });

    it("shows down with the tunnel error", () => {
        expect(remoteChip(DOWN)).toEqual({
            tone: "down",
            label: "Remote down",
            title: "Tunnel down: connection refused",
        });
    });

    it("shows starting while on and the tunnel is not up yet", () => {
        expect(remoteChip({ ...UP, tunnel: "starting" })).toMatchObject({ tone: "starting" });
    });

    it("stays reachable when on even if setup has since gone missing", () => {
        expect(remoteChip({ ...UP, cloudflaredmissing: true })).toMatchObject({ tone: "on" });
    });
});

describe("remoteSetupPatch", () => {
    const EMPTY = { tunneltoken: "", team: "", aud: "", email: "", hostname: "" };

    it("sends only the edited field, so Setup keeps every other stored value", () => {
        expect(remoteSetupPatch("team", " acme ")).toEqual({ ...EMPTY, team: "acme" });
        expect(remoteSetupPatch("tunneltoken", "eyJh")).toEqual({ ...EMPTY, tunneltoken: "eyJh" });
    });

    it("sends the port as a number", () => {
        expect(remoteSetupPatch("port", "8765")).toEqual({ ...EMPTY, port: 8765 });
    });

    it("refuses a port that is not a whole number", () => {
        for (const bad of ["80a", "1.5", "-1"]) {
            expect(remoteSetupPatch("port", bad)).toHaveProperty("error");
        }
    });

    it("refuses an empty value, since Setup would keep the stored one", () => {
        expect(remoteSetupPatch("email", "  ")).toEqual({ error: "email can't be empty" });
    });
});

describe("tailscale", () => {
    const TS: RemoteStatusData = {
        ...OFF,
        provider: "tailscale",
        hostname: "pc.tail123.ts.net",
        email: "me@example.com",
    };

    it("reads an old status with no provider as cloudflare", () => {
        expect(remoteProvider(OFF)).toBe("cloudflare");
        expect(remoteProvider(null)).toBe("cloudflare");
        expect(remoteProvider(TS)).toBe("tailscale");
    });

    it("switches provider with a setup that carries nothing else", () => {
        expect(remoteProviderPatch("tailscale")).toEqual({
            provider: "tailscale",
            tunneltoken: "",
            team: "",
            aud: "",
            email: "",
            hostname: "",
        });
    });

    it("is disabled with the install line while tailscale is missing", () => {
        expect(remoteSwitch({ ...TS, tailscalemissing: true })).toEqual({
            enabled: false,
            on: false,
            note: REMOTE_TAILSCALE_NOTE,
        });
    });

    it("names tailscale serve and the tailnet login in the status lines", () => {
        expect(texts({ ...TS, on: true, tunnel: "up" })).toContain("Tailscale serve up");
        expect(texts({ ...TS, missing: ["email"] })[0]).toBe("Setup incomplete, missing tailnet login");
        expect(texts(TS)).toContain("https://pc.tail123.ts.net");
    });
});
