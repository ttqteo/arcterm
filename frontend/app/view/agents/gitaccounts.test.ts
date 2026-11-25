// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    addPayload,
    addStep,
    addStepInit,
    canCheck,
    canSave,
    CREDENTIALS_PATH,
    defaultTicks,
    emailOk,
    fixAllowed,
    fixDisabledReason,
    fixPayload,
    fixResultsByKey,
    fixRows,
    gitRows,
    helperText,
    leakText,
    needsDefaultLogin,
    repoCountText,
    scanFor,
    tokenStateText,
    tokenView,
    type AddForm,
    type AddStep,
} from "./gitaccounts";

const list = (over: Partial<GitAccountListRtnData> = {}): GitAccountListRtnData => ({
    accounts: [
        { login: "ttqteo", name: "Tu Quang", email: "me@example.com", roots: ["/work/me"] },
        { login: "acme-dev", name: "acme-dev", email: "dev@acme.test", roots: [] },
    ],
    defaultlogin: "work-login",
    globalname: "T Q",
    globalemail: "global@example.com",
    defaulthelper: "gh",
    ...over,
});

describe("gitRows", () => {
    it("puts the Default row first, then the accounts in the backend's order", () => {
        const rows = gitRows(list());
        expect(rows.map((r) => r.id)).toEqual(["default", "ttqteo", "acme-dev"]);
        expect(rows[0]).toMatchObject({ kind: "default", login: "work-login", helper: "gh" });
        expect(rows[0].email).toBe("T Q · global@example.com");
    });

    it("names the Default row by its login, or Default while none is set", () => {
        expect(gitRows(list())[0].label).toBe("work-login");
        expect(gitRows(list({ defaultlogin: undefined }))[0].label).toBe("Default");
    });

    it("shows the commit name beside the email only when it differs from the login", () => {
        const rows = gitRows(list());
        expect(rows[1].email).toBe("Tu Quang · me@example.com");
        expect(rows[2].email).toBe("dev@acme.test");
    });

    it("keeps an account with no root as an account with an empty roots list", () => {
        const row = gitRows(list())[2];
        expect(row.kind === "account" && row.roots).toEqual([]);
    });

    it("lists only the Default row when there is no account", () => {
        expect(gitRows(list({ accounts: [] })).map((r) => r.id)).toEqual(["default"]);
    });
});

describe("helperText", () => {
    it("names the helpers the cards meet", () => {
        expect(helperText("gh")).toBe("Signed in with gh");
        expect(helperText("osxkeychain")).toBe("Keychain");
        expect(helperText("manager")).toBe("Credential Manager");
        expect(helperText("")).toBe("No credential helper");
        expect(helperText("store")).toBe("store");
    });
});

describe("token state text", () => {
    it("says each state in words, with a tone that is never the only signal", () => {
        expect(tokenStateText("saved")).toEqual({ text: "Token saved", tone: "ok" });
        expect(tokenStateText("refused")).toEqual({ text: "Token refused by GitHub", tone: "error" });
        expect(tokenStateText("missing")).toEqual({ text: "No token saved", tone: "warn" });
        expect(tokenStateText("unreachable")).toEqual({ text: "Couldn't reach GitHub", tone: "warn" });
        expect(tokenStateText("checking").text).toBe("Checking token…");
        expect(tokenStateText("failed").tone).toBe("warn");
    });

    it("reads the backend's state, treats no answer as checking and a state it does not know as failed", () => {
        expect(tokenView({ state: "saved" })).toBe("saved");
        expect(tokenView({ state: "unreachable", detail: "offline" })).toBe("unreachable");
        expect(tokenView(null)).toBe("checking");
        expect(tokenView(undefined)).toBe("checking");
        expect(tokenView({ state: "weird" })).toBe("failed");
    });
});

const scan = (): GitAccountScanRtnData => ({
    credentialslines: 2,
    accounts: [
        {
            login: "ttqteo",
            repos: 31,
            tokenrepos: [
                { path: "/work/me/a", remote: "origin", maskedurl: "https://•••@github.com/me/a" },
                { path: "/work/me/b", remote: "origin", maskedurl: "https://•••@github.com/me/b" },
            ],
            identityrepos: [{ path: "/work/me/c", name: "Old Me", email: "old@example.com" }],
        },
        { login: "acme-dev", repos: 1, tokenrepos: [], identityrepos: [] },
    ],
});

