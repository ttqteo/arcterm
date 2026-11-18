// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Remote mode's scenarios, ported from the kael fork: remote-switch (Settings > Remote and the footer's Remote chip)
// and remote-phone (the phone page, served by cmd/remotepreview, in a phone-sized headless browser). scenarios.mjs
// passes the helpers it keeps to itself (lookEval, polishNap, polishWaitFor) as a kit.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openPage } from "./attach.mjs";

let lookEval, polishNap, polishWaitFor;

// --- remote-switch: Settings > Remote and the footer's remote chip ----------------------------------------------
// Step 1 reads the dev store's real status (no remote setup). The rest are fixtures set into remoteStatusAtom
// through the app's own store module; nothing reaches wavesrv but step 7's switch click, which the real
// RemoteOnCommand refuses because the dev store has no setup, and step 9's bad team, which the real
// RemoteSetupCommand refuses before storing anything. Teardown reloads the real status.
const REMOTE_PANE = `document.querySelector('[data-settings-section="remote"]')`;
const REMOTE_PILL = `document.querySelector('[data-remote-pill]')`;
const REMOTE_HOST = "arc.example.com";
const REMOTE_TUNNEL_ERROR = "failed to dial edge: connection refused";
const REMOTE_TS_HOST = "pc.tail123.ts.net";
const REMOTE_SET_UP = {
    on: false,
    team: "acme",
    aud: "aud-tag",
    email: "me@example.com",
    hostname: REMOTE_HOST,
    port: 8765,
    tunnel: "off",
    subscriptions: 0,
};
// a full host name where Setup wants the bare team name, so the real RemoteSetupCommand refuses it and stores nothing
const REMOTE_BAD_TEAM = "acme.cloudflareaccess.com";
const REMOTE_FIELDS = `(() => {
    const pane = ${REMOTE_PANE};
    const input = (id) => pane?.querySelector(\`[data-setting-row="remote.\${id}"] input\`);
    return {
        ...Object.fromEntries(["hostname", "port", "team", "aud", "email"].map((id) => [id, input(id)?.value ?? null])),
        token: input("tunneltoken")?.getAttribute("placeholder") ?? null,
    };
})()`;
const REMOTE_FIXTURES = {
    up: { ...REMOTE_SET_UP, on: true, tunnel: "up", subscriptions: 1 },
    down: { ...REMOTE_SET_UP, on: true, tunnel: "down", tunnelerror: REMOTE_TUNNEL_ERROR, subscriptions: 1 },
    nocloudflared: { ...REMOTE_SET_UP, cloudflaredmissing: true },
    tailscale: { ...REMOTE_SET_UP, provider: "tailscale", hostname: REMOTE_TS_HOST, on: true, tunnel: "up", subscriptions: 1 },
    off: REMOTE_SET_UP,
};
const remoteSetStatus = (h, name) =>
    lookEval(h, `
        const { globalStore } = await mod("app/store/jotaiStore.ts");
        const { remoteStatusAtom } = await mod("app/view/agents/remotestore.ts");
        globalStore.set(remoteStatusAtom, ${JSON.stringify(REMOTE_FIXTURES[name])});
        return true;
    `);
const remoteReload = (h) =>
    lookEval(h, `
        await (await mod("app/view/agents/remotestore.ts")).loadRemoteStatus();
        return true;
    `);
const REMOTE_READ = `(() => {
    const pane = ${REMOTE_PANE};
    const sw = pane?.querySelector('[role="switch"]');
    const text = (el) => (el?.textContent || "").trim();
    return {
        pane: pane != null,
        pill: ${REMOTE_PILL} != null,
        pillTone: ${REMOTE_PILL}?.getAttribute("data-remote-pill") ?? null,
        pillText: (${REMOTE_PILL}?.textContent || "").trim(),
        switchOn: sw?.getAttribute("aria-checked") === "true",
        switchDisabled: sw?.disabled ?? null,
        note: text(pane?.querySelector('[data-testid="remote-switch-note"]')),
        error: text(pane?.querySelector('[data-testid="remote-error"]')),
        lines: Object.fromEntries([...(pane?.querySelectorAll('[data-remote-line]') ?? [])].map((l) => [l.getAttribute("data-remote-line"), text(l)])),
    };
})()`;

const remoteSwitchScenario = {
    name: "remote-switch",
    surface: "settings",
    async arrange() {
        return {};
    },
    async assert(h) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/remote-switch-${n}.png`);
        const settle = () => polishNap(300);

        await h.cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 950, deviceScaleFactor: 1, mobile: false });
        await h.goto("settings");
        await remoteReload(h);
        await h.ev(`document.querySelector('[data-section="remote"]')?.click()`);
        await polishWaitFor(h, `${REMOTE_PANE}?.querySelector('[data-remote-line]') != null`, 5000);
        await settle();
        await shot("1-unset");
        const unset = await h.ev(REMOTE_READ);
        rec(
            "1. with no setup the switch is disabled, says to run wsh remote setup, and no pill shows",
            unset.pane && unset.switchDisabled === true && !unset.switchOn && unset.note.includes("wsh remote setup") && !unset.pill && /^Setup incomplete/.test(unset.lines.setup ?? ""),
            JSON.stringify(unset)
        );

        await remoteSetStatus(h, "up");
        await polishWaitFor(h, `${REMOTE_PILL} != null`, 3000);
        await settle();
        await shot("2-up");
        const up = await h.ev(REMOTE_READ);
        const pillText = await h.ev(`(${REMOTE_PILL}?.textContent || "").trim()`);
        rec(
            "2. on with the tunnel up: the pill shows, the section shows on, the address and subscribed",
            up.pill && pillText === "Remote on" && up.switchOn && up.switchDisabled === false && up.lines.tunnel === "Tunnel up" && up.lines.address === `https://${REMOTE_HOST}` && up.lines.phone === "Phone subscribed",
            JSON.stringify({ ...up, pillText })
        );

        await h.goto("agent");
        await settle();
        await h.ev(`${REMOTE_PILL}?.click()`);
        const opened = await polishWaitFor(h, `${REMOTE_PANE} != null`, 5000);
        await settle();
        await shot("3-pill-opens");
        const selected = await h.ev(`document.querySelector('[data-section="remote"]')?.className.includes("bg-surface-selected") ?? false`);
        rec("3. clicking the pill on the Agent surface opens Settings > Remote", opened && selected, JSON.stringify({ opened, selected }));

        await remoteSetStatus(h, "down");
        await settle();
        await shot("4-down");
        const down = await h.ev(REMOTE_READ);
        rec(
            "4. on with the tunnel down: the section shows the down line with its error, and the chip reads down",
            down.lines.tunnel === `Tunnel down: ${REMOTE_TUNNEL_ERROR}` && down.switchOn && down.pillTone === "down",
            JSON.stringify(down)
        );

        await remoteSetStatus(h, "nocloudflared");
        await settle();
        await shot("5-no-cloudflared");
        const nocf = await h.ev(REMOTE_READ);
        rec(
            "5. set up but cloudflared missing: the switch is disabled with the winget line",
            nocf.switchDisabled === true && nocf.note.includes("winget install --id Cloudflare.cloudflared") && !nocf.pill && nocf.lines.setup === "Setup complete",
            JSON.stringify(nocf)
        );

        await remoteSetStatus(h, "off");
        await settle();
        await shot("6-off");
        const off = await h.ev(REMOTE_READ);
        rec("6. set up and off: the chip reads Remote off", off.pillTone === "off" && off.pillText === "Remote off", JSON.stringify(off));
        await h.ev(`${REMOTE_PANE}?.querySelector('[role="switch"]')?.click()`);
        await polishWaitFor(h, `${REMOTE_PANE}?.querySelector('[data-testid="remote-error"]') != null`, 20000);
        await settle();
        await shot("7-refused");
        const refused = await h.ev(REMOTE_READ);
        rec(
            "7. set up and off: the switch's real RemoteOnCommand refuses, and the section shows the error inline",
            refused.error !== "" && !refused.switchOn && !refused.pill,
            JSON.stringify(refused)
        );

        // step 7's refusal published the dev store's real status, so the set-up fixture goes back in
        await remoteSetStatus(h, "off");
        await settle();
        await shot("8-fields");
        const fields = await h.ev(REMOTE_FIELDS);
        rec(
            "8. set up: the setup rows show the stored values, and the token row says one is stored without showing it",
            fields.hostname === REMOTE_HOST && fields.port === "8765" && fields.team === "acme" && fields.aud === "aud-tag" && fields.email === "me@example.com" && /^Stored/.test(fields.token ?? ""),
            JSON.stringify(fields)
        );

        await h.ev(`(() => {
            const input = ${REMOTE_PANE}?.querySelector('[data-setting-row="remote.team"] input');
            if (!input) return false;
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(REMOTE_BAD_TEAM)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
            return true;
        })()`);
        await polishWaitFor(h, `/bare team name/.test(${REMOTE_PANE}?.querySelector('[data-testid="remote-error"]')?.textContent || "")`, 10000);
        await settle();
        await shot("9-bad-team");
        const bad = await h.ev(REMOTE_READ);
        // the field keeps the refused text for correcting, so what got stored is read from wavesrv
        const stored = await lookEval(h, `
            const { RpcApi } = await mod("app/store/wshclientapi.ts");
            const { TabRpcClient } = await mod("app/store/wshrpcutil.ts");
            return (await RpcApi.RemoteStatusCommand(TabRpcClient)).team ?? "";
        `);
        rec(
            "9. a bad team goes to the real RemoteSetupCommand, which refuses it inline and stores nothing",
            /bare team name/.test(bad.error) && stored === "",
            JSON.stringify({ error: bad.error, storedTeam: stored })
        );

        await remoteSetStatus(h, "tailscale");
        await settle();
        await shot("10-tailscale");
        const ts = await h.ev(`(() => {
            const pane = ${REMOTE_PANE};
            const row = (id) => pane?.querySelector(\`[data-setting-row="remote.\${id}"]\`);
            const picked = pane?.querySelector('[data-testid="remote-provider-tailscale"]');
            return {
                picked: picked?.className.includes("bg-surface-selected") ?? false,
                tshostname: row("tshostname")?.querySelector("input")?.value ?? null,
                tslogin: row("tslogin")?.querySelector("input")?.value ?? null,
                port: row("port")?.querySelector("input")?.value ?? null,
                token: row("tunneltoken") != null,
                team: row("team") != null,
                tunnel: pane?.querySelector('[data-remote-line="tunnel"]')?.textContent?.trim() ?? "",
            };
        })()`);
        rec(
            "10. through tailscale: Tailscale is picked, the tailnet address and login show, and the Cloudflare rows are gone",
            ts.picked && ts.tshostname === REMOTE_TS_HOST && ts.tslogin === "me@example.com" && ts.port === "8765" && !ts.token && !ts.team && ts.tunnel === "Tailscale serve up",
            JSON.stringify(ts)
        );
        return steps;
    },
    async teardown(h) {
        await remoteReload(h).catch(() => {});
        await h.goto("cockpit");
    },
};

