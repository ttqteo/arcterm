// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A skill, agent or memory note opens with a YAML frontmatter block. Markdown has no such thing, so the
// preview read its closing fence as a setext underline and set the whole block as one giant heading.
// The Code preview lifts the block off the body and shows its fields as a card instead. This is a reader
// for the flat key: value shape those files use, not a YAML parser: a nested or folded value is shown as
// its text on one line.

export type FrontmatterSplit = { fields: [string, string][]; body: string };

const OPEN = /^---\r?\n/;
const CLOSE = /^---[ \t]*(?:\r?\n|$)/m;
const FIELD = /^([A-Za-z_][\w.-]*):[ \t]*(.*)$/;

function unquote(value: string): string {
    const v = value.trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
        return v.slice(1, -1);
    }
    return v;
}

/** Pure: the leading frontmatter's fields and the document after it. No fields, and the text unchanged,
 *  when the document does not open with a closed block of key: value lines. */
export function splitFrontmatter(text: string): FrontmatterSplit {
    const none = { fields: [], body: text };
    const open = OPEN.exec(text);
    if (open == null) {
        return none;
    }
    const rest = text.slice(open[0].length);
    const close = CLOSE.exec(rest);
    if (close == null) {
        return none;
    }
    const fields: [string, string][] = [];
    for (const line of rest.slice(0, close.index).split(/\r?\n/)) {
        if (line.trim() === "") {
            continue;
        }
        const field = /^\s/.test(line) ? null : FIELD.exec(line);
        if (field != null) {
            // a block-scalar marker (| or >) carries no text of its own; the indented lines below do
            fields.push([field[1], /^[|>][+-]?$/.test(field[2].trim()) ? "" : field[2]]);
        } else if (fields.length > 0 && /^\s/.test(line)) {
            const last = fields[fields.length - 1];
            last[1] = last[1] === "" ? line.trim() : `${last[1]} ${line.trim()}`;
        } else {
            return none;
        }
    }
    if (fields.length === 0) {
        return none;
    }
    return {
        fields: fields.map(([k, v]) => [k, unquote(v)]),
        body: rest.slice(close.index + close[0].length),
    };
}
