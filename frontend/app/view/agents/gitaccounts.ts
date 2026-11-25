// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Settings → Agents → GitHub accounts: the pure side of the card. The rows (the Default one first), what each token
// state says, the add dialog's step reducer, and the fix list (its rows, default ticks, button rule and the payload
// Apply sends). The card (settingspages/gitaccounts.tsx) and its two dialogs only draw these.

// Network RPCs (a token check against GitHub, a scan of up to 50 repos, a fix) outlast wshrpc's 5 s default.
export const GIT_RPC_OPTS = { timeout: 30000 };

export const NO_FOLDER = "No folder";
export const CREDENTIALS_PATH = "~/.git-credentials";

// ── rows ────────────────────────────────────────────────────────────────────────────────────────────

export type GitRow =
    | { kind: "default"; id: "default"; login: string; label: string; email: string; helper: string }
    | {
          kind: "account";
          id: string;
          login: string;
          label: string;
          email: string;
          // what Rename and Change email start from
          name: string;
          address: string;
          roots: string[];
      };

// The Default row (what git does outside every root: the machine's identity and its github.com helper), then one
// row per account in the order the backend keeps them.
export function gitRows(list: GitAccountListRtnData): GitRow[] {
    const login = list.defaultlogin ?? "";
    const global = [list.globalname ?? "", list.globalemail ?? ""].filter((s) => s !== "");
    return [
        {
            kind: "default",
            id: "default",
            login,
            label: login !== "" ? login : "Default",
            email: global.join(" · "),
            helper: list.defaulthelper ?? "",
        },
        ...list.accounts.map(
            (a): GitRow => ({
                kind: "account",
                id: a.login,
                login: a.login,
                label: a.login,
                // the commit name, shown only when it says more than the login does
                email: [a.name != null && a.name !== a.login ? a.name : "", a.email ?? ""]
                    .filter((s) => s !== "")
                    .join(" · "),
                name: a.name ?? a.login,
                address: a.email ?? "",
                roots: a.roots ?? [],
            })
        ),
    ];
}

// "Signed in with gh" for the helper git uses for github.com outside every root.
export function helperText(helper: string): string {
    switch (helper.trim()) {
        case "":
            return "No credential helper";
        case "gh":
            return "Signed in with gh";
        case "osxkeychain":
            return "Keychain";
        case "manager":
        case "manager-core":
            return "Credential Manager";
        default:
            return helper;
    }
}

// ── token state ─────────────────────────────────────────────────────────────────────────────────────

// The backend's four states, plus the two the card adds: the check has not come back yet, and the check itself failed.
export type TokenView = "saved" | "refused" | "missing" | "unreachable" | "checking" | "failed";
export type Tone = "ok" | "warn" | "error" | "muted";

export function tokenView(s: GitAccountTokenStateData | null | undefined): TokenView {
    if (s == null) {
        return "checking";
    }
    switch (s.state) {
        case "saved":
        case "refused":
        case "missing":
        case "unreachable":
            return s.state;
        default:
            return "failed";
    }
}

export function tokenStateText(view: TokenView): { text: string; tone: Tone } {
    switch (view) {
        case "saved":
            return { text: "Token saved", tone: "ok" };
        case "refused":
            return { text: "Token refused by GitHub", tone: "error" };
        case "missing":
            return { text: "No token saved", tone: "warn" };
        case "unreachable":
            return { text: "Couldn't reach GitHub", tone: "warn" };
        case "failed":
            return { text: "Couldn't check the token", tone: "warn" };
        case "checking":
            return { text: "Checking token…", tone: "muted" };
    }
}

// ── scan ────────────────────────────────────────────────────────────────────────────────────────────

export type ScanStatus = "running" | "done" | "failed";

export function scanFor(scan: GitAccountScanRtnData | null, login: string): GitAccountScanData | null {
    return scan?.accounts?.find((a) => a.login === login) ?? null;
}

// A dash until the scan has an answer for the account: running, or failed.
export function repoCountText(status: ScanStatus, s: GitAccountScanData | null): string {
    if (status !== "done" || s == null) {
        return "—";
    }
    return `${s.repos} ${s.repos === 1 ? "repo" : "repos"}`;
}

// What the scan could not read, one line for the card's note.
export function scanErrorText(scan: GitAccountScanRtnData | null): string {
    return (scan?.errors ?? []).join("; ");
}

// The warning strip under the rows: what the scan found for the account. "" when there is nothing to fix.
// ~/.git-credentials lines are not counted here: they are one row of the fix list, not a finding of the account.
export function leakText(s: GitAccountScanData | null, roots: string[]): string {
    const tokens = s?.tokenrepos?.length ?? 0;
    const identities = s?.identityrepos?.length ?? 0;
    const repos = (n: number) => `${n} ${n === 1 ? "repo" : "repos"}`;
    const where = roots.length === 1 ? ` under ${roots[0]}` : "";
    const parts: string[] = [];
    if (tokens > 0) {
        parts.push(`${repos(tokens)}${where} ${tokens === 1 ? "keeps" : "keep"} a token in their remote URL`);
    }
    if (identities > 0) {
        parts.push(`${repos(identities)}${where} set their own name or email`);
    }
    return parts.length === 0 ? "" : `${parts.join("; ")}.`;
}

// ── fix list ────────────────────────────────────────────────────────────────────────────────────────

export type FixKind = "token" | "identity" | "credentials";

export type FixRow = {
    key: string; // "<kind>:<path>"
    kind: FixKind;
    path: string;
    title: string;
    detail: string;
    ticked: boolean;
};