// --- remote-phone: the phone page, served by cmd/remotepreview, in a phone-sized headless browser ---------------
// Needs no dev app: the preview serves the real page and handler with fixture data and an Access check that lets
// everything through, and prints a line for each answer, subscribe and off it gets. The browser is its own
// headless Edge or Chrome on its own CDP port; its shots join the run's. Restarts reuse the first port, since the
// page's origin, service worker and last-reached time all hang on it.
const PHONE_REPO = fileURLToPath(new URL("../..", import.meta.url));
// "REMOTEPREVIEW <url>" once listening, then "REMOTEPREVIEW <what> <json>" per answer, subscribe and off
const PHONE_LINE = /^REMOTEPREVIEW (\S+)(?: (.*))?$/;
const PHONE_ENDPOINT = "https://push.example.test/arc-remote-phone";
const PHONE_WAIT_MS = 15_000;
const PHONE_GONE_TEXT = "already answered or withdrawn";
// headless chrome has no push service: the grant and the subscription are stubbed before any page script runs, and
// the grant outlives a reload as a real one would
const PHONE_GRANT_KEY = "arc-remote-phone.granted";
const PHONE_STUB = `(() => {
    Object.defineProperty(Notification, "permission", {
        configurable: true,
        get: () => (localStorage.getItem(${JSON.stringify(PHONE_GRANT_KEY)}) ? "granted" : "default"),
    });
    Notification.requestPermission = async () => {
        localStorage.setItem(${JSON.stringify(PHONE_GRANT_KEY)}, "1");
        return "granted";
    };
    PushManager.prototype.subscribe = async () => ({
        endpoint: ${JSON.stringify(PHONE_ENDPOINT)},
        expirationTime: null,
        keys: { p256dh: "BFakeP256dhKeyForTheRemotePhoneScenario", auth: "fakeAuthSecret" },
    });
})()`;

function phoneBrowserPath() {
    if (process.env.CHROME) return process.env.CHROME;
    const found = [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ].find((p) => existsSync(p));
    if (!found) throw new Error("no Chrome or Edge found; set CHROME=<path to chrome or msedge>");
    return found;
}

// resolves once the preview prints its url; every later record line lands in ctx.records
function phoneStartPreview(ctx, fixture) {
    const args = ["--fixture", fixture, ...(ctx.port ? ["--port", String(ctx.port)] : [])];
    const child = spawn(ctx.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    ctx.preview = child;
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    return new Promise((resolveUrl, reject) => {
        const timer = setTimeout(() => reject(new Error(`remotepreview did not start in ${PHONE_WAIT_MS}ms: ${stderr}`)), PHONE_WAIT_MS);
        let buf = "";
        child.stdout.on("data", (d) => {
            buf += d;
            let nl;
            while ((nl = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, nl).trim();
                buf = buf.slice(nl + 1);
                const m = line.match(PHONE_LINE);
                if (!m) continue;
                if (m[1].startsWith("http")) {
                    clearTimeout(timer);
                    ctx.url = m[1];
                    ctx.port = Number(new URL(m[1]).port);
                    resolveUrl(m[1]);
                } else {
                    ctx.records.push({ what: m[1], data: m[2] ? JSON.parse(m[2]) : null });
                }
            }
        });
        child.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`remotepreview exited (${code}) before it listened: ${stderr}`));
        });
    });
}

async function phoneStopPreview(ctx) {
    const child = ctx.preview;
    ctx.preview = null;
    if (!child || child.exitCode != null) return;
    const exited = new Promise((r) => child.once("exit", r));
    child.kill();
    await exited;
}

async function phoneLaunchBrowser(ctx, shots) {
    const profile = join(ctx.dir, "profile");
    ctx.browser = spawn(
        phoneBrowserPath(),
        [
            "--headless=new",
            "--disable-gpu",
            "--hide-scrollbars",
            "--no-first-run",
            "--no-default-browser-check",
            `--user-data-dir=${profile}`,
            "--remote-debugging-port=0",
            "about:blank",
        ],
        { stdio: "ignore" }
    );
    const portFile = join(profile, "DevToolsActivePort");
    let port = 0;
    for (const start = Date.now(); !port && Date.now() - start < PHONE_WAIT_MS; await polishNap(200)) {
        if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
    }
    if (!port) throw new Error(`the headless browser wrote no DevToolsActivePort in ${PHONE_WAIT_MS}ms`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find((t) => t.type === "page");
    if (!target) throw new Error(`the headless browser on :${port} has no page target`);
    const page = await openPage(target, shots);
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: PHONE_STUB });
    return page;
}

// a navigation or reload, then the first draw of #app
async function phoneLoad(page, url) {
    await page.ev(`(() => { window.__phoneReloading = true; location.href = ${JSON.stringify(url)}; })()`).catch(() => {});
    await polishWaitFor(page, `!window.__phoneReloading && document.querySelector("#app")?.childElementCount > 0`, PHONE_WAIT_MS);
}