describe("scan reading", () => {
    it("shows a dash until the scan has answered for the account", () => {
        const s = scanFor(scan(), "ttqteo");
        expect(repoCountText("running", s)).toBe("—");
        expect(repoCountText("failed", s)).toBe("—");
        expect(repoCountText("done", null)).toBe("—");
        expect(repoCountText("done", s)).toBe("31 repos");
        expect(repoCountText("done", scanFor(scan(), "acme-dev"))).toBe("1 repo");
    });

    it("finds an account's scan by login", () => {
        expect(scanFor(scan(), "ttqteo")?.repos).toBe(31);
        expect(scanFor(scan(), "nobody")).toBeNull();
        expect(scanFor(null, "ttqteo")).toBeNull();
    });

    it("words the warning strip from what the scan found, and says nothing when there is none", () => {
        expect(leakText(scanFor(scan(), "ttqteo"), ["/work/me"])).toBe(
            "2 repos under /work/me keep a token in their remote URL; 1 repo under /work/me set their own name or email."
        );
        expect(leakText(scanFor(scan(), "ttqteo"), ["/a", "/b"])).toContain("2 repos keep a token");
        expect(leakText(scanFor(scan(), "acme-dev"), [])).toBe("");
        expect(leakText(null, [])).toBe("");
    });
});

describe("fix list", () => {
    it("lists token repos, then identity repos, then the credentials file", () => {
        const rows = fixRows(scanFor(scan(), "ttqteo"), 2);
        expect(rows.map((r) => r.key)).toEqual([
            "token:/work/me/a",
            "token:/work/me/b",
            "identity:/work/me/c",
            `credentials:${CREDENTIALS_PATH}`,
        ]);
        expect(rows[0].detail).toBe("https://•••@github.com/me/a");
        expect(rows[2].detail).toBe("Old Me · old@example.com");
        expect(rows[3].detail).toBe("2 github.com lines kept in plain text");
    });

    it("has no credentials row when ~/.git-credentials holds no github.com line", () => {
        expect(fixRows(scanFor(scan(), "ttqteo"), 0).some((r) => r.kind === "credentials")).toBe(false);
    });

    it("ticks token and credentials rows and leaves identity rows unticked", () => {
        const rows = fixRows(scanFor(scan(), "ttqteo"), 1);
        expect([...defaultTicks(rows)]).toEqual([
            "token:/work/me/a",
            "token:/work/me/b",
            `credentials:${CREDENTIALS_PATH}`,
        ]);
    });

    it("enables the fix button only with the token saved and something to fix", () => {
        const rows = fixRows(scanFor(scan(), "ttqteo"), 0);
        expect(fixAllowed("saved", rows)).toBe(true);
        for (const v of ["refused", "missing", "unreachable", "checking", "failed"] as const) {
            expect(fixAllowed(v, rows)).toBe(false);
        }
        expect(fixAllowed("saved", [])).toBe(false);
        expect(fixDisabledReason("saved", [])).toBe("Nothing to fix");
        expect(fixDisabledReason("refused", rows)).toMatch(/token/);
        expect(fixDisabledReason("saved", rows)).toBe("");
    });

    it("sends only the ticked paths, grouped by kind", () => {
        const rows = fixRows(scanFor(scan(), "ttqteo"), 1);
        const ticked = defaultTicks(rows);
        ticked.delete("token:/work/me/b");
        ticked.add("identity:/work/me/c");
        expect(fixPayload("ttqteo", rows, ticked)).toEqual({
            login: "ttqteo",
            tokenrepos: ["/work/me/a"],
            identityrepos: ["/work/me/c"],
            credentials: true,
        });
        expect(fixPayload("ttqteo", rows, new Set())).toEqual({
            login: "ttqteo",
            tokenrepos: [],
            identityrepos: [],
            credentials: false,
        });
    });

    it("matches a result to its row, the credentials one whatever path the backend names", () => {
        const byKey = fixResultsByKey([
            { kind: "token", path: "/work/me/a" },
            { kind: "identity", path: "/work/me/c", error: "locked" },
            { kind: "credentials", path: "C:\\Users\\me\\.git-credentials" },
        ]);
        expect(byKey.get("token:/work/me/a")?.error).toBeUndefined();
        expect(byKey.get("identity:/work/me/c")?.error).toBe("locked");
        expect(byKey.has(`credentials:${CREDENTIALS_PATH}`)).toBe(true);
    });
});

