// The phone page's chat with one handed-over agent: streams its transcript over /api/agents/<tab>/stream,
// draws it with the cockpit's projectors, and sends, stops, approves, denies and takes back through the
// action routes. Every string from the server or the agent goes in as text, never as markup.

import { chatItems, composerFor, endedText, headerStateLabel, liveElapsed, permissionCard } from "./chatmodel.js";
import { projectFor } from "./projectors.js";

const MAX_LINES = 2000;
const HEADER_TICK_MS = 30 * 1000;
const ELAPSED_TICK_MS = 1000;
// a little slack so a list a pixel short of the end still follows new lines
const STICK_PX = 48;
const MOVED_ON = "The agent moved on; showing it as it is now.";
const ICON_CHEVRON_LEFT = '<path d="M15 6l-6 6 6 6"></path>';
const MARKS = { ok: "✓", fail: "✗", pending: "·" };

/**
 * Draws the chat for tab into root until the returned close() is called. ui carries the page's own
 * helpers: h, icon, post, onBack (leave the chat for the list) and initial (the list's row for the tab, or
 * null), so the header shows before the stream's first agent event.
 */
export function openChat(root, tab, ui) {
    const { h, icon, post } = ui;
    const st = {
        agent: ui.initial ?? null,
        lines: [],
        notice: "",
        error: "",
        sending: false,
        closed: false,
        live: null,
    };
    const base = `/api/agents/${encodeURIComponent(tab)}`;

    const header = h("header", { class: "back-head chat-head" });
    const body = h("main", { class: "main chat-body", "aria-live": "polite", "data-chat-body": true });
    const box = h("textarea", {
        id: "chat-msg",
        rows: "1",
        autocomplete: "off",
        oninput: () => {
            box.style.height = "auto";
            box.style.height = `${box.scrollHeight}px`;
            syncSend();
        },
    });
    const boxLabel = h("label", { for: "chat-msg", class: "sr-only" });
    const send = h("button", { type: "button", class: "chat-send", "data-chat-send": true, onclick: onSend }, "Send");
    const stop = h(
        "button",
        { type: "button", class: "btn btn-danger stop", "data-chat-stop": true, onclick: () => act("stop", {}) },
        h("span", { class: "stop-mark", "aria-hidden": "true" }),
        "Stop"
    );
    const note = h("div", { class: "chat-note", "data-chat-note": true });
    const errorLine = h("div", { class: "send-error", role: "alert" });
    const footer = h(
        "footer",
        { class: "foot chat-foot" },
        note,
        h("div", { class: "composer" }, boxLabel, box, send),
        errorLine
    );

    const es = new EventSource(`${base}/stream`);
    let opened = false;
    es.addEventListener("open", () => {
        // a reconnect resends the backlog, so the lines start over
        if (opened) {
            st.lines = [];
        }
        opened = true;
    });
    es.addEventListener("agent", (e) => {
        st.agent = JSON.parse(e.data);
        st.notice = "";
        draw();
    });
    es.addEventListener("lines", (e) => {
        const { lines } = JSON.parse(e.data);
        st.lines = st.lines.concat(lines ?? []).slice(-MAX_LINES);
        drawBody();
    });
    es.addEventListener("ended", (e) => end(JSON.parse(e.data).reason));
    es.addEventListener("error", () => {
        // closed for good (a refused or redirected answer); the list says whether Arc is reachable
        if (es.readyState === EventSource.CLOSED && !st.closed) {
            ui.onBack();
        }
    });
    const tick = setInterval(drawHeader, HEADER_TICK_MS);
    const elapsedTick = setInterval(drawElapsed, ELAPSED_TICK_MS);

    function close() {
        st.closed = true;
        es.close();
        clearInterval(tick);
        clearInterval(elapsedTick);
    }

    function name() {
        return st.agent?.name || "The agent";
    }

    function titleBlock() {
        const a = st.agent;
        return h(
            "div",
            { class: "chat-title" },
            h("span", { class: "rt-dot", "data-rt": a?.runtime || "none", "aria-hidden": "true" }),
            h("span", { class: "chat-name" }, a?.name ?? ""),
            a?.project ? h("span", { class: "meta-project" }, a.project) : null
        );
    }

    function backButton() {
        return h(
            "button",
            { type: "button", class: "icon-btn", "aria-label": "Back to the list", onclick: ui.onBack },
            icon(ICON_CHEVRON_LEFT, 18)
        );
    }

    function drawHeader() {
        const a = st.agent;
        header.replaceChildren(
            backButton(),
            h(
                "div",
                { class: "chat-who" },
                titleBlock(),
                a
                    ? h(
                          "div",
                          { class: "state-line", "data-state": a.state, "data-chat-state": true },
                          h("span", { class: "state-dot", "aria-hidden": "true" }),
                          headerStateLabel(a, Date.now())
                      )
                    : null
            ),
            // in the header, away from the composer, so a thumb aiming for Send never stops the turn
            stop,
            h(
                "button",
                { type: "button", class: "take-back", "data-chat-takeback": true, onclick: takeBack },
                "Take back"
            )
        );
    }

    // the running call's elapsed ticks on its own, without redrawing the body
    function drawElapsed() {
        const el = body.querySelector("[data-chat-elapsed]");
        if (el && st.live) {
            el.textContent = liveElapsed(st.live, Date.now());
        }
    }

    function actionRow(item, live) {
        const verb = live && item.verb === "Ran" ? "Running" : item.verb;
        const elapsed = live ? liveElapsed(item, Date.now()) : "";
        const tail = elapsed
            ? h("span", { class: "act-tail", "data-chat-elapsed": true }, elapsed)
            : item.adds != null
              ? h(
                    "span",
                    { class: "act-tail" },
                    h("span", { class: "adds" }, `+${item.adds}`),
                    " ",
                    h("span", { class: "dels" }, `−${item.dels}`)
                )
              : item.summary
                ? h("span", { class: "act-tail" }, item.summary)
                : null;
        return h(
            "div",
            { class: live ? "act live" : "act", "data-mark": item.mark, "data-chat-action": true },
            h(
                "span",
                { class: "act-mark", "aria-hidden": "true" },
                live ? h("span", { class: "live-dot" }) : MARKS[item.mark]
            ),
            h("span", { class: "act-verb" }, verb),
            h("span", { class: "act-target" }, item.target),
            tail
        );
    }

    function replyBlock(tree) {
        return h("div", { class: "reply", "data-chat-reply": true }, tree.children.map(mdNode));
    }

    // one node of a reply's tree (chatmodel.js replyTree) as an element, every value as a text node.
    function mdNode(n) {
        const kids = () => (n.children ?? []).flatMap(mdNode);
        switch (n.type) {
            case "text":
                return n.value;
            case "paragraph":
                return h("p", null, kids());
            case "heading":
                return h(`h${n.depth}`, null, kids());
            case "thematicBreak":
                return h("hr");
            case "blockquote":
                return h("blockquote", null, kids());
            case "list":
                return h(n.ordered ? "ol" : "ul", { start: n.ordered && n.start !== 1 ? n.start : null }, kids());
            case "listItem":
                return listItem(n);
            case "table":
                return table(n);
            case "code":
                return h("pre", { class: "reply-code", "data-lang": n.lang || null }, n.value);
            case "emphasis":
                return h("em", null, kids());
            case "strong":
                return h("strong", null, kids());
            case "delete":
                return h("del", null, kids());
            case "highlight":
                return h("mark", null, kids());
            case "inlineCode":
                return h("code", null, n.value);
            case "break":
                return h("br");
            case "link":
                return h("a", { href: n.url, target: "_blank", rel: "noopener noreferrer" }, kids());
            default:
                return n.value ?? kids();
        }
    }

    // a tight item's paragraph is its text, as the cockpit draws it; a task item leads with its box as written
    function listItem(n) {
        const kids = n.children.flatMap((c) =>
            c.type === "paragraph" && !n.spread ? c.children.flatMap(mdNode) : mdNode(c)
        );
        const task = n.checked == null ? null : h("span", { class: "reply-task" }, n.checked ? "[x]" : "[ ]");
        return h("li", null, task, kids);
    }

    function table(n) {
        const row = (r, tag) =>
            h(
                "tr",
                null,
                r.children.map((c, i) => h(tag, { "data-align": n.align?.[i] }, c.children.flatMap(mdNode)))
            );
        const [head, ...body] = n.children;
        const tbody = body.length
            ? h(
                  "tbody",
                  null,
                  body.map((r) => row(r, "td"))
              )
            : null;
        return h("div", { class: "reply-table" }, h("table", null, h("thead", null, row(head, "th")), tbody));
    }

    function permissionBlock(entries) {
        const card = permissionCard(entries, st.agent);
        return h(
            "div",
            { class: "perm", "data-chat-permission": true },
            h(
                "div",
                { class: "perm-head" },
                card.tool ? h("span", { class: "qheader perm-tool" }, card.tool) : null,
                h("span", { class: "perm-ask" }, card.ask)
            ),
            card.target ? h("div", { class: "perm-target" }, card.target) : null,
            h("div", { class: "perm-note" }, "The agent is paused until you choose."),
            h(
                "div",
                { class: "btn-row" },
                h(
                    "button",
                    {
                        type: "button",
                        class: "btn btn-primary",
                        disabled: st.sending,
                        "data-chat-approve": true,
                        onclick: () => act("approve", {}),
                    },
                    "Approve"
                ),
                h(
                    "button",
                    {
                        type: "button",
                        class: "btn",
                        disabled: st.sending,
                        "data-chat-deny": true,
                        onclick: () => act("deny", denyBody(), true),
                    },
                    "Deny"
                )
            )
        );
    }

    function drawBody() {
        const stick = body.scrollHeight - body.scrollTop - body.clientHeight < STICK_PX;
        const entries = st.agent ? projectFor(st.agent.runtime, st.lines) : [];
        const items = chatItems(entries);
        const state = st.agent?.state;
        const last = items[items.length - 1];
        const pendingLast = last?.kind === "action" && last.mark === "pending";
        st.live = state === "working" && pendingLast ? last : null;
        // the permission card shows the call it waits on in full
        if (state === "permission" && pendingLast) {
            items.pop();
        }
        const rows = items.map((item) => {
            if (item.kind === "user") {
                return h("div", { class: "bubble", "data-chat-user": true }, item.text);
            }
            if (item.kind === "action") {
                return actionRow(item, item === st.live);
            }
            return replyBlock(item.tree);
        });
        if (state === "permission") {
            rows.push(permissionBlock(entries));
        }
        if (st.notice) {
            rows.push(h("div", { class: "notice", role: "status" }, st.notice));
        }
        body.replaceChildren(...rows);
        if (stick) {
            body.scrollTop = body.scrollHeight;
        }
    }

    function syncSend() {
        const c = st.agent ? composerFor(st.agent) : null;
        send.disabled = !c || c.disabled || st.sending || box.value.trim() === "";
    }

    function drawFooter() {
        const c = st.agent ? composerFor(st.agent) : null;
        box.placeholder = c?.placeholder ?? "";
        box.disabled = !c || c.disabled;
        boxLabel.textContent = c?.label ?? "";
        stop.hidden = !c?.stop;
        stop.disabled = st.sending;
        note.replaceChildren(
            ...(c?.note
                ? [
                      c.note,
                      st.agent.state === "asking"
                          ? h("button", { type: "button", class: "link", onclick: ui.onBack }, "Back to the list")
                          : null,
                  ].filter(Boolean)
                : [])
        );
        note.hidden = !c?.note;
        errorLine.textContent = st.error;
        errorLine.hidden = !st.error;
        syncSend();
    }

    function draw() {
        if (st.closed) {
            return;
        }
        drawHeader();
        drawBody();
        drawFooter();
    }

    function denyBody() {
        const text = box.value.trim();
        return text ? { text } : {};
    }

    function onSend() {
        const text = box.value.trim();
        if (!text) {
            return;
        }
        if (st.agent?.state === "permission") {
            act("deny", { text }, true);
        } else {
            act("send", { text }, true);
        }
    }

    // posts one action; the box clears only when Arc took it
    async function act(kind, payload, clearsBox = false) {
        st.sending = true;
        st.error = "";
        st.notice = "";
        draw();
        let res = null;
        try {
            res = await post(`${base}/${kind}`, payload);
        } catch {
            // reported below as not reachable
        }
        st.sending = false;
        if (st.closed) {
            return;
        }
        if (res?.ok) {
            if (clearsBox) {
                box.value = "";
                box.style.height = "";
            }
            if (kind === "takeback") {
                end("taken");
                return;
            }
        } else if (res?.status === 410) {
            end(await goneReason(res));
            return;
        } else if (res?.status === 409) {
            st.notice = MOVED_ON;
        } else {
            st.error = res
                ? `Not sent: Arc refused it (${res.status || "login expired"}). Try again.`
                : "Not sent: Arc is not reachable. Try again.";
        }
        draw();
    }

    function takeBack() {
        act("takeback", {});
    }

    function end(reason) {
        const who = name();
        const a = st.agent;
        close();
        root.replaceChildren(
            h(
                "header",
                { class: "back-head chat-head" },
                backButton(),
                a ? h("div", { class: "chat-who" }, titleBlock()) : null
            ),
            h(
                "main",
                { class: "main main-blank", "data-chat-ended": reason || "taken" },
                h("div", { class: "blank-title" }, "Back at the desk"),
                h("div", { class: "blank-text" }, endedText(who, reason)),
                h(
                    "button",
                    { type: "button", class: "link", onclick: ui.onBack },
                    icon(ICON_CHEVRON_LEFT, 14),
                    "Back to the list"
                )
            )
        );
    }

    root.replaceChildren(header, body, footer);
    draw();
    return close;
}

async function goneReason(res) {
    try {
        return (await res.json()).reason;
    } catch {
        return "";
    }
}
