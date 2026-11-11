// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The XML-tagged blocks a message of yours carries that you never typed as such, for your bubble to draw as folded cards
// (docs/superpowers/plans/2026-11-10-chat-files-slash-pills.md, Task 8). Written for <pasted_content …> (a paste the
// harness wraps), <system-reminder>, <command-name> / <command-message> / <command-args>, <local-command-stdout> and
// <local-command-caveat>; any other <tag>…</tag> a hook or tool adds folds the same way, named by its words. A block is a
// line that opens with the tag (attributes allowed) up to the line that ends with its matching close tag; text inside a
// ``` fence, an unclosed tag, a tag that does not start a line and a close of another name stay text. <task-notification>
// is never split: the projection turns it into a marker before it reaches a bubble. Pure.

export type TextPart = { kind: "text"; text: string };
export type TagPart = {
    kind: "tag";
    tag: string;
    attrs: Record<string, string>;
    body: string;
    /** a command's blocks folded into one card (foldCommandParts): the command as typed, "/name args" */
    label?: string;
};
export type TaggedPart = TextPart | TagPart;

const NEVER_SPLIT = new Set(["task-notification"]);

// <name attr="v" other='v' bare>, the whole line starting at its first character; what follows the ">" is group 3
const ATTR = String.raw`\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?`;
const OPEN_TAG = new RegExp(String.raw`^<([A-Za-z][\w-]{0,63})((?:${ATTR})*)\s*>(.*)$`);
const ATTR_PAIR = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const FENCE = /^ {0,3}```/;

function parseAttrs(source: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const m of source.matchAll(ATTR_PAIR)) {
        attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
    }
    return attrs;
}

// a line that ends with </name>, or with a close carrying attributes as Claude Code writes a paste's (`</pasted_content
// id="cdd1">`): what comes before the close, or null when the line does not end with one
function beforeClose(line: string, name: string): string | null {
    const m = new RegExp(String.raw`</${name}(?:${ATTR})*\s*>$`).exec(line.trimEnd());
    return m == null ? null : line.trimEnd().slice(0, m.index);
}

// the block that opens on lines[at], or null: where its close line is and the lines of its body
function readBlock(lines: string[], at: number): { end: number; part: TagPart } | null {
    const open = OPEN_TAG.exec(lines[at]);
    if (open == null) {
        return null;
    }
    const name = open[1];
    const rest = open[3];
    const body: string[] = [];
    const part = (end: number): { end: number; part: TagPart } => ({
        end,
        part: { kind: "tag", tag: name, attrs: parseAttrs(open[2]), body: body.join("\n") },
    });
    // the whole block on one line
    const oneLine = beforeClose(rest, name);
    if (oneLine != null) {
        if (oneLine.trim() !== "") {
            body.push(oneLine);
        }
        return part(at);
    }
    if (rest.trim() !== "") {
        body.push(rest);
    }
    // a block of the same name inside this one needs its own close first
    let depth = 1;
    for (let i = at + 1; i < lines.length; i++) {
        const line = lines[i];
        const inner = beforeClose(line, name);
        const opens = OPEN_TAG.exec(line)?.[1] === name;
        depth += (opens ? 1 : 0) - (inner != null ? 1 : 0);
        if (depth > 0) {
            body.push(line);
            continue;
        }
        if (inner != null && inner.trim() !== "") {
            body.push(inner);
        }
        return part(i);
    }
    return null;
}

/** Pure: a message that is nothing but one paste block the harness wrapped, read as the paste itself. Claude Code wraps
 *  a whole multi-line message it is handed as one paste (a Chat message queued while the agent worked arrives so): that
 *  is the message you wrote, not a paste inside it, and its attachment lists sit at the end of the body. Any other
 *  message comes back as it was. */
export function unwrapWholePaste(text: string): string {
    const parts = splitTagged(text.trim());
    const only = parts.length === 1 ? parts[0] : null;
    return only?.kind === "tag" && only.tag === "pasted_content" ? only.body : text;
}

