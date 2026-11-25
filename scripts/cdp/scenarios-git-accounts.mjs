// Settings → Agents → GitHub accounts (docs/superpowers/specs/2026-11-25-git-accounts-design.md), one scenario:
//
//   settings-git-accounts: the card under Claude account on the Agents page. The Default row (its login, name and email,
//   its credential helper) and four account rows (folders, token state, repo count), the warning strip with its Fix
//   button, the empty state, the add dialog (a refused check, then email / folder / default login and Save), the fix
//   list (ticks, the payload, a row that failed), a scan error, and each ⋯ menu action with the payload it sends.
//
// Nothing real is written or fetched: an RPC mock (RpcApi.setMockRpcClient) answers every gitaccount* command from
// fixtures, keeps the list in memory so a write changes what the next list read returns, and records the calls. Every
// other command goes on to whatever client was installed before. The card reads its list on mount, so a step that needs
// another fixture seeds it and mounts the card again (cockpit and back to Settings). Clicks and keys are real CDP input
// events; a menu row is clicked through its data-menu-item hook.

import * as AC from "./agent-page-fixtures.mjs";

const WAIT_MS = 15000;
const SHORT_MS = 6000;
const MOCK_KEY = "__gitAccountsMock";
const CARD = `document.querySelector('[data-setting-card="gitaccounts"]')`;
const VK = { Enter: 13, Escape: 27 };

// --- the fixtures ------------------------------------------------------------------------------------------------------

const WORK = "/Users/verify/work";
const OSS = "/Users/verify/oss";
const LAB = "/Users/verify/lab";
const SIDE = "/Users/verify/side";
const NEW_ROOT = "/Users/verify/new-work";
const FAIL_TEXT = "couldn't write .git/config: permission denied";
const REFUSED_TEXT = "GitHub refused this token (401 Bad credentials)";
const KEEP_DEFAULT_TEXT = "dave is the default login: choose another default login first";

const repo = (root, name, login) => ({
    path: `${root}/${name}`,
    remote: "origin",
    maskedurl: `https://${login}:***@github.com/${login}/${name}.git`,
});

// four accounts, one of each token state; alice and bob have repos to fix, carol has no folder, dave is the default login
const FULL = {
    defaultlogin: "dave",
    globalname: "Dave Verify",
    globalemail: "dave@verify.test",
    defaulthelper: "osxkeychain",
    accounts: [
        { login: "alice", name: "Alice Verify", email: "alice@verify.test", roots: [WORK] },
        { login: "bob", name: "Bob Verify", email: "bob@verify.test", roots: [OSS] },
        { login: "carol", name: "carol", email: "carol@verify.test", roots: [] },
        { login: "dave", name: "Dave Verify", email: "dave@verify.test", roots: [LAB] },
    ],
    tokens: {
        alice: { state: "saved" },
        bob: { state: "refused", detail: "401 Bad credentials" },
        carol: { state: "missing" },
        dave: { state: "unreachable", detail: "dial tcp: no route to host" },
    },
    scan: {
        alice: {
            repos: 3,
            tokenrepos: [repo(WORK, "api", "alice"), repo(WORK, "web", "alice")],
            identityrepos: [{ path: `${WORK}/legacy`, name: "Old Name", email: "old@verify.test" }],
        },
        bob: { repos: 2, tokenrepos: [repo(OSS, "lib", "bob")], identityrepos: [] },
        carol: { repos: 0, tokenrepos: [], identityrepos: [] },
        dave: { repos: 1, tokenrepos: [], identityrepos: [] },
    },
    credentialslines: 2,
};

// no account and no default login: the first account asks for the default login too
const EMPTY = {
    defaultlogin: "",
    globalname: "",
    globalemail: "",
    defaulthelper: "",
    accounts: [],
    tokens: {},
    scan: {},
    credentialslines: 0,
};

// clean repos for every account and two github.com lines in ~/.git-credentials: the credentials-only strip; dave, the
// default login, has his token saved so Fix is open
const CREDENTIALS_ONLY = {
    ...FULL,
    tokens: { ...FULL.tokens, dave: { state: "saved" } },
    scan: {
        alice: { repos: 3, tokenrepos: [], identityrepos: [] },
        bob: { repos: 2, tokenrepos: [], identityrepos: [] },
        carol: { repos: 0, tokenrepos: [], identityrepos: [] },
        dave: { repos: 1, tokenrepos: [], identityrepos: [] },
    },
    credentialslines: 2,
};
const CREDENTIALS_TEXT = "~/.git-credentials keeps 2 github.com lines in plain text.";

// --- page expressions --------------------------------------------------------------------------------------------------

const q = JSON.stringify;
const FLAT = `((el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim())`;
const sel = (s) => `document.querySelector(${q(s)})`;
const rowSel = (id) => `[data-git-account-row=${q(id)}]`;
const fixRowSel = (key) => `[data-git-fix-row=${q(key)}]`;
const menuSel = (label) => `[data-menu-item=${q(label)}]`;
const dialogButton = (prefix) =>
    `[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim().startsWith(${q(prefix)}))`;

// an object compared whatever its key order
const canon = (v) =>
    JSON.stringify(v, (_k, x) =>
        x && typeof x === "object" && !Array.isArray(x)
            ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
            : x
    );
const same = (a, b) => canon(a) === canon(b);

// everything the card draws, in one read: the Default row and each login's row
const READ_CARD = (logins) => `(() => {
    const flat = ${FLAT};
    const card = ${CARD};
    if (!card) return null;
    const rowOf = (id) => card.querySelector('[data-git-account-row="' + id + '"]');
    const d = rowOf("default");
    const out = { def: d ? { text: flat(d), helper: flat(d.querySelector("[data-git-default-helper]")) } : null, rows: {} };
    for (const l of ${q(logins)}) {
        const r = rowOf(l);
        if (!r) { out.rows[l] = null; continue; }
        const token = r.querySelector("[data-git-account-token]");
        const fix = r.querySelector("[data-git-account-fix]");
        out.rows[l] = {
            roots: [...r.querySelectorAll("[data-git-account-root]")].map((e) => e.getAttribute("data-git-account-root")),
            rootText: [...r.querySelectorAll("[data-git-account-root]")].map(flat),
            state: token ? token.getAttribute("data-state") : null,
            token: flat(token),
            repos: flat(r.querySelector("[data-git-account-repos]")),
            leaks: !!r.querySelector("[data-git-account-leaks]"),
            leakText: flat(r.querySelector("[data-git-account-leaks]")),
            fix: fix ? { disabled: fix.disabled, title: fix.getAttribute("title") ?? "" } : null,
        };
    }
    return out;
})()`;