const PHONE_READ = `(() => {
    const text = (el) => (el?.textContent || "").trim();
    const buttons = [...document.querySelectorAll("button")].map(text);
    return {
        chip: text(document.querySelector(".chip")),
        title: text(document.querySelector(".head h1")),
        sub: text(document.querySelector(".head-sub")),
        sections: [...document.querySelectorAll("section h2")].map(text),
        cards: [...document.querySelectorAll(".card .meta-agent")].map(text),
        held: document.querySelectorAll(".shown").length,
        notice: text(document.querySelector(".notice")),
        blank: text(document.querySelector(".blank-title")),
        notifications: buttons.includes("Turn on notifications"),
        off: buttons.includes("Turn off remote mode"),
        answering: document.querySelector(".qblock") != null,
        sent: text(document.querySelector(".sent")),
        handed: [...document.querySelectorAll("[data-handed-row]")].map((r) => ({
            tab: r.dataset.handedRow,
            name: text(r.querySelector(".meta-agent")),
            state: r.querySelector(".state-chip")?.dataset.state ?? "",
            chip: text(r.querySelector(".state-chip")),
            line: text(r.querySelector(".agent-line")),
        })),
        agents: [...document.querySelectorAll("[data-agent-row]")].map((r) => ({
            tab: r.dataset.agentRow,
            tag: r.tagName,
            untakeable: r.hasAttribute("data-untakeable"),
            dot: r.querySelector(".lead-dot")?.dataset.state ?? "",
            state: r.querySelector(".state-chip")?.dataset.state ?? "",
            chip: text(r.querySelector(".state-chip")),
            project: text(r.querySelector(".meta-project")),
            line: text(r.querySelector(".agent-line")),
            error: text(r.querySelector("[data-take-error]")),
        })),
        runs: [...document.querySelectorAll("[data-run-row]")].map((r) => ({
            key: r.dataset.runRow,
            expanded: r.getAttribute("aria-expanded"),
            name: text(r.querySelector(".run-name")),
            counts: text(r.querySelector(".agent-line")),
            needs: text(r.querySelector("[data-run-needs]")),
            workers: [...r.closest(".run").querySelectorAll("[data-run-worker]")].map((w) => ({ tab: w.dataset.runWorker, text: text(w) })),
        })),
        computer: (() => {
            const s = document.querySelector('section[aria-label="Computer"]');
            return s
                ? {
                      heading: text(s.querySelector("h2")),
                      buttons: [...s.querySelectorAll("[data-pc]")].map((b) => [b.dataset.pc, text(b)]),
                      error: text(s.querySelector("[data-pc-error]")),
                  }
                : null;
        })(),
        foot: text(document.querySelector(".foot-text")),
    };
})()`;

// the boards' copy, verbatim
const PHONE_OFF_FOOT = "This page goes offline, every handed-over agent goes back to the desk, and the PC may sleep again.";
const PHONE_TAKEN_TEXT =
    "phone-chat was taken back, here or at the desk, so it no longer takes messages from the phone. Hand it over again from the Agent surface.";
// fx-exited is on no list, so the page has no name for it
const PHONE_EXITED_TEXT = "The agent exited, so it is off the phone.";
const PHONE_EXITED_TAB = "fx-exited";
// what the preview's fixtures say (cmd/remotepreview): the take it refuses, the volume key it refuses, and the long
// transcript behind fx-lab-notes (testdata/lab-notes.jsonl: 260 lines, so the 200-line backlog starts at week 15)
const PHONE_REFUSED_TEXT = `Not taken: "refused" (tab fx-refused) has exited to its shell: claude is no longer running there`;
const PHONE_MUTE_REFUSAL = "This computer has no mute key";
const PHONE_LAB_FILE = "cmd/remotepreview/testdata/lab-notes.jsonl";
const PHONE_LAB_BACKLOG = 200;
const PHONE_LAB_FIRST = "Start a notes file for the thesis lab meeting: agenda, who presents, open questions.";
const PHONE_LAB_BACKLOG_TOP = "Add week 15's meeting to notes/lab-meeting.md: we talked about the supervisor's request for a second dataset.";
const PHONE_LAB_LINE = "Rewrote the related-work paragraph and added the two missing citations.";

const PHONE_CHAT_READ = `(() => {
    const text = (el) => (el?.textContent || "").trim();
    const q = (s) => document.querySelector(s);
    const box = q("#chat-msg");
    const stop = q("[data-chat-stop]");
    const note = q("[data-chat-note]");
    return {
        name: text(q(".chat-name")),
        state: text(q("[data-chat-state]")),
        users: [...document.querySelectorAll("[data-chat-user]")].map(text),
        actions: [...document.querySelectorAll("[data-chat-action]")].map((a) => ({
            mark: a.dataset.mark,
            verb: text(a.querySelector(".act-verb")),
            target: text(a.querySelector(".act-target")),
            tail: text(a.querySelector(".act-tail")),
            live: a.classList.contains("live"),
        })),
        replies: [...document.querySelectorAll("[data-chat-reply]")].map(text),
        md: [...document.querySelectorAll("[data-chat-reply]")].map((r) => {
            const prose = r.cloneNode(true);
            prose.querySelectorAll("pre").forEach((p) => p.remove());
            return {
                strong: [...r.querySelectorAll("strong")].map(text),
                em: [...r.querySelectorAll("em")].map(text),
                code: [...r.querySelectorAll(":not(pre) > code")].map((c) => ({ text: text(c), mono: /mono/i.test(getComputedStyle(c).fontFamily) })),
                items: [...r.querySelectorAll("ul > li")].map(text),
                links: [...r.querySelectorAll("a")].map((a) => ({ text: text(a), href: a.getAttribute("href"), target: a.target, rel: a.rel })),
                marks: [...r.querySelectorAll("mark")].map(text),
                prose: prose.textContent,
            };
        }),
        code: [...document.querySelectorAll("[data-chat-reply] pre.reply-code")].map((p) => ({
            text: p.textContent,
            mono: /mono/i.test(getComputedStyle(p).fontFamily),
        })),
        label: text(q('label[for="chat-msg"]')),
        placeholder: box?.placeholder ?? "",
        boxDisabled: box?.disabled ?? null,
        stop: stop && !stop.hidden ? text(stop) : "",
        note: note && !note.hidden ? text(note) : "",
        permission: q("[data-chat-permission]")
            ? { tool: text(q(".perm-tool")), ask: text(q(".perm-ask")), target: text(q(".perm-target")), note: text(q(".perm-note")) }
            : null,
        approve: q("[data-chat-approve]") != null,
        deny: q("[data-chat-deny]") != null,
        error: text(q(".send-error")),
        ended: q("[data-chat-ended]")?.dataset.chatEnded ?? "",
        endedTitle: text(q("[data-chat-ended] .blank-title")),
        endedText: text(q("[data-chat-ended] .blank-text")),
    };
})()`;

