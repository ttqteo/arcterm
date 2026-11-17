// The phone page: draws what waits on the owner from /api/waiting, answers questions, opens the chat with
// a handed-over agent (#agent/<tab>), turns remote mode off and subscribes to pushes. Every string from
// the server goes in as text, never as markup.

import { openChat } from "./chat.js";
import { chatTab, rowStateLabel } from "./chatmodel.js";
import {
    answerText,
    base64UrlToBytes,
    buildAnswers,
    countsLine,
    formatAge,
    optionCountLine,
    shownWord,
    splitRecommended,
    viewState,
} from "./model.js";

const REFRESH_MS = 10 * 1000;
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
    // keys of shown rows whose reason the owner expanded; the 10s refresh redraws every row
    expanded: new Set(),
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
    state.loaded = true;
    state.list = list;
    state.error = error;
    // an open answer keeps its picks and typing, and a chat draws from its own stream; the list redraws
    // when the owner goes back to it
    if (!state.answering && !state.sent && !state.chat) {
        render();
    }
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
            h("h1", null, "Waiting on you"),
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
                throw new Error(`Arc answered ${res.status}`);
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
        h(
            "span",
            { class: "meta" },
            h("span", { class: "rt-dot", "data-rt": a.runtime || "none", "aria-hidden": "true" }),
            h("span", { class: "meta-agent" }, a.name),
            a.project ? h("span", { class: "meta-project" }, a.project) : null,
            h(
                "span",
                { class: "state-chip", "data-state": a.state },
                h("span", { class: "state-dot", "aria-hidden": "true" }),
                rowStateLabel(a, Date.now())
            )
        ),
        h("span", { class: "agent-line-row" }, h("span", { class: "agent-line" }, a.line), icon(ICON_CHEVRON_RIGHT, 14))
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
        state.notice = "Remote mode did not turn off: Arc did not answer. Try again.";
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
            notificationsButton()
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
            h("div", { class: "blank-title" }, "Arc is not reachable."),
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
        ? `Not sent: Arc refused the answer (${res.status || "login expired"}). Try again.`
        : "Not sent: Arc is not reachable. Try again.";
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
    if (!state.loaded || state.chat) {
        return;
    }
    let view;
    if (state.sent) {
        view = sentView();
    } else if (state.answering) {
        view = answerView();
    } else {
        const which = viewState(state.list, state.error);
        view = which === "main" ? mainView() : which === "empty" ? emptyView() : unreachableView();
    }
    app.replaceChildren(...view);
    hideNeedlessToggles();
}

// the chat lives in the hash, so a reload or a push tap keeps it
function route() {
    const tab = chatTab(location.hash);
    if ((state.chat?.tab ?? null) === tab) {
        return;
    }
    state.chat?.close();
    state.chat = null;
    if (tab) {
        const initial = (state.list?.handed ?? []).find((a) => a.tab === tab) ?? null;
        state.chat = { tab, close: openChat(app, tab, { h, icon, post, initial, onBack: leaveChat }) };
        return;
    }
    render();
    refresh();
}

function leaveChat() {
    history.replaceState(null, "", location.pathname + location.search);
    route();
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