// every token check and the one scan have answered: no row is still on "Checking…" and no count is a dash
const SETTLED = `(() => {
    const card = ${CARD};
    if (!card) return false;
    const tokens = [...card.querySelectorAll("[data-git-account-token]")];
    const repos = [...card.querySelectorAll("[data-git-account-repos]")];
    return tokens.length > 0 && tokens.every((t) => t.getAttribute("data-state") !== "checking") && repos.every((r) => r.textContent.trim() !== "—");
})()`;

export default function (kit) {
    const { polishWaitFor, polishNap } = kit;

    // --- input ------------------------------------------------------------------------------------------------------

    async function press(h, name, nap = 300) {
        for (const type of ["keyDown", "keyUp"]) {
            await h.cdp("Input.dispatchKeyEvent", { type, key: name, code: name, windowsVirtualKeyCode: VK[name] });
        }
        await polishNap(nap);
    }

    // A real mouse click at the middle of the element `expr` evaluates to (scrolled into view); false when none is drawn.
    // A row or a dialog still springing into place is clicked where it settles.
    async function click(h, expr) {
        const measure = () =>
            h.ev(`(() => {
                const el = ${expr};
                if (!el) return null;
                el.scrollIntoView({ block: "center" });
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
            })()`);
        let box = await measure();
        for (let i = 0; i < 8 && box != null; i++) {
            await polishNap(120);
            const again = await measure();
            const steady = again != null && again.x === box.x && again.y === box.y;
            box = again;
            if (steady) break;
        }
        if (box == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
        for (const type of ["mousePressed", "mouseReleased"]) {
            await h.cdp("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
        }
        await polishNap(300);
        return true;
    }
    const clickSel = (h, s) => click(h, sel(s));

    // a real pointer over the element, from outside it (a submenu opens on hover)
    async function hover(h, expr) {
        const at = await h.ev(`(() => {
            const el = ${expr};
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        })()`);
        if (at == null) return false;
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
        await h.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
        await polishNap(200);
        return true;
    }

    // focuses the field, selects what it holds and types over it
    async function typeInto(h, selector, text) {
        const focused = await h.ev(`(() => {
            const el = ${sel(selector)};
            if (!el) return false;
            el.focus();
            el.select?.();
            return document.activeElement === el;
        })()`);
        if (!focused) return false;
        await h.cdp("Input.insertText", { text });
        await polishNap(150);
        return true;
    }

    // ⋯ button → the menu row with this label. A menu that is still fading out is waited for, so the next one is not mixed
    // with it.
    async function pickMenu(h, menuId, label) {
        if (!(await clickSel(h, `[data-git-account-menu=${q(menuId)}]`))) return false;
        if (!(await polishWaitFor(h, `!!${sel(menuSel(label))}`, SHORT_MS))) return false;
        const clicked = await h.ev(`(() => { const r = ${sel(menuSel(label))}; if (!r) return false; r.click(); return true; })()`);
        await polishWaitFor(h, `!document.querySelector("[data-menu-item]")`, SHORT_MS);
        return clicked;
    }

    async function shot(h, name) {
        try {
            await h.shot(`cdp-shots/settings-git-accounts-${name}.png`);
        } catch (e) {
            console.error(`settings-git-accounts: the shot ${name} failed: ${e?.message ?? e}`);
        }
    }

    // --- the RPC mock -----------------------------------------------------------------------------------------------

    // Answers every gitaccount* command from window.<MOCK_KEY>.state, changes that state as the real handlers would, and
    // records each call in .calls. A scan waits on .gate while a step holds it; .scanFail makes it throw, .scanErrors fills
    // its errors, .failPaths are the repos a fix fails on. The token is never in an answer, as on the wire.
    async function installMock(h) {
        const got = await AC.agentPage(
            h,
            `const api = (await mod("app/store/wshclientapi.ts")).RpcApi;
            if (!api || typeof api.setMockRpcClient !== "function") return "no-api";
            if (window.${MOCK_KEY}) return "already-installed";
            const prev = api.mockClient ?? null;
            const clone = (v) => JSON.parse(JSON.stringify(v));
            const m = { api, prev, calls: [], state: clone(${JSON.stringify(FULL)}), gate: null, open: null, scanFail: null, scanErrors: [], failPaths: [] };
            m.holdScan = () => { m.gate = new Promise((r) => { m.open = r; }); };
            m.releaseScan = () => { m.open?.(); m.gate = null; m.open = null; };
            const account = (login) => {
                const a = m.state.accounts.find((x) => x.login === login);
                if (!a) throw new Error("no account " + login);
                return a;
            };
            const handle = async (command, data) => {
                const s = m.state;
                switch (command) {
                    case "gitaccountlist":
                        return clone({ accounts: s.accounts, defaultlogin: s.defaultlogin, globalname: s.globalname, globalemail: s.globalemail, defaulthelper: s.defaulthelper });
                    case "gitaccounttokenstate":
                        return clone(s.tokens[data.login] ?? { state: "missing" });
                    case "gitaccountscan": {
                        const gate = m.gate;
                        if (gate) await gate;
                        if (m.scanFail) throw new Error(m.scanFail);
                        return clone({
                            accounts: s.accounts.map((a) => ({ login: a.login, ...(s.scan[a.login] ?? { repos: 0, tokenrepos: [], identityrepos: [] }) })),
                            credentialslines: s.credentialslines,
                            errors: m.scanErrors,
                        });
                    }
                    case "gitaccountchecktoken":
                        if (data.token === "bad-token") throw new Error(${JSON.stringify(REFUSED_TEXT)});
                        return { login: data.login, name: "Newbie Verify", email: "public@verify.test" };
                    case "gitaccountsettoken":
                        s.tokens[data.login] = { state: "saved" };
                        return null;
                    case "gitaccountadd": {
                        const a = { login: data.login, name: data.name, email: data.email, roots: [data.root] };
                        s.accounts.push(a);
                        if (data.defaultlogin) s.defaultlogin = data.defaultlogin;
                        s.tokens[data.login] = { state: "saved" };
                        s.scan[data.login] = { repos: 1, tokenrepos: [], identityrepos: [] };
                        return clone(a);
                    }
                    case "gitaccountupdate": {
                        const a = account(data.login);
                        if (data.name) a.name = data.name;
                        if (data.email) a.email = data.email;
                        return null;
                    }
                    case "gitaccountsetdefault":
                        s.defaultlogin = data.login;
                        return null;
                    case "gitaccountaddroot":
                        account(data.login).roots.push(data.root);
                        return null;
                    case "gitaccountremoveroot": {
                        const a = account(data.login);
                        a.roots = a.roots.filter((r) => r !== data.root);
                        return null;
                    }
                    case "gitaccountremove":
                        if (data.login === s.defaultlogin) throw new Error(${JSON.stringify(KEEP_DEFAULT_TEXT)});
                        s.accounts = s.accounts.filter((a) => a.login !== data.login);
                        delete s.tokens[data.login];
                        delete s.scan[data.login];
                        return null;
                    case "gitaccountfix": {
                        const results = [];
                        const failed = (p) => m.failPaths.includes(p);
                        for (const p of data.tokenrepos ?? []) results.push(failed(p) ? { kind: "token", path: p, error: ${JSON.stringify(FAIL_TEXT)} } : { kind: "token", path: p });
                        for (const p of data.identityrepos ?? []) results.push(failed(p) ? { kind: "identity", path: p, error: ${JSON.stringify(FAIL_TEXT)} } : { kind: "identity", path: p });
                        if (data.credentials) results.push({ kind: "credentials", path: "/Users/verify/.git-credentials" });
                        const ok = new Set(results.filter((r) => !r.error).map((r) => r.path));
                        const sc = s.scan[data.login];
                        if (sc) {
                            sc.tokenrepos = sc.tokenrepos.filter((r) => !ok.has(r.path));
                            sc.identityrepos = sc.identityrepos.filter((r) => !ok.has(r.path));
                        }
                        if (data.credentials) s.credentialslines = 0;
                        return { results };
                    }
                    default:
                        throw new Error("the git accounts mock has no answer for " + command);
                }
            };
            api.setMockRpcClient({
                mockWshRpcCall(client, command, data, opts) {
                    if (!command.startsWith("gitaccount")) {
                        return prev ? prev.mockWshRpcCall(client, command, data, opts) : client.wshRpcCall(command, data, opts);
                    }
                    m.calls.push({ command, data: clone(data ?? null) });
                    return handle(command, data);
                },
                mockWshRpcStream(client, command, data, opts) {
                    return prev ? prev.mockWshRpcStream(client, command, data, opts) : client.wshRpcStream(command, data, opts);
                },
            });
            window.${MOCK_KEY} = m;
            return "installed";`
        );
        if (got !== "installed") throw new Error(`the RPC mock: ${got}`);
    }
    const removeMock = (h) =>
        AC.agentPage(
            h,
            `const m = window.${MOCK_KEY};
            if (m) { m.releaseScan(); m.api.setMockRpcClient(m.prev); delete window.${MOCK_KEY}; }
            return true;`
        );
    const mockCalls = (h, command) => h.ev(`(window.${MOCK_KEY}?.calls ?? []).filter((c) => c.command === ${q(command)}).map((c) => c.data)`);
    const clearCalls = (h) => h.ev(`(() => { window.${MOCK_KEY}.calls.length = 0; return true; })()`);
    // the next mount of the card reads this list; the failures and the held scan are cleared
    const seed = (h, state) =>
        h.ev(`(() => {
            const m = window.${MOCK_KEY};
            m.releaseScan();
            m.state = ${JSON.stringify(state)};
            m.scanFail = null;
            m.scanErrors = [];
            m.failPaths = [];
            return true;
        })()`);
    const holdScan = (h) => h.ev(`(() => { window.${MOCK_KEY}.holdScan(); return true; })()`);
    const releaseScan = (h) => h.ev(`(() => { window.${MOCK_KEY}.releaseScan(); return true; })()`);
    const setMock = (h, patch) => h.ev(`(() => { Object.assign(window.${MOCK_KEY}, ${JSON.stringify(patch)}); return true; })()`);

    // Settings → Agents, with the card freshly mounted: the card reads the list when it mounts, and a surface the person
    // left unmounts
    async function openCard(h) {
        await h.goto("cockpit");
        await h.goto("settings");
        await polishWaitFor(h, `document.querySelector('button[data-section="agents"]') != null`, SHORT_MS);
        await h.ev(`document.querySelector('button[data-section="agents"]')?.click()`);
        const drawn = await polishWaitFor(
            h,
            `(() => { const c = ${CARD}; return !!c && (!!c.querySelector("[data-git-account-row]") || !!c.querySelector("[data-git-accounts-empty]")); })()`,
            WAIT_MS
        );
        await polishNap(300);
        return drawn;
    }
    const settled = (h) => polishWaitFor(h, SETTLED, WAIT_MS);

    // a step that throws is a failed step, not the end of the run: the ones after it read what they need themselves
    function stepRunner(steps) {
        const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
        const run = async (name, fn) => {
            try {
                await fn(name);
            } catch (e) {
                rec(name, false, `the step threw: ${String(e?.message ?? e)}`);
            }
        };
        return { rec, run };
    }

    const LOGINS = ["alice", "bob", "carol", "dave"];

    const scenario = {
        name: "settings-git-accounts",
        surface: "settings",

        async arrange(h) {
            const ctx = {};
            try {
                await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
                await installMock(h);
            } catch (e) {
                ctx.arrangeError = String(e?.message ?? e);
            }
            return ctx;
        },

        async assert(h, ctx) {
            const steps = [];
            const { rec, run } = stepRunner(steps);
            if (ctx.arrangeError != null) {
                rec("0. the RPC mock", false, ctx.arrangeError);
                return steps;
            }
            await h.cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
            const closeFix = async () => {
                await click(h, `(${dialogButton("Close")} ?? ${dialogButton("Cancel")})`);
                return polishWaitFor(h, `!document.querySelector("[data-git-fix-modal]")`, SHORT_MS);
            };

            // 1. the card under Claude account: the Default row, four accounts, the strips and the Fix buttons
            await run("1. the card", async (name) => {
                await seed(h, FULL);
                const drawn = await openCard(h);
                const done = await settled(h);
                await h.ev(`${CARD}?.scrollIntoView({ block: "start" })`);
                await polishNap(300);
                const got = await h.ev(READ_CARD(LOGINS));
                const order = await h.ev(
                    `[...document.querySelectorAll('[data-setting-card]')].map((c) => c.getAttribute("data-setting-card")).slice(0, 3)`
                );
                await shot(h, "1-card");
                const r = got?.rows ?? {};
                rec(
                    `${name}: Settings → Agents draws the card after claudeaccount; the Default row names dave with Dave Verify · dave@verify.test and the Keychain helper; the four accounts read saved / refused / missing / unreachable with their folders and 3 / 2 / 0 / 1 repos; alice and bob have a leaks strip, carol and dave none; Fix is enabled on alice and disabled, with a reason, on bob`,
                    drawn &&
                        done &&
                        got != null &&
                        order[0] === "claudeaccount" &&
                        order[1] === "gitaccounts" &&
                        got.def != null &&
                        got.def.text.includes("dave") &&
                        got.def.text.includes("Dave Verify · dave@verify.test") &&
                        got.def.helper === "Keychain" &&
                        r.alice?.state === "saved" && r.alice.token === "Token saved" && same(r.alice.roots, [WORK]) && r.alice.repos === "3 repos" &&
                        r.bob?.state === "refused" && r.bob.token === "Token refused by GitHub" && same(r.bob.roots, [OSS]) && r.bob.repos === "2 repos" &&
                        r.carol?.state === "missing" && r.carol.token === "No token saved" && same(r.carol.roots, [""]) && r.carol.rootText[0] === "No folder" && r.carol.repos === "0 repos" &&
                        r.dave?.state === "unreachable" && r.dave.token === "Couldn't reach GitHub" && same(r.dave.roots, [LAB]) && r.dave.repos === "1 repo" &&
                        r.alice.leaks && /token in their remote URL/.test(r.alice.leakText) &&
                        r.bob.leaks &&
                        !r.carol.leaks &&
                        !r.dave.leaks &&
                        r.alice.fix?.disabled === false &&
                        r.bob.fix?.disabled === true &&
                        r.bob.fix.title !== "",
                    { drawn, done, order, got }
                );
            });

            // 1b. a scan still running: dashes for the counts and no strip; they fill in when it answers
            await run("1b. the scan pending", async (name) => {
                await seed(h, FULL);
                await holdScan(h);
                const drawn = await openCard(h);
                const tokens = await polishWaitFor(
                    h,
                    `(() => { const t = ${CARD}?.querySelector('[data-git-account-token="alice"]'); return !!t && t.getAttribute("data-state") !== "checking"; })()`,
                    WAIT_MS
                );
                const before = await h.ev(READ_CARD(LOGINS));
                await shot(h, "1b-scan-pending");
                await releaseScan(h);
                const after = await settled(h).then(() => h.ev(READ_CARD(LOGINS)));
                const b = before?.rows ?? {};
                rec(
                    `${name}: while the scan is held every [data-git-account-repos] reads "—" and no [data-git-account-leaks] is drawn; once it resolves alice reads "3 repos" and her strip appears`,
                    drawn &&
                        tokens &&
                        LOGINS.every((l) => b[l]?.repos === "—" && b[l]?.leaks === false) &&
                        after?.rows?.alice?.repos === "3 repos" &&
                        after.rows.alice.leaks === true,
                    { drawn, tokens, before, after }
                );
            });

            // 2. no account: one line of explanation, no Default row, the footer offers only + Add account
            await run("2. the empty state", async (name) => {
                await seed(h, EMPTY);
                const drawn = await openCard(h);
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const card = ${CARD};
                    return {
                        empty: flat(card?.querySelector("[data-git-accounts-empty]")),
                        rows: card?.querySelectorAll("[data-git-account-row]").length ?? -1,
                        add: !!card?.querySelector("[data-git-account-add]"),
                        addRoot: !!card?.querySelector("[data-git-account-add-root]"),
                    };
                })()`);
                await shot(h, "2-empty");
                rec(
                    `${name}: with no account the card shows [data-git-accounts-empty], no row (the Default row is not drawn), and + Add account alone in its footer`,
                    drawn && got.empty !== "" && got.rows === 0 && got.add && !got.addRoot,
                    { drawn, got }
                );
            });

            // 3. + Add account: a token GitHub refuses stays on the token step with its reason
            await run("3. a refused token", async (name) => {
                await clearCalls(h);
                const opened = await clickSel(h, "[data-git-account-add]");
                const modal = await polishWaitFor(h, `!!${sel('[data-git-add-modal][data-mode="add"]')}`, SHORT_MS);
                const typedLogin = await typeInto(h, "[data-git-add-login]", "newbie");
                const typedToken = await typeInto(h, "[data-git-add-token]", "bad-token");
                const checked = await clickSel(h, "[data-git-add-check]");
                const failed = await polishWaitFor(h, `!!${sel("[data-git-add-error]")}`, SHORT_MS);
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    return {
                        error: flat(${sel("[data-git-add-error]")}),
                        tokenStep: !!${sel("[data-git-add-token]")},
                        detailsStep: !!${sel("[data-git-add-email]")},
                    };
                })()`);
                const calls = await mockCalls(h, "gitaccountchecktoken");
                await shot(h, "3-refused");
                rec(
                    `${name}: + Add account opens [data-git-add-modal][data-mode="add"]; Check token with a refused token sends gitaccountchecktoken {login, token} and the error "${REFUSED_TEXT}" shows in [data-git-add-error] on the token step`,
                    opened &&
                        modal &&
                        typedLogin &&
                        typedToken &&
                        checked &&
                        failed &&
                        got.error === REFUSED_TEXT &&
                        got.tokenStep &&
                        !got.detailsStep &&
                        calls.length === 1 &&
                        same(calls[0], { login: "newbie", token: "bad-token" }),
                    { opened, modal, typedLogin, typedToken, checked, failed, got, calls }
                );
            });

            // 4. a good token: email (GitHub's public one), folder and default login; Save sends gitaccountadd, the row appears
            await run("4. a good token and Save", async (name) => {
                await clearCalls(h);
                const typedToken = await typeInto(h, "[data-git-add-token]", "good-token");
                const checked = await clickSel(h, "[data-git-add-check]");
                const details = await polishWaitFor(h, `!!${sel("[data-git-add-email]")}`, SHORT_MS);
                const prefilled = await h.ev(`${sel("[data-git-add-email]")}?.value ?? null`);
                const typedRoot = await typeInto(h, "[data-git-add-root]", NEW_ROOT);
                const asksDefault = await h.ev(`!!${sel("[data-git-add-default]")}`);
                const typedDefault = await typeInto(h, "[data-git-add-default]", "newbie");
                const saveEnabled = await h.ev(`${sel("[data-git-add-save]")}?.disabled === false`);
                await shot(h, "4-details");
                const saved = await clickSel(h, "[data-git-add-save]");
                const closed = await polishWaitFor(h, `!${sel("[data-git-add-modal]")}`, SHORT_MS);
                const row = await polishWaitFor(h, `!!${sel(rowSel("newbie"))}`, SHORT_MS);
                const adds = await mockCalls(h, "gitaccountadd");
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const r = ${sel(rowSel("newbie"))};
                    return { row: flat(r), root: r?.querySelector("[data-git-account-root]")?.getAttribute("data-git-account-root") ?? null, def: flat(${sel(rowSel("default"))}) };
                })()`);
                await shot(h, "4-added");
                rec(
                    `${name}: a good check moves to the details step with GitHub's email filled in; with a folder and the default login typed, Save sends gitaccountadd {login, token, name, email, root, defaultlogin}, the dialog closes and the row for newbie appears under ${NEW_ROOT}`,
                    typedToken &&
                        checked &&
                        details &&
                        prefilled === "public@verify.test" &&
                        typedRoot &&
                        asksDefault &&
                        typedDefault &&
                        saveEnabled &&
                        saved &&
                        closed &&
                        row &&
                        adds.length === 1 &&
                        same(adds[0], {
                            login: "newbie",
                            token: "good-token",
                            name: "Newbie Verify",
                            email: "public@verify.test",
                            root: NEW_ROOT,
                            defaultlogin: "newbie",
                        }) &&
                        got.root === NEW_ROOT &&
                        got.def.includes("newbie"),
                    { typedToken, checked, details, prefilled, typedRoot, asksDefault, typedDefault, saveEnabled, saved, closed, row, adds, got }
                );
            });

            // 5. Fix: the list with its ticks; clearing one then Apply sends only the ticked paths
            const WEB = `token:${WORK}/web`;
            const API = `token:${WORK}/api`;
            const LEGACY = `identity:${WORK}/legacy`;
            const CREDS = "credentials:~/.git-credentials";
            await run("5. Fix and its ticks", async (name) => {
                await seed(h, FULL);
                await openCard(h);
                await settled(h);
                await clearCalls(h);
                const opened = await clickSel(h, '[data-git-account-fix="alice"]');
                const modal = await polishWaitFor(h, `!!${sel('[data-git-fix-modal][data-login="alice"]')}`, SHORT_MS);
                const read = () =>
                    h.ev(`(() => {
                        const flat = ${FLAT};
                        const m = ${sel("[data-git-fix-modal]")};
                        if (!m) return null;
                        return {
                            rows: [...m.querySelectorAll("[data-git-fix-row]")].map((r) => ({ key: r.getAttribute("data-git-fix-row"), ticked: r.querySelector("input")?.checked === true, text: flat(r) })),
                            apply: flat(m.querySelector("[data-git-fix-apply]")),
                        };
                    })()`);
                const before = await read();
                await shot(h, "5-fix-list");
                const cleared = await click(h, `${sel(fixRowSel(WEB))}?.querySelector("input")`);
                const mid = await read();
                const applied = await clickSel(h, "[data-git-fix-apply]");
                const done = await polishWaitFor(h, `!!${sel(`[data-git-fix-result=${q(API)}]`)}`, SHORT_MS);
                const fixes = await mockCalls(h, "gitaccountfix");
                const after = await h.ev(`(() => {
                    const m = ${sel("[data-git-fix-modal]")};
                    return {
                        open: !!m,
                        ok: [...(m?.querySelectorAll("[data-git-fix-result]") ?? [])].map((r) => r.getAttribute("data-git-fix-result") + "=" + r.getAttribute("data-ok")),
                        apply: !!m?.querySelector("[data-git-fix-apply]"),
                    };
                })()`);
                await shot(h, "5-fixed");
                await closeFix();
                const tick = (state, key) => state?.rows.find((x) => x.key === key)?.ticked;
                rec(
                    `${name}: Fix opens [data-git-fix-modal] with the two token rows and the ~/.git-credentials row ticked and the identity row (Old Name · old@verify.test) unticked; clearing one tick then Apply sends gitaccountfix with only the ticked paths, each row reads ok, and the modal stays open with Close in place of Apply`,
                    opened &&
                        modal &&
                        before != null &&
                        same(before.rows.map((x) => x.key), [API, WEB, LEGACY, CREDS]) &&
                        tick(before, API) === true &&
                        tick(before, WEB) === true &&
                        tick(before, LEGACY) === false &&
                        tick(before, CREDS) === true &&
                        before.rows.find((x) => x.key === LEGACY).text.includes("Old Name · old@verify.test") &&
                        before.apply === "Fix 3 items" &&
                        cleared &&
                        mid?.apply === "Fix 2 items" &&
                        applied &&
                        done &&
                        fixes.length === 1 &&
                        same(fixes[0], { login: "alice", tokenrepos: [`${WORK}/api`], identityrepos: [], credentials: true }) &&
                        after.open &&
                        !after.apply &&
                        same(after.ok, [`${API}=true`, `${CREDS}=true`]),
                    { opened, modal, before, cleared, mid, applied, done, fixes, after }
                );
            });

            // 6. a fix that fails on one repo: the modal stays open and that row is in the error tone
            await run("6. a repo the fix failed on", async (name) => {
                // the scan after step 5 left alice's web repo and the legacy repo; wait for her strip to say so
                await polishWaitFor(h, `/^1 repo/.test(${CARD}?.querySelector('[data-git-account-leaks="alice"]')?.textContent?.trim() ?? "")`, WAIT_MS);
                await setMock(h, { failPaths: [`${WORK}/web`] });
                await clearCalls(h);
                const opened = await clickSel(h, '[data-git-account-fix="alice"]');
                const modal = await polishWaitFor(h, `!!${sel("[data-git-fix-modal]")}`, SHORT_MS);
                const applied = await clickSel(h, "[data-git-fix-apply]");
                const done = await polishWaitFor(h, `!!${sel(`[data-git-fix-result=${q(WEB)}]`)}`, SHORT_MS);
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const m = ${sel("[data-git-fix-modal]")};
                    const res = m?.querySelector(${q(`[data-git-fix-result=${q(WEB)}]`)});
                    return {
                        open: !!m,
                        ok: res?.getAttribute("data-ok") ?? null,
                        text: flat(res),
                        tone: res?.classList.contains("text-error") ?? false,
                        lead: flat(m?.querySelector("h2")?.nextElementSibling),
                    };
                })()`);
                const fixes = await mockCalls(h, "gitaccountfix");
                await shot(h, "6-fix-failed");
                await closeFix();
                rec(
                    `${name}: when the fix fails on a repo the modal stays open, that row's [data-git-fix-result] has data-ok="false" in the error tone with "${FAIL_TEXT}", and the line above the list says "1 failed"`,
                    opened &&
                        modal &&
                        applied &&
                        done &&
                        fixes.length === 1 &&
                        same(fixes[0].tokenrepos, [`${WORK}/web`]) &&
                        got.open &&
                        got.ok === "false" &&
                        got.text === FAIL_TEXT &&
                        got.tone &&
                        got.lead.startsWith("1 failed"),
                    { opened, modal, applied, done, got, fixes }
                );
            });

            // 7. a scan that fails: its note shows and the rows stay
            await run("7. a scan error", async (name) => {
                await seed(h, FULL);
                await setMock(h, { scanFail: "walking /Users/verify/work took too long" });
                const drawn = await openCard(h);
                const note = await polishWaitFor(h, `!!${sel("[data-git-accounts-scan-error]")}`, WAIT_MS);
                const tokens = await polishWaitFor(
                    h,
                    `(() => { const t = ${CARD}?.querySelectorAll("[data-git-account-token]") ?? []; return t.length === 4 && [...t].every((x) => x.getAttribute("data-state") !== "checking"); })()`,
                    WAIT_MS
                );
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    const card = ${CARD};
                    return {
                        note: flat(card?.querySelector("[data-git-accounts-scan-error]")),
                        rows: card?.querySelectorAll("[data-git-account-row]").length ?? -1,
                        repos: flat(card?.querySelector('[data-git-account-repos="alice"]')),
                        leaks: card?.querySelectorAll("[data-git-account-leaks]").length ?? -1,
                    };
                })()`);
                await shot(h, "7-scan-error");
                rec(
                    `${name}: a scan that throws shows its message in [data-git-accounts-scan-error] while the five rows stay, counts read "—" and no strip is drawn`,
                    drawn && note && tokens && got.note.includes("walking /Users/verify/work took too long") && got.rows === 5 && got.repos === "—" && got.leaks === 0,
                    { drawn, note, tokens, got }
                );
            });

            // 8–12 on one mounted card with the full fixture; each asserts the payload it recorded
            await seed(h, FULL);
            const mounted = await openCard(h);
            await settled(h);

            // 8. ⋯ → Replace token: the login is fixed, a good check sends gitaccountsettoken and the state moves to saved
            await run("8. Replace token", async (name) => {
                await clearCalls(h);
                const picked = await pickMenu(h, "bob", "Replace token");
                const modal = await polishWaitFor(h, `!!${sel('[data-git-add-modal][data-mode="token"]')}`, SHORT_MS);
                const fixed = await h.ev(`(() => {
                    const flat = ${FLAT};
                    return { login: !!${sel("[data-git-add-login]")}, title: flat(${sel("[data-git-add-modal] h2")}) };
                })()`);
                const typed = await typeInto(h, "[data-git-add-token]", "bobs-new-token");
                await shot(h, "8-replace-token");
                const checked = await clickSel(h, "[data-git-add-check]");
                const closed = await polishWaitFor(h, `!${sel("[data-git-add-modal]")}`, SHORT_MS);
                const state = await polishWaitFor(h, `${CARD}?.querySelector('[data-git-account-token="bob"]')?.getAttribute("data-state") === "saved"`, SHORT_MS);
                const checks = await mockCalls(h, "gitaccountchecktoken");
                const sets = await mockCalls(h, "gitaccountsettoken");
                rec(
                    `${name}: ⋯ → Replace token opens [data-git-add-modal][data-mode="token"] titled for bob with no login field; a good check sends gitaccountchecktoken then gitaccountsettoken {login: "bob", token}, the dialog closes and bob's token reads saved`,
                    mounted &&
                        picked &&
                        modal &&
                        !fixed.login &&
                        fixed.title.includes("bob") &&
                        typed &&
                        checked &&
                        closed &&
                        state &&
                        checks.length === 1 &&
                        same(checks[0], { login: "bob", token: "bobs-new-token" }) &&
                        sets.length === 1 &&
                        same(sets[0], { login: "bob", token: "bobs-new-token" }),
                    { mounted, picked, modal, fixed, typed, checked, closed, state, checks, sets }
                );
            });

            // 9. ⋯ → Rename and ⋯ → Change email
            await run("9. Rename and Change email", async (name) => {
                await clearCalls(h);
                const renamePicked = await pickMenu(h, "bob", "Rename");
                const renameInput = await polishWaitFor(h, `!!${sel('[data-git-account-rename-input="bob"]')}`, SHORT_MS);
                const renameTyped = await typeInto(h, '[data-git-account-rename-input="bob"]', "Robert Verify");
                await press(h, "Enter", 500);
                const renamed = await polishWaitFor(h, `!${sel('[data-git-account-rename-input="bob"]')}`, SHORT_MS);

                const emailPicked = await pickMenu(h, "bob", "Change email");
                const emailInput = await polishWaitFor(h, `!!${sel('[data-git-account-email-input="bob"]')}`, SHORT_MS);
                const emailTyped = await typeInto(h, '[data-git-account-email-input="bob"]', "robert@verify.test");
                await press(h, "Enter", 500);
                const emailDone = await polishWaitFor(h, `!${sel('[data-git-account-email-input="bob"]')}`, SHORT_MS);
                const updates = await mockCalls(h, "gitaccountupdate");
                const text = await h.ev(`(${FLAT})(${sel(rowSel("bob"))})`);
                rec(
                    `${name}: ⋯ → Rename sends one gitaccountupdate {login: "bob", name: "Robert Verify"} and ⋯ → Change email one {login: "bob", email: "robert@verify.test"}; the row reads both afterwards`,
                    renamePicked &&
                        renameInput &&
                        renameTyped &&
                        renamed &&
                        emailPicked &&
                        emailInput &&
                        emailTyped &&
                        emailDone &&
                        updates.length === 2 &&
                        same(updates[0], { login: "bob", name: "Robert Verify" }) &&
                        same(updates[1], { login: "bob", email: "robert@verify.test" }) &&
                        text.includes("Robert Verify") &&
                        text.includes("robert@verify.test"),
                    { renamePicked, renameInput, renameTyped, renamed, emailPicked, emailInput, emailTyped, emailDone, updates, text }
                );
            });

            // 10. footer + Add folder → pick the account → type the path; ⋯ → Remove folder
            await run("10. Add folder and Remove folder", async (name) => {
                await clearCalls(h);
                const footer = await clickSel(h, "[data-git-account-add-root]");
                const menu = await polishWaitFor(h, `!!${sel(menuSel("carol"))}`, SHORT_MS);
                const choices = await h.ev(`[...document.querySelectorAll("[data-menu-item]")].map((e) => e.getAttribute("data-menu-item"))`);
                const picked = await h.ev(`(() => { const r = ${sel(menuSel("carol"))}; if (!r) return false; r.click(); return true; })()`);
                await polishWaitFor(h, `!document.querySelector("[data-menu-item]")`, SHORT_MS);
                const input = await polishWaitFor(h, `!!${sel('[data-git-root-input="carol"]')}`, SHORT_MS);
                const inCarol = await h.ev(`!!${sel(rowSel("carol"))}?.querySelector('[data-git-root-input="carol"]')`);
                const typed = await typeInto(h, '[data-git-root-input="carol"]', SIDE);
                await shot(h, "10-add-folder");
                await press(h, "Enter", 500);
                const added = await polishWaitFor(h, `!!${sel(rowSel("carol"))}?.querySelector(${q(`[data-git-account-root=${q(SIDE)}]`)})`, SHORT_MS);
                const addCalls = await mockCalls(h, "gitaccountaddroot");

                // Remove folder is a submenu: one row per folder, opened by hovering it
                const menuOpen = await clickSel(h, '[data-git-account-menu="carol"]');
                const rowUp = await polishWaitFor(h, `!!${sel(menuSel("Remove folder"))}`, SHORT_MS);
                const hovered = await hover(h, sel(menuSel("Remove folder")));
                const subUp = await polishWaitFor(h, `!!${sel(menuSel(SIDE))}`, SHORT_MS);
                const removed = await h.ev(`(() => { const r = ${sel(menuSel(SIDE))}; if (!r) return false; r.click(); return true; })()`);
                await polishWaitFor(h, `!document.querySelector("[data-menu-item]")`, SHORT_MS);
                const back = await polishWaitFor(
                    h,
                    `${sel(rowSel("carol"))}?.querySelector("[data-git-account-root]")?.getAttribute("data-git-account-root") === ""`,
                    SHORT_MS
                );
                const removeCalls = await mockCalls(h, "gitaccountremoveroot");
                rec(
                    `${name}: with four accounts the footer + Add folder offers one row per login; picking carol opens [data-git-root-input="carol"] in her row, Enter sends gitaccountaddroot {login: "carol", root: "${SIDE}"} and the folder shows; ⋯ → Remove folder lists it, and picking it sends gitaccountremoveroot with the same payload and her row goes back to No folder`,
                    footer &&
                        menu &&
                        same(choices.slice().sort(), ["alice", "bob", "carol", "dave"]) &&
                        picked &&
                        input &&
                        inCarol &&
                        typed &&
                        added &&
                        addCalls.length === 1 &&
                        same(addCalls[0], { login: "carol", root: SIDE }) &&
                        menuOpen &&
                        rowUp &&
                        hovered &&
                        subUp &&
                        removed &&
                        back &&
                        removeCalls.length === 1 &&
                        same(removeCalls[0], { login: "carol", root: SIDE }),
                    { footer, menu, choices, picked, input, inCarol, typed, added, addCalls, menuOpen, rowUp, hovered, subUp, removed, back, removeCalls }
                );
            });

            // 11. ⋯ → Remove account confirms and sends gitaccountremove; the default login's refusal shows in the error line
            await run("11. Remove account", async (name) => {
                await clearCalls(h);
                const picked = await pickMenu(h, "carol", "Remove account");
                const confirm = await polishWaitFor(h, `!!${dialogButton("Remove")}`, SHORT_MS);
                await shot(h, "11-remove-confirm");
                const confirmed = await click(h, dialogButton("Remove"));
                const gone = await polishWaitFor(h, `!${sel(rowSel("carol"))}`, SHORT_MS);
                const first = await mockCalls(h, "gitaccountremove");

                const pickedDefault = await pickMenu(h, "dave", "Remove account");
                const confirmDefault = await polishWaitFor(h, `!!${dialogButton("Remove")}`, SHORT_MS);
                const confirmedDefault = await click(h, dialogButton("Remove"));
                const error = await polishWaitFor(h, `!!${sel("[data-git-accounts-error]")}`, SHORT_MS);
                const got = await h.ev(`(() => {
                    const flat = ${FLAT};
                    return { error: flat(${sel("[data-git-accounts-error]")}), dave: !!${sel(rowSel("dave"))} };
                })()`);
                const all = await mockCalls(h, "gitaccountremove");
                await shot(h, "11-remove-refused");
                rec(
                    `${name}: ⋯ → Remove account asks first, Remove sends gitaccountremove {login: "carol"} and her row goes; the same on dave, the default login, is refused by the mock and "${KEEP_DEFAULT_TEXT}" shows in [data-git-accounts-error] with dave's row kept`,
                    picked &&
                        confirm &&
                        confirmed &&
                        gone &&
                        first.length === 1 &&
                        same(first[0], { login: "carol" }) &&
                        pickedDefault &&
                        confirmDefault &&
                        confirmedDefault &&
                        error &&
                        got.error.includes(KEEP_DEFAULT_TEXT) &&
                        got.dave &&
                        all.length === 2 &&
                        same(all[1], { login: "dave" }),
                    { picked, confirm, confirmed, gone, first, pickedDefault, confirmDefault, confirmedDefault, error, got, all }
                );
            });

            // 12. the Default row's ⋯ → Change default login
            await run("12. Change default login", async (name) => {
                await clearCalls(h);
                const picked = await pickMenu(h, "default", "Change default login");
                const input = await polishWaitFor(h, `!!${sel("[data-git-default-input]")}`, SHORT_MS);
                const typed = await typeInto(h, "[data-git-default-input]", "alice");
                await press(h, "Enter", 500);
                const closed = await polishWaitFor(h, `!${sel("[data-git-default-input]")}`, SHORT_MS);
                const label = await polishWaitFor(h, `(${FLAT})(${sel(rowSel("default"))}).startsWith("alice")`, SHORT_MS);
                const calls = await mockCalls(h, "gitaccountsetdefault");
                rec(
                    `${name}: Default row ⋯ → Change default login opens [data-git-default-input], Enter sends gitaccountsetdefault {login: "alice"} once and the row is named alice`,
                    picked && input && typed && closed && label && calls.length === 1 && same(calls[0], { login: "alice" }),
                    { picked, input, typed, closed, label, calls }
                );
            });

            // 14. ~/.git-credentials is all there is to fix: dave's row, the default login's, carries the only strip
            await run("14. credentials only", async (name) => {
                const CRED_KEY = "credentials:~/.git-credentials";
                await seed(h, CREDENTIALS_ONLY);
                await openCard(h);
                const done = await settled(h);
                await clearCalls(h);
                const got = await h.ev(`(() => {
                    const card = ${CARD};
                    const strips = [...(card?.querySelectorAll("[data-git-account-leaks]") ?? [])];
                    return {
                        on: strips.map((e) => e.getAttribute("data-git-account-leaks")),
                        kinds: strips.map((e) => e.getAttribute("data-git-account-leaks-kind")),
                    };
                })()`);
                const card = await h.ev(READ_CARD(LOGINS));
                await h.ev(`${CARD}?.scrollIntoView({ block: "center" })`);
                await shot(h, "14-credentials-only");
                const opened = await clickSel(h, '[data-git-account-fix="dave"]');
                const modal = await polishWaitFor(h, `!!${sel('[data-git-fix-modal][data-login="dave"]')}`, SHORT_MS);
                const list = await h.ev(`(() => {
                    const m = ${sel("[data-git-fix-modal]")};
                    return [...(m?.querySelectorAll("[data-git-fix-row]") ?? [])].map((r) => ({ key: r.getAttribute("data-git-fix-row"), ticked: r.querySelector("input")?.checked === true }));
                })()`);
                const applied = await clickSel(h, "[data-git-fix-apply]");
                const result = await polishWaitFor(h, `!!${sel(`[data-git-fix-result=${q(CRED_KEY)}]`)}`, SHORT_MS);
                const ok = await h.ev(`${sel(`[data-git-fix-result=${q(CRED_KEY)}]`)}?.getAttribute("data-ok") ?? null`);
                const fixes = await mockCalls(h, "gitaccountfix");
                await closeFix();
                rec(
                    `${name}: with clean repos and 2 github.com lines in ~/.git-credentials only dave's row, the default login's, shows a strip ("${CREDENTIALS_TEXT}", marked data-git-account-leaks-kind="credentials"); Fix opens [data-git-fix-modal] with the one ticked row ${CRED_KEY}, Apply sends gitaccountfix {login: "dave", tokenrepos: [], identityrepos: [], credentials: true} and the row reads ok`,
                    done &&
                        same(got.on, ["dave"]) &&
                        same(got.kinds, ["credentials"]) &&
                        card?.rows.dave?.leakText.startsWith(CREDENTIALS_TEXT) === true &&
                        card.rows.dave.fix?.disabled === false &&
                        LOGINS.filter((l) => l !== "dave").every((l) => card.rows[l]?.leaks === false) &&
                        opened &&
                        modal &&
                        same(list, [{ key: CRED_KEY, ticked: true }]) &&
                        applied &&
                        result &&
                        ok === "true" &&
                        fixes.length === 1 &&
                        same(fixes[0], { login: "dave", tokenrepos: [], identityrepos: [], credentials: true }),
                    { done, got, card, opened, modal, list, applied, result, ok, fixes }
                );
            });

            // the card's picture for What's new, from the full fixture
            await run("15. the What's new picture", async (name) => {
                await seed(h, FULL);
                await openCard(h);
                const done = await settled(h);
                await h.ev(`${CARD}?.scrollIntoView({ block: "center" })`);
                await polishNap(400);
                const picture = await h.whatsnewShot("git-accounts", { selector: '[data-setting-card="gitaccounts"]' });
                rec(`${name}: the card is captured for What's new`, done && picture != null, { done, picture: picture?.comment ?? picture });
            });

            return steps;
        },

        async teardown(h) {
            const step = async (what, fn) => {
                try {
                    await fn();
                } catch (e) {
                    console.error(`settings-git-accounts teardown: ${what} failed: ${e?.message ?? e}`);
                }
            };
            await step("close an open dialog", async () => {
                if (await h.ev(`!!document.querySelector('[role="dialog"]')`)) await press(h, "Escape");
            });
            await step("remove the RPC mock", () => removeMock(h));
            await step("clear the window size", () => h.cdp("Emulation.clearDeviceMetricsOverride", {}));
            await step("go home", () => h.goto("cockpit"));
        },
    };

    return [scenario];
}