export function fixKey(kind: string, path: string): string {
    // the credentials fix is one row for the one file: its result names the file by whatever path the backend uses
    return kind === "credentials" ? `credentials:${CREDENTIALS_PATH}` : `${kind}:${path}`;
}

// Every repo the fix would touch: leaked tokens, then repos with an identity of their own, then ~/.git-credentials.
// Token and credentials rows start ticked; an identity row never does (a repo may set its own on purpose).
export function fixRows(s: GitAccountScanData | null, credentialsLines: number): FixRow[] {
    const rows: FixRow[] = [];
    for (const r of s?.tokenrepos ?? []) {
        rows.push({
            key: fixKey("token", r.path),
            kind: "token",
            path: r.path,
            title: r.path,
            detail: r.maskedurl,
            ticked: true,
        });
    }
    for (const r of s?.identityrepos ?? []) {
        const who = [r.name ?? "", r.email ?? ""].filter((x) => x !== "").join(" · ");
        rows.push({
            key: fixKey("identity", r.path),
            kind: "identity",
            path: r.path,
            title: r.path,
            detail: who === "" ? "its own identity" : who,
            ticked: false,
        });
    }
    if (credentialsLines > 0) {
        rows.push({
            key: fixKey("credentials", CREDENTIALS_PATH),
            kind: "credentials",
            path: CREDENTIALS_PATH,
            title: CREDENTIALS_PATH,
            detail: `${credentialsLines} github.com ${credentialsLines === 1 ? "line" : "lines"} kept in plain text`,
            ticked: true,
        });
    }
    return rows;
}

export function defaultTicks(rows: FixRow[]): Set<string> {
    return new Set(rows.filter((r) => r.ticked).map((r) => r.key));
}

// The fix button needs the token in the store (so removing it from a URL never breaks the next push) and something
// to fix. A `title` on the disabled button says which of the two is missing.
export function fixAllowed(view: TokenView, rows: FixRow[]): boolean {
    return view === "saved" && rows.length > 0;
}

export function fixDisabledReason(view: TokenView, rows: FixRow[]): string {
    if (rows.length === 0) {
        return "Nothing to fix";
    }
    return view === "saved" ? "" : "Fix needs this account's token saved and accepted by GitHub";
}

export function fixPayload(login: string, rows: FixRow[], ticked: Set<string>): CommandGitAccountFixData {
    const on = rows.filter((r) => ticked.has(r.key));
    return {
        login,
        tokenrepos: on.filter((r) => r.kind === "token").map((r) => r.path),
        identityrepos: on.filter((r) => r.kind === "identity").map((r) => r.path),
        credentials: on.some((r) => r.kind === "credentials"),
    };
}

// The result for each row of the list, by key; a result the list has no row for (it should not happen) is dropped.
export function fixResultsByKey(results: GitFixResultData[]): Map<string, GitFixResultData> {
    return new Map(results.map((r) => [fixKey(r.kind, r.path ?? ""), r]));
}

// ── add dialog ──────────────────────────────────────────────────────────────────────────────────────

// "add": login + token → check → email / folder / default login → save. "token": the login is fixed and only the
// token is asked (Replace token); a good check there saves straight away.
export type AddMode = "add" | "token";

export type AddStep =
    | { kind: "token"; busy: boolean; error: string | null }
    | { kind: "details"; user: GitHubUserData; busy: boolean; error: string | null }
    | { kind: "done" };

export type AddAction =
    | { type: "checking" }
    | { type: "refused"; message: string }
    | { type: "checked"; user: GitHubUserData }
    | { type: "saving" }
    | { type: "failed"; message: string }
    | { type: "saved" };

export const addStepInit: AddStep = { kind: "token", busy: false, error: null };

export function addStep(s: AddStep, a: AddAction): AddStep {
    switch (a.type) {
        case "checking":
            return s.kind === "token" ? { kind: "token", busy: true, error: null } : s;
        case "refused":
            // a refused check stays on the token step with its reason
            return { kind: "token", busy: false, error: a.message };
        case "checked":
            return { kind: "details", user: a.user, busy: false, error: null };
        case "saving":
            return s.kind === "details" ? { ...s, busy: true, error: null } : s;
        case "failed":
            return s.kind === "details" ? { ...s, busy: false, error: a.message } : s;
        case "saved":
            return { kind: "done" };
    }
}

export type AddForm = { login: string; token: string; email: string; root: string; defaultLogin: string };

export function emailOk(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// The first account asks for the default login too: the account git uses outside every root.
export function needsDefaultLogin(list: GitAccountListRtnData | null): boolean {
    return (list?.defaultlogin ?? "") === "";
}

export function canCheck(form: AddForm, mode: AddMode, busy: boolean): boolean {
    return !busy && form.token.trim() !== "" && (mode === "token" || form.login.trim() !== "");
}

export function canSave(form: AddForm, needsDefault: boolean, busy: boolean): boolean {
    return (
        !busy && emailOk(form.email) && form.root.trim() !== "" && (!needsDefault || form.defaultLogin.trim() !== "")
    );
}

// The RPC payload of Save. The commit name is GitHub's name for the account, else its login.
export function addPayload(form: AddForm, user: GitHubUserData, needsDefault: boolean): CommandGitAccountAddData {
    return {
        login: user.login !== "" ? user.login : form.login.trim(),
        token: form.token.trim(),
        name: user.name != null && user.name !== "" ? user.name : user.login || form.login.trim(),
        email: form.email.trim(),
        root: form.root.trim(),
        ...(needsDefault ? { defaultlogin: form.defaultLogin.trim() } : {}),
    };
}
