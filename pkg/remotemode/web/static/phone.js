// The phone page: draws what waits on the owner from /api/waiting, answers questions, opens the chat with
// a handed-over agent (#agent/<tab>), turns remote mode off and subscribes to pushes. Every string from
// the server goes in as text, never as markup.

import { openChat } from "./chat.js";
import { chatTab, rowStateLabel } from "./chatmodel.js";
import {
    agentProject,
    answerText,
    base64UrlToBytes,
    buildAnswers,
    countsLine,
    failReason,
    formatAge,
    listedAgents,
    needYouTitle,
    optionCountLine,
    pageOutdated,
    runCounts,
    runWorkerText,
    shownWord,
    splitRecommended,
    takeNotice,
    viewState,
} from "./model.js";

const REFRESH_MS = 10 * 1000;
const PC_LOCK_REREAD_MS = 1500;
// Leaving a chat waits for its release post so the list never reads the agent as still handed. The chat bounds
// its own wait to about 2 s; this is the page's backstop, so the list can never wait longer than that.
const LEAVE_WAIT_MS = 3 * 1000;
const LAST_REACHED_KEY = "arc-remote.lastReached";
// an expired access session turns api calls into a redirect to the login; one reload per window sends the
// page through it without looping when the login itself keeps failing
const LOGIN_RELOAD_KEY = "arc-remote.loginReload";
const LOGIN_RELOAD_GAP_MS = 30 * 1000;
const HELD_KIND = "run-land-held";
const GONE_NOTICE = "That question was already answered or withdrawn, so nothing was sent.";

const ICON_CHEVRON_RIGHT = '<path d="M9 6l6 6-6 6"></path>';
const ICON_CHEVRON_LEFT = '<path d="M15 6l-6 6 6 6"></path>';
const ICON_PAUSE = '<path d="M8 5v14M16 5v14"></path>';
const ICON_DESK = '<rect x="3" y="4" width="18" height="12" rx="2"></rect><path d="M8 20h8M12 16v4"></path>';
const ICON_CHECK = '<path d="M5 12l5 5 9-10"></path>';
const ICON_CHEVRON_DOWN = '<path d="M6 9l6 6 6-6"></path>';

const app = document.getElementById("app");
const state = {
    loaded: false,
    list: null,
    error: null,
    answering: null, // { q, picks: number[][], texts: string[], sending }
    sent: null, // { q, text }
    notice: "",
    confirmOff: false,
    turnedOff: false,
    subscribing: false,
    subscribed: false,
    chat: null, // { tab, close } while a chat is open
    // how many chats are being left: their release posts are still going, so a list drawn now could read the
    // agent as handed over; render() waits for the count to reach zero
    leaving: 0,
    // which view render() drew last (null while a chat holds the page), so a redraw of the same view keeps its scroll
    drawn: null,
    // keys of shown rows whose reason the owner expanded; the 10s refresh redraws every row
    expanded: new Set(),
    // the 10s refresh redraws every row, so what a row shows lives here, not in its element:
    taking: new Set(), // tabs whose take is in flight
    takeErrors: new Map(), // tab -> "Not taken: <reason>", until that row's next take
    openRuns: new Set(), // keys of the run rows the owner opened
    pcError: "", // what the last Computer press answered when it was not 200
    build: "", // the build the first list named: the page's own code is that build's
};

function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v == null || v === false) {
            continue;
        }
        if (k === "class") {
            el.className = v;
        } else if (k.startsWith("on")) {
            el.addEventListener(k.slice(2), v);
        } else {
            el.setAttribute(k, v === true ? "" : String(v));
        }
    }
    el.append(...children.flat().filter((c) => c != null && c !== false && c !== ""));
    return el;
}

// icon markup is the constants above, never server data
function icon(paths, size, strokeWidth = 2) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", strokeWidth);
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = paths;
    return svg;
}

function age(since) {
    return since > 0 ? formatAge(Date.now() - since) : "";
}

function clock(ts) {
    const d = new Date(ts);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (d.toDateString() === new Date().toDateString()) {
        return time;
    }
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

async function post(path, body) {
    return fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        redirect: "manual",
    });
}

// one string field of an answer's JSON body, "" when the body is not JSON or lacks it
async function bodyField(res, field) {
    try {
        return (await res.json())[field] ?? "";
    } catch {
        return "";
    }
}