describe("add dialog steps", () => {
    const user = { login: "ttqteo", name: "Tu Quang", email: "pub@example.com" };

    it("starts on the token step", () => {
        expect(addStepInit).toEqual({ kind: "token", busy: false, error: null });
    });

    it("moves token → details on a good check, and busy while it runs", () => {
        let s: AddStep = addStep(addStepInit, { type: "checking" });
        expect(s).toEqual({ kind: "token", busy: true, error: null });
        s = addStep(s, { type: "checked", user });
        expect(s).toEqual({ kind: "details", user, busy: false, error: null });
    });

    it("keeps a refused check on the token step with its error, and clears it on the next try", () => {
        let s: AddStep = addStep(addStep(addStepInit, { type: "checking" }), {
            type: "refused",
            message: "token is for another login",
        });
        expect(s).toEqual({ kind: "token", busy: false, error: "token is for another login" });
        s = addStep(s, { type: "checking" });
        expect(s).toEqual({ kind: "token", busy: true, error: null });
    });

    it("keeps a failed save on the details step with its error, and ends on saved", () => {
        let s: AddStep = addStep(addStepInit, { type: "checked", user });
        s = addStep(s, { type: "saving" });
        expect(s).toMatchObject({ kind: "details", busy: true });
        s = addStep(s, { type: "failed", message: "root is inside another account's root" });
        expect(s).toMatchObject({ kind: "details", busy: false, error: "root is inside another account's root" });
        expect(addStep(s, { type: "saved" })).toEqual({ kind: "done" });
    });

    it("ignores a save or a failure that arrives off the details step", () => {
        expect(addStep(addStepInit, { type: "saving" })).toBe(addStepInit);
        expect(addStep(addStepInit, { type: "failed", message: "x" })).toBe(addStepInit);
    });

    const form = (over: Partial<AddForm> = {}): AddForm => ({
        login: "ttqteo",
        token: "ghp_x",
        email: "me@example.com",
        root: "/work/me",
        defaultLogin: "",
        ...over,
    });

    it("checks once the token and, for a new account, the login are filled", () => {
        expect(canCheck(form(), "add", false)).toBe(true);
        expect(canCheck(form({ login: " " }), "add", false)).toBe(false);
        expect(canCheck(form({ login: "" }), "token", false)).toBe(true);
        expect(canCheck(form({ token: "" }), "add", false)).toBe(false);
        expect(canCheck(form(), "add", true)).toBe(false);
    });

    it("requires the default login for the first account only", () => {
        expect(needsDefaultLogin(list({ defaultlogin: undefined, accounts: [] }))).toBe(true);
        expect(needsDefaultLogin(list({ defaultlogin: "" }))).toBe(true);
        expect(needsDefaultLogin(list())).toBe(false);
        expect(needsDefaultLogin(null)).toBe(true);
        expect(canSave(form(), true, false)).toBe(false);
        expect(canSave(form({ defaultLogin: "work-login" }), true, false)).toBe(true);
        expect(canSave(form(), false, false)).toBe(true);
    });

    it("saves only with a valid email and a folder, and not while busy", () => {
        expect(canSave(form({ email: "nope" }), false, false)).toBe(false);
        expect(canSave(form({ root: " " }), false, false)).toBe(false);
        expect(canSave(form(), false, true)).toBe(false);
        expect(emailOk("a@b.co")).toBe(true);
        expect(emailOk("a b@c.co")).toBe(false);
    });

    it("builds the add payload: GitHub's name else the login, and the default login only for the first account", () => {
        expect(addPayload(form(), user, false)).toEqual({
            login: "ttqteo",
            token: "ghp_x",
            name: "Tu Quang",
            email: "me@example.com",
            root: "/work/me",
        });
        expect(addPayload(form({ defaultLogin: " work-login " }), { login: "ttqteo" }, true)).toMatchObject({
            name: "ttqteo",
            defaultlogin: "work-login",
        });
    });
});