// Send stays disabled until an input event says the box holds text
const phoneType = (text) =>
    `(() => { const b = document.querySelector("#chat-msg"); if (!b) return false; b.value = ${JSON.stringify(text)}; b.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
const phoneClick = (selector) => `(() => { const b = document.querySelector(${JSON.stringify(selector)}); b?.click(); return !!b; })()`;
const phoneOpenChat = (tab) => phoneClick(`[data-handed-row="${tab}"]`);
// the stream's backlog has drawn once the transcript's first message shows
const PHONE_CHAT_DRAWN = `document.querySelector("[data-chat-user]") != null`;

const phoneClickButton = (label) =>
    `(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === ${JSON.stringify(label)}); b?.click(); return !!b; })()`;
const phoneOpenCard = (source) =>
    `(() => { const c = [...document.querySelectorAll(".card")].find((x) => x.querySelector(".meta-agent")?.textContent === ${JSON.stringify(source)}); c?.click(); return !!c; })()`;
const phonePick = (qi, oi) => `document.querySelectorAll(".qblock")[${qi}]?.querySelectorAll(".option")[${oi}]?.click()`;
const PHONE_SEND_DISABLED = `document.querySelector(".btn-primary")?.disabled ?? null`;

// The page polls /api/waiting every 10 s and again whenever it turns visible: a visibilitychange makes one at once.
// Counts the answers through a wrapper on fetch (kept for the life of the document), so this resolves once a new
// answer is in, then waits a beat for the page to draw it.
async function phoneRefresh(page) {
    await page.ev(`(() => {
        if (!window.__waitingAnswers) {
            window.__waitingAnswers = 0;
            const real = window.fetch;
            window.fetch = (...args) => {
                const p = real.apply(window, args);
                if (String(args[0]).includes("/api/waiting")) p.then(() => window.__waitingAnswers++, () => {});
                return p;
            };
        }
        window.__waitingWas = window.__waitingAnswers;
        document.dispatchEvent(new Event("visibilitychange"));
    })()`);
    await polishWaitFor(page, `window.__waitingAnswers > window.__waitingWas`, PHONE_WAIT_MS);
    await polishNap(300);
}

// the rows of the chat body once two reads 300 ms apart agree: the first paint of a thin backlog pages back by itself
async function phoneChatSettled(page) {
    let last = -1;
    for (let i = 0; i < 20; i++) {
        const n = await page.ev(`document.querySelector("[data-chat-body]")?.childElementCount ?? 0`);
        if (n > 0 && n === last) return n;
        last = n;
        await polishNap(300);
    }
    return last;
}

// the byte offset the preview gives the start of the 200-line backlog: lines joined by newlines, so the first
// (total - 200) lines' lengths plus one each (cmd/remotepreview lineOffsets)
function phoneLabCursor() {
    const lines = readFileSync(join(PHONE_REPO, PHONE_LAB_FILE), "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    return lines.slice(0, Math.max(0, lines.length - PHONE_LAB_BACKLOG)).reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
}

const remotePhone = {
    name: "remote-phone",
    surface: "cockpit",
    async arrange() {
        const dir = mkdtempSync(join(tmpdir(), "verify-remote-phone-"));
        const bin = join(dir, `remotepreview${process.platform === "win32" ? ".exe" : ""}`);
        // a built binary, not go run: killing go run on Windows leaves its child serving
        execFileSync("go", ["build", "-o", bin, "./cmd/remotepreview"], { cwd: PHONE_REPO, stdio: "pipe" });
        return { dir, bin, records: [], port: 0 };
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const records = (what) => ctx.records.filter((r) => r.what === what);
        const recorded = async (what, n) => {
            for (const start = Date.now(); records(what).length < n && Date.now() - start < PHONE_WAIT_MS; ) await polishNap(200);
            return records(what).length >= n;
        };

        await phoneStartPreview(ctx, "main");
        const page = (ctx.page = await phoneLaunchBrowser(ctx, h.shots));
        const shot = (n) => page.shot(`cdp-shots/remote-phone-${n}.png`);
        const shotScrolled = async (n) => {
            await page.ev(`document.querySelector(".main")?.scrollTo(0, 1e6)`);
            await polishNap(200);
            await shot(n);
            await page.ev(`document.querySelector(".main")?.scrollTo(0, 0)`);
        };
        const read = () => page.ev(PHONE_READ);
        const list = await (await fetch(`${ctx.url}api/waiting`)).json();
        const [portQ, checksQ, withdrawnQ] = list.questions;

        // 1. Main
        await phoneLoad(page, ctx.url);
        await polishWaitFor(page, `document.querySelectorAll(".card").length === 3`, PHONE_WAIT_MS);
        // the service worker must hold the shell before step 6 can draw Unreachable offline
        const sw = await page.ev(`Promise.race([
            navigator.serviceWorker.ready.then(() => caches.match("/")).then((r) => !!r),
            new Promise((r) => setTimeout(() => r(false), ${PHONE_WAIT_MS})),
        ])`);
        await polishNap(300);
        // the Handed over section sits under the three questions, below a phone's fold
        await page.ev(`document.querySelector('section[aria-label="Handed over"]')?.scrollIntoView({ block: "end" })`);
        await polishNap(200);
        await shot("1-main");
        await page.ev(`document.querySelector(".main")?.scrollTo(0, 0)`);
        await shotScrolled("1-main-held");
        const main = await read();
        const rowOf = (a) => ({ tab: a.tab, name: a.name, state: a.state, line: a.line });
        const wantHanded = list.handed.map(rowOf);
        const chipsOk =
            main.handed.length === 3 &&
            main.handed[0].chip === "needs approval" &&
            main.handed[1].chip.startsWith("working ") &&
            main.handed[2].chip.startsWith("idle ");
        // the h1 counts the three questions, the two held runs, siem-deploy's permission (once: the Agents roster repeats
        // it) and the run worker that waits on one; the sub-line names those two as "2 need approval" (it adds up to
        // the h1 but for the three hand-overs: 3 questions + 2 need approval + 2 held runs = 7)
        rec(
            "1. Main: the h1 counting what needs you, questions, the three hand-overs with their state chips, held runs, Agents, Runs, Computer, the counts line, the off footer and Turn on notifications",
            main.chip === "Remote on" &&
                main.title === "7 need you" &&
                main.sub === "3 questions to answer · 2 need approval · 3 agents handed over · 2 runs held" &&
                JSON.stringify(main.sections) ===
                    JSON.stringify(["Questions", "Handed over", "Held runs", "Agents", "Runs", "Computer"]) &&
                JSON.stringify(main.cards) === JSON.stringify(list.questions.map((q) => q.source)) &&
                JSON.stringify(main.handed.map(rowOf)) === JSON.stringify(wantHanded) &&
                JSON.stringify(wantHanded.map((a) => [a.name, a.state])) ===
                    JSON.stringify([
                        ["siem-deploy", "permission"],
                        ["phone-chat", "working"],
                        ["vault-sync", "idle"],
                    ]) &&
                chipsOk &&
                main.held === 2 &&
                main.off &&
                main.foot === PHONE_OFF_FOOT &&
                main.notifications &&
                sw === true,
            JSON.stringify({ ...main, sw })
        );

        // 1a. Agents: the live agents at the desk, hand-overs left out. The fixture's idle rows have sat 25, 12 and 8
        // minutes; one more minute may have passed since the preview started.
        await page.ev(`document.querySelector('section[aria-label="Agents"]')?.scrollIntoView({ block: "end" })`);
        await polishNap(200);
        await shot("1a-agents");
        await page.ev(`document.querySelector(".main")?.scrollTo(0, 0)`);
        const idleFor = (m) => new RegExp(`^idle (${m}|${m + 1})m$`);
        const agentRows = main.agents.map((a) => [a.tab, a.tag, a.untakeable, a.dot, a.state]);
        const [bench, lab, codex, refused] = main.agents;
        rec(
            "1a. Agents: bench-runner, lab-notes, codex-scan and refused with a state dot and chip each, lab-notes' line the first sentence of its last reply, the takeable rows buttons and codex-scan a muted row, no exited row",
            JSON.stringify(agentRows) ===
                JSON.stringify([
                    ["fx-bench-runner", "BUTTON", false, "working", "working"],
                    ["fx-lab-notes", "BUTTON", false, "idle", "idle"],
                    ["fx-codex-scan", "DIV", true, "idle", "idle"],
                    ["fx-refused", "BUTTON", false, "idle", "idle"],
                ]) &&
                bench.chip === "working" &&
                bench.line === "Running go test ./pkg/orchestrate" &&
                lab.project === "mit-thesis" &&
                idleFor(25).test(lab.chip) &&
                lab.line === PHONE_LAB_LINE &&
                idleFor(12).test(codex.chip) &&
                codex.line === "" &&
                idleFor(8).test(refused.chip) &&
                main.agents.every((a) => a.state !== "ended" && a.chip !== "exited" && a.tab !== "fx-old-spike") &&
                (await page.ev(`document.querySelectorAll("div[data-agent-row]:not([data-untakeable]), button[data-untakeable]").length`)) === 0,
            JSON.stringify(main.agents)
        );

        // 1b. Turn on notifications
        await page.ev(phoneClickButton("Turn on notifications"));
        const subscribed = await recorded("subscribe", 1);
        await polishWaitFor(page, `![...document.querySelectorAll("button")].some((b) => /^Turn(ing)? on notifications/.test(b.textContent.trim()))`, PHONE_WAIT_MS);
        await shot("1b-notifications-on");
        const afterSub = await read();
        rec(
            "1b. tapping Turn on notifications: the preview recorded the stub's subscription and the button is gone",
            subscribed && records("subscribe")[0].data.endpoint === PHONE_ENDPOINT && !afterSub.notifications && afterSub.notice === "",
            JSON.stringify({ subscribe: records("subscribe"), notice: afterSub.notice, button: afterSub.notifications })
        );

        // 1c. Take: a tap on a takeable row takes the agent and opens its chat; leaving it unacted releases the take and
        // the row is listed again; a refused take says why on its row, through a refresh, and opens nothing
        const takes = () => records("take").length;
        const releases = () => records("release").length;
        const [take0, release0] = [takes(), releases()];
        await page.ev(phoneClick('[data-agent-row="fx-lab-notes"]'));
        const tookLab = await recorded("take", take0 + 1);
        await polishWaitFor(page, PHONE_CHAT_DRAWN, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("1c-take-chat");
        const labChat = await page.ev(PHONE_CHAT_READ);
        const labHash = await page.ev(`location.hash`);
        await page.ev(phoneClick('[aria-label="Back to the list"]'));
        const releasedLab = await recorded("release", release0 + 1);
        await polishWaitFor(
            page,
            `document.querySelector('[data-agent-row="fx-lab-notes"]') != null && document.querySelectorAll("[data-handed-row]").length === 3`,
            PHONE_WAIT_MS
        );
        await polishNap(300);
        const listedAgain = await read();
        await page.ev(`document.querySelector('[data-agent-row="fx-lab-notes"]')?.scrollIntoView({ block: "center" })`);
        await shot("1c-released");
        await page.ev(phoneClick('[data-agent-row="fx-refused"]'));
        await polishWaitFor(page, `document.querySelector('[data-agent-row="fx-refused"] [data-take-error]') != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await page.ev(`document.querySelector('[data-agent-row="fx-refused"]')?.scrollIntoView({ block: "center" })`);
        await shot("1c-refused");
        const refusedNow = (await read()).agents.find((a) => a.tab === "fx-refused");
        await phoneRefresh(page);
        const refusedKept = (await read()).agents.find((a) => a.tab === "fx-refused");
        const stayedOnList = await page.ev(`location.hash === "" && document.querySelector(".chat-name") == null`);
        rec(
            "1c. Take: tapping lab-notes records a take and opens its chat, Back records a release and lists the row again; tapping refused shows its Not taken line, which survives a refresh, and opens no chat",
            tookLab &&
                JSON.stringify(records("take")[take0].data) === JSON.stringify({ tab: "fx-lab-notes" }) &&
                labHash === "#agent/fx-lab-notes" &&
                labChat.name === "lab-notes" &&
                labChat.state.startsWith("idle") &&
                labChat.users.length > 0 &&
                releasedLab &&
                JSON.stringify(records("release")[release0].data) === JSON.stringify({ tab: "fx-lab-notes" }) &&
                listedAgain.agents.some((a) => a.tab === "fx-lab-notes") &&
                !listedAgain.handed.some((a) => a.tab === "fx-lab-notes") &&
                refusedNow?.error === PHONE_REFUSED_TEXT &&
                refusedKept?.error === PHONE_REFUSED_TEXT &&
                stayedOnList &&
                takes() === take0 + 1 &&
                releases() === release0 + 1,
            JSON.stringify({ labHash, labChat: { name: labChat.name, state: labChat.state }, refusedNow, refusedKept, stayedOnList, takes: records("take"), releases: records("release") })
        );

        // 1d. Runs: the run row's counts and needs-you chip; a tap opens its three worker lines, a refresh keeps them
        // open, a second tap closes them
        const [run] = list.runs;
        const wantWorkers = run.workers.map((w) => ({ tab: w.tab, text: [w.label, w.line].filter(Boolean).join(" · ") }));
        const runRowSel = `[data-run-row="${run.key}"]`;
        await page.ev(`document.querySelector('${runRowSel}')?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await shot("1d-run-closed");
        const runClosed = (await read()).runs;
        await page.ev(phoneClick(runRowSel));
        await polishWaitFor(page, `document.querySelectorAll("[data-run-worker]").length === ${wantWorkers.length}`, PHONE_WAIT_MS);
        await page.ev(`document.querySelector(".run")?.scrollIntoView({ block: "center" })`);
        await polishNap(200);
        await shot("1d-run-open");
        const runOpen = (await read()).runs;
        await phoneRefresh(page);
        const runKept = (await read()).runs;
        await page.ev(phoneClick(runRowSel));
        await polishWaitFor(page, `document.querySelectorAll("[data-run-worker]").length === 0`, PHONE_WAIT_MS);
        const runShut = (await read()).runs;
        rec(
            "1d. Runs: the run row reads 2 working · 1 needs approval with its Needs you at the desk chip, a tap opens three worker lines (label · line), a refresh keeps them, a second tap closes them",
            run.key === "dag-fx1" &&
                wantWorkers.length === 3 &&
                runClosed.length === 1 &&
                runClosed[0].key === run.key &&
                runClosed[0].name === "Phone agent list" &&
                runClosed[0].counts === "2 working · 1 needs approval" &&
                runClosed[0].needs === "Needs you at the desk" &&
                runClosed[0].expanded === "false" &&
                runClosed[0].workers.length === 0 &&
                runOpen[0]?.expanded === "true" &&
                JSON.stringify(runOpen[0].workers) === JSON.stringify(wantWorkers) &&
                runKept[0]?.expanded === "true" &&
                JSON.stringify(runKept[0].workers) === JSON.stringify(wantWorkers) &&
                runShut[0]?.expanded === "false" &&
                runShut[0].workers.length === 0,
            JSON.stringify({ runClosed, runOpen, runKept, runShut })
        );

        // 2. Answer
        await page.ev(phoneOpenCard(portQ.source));
        await polishWaitFor(page, `document.querySelector(".qblock") != null`, PHONE_WAIT_MS);
        await page.ev(`(() => { const d = document.querySelector("details.fold"); if (d) d.open = true; })()`);
        await polishNap(300);
        await shot("2-answer");
        await shotScrolled("2-answer-end");
        const pq = portQ.questions[0];
        const answer = await page.ev(`(() => {
            const text = (el) => (el?.textContent || "").trim();
            const block = document.querySelector(".qblock");
            return {
                question: text(block?.querySelector("h1")),
                fold: block?.querySelector("details.fold")?.open ?? false,
                preview: block?.querySelector(".fold-text")?.textContent ?? "",
                nums: [...(block?.querySelectorAll(".option-num") ?? [])].map(text),
                rec: [...(block?.querySelectorAll(".option") ?? [])].findIndex((o) => o.querySelector(".rec-mark")),
                own: block?.querySelector("input[type=text]") != null,
                send: text(document.querySelector(".btn-primary")),
                sendDisabled: document.querySelector(".btn-primary")?.disabled ?? null,
            };
        })()`);
        const recIndex = pq.options.findIndex((o) => /\(Recommended\)$/.test(o.label));
        rec(
            "2. Answer: the full question, the fold open on the preview, numbered rows with the recommended mark, own answer, Send",
            answer.question === pq.question &&
                answer.fold &&
                answer.preview === pq.options[recIndex].preview &&
                JSON.stringify(answer.nums) === JSON.stringify(pq.options.map((_, i) => String(i + 1))) &&
                answer.rec === recIndex &&
                answer.own &&
                answer.send === "Send answer" &&
                answer.sendDisabled === true,
            JSON.stringify(answer)
        );

        // 3. Answered
        await page.ev(phonePick(0, recIndex));
        await page.ev(phoneClickButton("Send answer"));
        await polishWaitFor(page, `document.querySelector(".sent") != null`, PHONE_WAIT_MS);
        const answered = await recorded("answer", 1);
        await polishNap(300);
        await shot("3-answered");
        const sent = await read();
        const first = records("answer")[0]?.data;
        rec(
            "3. pick and send: Answered with what was sent, and the preview recorded the answer",
            sent.sent.startsWith("Answered") &&
                sent.sent.includes(`Sent to ${portQ.source}: 8765`) &&
                answered &&
                first.oref === portQ.oref &&
                first.askid === portQ.askid &&
                JSON.stringify(first.answers) === JSON.stringify([{ selectedindexes: [recIndex] }]),
            JSON.stringify({ sent: sent.sent, record: first })
        );

        // 4. a two-question ask: Send waits for both
        await page.ev(phoneClickButton("Back to what is waiting"));
        await polishWaitFor(page, `document.querySelectorAll(".card").length === 2`, PHONE_WAIT_MS);
        await page.ev(phoneOpenCard(checksQ.source));
        await polishWaitFor(page, `document.querySelectorAll(".qblock").length === 2`, PHONE_WAIT_MS);
        await page.ev(phonePick(0, 1));
        const halfDisabled = await page.ev(PHONE_SEND_DISABLED);
        await polishNap(200);
        await shot("4-half-answered");
        await page.ev(phonePick(1, 0));
        await page.ev(phonePick(1, 2));
        const fullDisabled = await page.ev(PHONE_SEND_DISABLED);
        const multiChecked = await page.ev(
            `[...document.querySelectorAll(".qblock")[1].querySelectorAll(".option")].map((o) => o.getAttribute("aria-checked"))`
        );
        await shotScrolled("4-both-answered");
        await page.ev(phoneClickButton("Send answer"));
        await polishWaitFor(page, `document.querySelector(".sent") != null`, PHONE_WAIT_MS);
        const second = (await recorded("answer", 2)) ? records("answer")[1].data : null;
        await polishNap(300);
        await shot("4-answered");
        rec(
            "4. a two-question ask: Send stays disabled with one answered, then sends both, the second multi-select",
            halfDisabled === true &&
                fullDisabled === false &&
                JSON.stringify(multiChecked) === JSON.stringify(["true", "false", "true"]) &&
                second?.oref === checksQ.oref &&
                JSON.stringify(second?.answers) === JSON.stringify([{ selectedindexes: [1] }, { selectedindexes: [0, 2] }]),
            JSON.stringify({ halfDisabled, fullDisabled, multiChecked, record: second })
        );

        // 4b. a question answered at the desk meanwhile
        await page.ev(phoneClickButton("Back to what is waiting"));
        await polishWaitFor(page, `document.querySelectorAll(".card").length === 1`, PHONE_WAIT_MS);
        await page.ev(phoneOpenCard(withdrawnQ.source));
        await polishWaitFor(page, `document.querySelector(".qblock") != null`, PHONE_WAIT_MS);
        await page.ev(phonePick(0, 0));
        await page.ev(phoneClickButton("Send answer"));
        await polishWaitFor(page, `document.querySelector(".notice") != null && !document.querySelector(".qblock")`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("4b-gone");
        const gone = await read();
        rec(
            "4b. the withdrawn question: the page says it was already answered or withdrawn and is back on the list",
            gone.notice.includes(PHONE_GONE_TEXT) && !gone.answering && gone.cards.length === 1 && records("answer").length === 2,
            JSON.stringify({ notice: gone.notice, cards: gone.cards, answers: records("answer").length })
        );

        // 5. Empty
        await phoneStopPreview(ctx);
        await phoneStartPreview(ctx, "empty");
        await phoneLoad(page, ctx.url);
        await polishWaitFor(page, `document.querySelector(".blank-title") != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("5-empty");
        const empty = await read();
        rec(
            "5. the empty fixture: Empty with the h1 Nothing waits on you, still on, the Computer section and the off button",
            empty.blank === "Nothing is waiting on you." &&
                empty.title === "Nothing waits on you" &&
                empty.chip === "Remote on" &&
                empty.sub === "Nothing waiting" &&
                empty.computer?.heading === "Computer" &&
                JSON.stringify(empty.computer.buttons) ===
                    JSON.stringify([
                        ["lock", "Lock"],
                        ["down", "Volume down"],
                        ["mute", "Mute"],
                        ["up", "Volume up"],
                    ]) &&
                empty.off,
            JSON.stringify(empty)
        );

        // 6. Unreachable
        await phoneStopPreview(ctx);
        await phoneLoad(page, ctx.url);
        await polishWaitFor(page, `document.querySelector(".chip-off") != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("6-unreachable");
        const down = await read();
        rec(
            "6. the preview stopped and the page reloaded: Unreachable with Last reached",
            down.chip === "Not reachable" && down.sub.startsWith("Last reached") && down.blank === "arcterm is not reachable.",
            JSON.stringify(down)
        );

        // 7. turn off from the phone
        await phoneStartPreview(ctx, "main");
        await phoneLoad(page, ctx.url);
        await polishWaitFor(page, `document.querySelector(".chip-on") != null && document.querySelectorAll(".card").length > 0`, PHONE_WAIT_MS);
        await page.ev(phoneClickButton("Turn off remote mode"));
        await polishNap(200);
        await shot("7-confirm-off");
        await page.ev(phoneClickButton("Turn off now"));
        const off = await recorded("off", 1);
        await polishWaitFor(page, `document.querySelector(".chip-off") != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("7-off");
        const after = await read();
        rec(
            "7. Turn off remote mode, confirmed: the preview recorded Off and the page shows Unreachable",
            off && after.chip === "Not reachable" && after.blank === "arcterm is not reachable.",
            JSON.stringify({ ...after, offRecords: records("off").length })
        );

        // the chats: a fresh main fixture, each chat opened from its Handed over row
        const inputs = () => records("input").map((r) => r.data);
        const chatRead = () => page.ev(PHONE_CHAT_READ);
        const restartOn = async (fixture) => {
            await phoneStopPreview(ctx);
            await phoneStartPreview(ctx, fixture);
            await phoneLoad(page, ctx.url);
            await polishWaitFor(page, `document.querySelectorAll("[data-handed-row]").length > 0`, PHONE_WAIT_MS);
        };
        const openChat = async (tab) => {
            await page.ev(phoneOpenChat(tab));
            await polishWaitFor(page, PHONE_CHAT_DRAWN, PHONE_WAIT_MS);
            await polishNap(300);
        };

        // 8. Chat: vault-sync, idle
        await restartOn("main");
        await openChat("fx-vault-sync");
        await shot("8-chat");
        const chat = await chatRead();
        // the first reply's markdown (vault-sync.jsonl a3) draws as elements, with no mark left as text
        const md = chat.md[0] ?? {};
        const mdOk =
            JSON.stringify(md.strong) === JSON.stringify(["stale"]) &&
            JSON.stringify(md.em) === JSON.stringify(["why"]) &&
            md.code?.length === 4 &&
            md.code[0].text === "git mv" &&
            md.code.every((c) => c.mono) &&
            md.items?.length === 3 &&
            md.items[0] === "inbox/2026-08-12 tunnel notes.md" &&
            JSON.stringify(md.links) ===
                JSON.stringify([{ text: "git mv", href: "https://git-scm.com/docs/git-mv", target: "_blank", rel: "noopener noreferrer" }]) &&
            JSON.stringify(md.marks) === JSON.stringify(["Moving them with git mv keeps their history."]) &&
            !/\*\*|`|==|\[git mv\]/.test(md.prose ?? "*");
        await page.ev(phoneType("archive the drafts folder too"));
        await page.ev(phoneClick("[data-chat-send]"));
        const sentOk = await recorded("input", 1);
        const cleared = await polishWaitFor(page, `document.querySelector("#chat-msg")?.value === ""`, PHONE_WAIT_MS);
        await shot("8-chat-sent");
        rec(
            "8. Chat (vault-sync, idle): the user bubble, the action lines, the reply's markdown (bold, italic, inline code, list, link, highlight; no raw marks) and its mono code block, Message vault-sync; Send is recorded",
            chat.name === "vault-sync" &&
                chat.state.startsWith("idle") &&
                JSON.stringify(chat.users) === JSON.stringify(["archive the inbox notes marked stale and push"]) &&
                JSON.stringify(chat.actions.map((a) => a.verb)) === JSON.stringify(["Grep", "Read", "Ran", "Ran"]) &&
                chat.actions[3]?.target === "git push" &&
                chat.actions[3]?.mark === "ok" &&
                chat.replies.length === 2 &&
                chat.replies[1] === "Moved the 3 stale notes to archive/ and pushed. Anything else?" &&
                chat.code.length === 1 &&
                chat.code[0].text.startsWith("git mv") &&
                chat.code[0].mono &&
                mdOk &&
                chat.label === "Message vault-sync" &&
                chat.placeholder === "Message vault-sync" &&
                chat.boxDisabled === false &&
                chat.stop === "" &&
                chat.permission === null &&
                sentOk &&
                cleared &&
                JSON.stringify(inputs()[0]) === JSON.stringify({ tab: "fx-vault-sync", action: "send", text: "archive the drafts folder too" }),
            JSON.stringify({ chat, cleared, inputs: inputs() })
        );

        // 9. ChatWorking: phone-chat
        await page.ev(`(location.hash = "#agent/fx-phone-chat", true)`);
        await polishWaitFor(page, `document.querySelector(".chat-name")?.textContent === "phone-chat" && ${PHONE_CHAT_DRAWN}`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("9-chat-working");
        const working = await chatRead();
        await page.ev(phoneClick("[data-chat-stop]"));
        const stopped = await recorded("input", 2);
        const live = working.actions.at(-1);
        rec(
            "9. ChatWorking (phone-chat): working, the live Running line with its elapsed, Add to this turn and Stop in the header; Stop is recorded",
            working.state.startsWith("working") &&
                live?.live === true &&
                live.verb === "Running" &&
                live.target === "node scripts/cdp/verify.mjs remote-phone" &&
                /^\d+[hms]/.test(live.tail) &&
                working.label === "Add to this turn" &&
                working.placeholder === "Add to this turn" &&
                working.stop === "Stop" &&
                working.code.length === 1 &&
                stopped &&
                JSON.stringify(inputs()[1]) === JSON.stringify({ tab: "fx-phone-chat", action: "stop", text: "" }),
            JSON.stringify({ working, inputs: inputs() })
        );

        // 10. ChatPermission: siem-deploy
        await page.ev(`(location.hash = "#agent/fx-siem-deploy", true)`);
        await polishWaitFor(page, `document.querySelector("[data-chat-permission]") != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("10-chat-permission");
        const perm = await chatRead();
        await page.ev(phoneClick("[data-chat-approve]"));
        const approved = await recorded("input", 3);
        await polishWaitFor(page, `document.querySelector("[data-chat-approve]")?.disabled === false`, PHONE_WAIT_MS);
        const reason = "restart it after 18:00, the night shift is still ingesting";
        await page.ev(phoneType(reason));
        await page.ev(phoneClick("[data-chat-send]"));
        const denied = await recorded("input", 4);
        await polishNap(200);
        await shot("10-chat-denied");
        const restartCmd = "ssh deploy@siem-236 'sudo systemctl restart ingest'";
        rec(
            "10. ChatPermission (siem-deploy): the card with Bash, the whole command, Approve and Deny, the deny box; Approve then a typed deny are recorded",
            perm.permission?.tool === "Bash" &&
                perm.permission.ask === "Wants to run a command" &&
                perm.permission.target === restartCmd &&
                perm.permission.note === "The agent is paused until you choose." &&
                perm.approve &&
                perm.deny &&
                !perm.actions.some((a) => a.target === restartCmd) &&
                perm.placeholder === "Deny and say what to do instead" &&
                perm.label === "Deny and tell siem-deploy why" &&
                approved &&
                denied &&
                JSON.stringify(inputs().slice(2)) ===
                    JSON.stringify([
                        { tab: "fx-siem-deploy", action: "approve", text: "" },
                        { tab: "fx-siem-deploy", action: "deny", text: reason },
                    ]),
            JSON.stringify({ perm, inputs: inputs() })
        );

        // 11. Needs input: docs-worker, alone in the input fixture
        await restartOn("input");
        await openChat("fx-docs-worker");
        await shot("11-needs-input");
        const needs = await chatRead();
        rec(
            "11. Needs input (docs-worker): the desk note, the box disabled, no Approve or Deny, no Stop",
            needs.name === "docs-worker" &&
                needs.note === "Needs input · answer it at the desk" &&
                needs.boxDisabled === true &&
                !needs.approve &&
                !needs.deny &&
                needs.stop === "" &&
                needs.replies.length === 1,
            JSON.stringify(needs)
        );

        // 12. ChatEnded taken: Take back on phone-chat
        await restartOn("main");
        await openChat("fx-phone-chat");
        await page.ev(phoneClick("[data-chat-takeback]"));
        const tookBack = await recorded("takeback", 1);
        await polishWaitFor(page, `document.querySelector('[data-chat-ended="taken"]') != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("12-ended-taken");
        const taken = await chatRead();
        await page.ev(phoneClickButton("Back to the list"));
        await polishWaitFor(page, `document.querySelectorAll("[data-handed-row]").length === 2`, PHONE_WAIT_MS);
        const afterTake = await read();
        rec(
            "12. ChatEnded taken: Take back is recorded, Back at the desk with the taken string, and the list drops phone-chat",
            tookBack &&
                JSON.stringify(records("takeback")[0].data) === JSON.stringify({ tab: "fx-phone-chat" }) &&
                taken.ended === "taken" &&
                taken.endedTitle === "Back at the desk" &&
                taken.endedText === PHONE_TAKEN_TEXT &&
                JSON.stringify(afterTake.handed.map((a) => a.name)) === JSON.stringify(["siem-deploy", "vault-sync"]),
            JSON.stringify({ taken, handed: afterTake.handed.map((a) => a.name) })
        );

        // 12b. ChatEnded exited: a tab whose agent exited, opened by its address
        await page.ev(`(location.hash = "#agent/${PHONE_EXITED_TAB}", true)`);
        await polishWaitFor(page, `document.querySelector('[data-chat-ended="exited"]') != null`, PHONE_WAIT_MS);
        await polishNap(300);
        await shot("12b-ended-exited");
        const exited = await chatRead();
        rec(
            "12b. ChatEnded exited: #agent/fx-exited draws Back at the desk with the exited string",
            exited.ended === "exited" && exited.endedTitle === "Back at the desk" && exited.endedText === PHONE_EXITED_TEXT,
            JSON.stringify(exited)
        );

        // 13. Older messages: lab-notes' backlog is its last 200 of 260 lines, so its first message lies a page back;
        // scrolling to the top asks for that page once, and the message that was on top stays in view under it
        await restartOn("main");
        const transcript0 = records("transcript").length;
        const release13 = records("release").length;
        await page.ev(phoneClick('[data-agent-row="fx-lab-notes"]'));
        await polishWaitFor(page, PHONE_CHAT_DRAWN, PHONE_WAIT_MS);
        await phoneChatSettled(page);
        await shot("13-chat-latest");
        const latest = await page.ev(`(() => {
            const body = document.querySelector("[data-chat-body]");
            return {
                users: [...document.querySelectorAll("[data-chat-user]")].map((b) => b.textContent.trim()),
                earlier: document.querySelector("[data-chat-earlier]")?.dataset.chatEarlier ?? "",
                scrollTop: body.scrollTop,
            };
        })()`);
        await page.ev(`(document.querySelector("[data-chat-body]").scrollTop = 0, true)`);
        const paged = await recorded("transcript", transcript0 + 1);
        await polishWaitFor(
            page,
            `document.querySelector("[data-chat-user]")?.textContent.trim() === ${JSON.stringify(PHONE_LAB_FIRST)} && document.querySelector("[data-chat-earlier]") == null`,
            PHONE_WAIT_MS
        );
        await phoneChatSettled(page);
        // the bubble that headed the backlog must lie wholly inside the body's viewport now
        const older = await page.ev(`(() => {
            const body = document.querySelector("[data-chat-body]");
            const box = body.getBoundingClientRect();
            const prev = [...document.querySelectorAll("[data-chat-user]")].find((b) => b.textContent.trim() === ${JSON.stringify(PHONE_LAB_BACKLOG_TOP)});
            const at = prev?.getBoundingClientRect();
            return {
                users: [...document.querySelectorAll("[data-chat-user]")].map((b) => b.textContent.trim()),
                earlier: document.querySelector("[data-chat-earlier]")?.dataset.chatEarlier ?? "",
                scrollTop: body.scrollTop,
                prevInView: !!at && at.top >= box.top - 1 && at.bottom <= box.bottom + 1,
            };
        })()`);
        await shot("13-older-messages");
        const pages = records("transcript").slice(transcript0);
        rec(
            "13. Older messages (lab-notes): the chat opens on the week 15 message, scrolling to the top records one transcript request before the backlog's cursor, the first message of the thread shows above, and the message that was on top is still in view",
            latest.users[0] === PHONE_LAB_BACKLOG_TOP &&
                !latest.users.includes(PHONE_LAB_FIRST) &&
                latest.earlier === "" &&
                latest.scrollTop > 0 &&
                paged &&
                pages.length === 1 &&
                JSON.stringify(pages[0].data) === JSON.stringify({ tab: "fx-lab-notes", before: phoneLabCursor() }) &&
                older.users[0] === PHONE_LAB_FIRST &&
                older.users.includes(PHONE_LAB_BACKLOG_TOP) &&
                older.users.length > latest.users.length &&
                older.earlier === "" &&
                older.scrollTop > 0 &&
                older.prevInView,
            JSON.stringify({ latest: { ...latest, users: latest.users.length, top: latest.users[0] }, older: { ...older, users: older.users.length, top: older.users[0] }, pages })
        );

        // 14. Computer: Lock and volume up reach the PC (the preview records them); Mute is refused and the page says
        // why under the buttons, until a later press goes through
        await page.ev(phoneClick('[aria-label="Back to the list"]'));
        await recorded("release", release13 + 1);
        await polishWaitFor(page, `document.querySelector('section[aria-label="Computer"]') != null && document.querySelectorAll("[data-handed-row]").length === 3`, PHONE_WAIT_MS);
        const [lock0, volume0] = [records("pclock").length, records("pcvolume").length];
        const pcScroll = () => page.ev(`document.querySelector('section[aria-label="Computer"]')?.scrollIntoView({ block: "center" })`);
        await pcScroll();
        await polishNap(300);
        await shot("14-computer");
        const computer = (await read()).computer;
        await page.ev(phoneClick('[data-pc="lock"]'));
        const locked = await recorded("pclock", lock0 + 1);
        await page.ev(phoneClick('[data-pc="up"]'));
        const louder = await recorded("pcvolume", volume0 + 1);
        await page.ev(phoneClick('[data-pc="mute"]'));
        await polishWaitFor(page, `document.querySelector("[data-pc-error]") != null`, PHONE_WAIT_MS);
        await pcScroll();
        await polishNap(300);
        await shot("14-computer-refused");
        const muted = (await read()).computer;
        const volumeAfterMute = records("pcvolume").length;
        await page.ev(phoneClick('[data-pc="down"]'));
        const quieter = await recorded("pcvolume", volume0 + 2);
        await polishWaitFor(page, `document.querySelector("[data-pc-error]") == null`, PHONE_WAIT_MS);
        const pcCleared = (await read()).computer;
        rec(
            "14. Computer: Lock records a pclock and Volume up a pcvolume up, Mute records nothing and shows its refusal under the buttons, and a later Volume down records and clears it",
            computer?.heading === "Computer" &&
                JSON.stringify(computer.buttons) ===
                    JSON.stringify([
                        ["lock", "Lock"],
                        ["down", "Volume down"],
                        ["mute", "Mute"],
                        ["up", "Volume up"],
                    ]) &&
                computer.error === "" &&
                locked &&
                JSON.stringify(records("pclock")[lock0].data) === JSON.stringify({}) &&
                louder &&
                JSON.stringify(records("pcvolume")[volume0].data) === JSON.stringify({ step: "up" }) &&
                muted?.error === PHONE_MUTE_REFUSAL &&
                volumeAfterMute === volume0 + 1 &&
                quieter &&
                JSON.stringify(records("pcvolume")[volume0 + 1].data) === JSON.stringify({ step: "down" }) &&
                pcCleared?.error === "",
            JSON.stringify({ computer, muted, cleared: pcCleared, locks: records("pclock"), volumes: records("pcvolume") })
        );
        return steps;
    },
    async teardown(_h, ctx) {
        ctx.page?.close();
        await phoneStopPreview(ctx).catch(() => {});
        if (ctx.browser && ctx.browser.exitCode == null) {
            const exited = new Promise((r) => ctx.browser.once("exit", r));
            ctx.browser.kill();
            await exited;
        }
        rmSync(ctx.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
};

// --- remote-hand: Hand to phone in the Agent header's More menu, and the On phone pill ---------------------------
// A dev roster (devMockAgentsAtom) holds one plain claude agent. Its block is not a real one, so the pane's start error
// is cleared once it has tried. Step 2 sets a handed-over status into remoteStatusAtom; step 3 picks Hand to phone
// against the real RemoteHandCommand, which refuses: the dev store has no remote setup, and the tab is no live agent.
const HAND_ID = "fx-remote-hand";
const HAND_BLOCK = "fx-blk-remote-hand";
const HAND_HEADER = `document.querySelector("[data-agent-header]")`;
const HAND_PILL = `${HAND_HEADER}?.querySelector("[data-hand-to-phone]")`;
const HAND_MENU_ITEM = `document.querySelector("[data-more-hand-to-phone]")`;
const HAND_TOAST = `[...document.querySelectorAll("[data-notification-toast]")].find((t) => (t.textContent || "").includes("Couldn't hand the agent to the phone"))`;
// the hand-over waits up to the switch's 15 s timeout before it fails
const HAND_REFUSE_MS = 20000;
const HAND_FIND_MODEL = `
    const agentsModel = () => {
        const nav = document.querySelector("nav");
        const key = nav && Object.keys(nav).find((k) => k.startsWith("__reactFiber$"));
        for (let f = key ? nav[key] : null; f; f = f.return) {
            if (f.memoizedProps?.model?.pendingLaunchesAtom) return f.memoizedProps.model;
        }
        throw new Error("no AgentsViewModel above the nav rail");
    };
`;
const handRoster = (roster) =>
    `${HAND_FIND_MODEL}
    const { globalStore } = await mod("app/store/jotaiStore.ts");
    const { devMockAgentsAtom } = await mod("app/view/agents/devmock.ts");
    globalStore.set(devMockAgentsAtom, ${JSON.stringify(roster)});
    if (${roster != null}) {
        const { setChatMode } = await mod("app/view/agents/chatmodestore.ts");
        setChatMode(${JSON.stringify(HAND_ID)}, "terminal");
        const model = agentsModel();
        globalStore.set(model.focusIdAtom, ${JSON.stringify(HAND_ID)});
        globalStore.set(model.surfaceAtom, "agent");
    }
    return true;`;
const handStatus = (h, status) =>
    lookEval(h, `
        const { globalStore } = await mod("app/store/jotaiStore.ts");
        const { remoteStatusAtom } = await mod("app/view/agents/remotestore.ts");
        globalStore.set(remoteStatusAtom, ${JSON.stringify(status)});
        return true;
    `);
const handReload = (h) =>
    lookEval(h, `
        await (await mod("app/view/agents/remotestore.ts")).loadRemoteStatus();
        return true;
    `);
const handOpenMore = async (h) => {
    const at = await h.ev(`(() => {
        const r = ${HAND_HEADER}?.querySelector("[data-agent-header-more]")?.getBoundingClientRect();
        return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    })()`);
    if (at == null) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
        await h.cdp("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
    }
    return polishWaitFor(h, `${HAND_MENU_ITEM} != null`, 3000);
};
const handCloseMenu = async (h) => {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    }
};
const HAND_READ = `(() => {
    const pill = ${HAND_PILL};
    const item = ${HAND_MENU_ITEM};
    return {
        header: ${HAND_HEADER} != null,
        pill: pill != null,
        pillText: (pill?.textContent || "").trim(),
        pillPressed: pill?.getAttribute("aria-pressed") ?? null,
        pillLabel: pill?.getAttribute("aria-label") ?? null,
        item: item != null,
        itemText: (item?.textContent || "").replace(/\\s+/g, " ").trim(),
    };
})()`;

const remoteHand = {
    name: "remote-hand",
    surface: "agent",
    async arrange(h) {
        const ctx = {};
        try {
            await h.goto("agent");
            await lookEval(
                h,
                handRoster([
                    {
                        id: HAND_ID,
                        name: "phone candidate",
                        project: "waveterm",
                        task: "phone candidate",
                        state: "idle",
                        agent: "claude",
                        model: "opus",
                        idleSince: Date.now() - 60_000,
                        blockId: HAND_BLOCK,
                    },
                ])
            );
            await polishWaitFor(h, `(${HAND_HEADER}?.textContent || "").includes("phone candidate")`, 8000);
            // the fixture block is not a real one: clear the start error the pane raises, as agent-header-redesign does
            await polishWaitFor(h, `!!${HAND_HEADER}?.querySelector("[data-agent-start-error]")`, 3000);
            await lookEval(
                h,
                `const { globalStore } = await mod("app/store/jotaiStore.ts");
                const { getStartErrorAtom } = await mod("app/view/agents/agentcontrollerstore.ts");
                globalStore.set(getStartErrorAtom(${JSON.stringify(HAND_BLOCK)}), undefined);
                return true;`
            );
            await handReload(h);
            await polishNap(400);
        } catch (e) {
            ctx.arrangeError = String(e?.message ?? e);
        }
        return ctx;
    },
    async assert(h, ctx) {
        const steps = [];
        const rec = (step, ok, detail) => steps.push({ step, ok, detail });
        const shot = (n) => h.shot(`cdp-shots/remote-hand-${n}.png`);

        const opened = await handOpenMore(h);
        await polishNap(200);
        await shot("1-more-menu");
        const idle = await h.ev(HAND_READ);
        rec(
            "1. a plain claude agent's header has no On phone pill, and its More menu offers Hand to phone",
            ctx.arrangeError == null && opened && idle.header && !idle.pill && idle.itemText.startsWith("Hand to phone"),
            ctx.arrangeError ?? JSON.stringify(idle)
        );
        await handCloseMenu(h);

        await handStatus(h, { on: true, tunnel: "up", subscriptions: 0, hostname: "arc.example.com", handed: [HAND_ID] });
        await polishWaitFor(h, `${HAND_PILL} != null`, 3000);
        await polishNap(300);
        await shot("2-on-phone");
        const handed = await h.ev(HAND_READ);
        const reopened = await handOpenMore(h);
        const handedMenu = await h.ev(HAND_READ);
        await handCloseMenu(h);
        rec(
            "2. handed over: the header shows On phone · Take back (the icon alone in a narrow header), pressed, and More offers Take back from the phone",
            handed.pill && ["On phone · Take back", ""].includes(handed.pillText) && handed.pillLabel === "Take back from the phone" && handed.pillPressed === "true" && reopened && handedMenu.itemText.startsWith("Take back from the phone"),
            JSON.stringify({ handed, menu: handedMenu.itemText })
        );

        await handReload(h);
        await polishWaitFor(h, `${HAND_PILL} == null`, 3000);
        await handOpenMore(h);
        await h.ev(`${HAND_MENU_ITEM}?.click()`);
        const toasted = await polishWaitFor(h, `${HAND_TOAST} != null`, HAND_REFUSE_MS);
        await polishNap(300);
        await shot("3-refused");
        const toast = await h.ev(`(${HAND_TOAST}?.textContent || "").trim()`);
        const after = await h.ev(HAND_READ);
        rec(
            "3. the real hand-over refuses: an error toast says why, and no On phone pill shows",
            toasted && toast.length > "Couldn't hand the agent to the phone".length && !after.pill,
            JSON.stringify({ toasted, toast, ...after })
        );
        return steps;
    },
    async teardown(h) {
        await handCloseMenu(h).catch(() => {});
        await handReload(h).catch(() => {});
        await lookEval(h, handRoster(null)).catch(() => {});
        await h.goto("cockpit");
    },
};

export default function remoteScenarios(kit) {
    ({ lookEval, polishNap, polishWaitFor } = kit);
    return [remoteSwitchScenario, remotePhone, remoteHand];
}