function reloadForLogin() {
    const last = Number(sessionStorage.getItem(LOGIN_RELOAD_KEY) ?? 0);
    if (Date.now() - last < LOGIN_RELOAD_GAP_MS) {
        return false;
    }
    sessionStorage.setItem(LOGIN_RELOAD_KEY, String(Date.now()));
    location.reload();
    return true;
}

async function refresh() {
    if (state.turnedOff || document.visibilityState !== "visible") {
        return;
    }
    let list = null;
    let error = null;
    try {
        const res = await fetch("/api/waiting", { cache: "no-store", redirect: "manual" });
        if (res.type === "opaqueredirect" && reloadForLogin()) {
            return;
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        list = await res.json();
        localStorage.setItem(LAST_REACHED_KEY, String(Date.now()));
    } catch (e) {
        error = e;
    }
    if (state.turnedOff) {
        return;
    }
    if (list && reloadIfOutdated(list.build)) {
        return;
    }
    state.loaded = true;
    state.list = list;
    state.error = error;
    // a refused take stays only on a row that is still listed
    const listed = new Set((list?.agents ?? []).map((a) => a.tab));
    for (const tab of state.takeErrors.keys()) {
        if (list && !listed.has(tab)) {
            state.takeErrors.delete(tab);
        }
    }
    // an open answer keeps its picks and typing, and a chat draws from its own stream; the list redraws
    // when the owner goes back to it
    if (!state.answering && !state.sent && !state.chat) {
        render();
    }
}

// Arc was updated while the page stayed open (a PWA can stay in memory for days): reload so the new page's
// code runs. Never mid-answer, in a chat, while confirming Turn off or while something is typed into; the next
// refresh after that tries again.
function reloadIfOutdated(build) {
    if (!state.build) {
        state.build = build ?? "";
        return false;
    }
    if (!pageOutdated(state.build, build)) {
        return false;
    }
    const typing = document.activeElement?.matches?.("input, textarea, [contenteditable]") ?? false;
    if (state.answering || state.sent || state.chat || state.leaving > 0 || state.confirmOff || typing) {
        return false;
    }
    location.reload();
    return true;
}

function backToList() {
    state.answering = null;
    state.sent = null;
    render();
    refresh();
}

// header

function listHeader(sub) {
    return h(
        "header",
        { class: "head" },
        h(
            "div",
            { class: "head-row" },
            h("h1", null, needYouTitle(state.list)),
            h("span", { class: "chip chip-on" }, h("span", { class: "chip-dot" }), "Remote on")
        ),
        h("div", { class: "head-sub" }, sub)
    );
}

function backHeader() {
    return h(
        "header",
        { class: "back-head" },
        h("button", { type: "button", class: "link", onclick: backToList }, icon(ICON_CHEVRON_LEFT, 16), "Waiting")
    );
}

// the waiting list

function canTurnOnNotifications() {
    return (
        !state.subscribed &&
        !!state.list?.vapidpublic &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window &&
        Notification.permission === "default"
    );
}

async function turnOnNotifications() {
    state.subscribing = true;
    render();
    try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: base64UrlToBytes(state.list.vapidpublic),
            });
            const res = await post("/api/subscribe", sub);
            if (!res.ok) {
                throw new Error(`arcterm answered ${res.status}`);
            }
            state.subscribed = true;
        }
    } catch (e) {
        state.notice = `Notifications did not turn on: ${e.message}`;
    }
    state.subscribing = false;
    render();
}

function notificationsButton() {
    if (!canTurnOnNotifications()) {
        return null;
    }
    return h(
        "button",
        { type: "button", class: "btn", disabled: state.subscribing, onclick: turnOnNotifications },
        state.subscribing ? "Turning on notifications…" : "Turn on notifications"
    );
}

function noticeLine() {
    return state.notice ? h("div", { class: "notice", role: "status" }, state.notice) : null;
}

function questionCard(q) {
    const first = q.questions?.[0] ?? {};
    return h(
        "button",
        {
            type: "button",
            class: "card",
            onclick: () => {
                state.notice = "";
                state.answering = { q, picks: q.questions.map(() => []), texts: q.questions.map(() => "") };
                render();
            },
        },
        metaRow(q),
        first.header ? h("span", { class: "qheader" }, first.header) : null,
        h("span", { class: "qtext" }, first.question ?? ""),
        h(
            "span",
            { class: "card-foot" },
            h("span", null, optionCountLine(q)),
            h("span", { class: "card-go" }, "Answer", icon(ICON_CHEVRON_RIGHT, 12))
        )
    );
}

