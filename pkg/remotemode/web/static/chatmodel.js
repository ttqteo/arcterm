// Pure logic of the phone page's chat with a handed-over agent, with no DOM, so chatmodel.test.js can cover
// it; chat.js draws from it. Entries are the cockpit projectors' AgentEntry values (projectors.js).

import { parseMarkdown } from "./markdown.js";
import { formatAge } from "./model.js";

const EDIT_VERBS = new Set(["edited", "wrote"]);
const SECOND = 1000;
const HOUR_S = 3600;

const ENDED = {
    taken: (name) =>
        `${name} was taken back, here or at the desk, so it no longer takes messages from the phone. Hand it over again from the Agent surface.`,
    exited: (name) => `${name} exited, so it is off the phone.`,
};

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// the mdast nodes a reply keeps (chat.js draws exactly these) and highlight, for the ==...== marks
// agents put around the sentences to read; any other node gives way to its children or its text
const KEPT = new Set([
    "root",
    "paragraph",
    "heading",
    "thematicBreak",
    "blockquote",
    "list",
    "listItem",
    "table",
    "tableRow",
    "tableCell",
    "code",
    "text",
    "emphasis",
    "strong",
    "delete",
    "inlineCode",
    "break",
    "link",
]);
// nodes whose children are blocks, where block-level HTML (now text) needs a paragraph of its own
const BLOCK_PARENTS = new Set(["root", "blockquote", "listItem"]);
const HIGHLIGHT = "==";
const DELIM = { type: "delim" };
const WEB_PROTOCOLS = new Set(["http:", "https:"]);

const textNode = (value) => ({ type: "text", value });

/** The http(s) address a link may open, or null: any other scheme or a relative path stays text. */
export function webHref(url) {
    try {
        const u = new URL(url);
        return WEB_PROTOCOLS.has(u.protocol) ? u.href : null;
    } catch {
        return null;
    }
}

function mergeText(nodes) {
    const out = [];
    for (const n of nodes) {
        const prev = out[out.length - 1];
        if (n.type === "text" && prev?.type === "text") {
            out[out.length - 1] = textNode(prev.value + n.value);
        } else if (n.type !== "text" || n.value) {
            out.push(n);
        }
    }
    return out;
}

// A run between two == marks becomes a highlight node. As with ** in markdown, a mark that opens has no
// space after it and one that closes none before it, so "x == y" stays as written; a mark with no
// partner stays text. Code spans hold no marks: they are not text nodes.
function markHighlights(children) {
    const seq = [];
    for (const c of children) {
        if (c.type !== "text") {
            seq.push(c);
            continue;
        }
        c.value.split(HIGHLIGHT).forEach((v, i) => {
            if (i) {
                seq.push(DELIM);
            }
            if (v) {
                seq.push(textNode(v));
            }
        });
    }
    const blankAt = (n, last) => !n || (n.type === "text" && /\s/.test(last ? n.value.at(-1) : n.value[0]));
    const out = [];
    let open = -1;
    seq.forEach((n, i) => {
        if (n !== DELIM) {
            out.push(n);
        } else if (open >= 0 && seq[i - 1] !== DELIM && !blankAt(seq[i - 1], true)) {
            const inner = out.splice(open).slice(1);
            out.push({ type: "highlight", children: inner });
            open = -1;
        } else if (open < 0 && seq[i + 1] !== DELIM && !blankAt(seq[i + 1], false)) {
            open = out.length;
            out.push(DELIM);
        } else {
            out.push(textNode(HIGHLIGHT));
        }
    });
    return mergeText(out.map((n) => (n === DELIM ? textNode(HIGHLIGHT) : n)));
}

// One mdast node as the nodes the reply draws: positions dropped, raw HTML and images as their text,
// links only to http(s) addresses, and the rest of what GFM parses as its children or its text.
function keep(node) {
    const { position: _position, children, ...rest } = node;
    if (node.type === "html") {
        return [textNode(node.value)];
    }
    if (node.type === "image" || node.type === "imageReference") {
        return node.alt ? [textNode(node.alt)] : [];
    }
    if (node.type === "footnoteReference") {
        return [textNode(`[^${node.label ?? node.identifier}]`)];
    }
    let kids = children?.flatMap(keep);
    if (BLOCK_PARENTS.has(node.type)) {
        kids = kids.map((k) => (k.type === "text" ? { type: "paragraph", children: [k] } : k));
    }
    if (kids?.some((k) => k.type === "text")) {
        kids = markHighlights(mergeText(kids));
    }
    if (node.type === "link") {
        const href = webHref(node.url);
        return href ? [{ type: "link", url: href, children: kids }] : kids;
    }
    if (!KEPT.has(node.type)) {
        return kids ?? (typeof node.value === "string" ? [textNode(node.value)] : []);
    }
    return [kids ? { ...rest, children: kids } : rest];
}

/**
 * A reply as the markdown tree the phone draws: the cockpit's own parser (markdown.js, GFM included),
 * cut down to the nodes chat.js knows. Every value in it is drawn as text, so markup an agent writes
 * shows as the text it is. An unclosed fence runs to the end as code.
 */
