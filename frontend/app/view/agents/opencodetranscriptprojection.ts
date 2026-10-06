// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure projection of an opencode shadow transcript (JSONL lines written by the Wave status plugin,
// installed from cmd/wsh/cmd/opencode-plugin.js) into AgentEntry[]. No React, no Wave runtime imports.

import type { AgentEntry } from "./agentsviewmodel";

const VERB_BY_TOOL: Record<string, string> = {
    bash: "ran",
    read: "read",
    write: "wrote",
    edit: "edited",
    grep: "grep",
    glob: "glob",
    todo: "updated",
    agent: "spawned",
};

function verbFor(name: string): string {
    return VERB_BY_TOOL[name] ?? name.toLowerCase();
}

// the target line for a tool: the command for bash, a file name or pattern for the file tools
function targetFor(name: string, input: string): string {
    if (name === "bash") {
        return input;
    }
    if (!input) {
        return name;
    }
    let args: any;
    try {
        args = JSON.parse(input);
    } catch {
        return input;
    }
    for (const key of ["filePath", "file_path"]) {
        if (typeof args[key] === "string" && args[key]) {
            return args[key].split(/[/\\]/).pop() || args[key];
        }
    }
    if (typeof args.pattern === "string" && args.pattern) {
        return args.pattern;
    }
    return input;
}

// only the file tools name a file; grep and glob take a directory
const FILE_TOOLS = new Set(["read", "write", "edit"]);

// the full path a file tool's JSON input names, if any
function filePathOf(input: string): string | null {
    try {
        const args = JSON.parse(input);
        for (const key of ["filePath", "file_path"]) {
            if (typeof args?.[key] === "string" && args[key] !== "") {
                return args[key];
            }
        }
    } catch {
        // not JSON: a bash command or a bare name
    }
    return null;
}

/** Pure: project shadow JSONL lines into ordered entries. user -> asked, assistant -> message,
 *  tool -> action (bash fails on an error state), state/session -> no entry. Unparseable lines and
 *  unknown record types are skipped. */
export function projectOpencodeTranscript(lines: string[]): AgentEntry[] {
    const entries: AgentEntry[] = [];
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec.type === "user" && typeof rec.text === "string" && rec.text.trim() !== "") {
            entries.push({ kind: "user", text: rec.text });
            continue;
        }
        if (rec.type === "assistant" && typeof rec.text === "string" && rec.text.trim() !== "") {
            entries.push({ kind: "message", text: rec.text });
            continue;
        }
        if (rec.type === "tool" && typeof rec.name === "string") {
            const input = typeof rec.input === "string" ? rec.input : "";
            const action: any = { kind: "action", verb: verbFor(rec.name), target: targetFor(rec.name, input) };
            const p = FILE_TOOLS.has(rec.name) ? filePathOf(input) : null;
            if (p != null) {
                action.path = p;
            }
            if (rec.name === "bash" && input) {
                action.outcome = rec.state === "error" ? "fail" : "ok";
            }
            entries.push(action);
            continue;
        }
    }
    return entries;
}

/** Pure: the session record's title if the plugin wrote one, else the first user text. */
export function extractOpencodeTitle(lines: string[]): string | undefined {
    let title: string | undefined;
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type === "session" && typeof rec.title === "string" && rec.title.trim() !== "") {
            title = rec.title;
        }
    }
    if (title) {
        return title;
    }
    for (const line of lines) {
        let rec: any;
        try {
            rec = JSON.parse(line);
        } catch {
            continue;
        }
        if (rec?.type === "user" && typeof rec.text === "string" && rec.text.trim() !== "") {
            return rec.text;
        }
    }
    return undefined;
}