function metaRow(q) {
    const waited = age(q.waitingsince);
    return h(
        "span",
        { class: "meta" },
        h("span", { class: "rt-dot", "data-rt": q.runtime || "none", "aria-hidden": "true" }),
        h("span", { class: "meta-agent" }, q.source),
        q.project ? h("span", { class: "meta-project" }, q.project) : null,
        waited ? h("span", { class: "meta-age" }, `waiting ${waited}`) : null
    );
}

// the dot on an agent row's left: coloured by what the agent is doing, not by its runtime
function leadDot(agentState) {
    return h("span", { class: "lead-dot", "data-state": agentState, "aria-hidden": "true" });
}

// the first line of an agent row: state dot, name, the project when it differs, and the state chip
function agentMeta(a) {
    const project = agentProject(a);
    return h(
        "span",
        { class: "meta" },
        leadDot(a.state),
        h("span", { class: "meta-agent" }, a.name || a.tab),
        project ? h("span", { class: "meta-project" }, project) : null,
        h(
            "span",
            { class: "state-chip", "data-state": a.state },
            h("span", { class: "state-dot", "aria-hidden": "true" }),
            rowStateLabel(a, Date.now())
        )
    );
}

function handedRow(a) {
    return h(
        "button",
        {
            type: "button",
            class: "agent-row",
            "data-handed-row": a.tab,
            onclick: () => {
                location.hash = `#agent/${encodeURIComponent(a.tab)}`;
            },
        },
        agentMeta(a),
        h("span", { class: "agent-line-row" }, h("span", { class: "agent-line" }, a.line), icon(ICON_CHEVRON_RIGHT, 14))
    );
}

// An agent in the Agents list. One the phone can take is a button that takes it and opens its chat; one it
// cannot (a codex, agy or opencode session, an agent with no terminal) is a muted row, shown for the glance.
function agentRow(a) {
    if (!a.takeable) {
        return h(
            "div",
            { class: "agent-row untakeable", "data-agent-row": a.tab, "data-untakeable": true },
            agentMeta(a),
            a.line ? h("span", { class: "agent-line" }, a.line) : null
        );
    }
    const taking = state.taking.has(a.tab);
    const refused = state.takeErrors.get(a.tab);
    return h(
        "button",
        {
            type: "button",
            class: "agent-row",
            "data-agent-row": a.tab,
            "aria-busy": taking ? "true" : null,
            onclick: () => takeAgent(a.tab),
        },
        agentMeta(a),
        h(
            "span",
            { class: "agent-line-row" },
            h("span", { class: "agent-line" }, a.line),
            icon(ICON_CHEVRON_RIGHT, 14)
        ),
        taking ? h("span", { class: "take-note" }, "Taking…") : null,
        refused ? h("span", { class: "take-error", "data-take-error": true }, refused) : null
    );
}

// A tap takes the agent at once: on 200 its chat opens as a handed-over agent's does; on a refusal the row
// says why and stays listed.
async function takeAgent(tab) {
    if (state.taking.has(tab)) {
        return;
    }
    state.taking.add(tab);
    state.takeErrors.delete(tab);
    render();
    let res = null;
    try {
        res = await post(`/api/agents/${encodeURIComponent(tab)}/hand`, {});
    } catch {
        // arcterm did not answer: takeNotice says so below
    }
    const reason = res?.status === 409 ? await bodyField(res, "reason") : "";
    state.taking.delete(tab);
    if (res?.ok) {
        location.hash = `#agent/${encodeURIComponent(tab)}`;
        return;
    }
    state.takeErrors.set(tab, takeNotice(res ? res.status : null, reason));
    render();
}