/** Pure: a message cut into its text and its tagged blocks, in order. A message with no block is one text part, as it
 *  came. The text between blocks keeps its lines but not the newline beside a block, and text of only whitespace is
 *  dropped. A block's body has one leading and one trailing newline trimmed. */
export function splitTagged(text: string): TaggedPart[] {
    const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
    const parts: TaggedPart[] = [];
    let pending: string[] = [];
    const flush = () => {
        const joined = pending.join("\n");
        if (joined.trim() !== "") {
            parts.push({ kind: "text", text: joined });
        }
        pending = [];
    };
    let fenced = false;
    for (let i = 0; i < lines.length; i++) {
        if (FENCE.test(lines[i])) {
            fenced = !fenced;
        }
        const block = fenced ? null : readBlock(lines, i);
        if (block == null || NEVER_SPLIT.has(block.part.tag)) {
            // a block that is never split stays text with everything inside it
            const end = block?.end ?? i;
            pending.push(...lines.slice(i, end + 1));
            i = end;
            continue;
        }
        flush();
        parts.push(block.part);
        i = block.end;
    }
    if (parts.length === 0) {
        return [{ kind: "text", text }];
    }
    flush();
    return parts;
}

const LABELS: Record<string, string> = {
    pasted_content: "Pasted",
    "system-reminder": "System reminder",
    "local-command-stdout": "Command output",
    "local-command-caveat": "Note",
    "command-name": "Command",
};

/** Pure: a tag's name for a card ("system-reminder" → "System reminder"); a tag it has no name for gets its words,
 *  the first capitalised ("foo_bar-baz" → "Foo bar baz"). */
export function tagLabel(tag: string): string {
    const known = LABELS[tag];
    if (known != null) {
        return known;
    }
    const words = tag
        .split(/[_-]+/)
        .filter((w) => w !== "")
        .join(" ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Pure: how many lines a body has (the newline that ends the last one starts no more). */
export function lineCount(body: string): number {
    const text = body.endsWith("\n") ? body.slice(0, -1) : body;
    return text === "" ? 0 : text.split(/\r?\n/).length;
}

/** Pure: what a card's header says: the command it folds, "Pasted · 12 lines" for a paste, else the tag's name. */
export function tagHeading(part: TagPart): string {
    if (part.label != null) {
        return part.label;
    }
    const label = tagLabel(part.tag);
    if (part.tag !== "pasted_content") {
        return label;
    }
    const n = lineCount(part.body);
    return `${label} · ${n} ${n === 1 ? "line" : "lines"}`;
}

const COMMAND_TAGS = new Set(["command-name", "command-message", "command-args"]);

function foldCommand(group: TagPart[]): TagPart[] {
    const name = group.find((p) => p.tag === "command-name");
    if (name == null) {
        return group;
    }
    const slash = name.body.trim();
    const args = group.find((p) => p.tag === "command-args")?.body.trim() ?? "";
    const message = group.find((p) => p.tag === "command-message")?.body ?? "";
    const command = slash.startsWith("/") ? slash : `/${slash}`;
    return [
        {
            kind: "tag",
            tag: "command-name",
            attrs: {},
            body: message,
            label: args === "" ? command : `${command} ${args}`,
        },
    ];
}

/** Pure: the command blocks Claude Code writes for a slash command you ran (<command-message>, <command-name>,
 *  <command-args>, side by side) folded into one card labelled with the command, "/name args", its body the message.
 *  A run of them starts a new command where a block repeats one the command already has; blocks with no name stay
 *  as they are. */
export function foldCommandParts(parts: TaggedPart[]): TaggedPart[] {
    const out: TaggedPart[] = [];
    let group: TagPart[] = [];
    const flush = () => {
        out.push(...foldCommand(group));
        group = [];
    };
    for (const part of parts) {
        if (part.kind !== "tag" || !COMMAND_TAGS.has(part.tag)) {
            flush();
            out.push(part);
            continue;
        }
        if (group.some((p) => p.tag === part.tag)) {
            flush();
        }
        group.push(part);
    }
    flush();
    return out;
}