export function replyTree(text) {
    return keep(parseMarkdown(text ?? ""))[0];
}

function duration(ms) {
    if (!(ms > 0)) {
        return "";
    }
    const s = Math.round(ms / SECOND);
    if (s < 60) {
        return `${s}s`;
    }
    if (s >= HOUR_S) {
        const m = Math.floor((s % HOUR_S) / 60);
        return m ? `${Math.floor(s / HOUR_S)}h ${m}m` : `${Math.floor(s / HOUR_S)}h`;
    }
    const rest = s % 60;
    return rest ? `${Math.floor(s / 60)}m ${rest}s` : `${Math.floor(s / 60)}m`;
}

function actionItem(e) {
    const item = {
        kind: "action",
        mark: e.outcome === "ok" ? "ok" : e.outcome === "fail" ? "fail" : "pending",
        verb: capitalize(e.verb),
        target: e.target ?? "",
        summary: e.summary || duration(e.durationMs),
        startedTs: e.startedTs,
    };
    if (e.detail?.kind === "edit") {
        item.adds = e.detail.files.reduce((n, f) => n + (f.adds ?? 0), 0);
        item.dels = e.detail.files.reduce((n, f) => n + (f.dels ?? 0), 0);
    }
    return item;
}

/** How long a call still running has run, or "" when its start is unknown. */
export function liveElapsed(item, now) {
    return item.startedTs > 0 ? duration(Math.max(SECOND, now - item.startedTs)) : "";
}

/** The chat's rows: the owner's messages, one-line tool calls and replies. Other entries are left out. */
export function chatItems(entries) {
    const items = [];
    for (const e of entries ?? []) {
        if (e.kind === "user") {
            items.push({ kind: "user", text: e.text });
        } else if (e.kind === "action") {
            items.push(actionItem(e));
        } else if (e.kind === "message") {
            const tree = replyTree(e.text);
            if (tree.children.length) {
                items.push({ kind: "reply", tree });
            }
        }
    }
    return items;
}

/**
 * What a permission wait asks: the tool call the menu waits on is the transcript's last action, still
 * without an outcome. Its whole command or path shows, since the hook's detail is cut short. With no such
 * call the card asks for approval over the row's line.
 */
export function permissionCard(entries, agent) {
    const last = (entries ?? []).findLast((e) => e.kind === "action");
    if (!last || last.outcome) {
        return { tool: "", ask: "Wants your approval", target: agent?.line ?? "" };
    }
    const verb = (last.verb ?? "").toLowerCase();
    if (verb === "ran") {
        return { tool: "Bash", ask: "Wants to run a command", target: last.target };
    }
    if (EDIT_VERBS.has(verb) || last.detail?.kind === "edit") {
        return { tool: "Edit", ask: "Wants to edit a file", target: last.target };
    }
    return { tool: last.verb, ask: "Wants to use a tool", target: last.target };
}

/** The message box for the agent's state, with Stop and the permission card when they apply. */
export function composerFor(agent) {
    const message = `Message ${agent.name}`;
    const base = { label: message, placeholder: message, disabled: false, stop: false, permission: false };
    switch (agent.state) {
        case "working":
            return { ...base, label: "Add to this turn", placeholder: "Add to this turn", stop: true };
        case "permission":
            return {
                ...base,
                label: `Deny and tell ${agent.name} why`,
                placeholder: "Deny and say what to do instead",
                permission: true,
            };
        case "input":
            return { ...base, disabled: true, note: "Needs input · answer it at the desk" };
        case "asking":
            return { ...base, disabled: true, note: "Asking you · answer it under Questions" };
        default:
            return base;
    }
}

function ageOf(agent, now) {
    return agent.since > 0 ? formatAge(now - agent.since) : "";
}

const withAge = (word, age, sep = " ") => (age ? `${word}${sep}${age}` : word);

/** A Handed over row's state chip. */
export function rowStateLabel(agent, now) {
    switch (agent.state) {
        case "permission":
            return "needs approval";
        case "input":
            return "needs input";
        case "asking":
            return "asking you";
        default:
            return withAge(agent.state, ageOf(agent, now));
    }
}

/** The chat header's state line. */
export function headerStateLabel(agent, now) {
    const age = ageOf(agent, now);
    switch (agent.state) {
        case "idle":
            return age ? `idle · replied ${age} ago` : "idle";
        case "permission":
            return withAge("needs approval", age, " · ");
        case "input":
            return withAge("needs input", age, " · ");
        case "asking":
            return withAge("asking you", age, " · ");
        default:
            return withAge(agent.state, age);
    }
}

/** Why a chat ended, for the Back at the desk page. */
export function endedText(name, reason) {
    return (ENDED[reason] ?? ENDED.taken)(name);
}

/** The handed-over tab a "#agent/<tab>" hash opens, else null. */
export function chatTab(hash) {
    const m = /^#agent\/(.+)$/.exec(hash ?? "");
    if (!m) {
        return null;
    }
    try {
        return decodeURIComponent(m[1]);
    } catch {
        return null;
    }
}