// One row per run with a live worker: its name, its workers' counts and, when one of them needs the owner, a
// chip sending the owner to the desk. A tap opens the workers under it, read-only: a worker cannot be taken.
function runRow(run) {
    const open = state.openRuns.has(run.key);
    const toggle = () => {
        if (open) {
            state.openRuns.delete(run.key);
        } else {
            state.openRuns.add(run.key);
        }
        render();
    };
    return h(
        "div",
        { class: "run" },
        h(
            "button",
            {
                type: "button",
                class: "agent-row run-row",
                "data-run-row": run.key,
                "aria-expanded": open ? "true" : "false",
                onclick: toggle,
            },
            h(
                "span",
                { class: "meta" },
                h("span", { class: "meta-agent run-name" }, run.name || run.key),
                run.needsyou
                    ? h(
                          "span",
                          { class: "run-need", "data-run-needs": true },
                          icon(ICON_DESK, 11, 2),
                          "Needs you at the desk"
                      )
                    : null
            ),
            h(
                "span",
                { class: "agent-line-row" },
                h("span", { class: "agent-line" }, runCounts(run)),
                icon(ICON_CHEVRON_DOWN, 14)
            )
        ),
        open
            ? h(
                  "div",
                  { class: "run-workers" },
                  (run.workers ?? []).map((w) =>
                      h("div", { class: "run-worker", "data-run-worker": w.tab }, leadDot(w.state), runWorkerText(w))
                  )
              )
            : null
    );
}

// Computer: lock it and nudge its volume. One press is one request; only a refusal or a failure draws, so a
// run of volume taps does not rebuild the buttons under the finger.
async function pcPress(path, body) {
    let error = "";
    try {
        const res = await post(path, body);
        if (!res.ok) {
            error = failReason(res.status, await bodyField(res, "error"));
        }
    } catch {
        error = failReason(null, "");
    }
    if (error !== state.pcError) {
        state.pcError = error;
        render();
    }
    // the lock lands a moment after the call returns: read the state again then, not at the next 10 s tick
    if (!error && path === "/api/pc/lock") {
        setTimeout(refresh, PC_LOCK_REREAD_MS);
    }
}

// The word beside the Computer heading: the waiting list's locked, which is null where the computer cannot tell.
function pcLockState(locked) {
    if (locked !== true && locked !== false) {
        return null;
    }
    return h("span", { class: "pc-state", "data-pc-locked": String(locked) }, locked ? "Locked" : "Unlocked");
}

function pcSection() {
    if (!state.list?.pc) {
        return null;
    }
    const locked = state.list.locked === true;
    const button = (key, label, path, body, disabled = false) =>
        h(
            "button",
            { type: "button", class: "btn", "data-pc": key, disabled, onclick: () => pcPress(path, body) },
            label
        );
    return h(
        "section",
        { class: "section", "aria-label": "Computer" },
        h("div", { class: "pc-head" }, h("h2", null, "Computer"), pcLockState(state.list.locked)),
        button("lock", locked ? "Locked" : "Lock", "/api/pc/lock", {}, locked),
        h(
            "div",
            { class: "btn-row" },
            button("down", "Volume down", "/api/pc/volume", { step: "down" }),
            button("mute", "Mute", "/api/pc/volume", { step: "mute" }),
            button("up", "Volume up", "/api/pc/volume", { step: "up" })
        ),
        state.pcError ? h("div", { class: "send-error", role: "alert", "data-pc-error": true }, state.pcError) : null
    );
}

function shownRow(s) {
    return h(
        "div",
        { class: "shown" },
        h(
            "div",
            { class: "meta" },
            h(
                "span",
                { class: "word", "data-kind": s.kind },
                s.kind === HELD_KIND ? icon(ICON_PAUSE, 10, 2.4) : null,
                shownWord(s.kind)
            ),
            s.project ? h("span", { class: "meta-project" }, s.project) : null,
            s.waitingsince > 0 ? h("span", { class: "meta-age quiet" }, age(s.waitingsince)) : null
        ),
        h("div", { class: "shown-title" }, s.title),
        s.reason ? reasonBlock(s) : null,
        h("div", { class: "desk" }, icon(ICON_DESK, 13, 1.8), "Clear it at the desk")
    );
}

// a long reason (a held land's git output) shows three lines until the owner asks for the rest
function reasonBlock(s) {
    const open = state.expanded.has(s.key);
    const toggle = () => {
        if (open) {
            state.expanded.delete(s.key);
        } else {
            state.expanded.add(s.key);
        }
        render();
    };
    return [
        h("div", { class: open ? "shown-reason" : "shown-reason clamped" }, s.reason),
        h(
            "button",
            { type: "button", class: "link", "data-reason-toggle": true, onclick: toggle },
            open ? "Show less" : "Show all"
        ),
    ];
}

// a toggle shows only where the clamp cut something; that needs layout, so it runs after the draw
function hideNeedlessToggles() {
    for (const el of app.querySelectorAll(".shown-reason.clamped")) {
        if (el.scrollHeight <= el.clientHeight + 1) {
            el.nextElementSibling.hidden = true;
        }
    }
}

function offFooter(end = false) {
    const controls = state.confirmOff
        ? h(
              "div",
              { class: "btn-row" },
              h(
                  "button",
                  {
                      type: "button",
                      class: "btn",
                      onclick: () => {
                          state.confirmOff = false;
                          render();
                      },
                  },
                  "Keep it on"
              ),
              h("button", { type: "button", class: "btn btn-danger", onclick: turnOff }, "Turn off now")
          )
        : h(
              "button",
              {
                  type: "button",
                  class: "btn",
                  onclick: () => {
                      state.confirmOff = true;
                      render();
                  },
              },
              "Turn off remote mode"
          );
    return h(
        "footer",
        { class: end ? "foot foot-end" : "foot" },
        controls,
        h(
            "div",
            { class: "foot-text" },
            "This page goes offline, every handed-over agent goes back to the desk, and the PC may sleep again."
        )
    );
}

async function turnOff() {
    let res = null;
    try {
        res = await post("/api/off", {});
    } catch {
        // falls through to the notice below
    }
    state.confirmOff = false;
    if (!res?.ok) {
        state.notice = "Remote mode did not turn off: arcterm did not answer. Try again.";
        render();
        return;
    }
    localStorage.setItem(LAST_REACHED_KEY, String(Date.now()));
    // the listener is closing; a refresh racing it must not draw the list back
    state.turnedOff = true;
    state.list = null;
    state.error = new Error("turned off");
    render();
}

function mainView() {
    const questions = state.list.questions ?? [];
    const handed = state.list.handed ?? [];
    const shown = state.list.shown ?? [];
    const agents = listedAgents(state.list);
    const runs = state.list.runs ?? [];
    const allHeld = shown.every((s) => s.kind === HELD_KIND);
    return [
        listHeader(countsLine(state.list)),
        h(
            "main",
            { class: "main" },
            noticeLine(),
            notificationsButton(),
            questions.length
                ? h(
                      "section",
                      { class: "section", "aria-label": "Questions" },
                      h("h2", null, "Questions"),
                      questions.map(questionCard)
                  )
                : null,
            handed.length
                ? h(
                      "section",
                      { class: "section", "aria-label": "Handed over" },
                      h("h2", null, "Handed over"),
                      handed.map(handedRow)
                  )
                : null,
            shown.length
                ? h(
                      "section",
                      { class: "section", "aria-label": allHeld ? "Held runs" : "Waiting at the desk" },
                      h("h2", null, allHeld ? "Held runs" : "Waiting at the desk"),
                      shown.map(shownRow)
                  )
                : null,
            agents.length
                ? h(
                      "section",
                      { class: "section", "aria-label": "Agents" },
                      h("h2", null, "Agents"),
                      agents.map(agentRow)
                  )
                : null,
            runs.length
                ? h("section", { class: "section", "aria-label": "Runs" }, h("h2", null, "Runs"), runs.map(runRow))
                : null,
            pcSection(),
            offFooter(true)
        ),
    ];
}

function emptyView() {
    return [
        listHeader(countsLine(state.list)),
        h(
            "main",
            { class: "main main-blank" },
            noticeLine(),
            h("div", { class: "blank-title" }, "Nothing is waiting on you."),
            h("div", { class: "blank-text" }, "Your phone buzzes when one asks you something or a run is held."),
            notificationsButton(),
            pcSection()
        ),
        offFooter(),
    ];
}

function unreachableView() {
    const last = Number(localStorage.getItem(LAST_REACHED_KEY) ?? 0);
    return [
        h(
            "header",
            { class: "head" },
            h(
                "div",
                { class: "head-row" },
                h("h1", null, "Waiting on you"),
                h("span", { class: "chip chip-off" }, h("span", { class: "chip-dot" }), "Not reachable")
            ),
            h("div", { class: "head-sub" }, last ? `Last reached ${clock(last)}` : "Not reached from this phone yet")
        ),
        h(
            "main",
            { class: "main main-blank" },
            noticeLine(),
            h("div", { class: "blank-title" }, "arcterm is not reachable."),
            h(
                "div",
                { class: "blank-text" },
                "Remote mode is off, or the PC is asleep or offline. If you turned it off from here, that is expected. Turn it on at the desk with ",
                h("span", { class: "mono" }, "wsh remote on"),
                "."
            )
        ),
    ];
}

// answering

function foldFor(question) {
    const previews = (question.options ?? []).filter((o) => o.preview);
    if (!previews.length) {
        return null;
    }
    const summary =
        previews.length === 1
            ? `What the agent attached · preview of ${splitRecommended(previews[0].label).label}`
            : `What the agent attached · ${previews.length} previews`;
    return h(
        "details",
        { class: "fold" },
        h("summary", null, summary),
        h(
            "div",
            { class: "fold-body" },
            previews.map((o) =>
                h(
                    "div",
                    null,
                    h("div", { class: "fold-label" }, splitRecommended(o.label).label),
                    h("pre", { class: "fold-text" }, o.preview)
                )
            )
        )
    );
}

function questionHead(question) {
    return [
        question.header ? h("span", { class: "qheader" }, question.header) : null,
        h("h1", null, question.question ?? ""),
    ];
}

function answerView() {
    const a = state.answering;
    const q = a.q;
    const rows = [];
    const inputs = [];
    const sendError = h("div", { class: "send-error", role: "alert", hidden: true });
    const send = h(
        "button",
        { type: "button", class: "btn btn-primary", onclick: () => sendAnswer(send, sendError) },
        "Send answer"
    );

    const sync = () => {
        q.questions.forEach((_, qi) => {
            const typed = a.texts[qi].trim() !== "";
            rows[qi].forEach((row, oi) => row.setAttribute("aria-checked", String(!typed && a.picks[qi].includes(oi))));
            inputs[qi].classList.toggle("typed", typed);
        });
        send.disabled = a.sending || buildAnswers(q.questions, a.picks, a.texts, q.prose) === null;
    };

    const pick = (qi, oi, multi) => {
        const picked = a.picks[qi];
        if (multi) {
            a.picks[qi] = picked.includes(oi) ? picked.filter((i) => i !== oi) : [...picked, oi];
        } else {
            a.picks[qi] = [oi];
        }
        // a pick replaces a typed answer, as on the cockpit's answer bar
        a.texts[qi] = "";
        inputs[qi].value = "";
        sync();
    };

    const blocks = q.questions.map((question, qi) => {
        const multi = !!question.multiselect;
        rows[qi] = (question.options ?? []).map((opt, oi) => {
            const { label, recommended } = splitRecommended(opt.label);
            return h(
                "button",
                {
                    type: "button",
                    class: recommended ? "option rec" : "option",
                    role: multi ? "checkbox" : "radio",
                    "aria-checked": "false",
                    onclick: () => pick(qi, oi, multi),
                },
                h("span", { class: "option-num" }, String(oi + 1)),
                h(
                    "span",
                    { class: "option-body" },
                    h(
                        "span",
                        { class: "option-label" },
                        label,
                        recommended ? h("span", { class: "rec-mark" }, "recommended") : null
                    ),
                    opt.description ? h("span", { class: "option-desc" }, opt.description) : null
                )
            );
        });
        const inputId = `own-${qi}`;
        inputs[qi] = h("input", {
            id: inputId,
            type: "text",
            placeholder: "Type a line for the agent",
            autocomplete: "off",
            oninput: (e) => {
                a.texts[qi] = e.target.value;
                sync();
            },
        });
        return h(
            "div",
            { class: "qblock" },
            questionHead(question),
            foldFor(question),
            rows[qi].length
                ? h(
                      "div",
                      {
                          class: "options",
                          role: multi ? "group" : "radiogroup",
                          "aria-label": question.header || "Options",
                      },
                      rows[qi]
                  )
                : null,
            h("div", { class: "own" }, h("label", { for: inputId }, "Or your own answer"), inputs[qi])
        );
    });
    sync();
    return [
        backHeader(),
        h("main", { class: "main main-answer" }, metaRow(q), blocks, sendError),
        h("footer", { class: "foot" }, send),
    ];
}

async function sendAnswer(button, errorLine) {
    const a = state.answering;
    const q = a.q;
    const answers = buildAnswers(q.questions, a.picks, a.texts, q.prose);
    if (!answers) {
        return;
    }
    a.sending = true;
    button.disabled = true;
    button.textContent = "Sending…";
    errorLine.hidden = true;
    let res = null;
    try {
        res = await post("/api/answer", { oref: q.oref, askid: q.askid, answers });
    } catch {
        // reported below as not reachable
    }
    if (res?.ok) {
        state.answering = null;
        state.sent = { q, text: answerText(q.questions, answers) };
        render();
        refresh();
        return;
    }
    if (res?.status === 409) {
        state.answering = null;
        state.notice = GONE_NOTICE;
        render();
        refresh();
        return;
    }
    errorLine.textContent = res
        ? `Not sent: arcterm refused the answer (${res.status || "login expired"}). Try again.`
        : "Not sent: arcterm is not reachable. Try again.";
    errorLine.hidden = false;
    a.sending = false;
    button.disabled = false;
    button.textContent = "Send answer";
}

function sentView() {
    const { q, text } = state.sent;
    return [
        backHeader(),
        h(
            "main",
            { class: "main main-answer" },
            metaRow(q),
            q.questions.map((question) => h("div", { class: "qblock" }, questionHead(question))),
            h(
                "div",
                { class: "sent", "aria-live": "polite" },
                h("div", { class: "sent-title" }, icon(ICON_CHECK, 16, 2.2), "Answered"),
                h("div", { class: "sent-text" }, `Sent to ${q.source}: `, h("strong", null, text)),
                h("button", { type: "button", class: "link", onclick: backToList }, "Back to what is waiting")
            )
        ),
    ];
}

function render() {
    // while a chat is open it draws itself, and while one is being left its release is still in flight
    if (!state.loaded || state.chat || state.leaving > 0) {
        return;
    }
    let kind;
    let view;
    if (state.sent) {
        kind = "sent";
        view = sentView();
    } else if (state.answering) {
        kind = "answer";
        view = answerView();
    } else {
        kind = viewState(state.list, state.error);
        view = kind === "main" ? mainView() : kind === "empty" ? emptyView() : unreachableView();
    }
    // a redraw of the same view (the 10s refresh, a run row opening) keeps the scroll position
    const scroll = kind === state.drawn ? (app.querySelector(".main")?.scrollTop ?? 0) : 0;
    app.replaceChildren(...view);
    const main = app.querySelector(".main");
    if (main && scroll) {
        main.scrollTop = scroll;
    }
    state.drawn = kind;
    hideNeedlessToggles();
}

// the chat lives in the hash, so a reload or a push tap keeps it
async function route() {
    const tab = chatTab(location.hash);
    if ((state.chat?.tab ?? null) === tab) {
        return;
    }
    const left = state.chat;
    state.chat = null;
    state.drawn = null;
    // close() stops the stream at once and returns a Promise that settles when the release post is done
    const released = left ? closeChat(left) : null;
    if (tab) {
        const handed = state.list?.handed ?? [];
        const initial =
            handed.find((a) => a.tab === tab) ?? (state.list?.agents ?? []).find((a) => a.tab === tab) ?? null;
        state.chat = { tab, close: openChat(app, tab, { h, icon, post, initial, onBack: leaveChat }) };
        return;
    }
    if (released) {
        // the list must not read the agent as still handed, so it draws after the release, but never after
        // the backstop
        state.leaving += 1;
        await Promise.race([released, new Promise((resolve) => setTimeout(resolve, LEAVE_WAIT_MS))]);
        state.leaving -= 1;
    }
    // another route took the page while the release was going
    if (state.chat) {
        return;
    }
    render();
    refresh();
}

// close() settles whether or not the release worked: a failure is the chat's to log, not the list's to wait on
async function closeChat(chat) {
    try {
        await chat.close();
    } catch (e) {
        console.warn("arc remote: leaving the chat", e);
    }
}

function leaveChat() {
    history.replaceState(null, "", location.pathname + location.search);
    return route();
}

if ("serviceWorker" in navigator) {
    navigator.serviceWorker
        .register("sw.js")
        .catch((e) => console.warn("arc remote: service worker not registered", e));
}
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        state.turnedOff = false;
        refresh();
    }
});
window.addEventListener("hashchange", route);
setInterval(refresh, REFRESH_MS);
route();
refresh();
