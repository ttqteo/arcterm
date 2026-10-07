// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    copyText,
    matchLogTask,
    ownerLabel,
    pollMs,
    portsLabel,
    serverLabel,
    serverUrl,
    uptimeLabel,
    type DevServerRow,
} from "./devserversmodel";

function row(over: Partial<DevServerRow> = {}): DevServerRow {
    return {
        pid: 29308,
        createms: 0,
        ports: [4321],
        name: "node.exe",
        cmdline: "node C:\\w\\site\\node_modules\\astro\\astro.js dev",
        cwd: "C:\\w\\site",
        byagent: false,
        ...over,
    };
}

describe("serverLabel", () => {
    it("drops the interpreter and names the script", () => {
        expect(serverLabel(row())).toBe("astro dev");
    });

    it("keeps a quoted path with spaces as one token", () => {
        const cmdline = '"C:\\Program Files\\nodejs\\node.exe" "D:\\w\\app\\node_modules\\next\\dist\\bin\\next" dev';
        expect(serverLabel(row({ cmdline }))).toBe("next dev");
    });

    it("names the package for a generic script name", () => {
        expect(serverLabel(row({ cmdline: "node /w/app/node_modules/vite/bin/vite.js --port 5174" }))).toBe(
            "vite --port 5174"
        );
        expect(serverLabel(row({ cmdline: "node /w/app/node_modules/foo/dist/cli.js start" }))).toBe("foo start");
        expect(serverLabel(row({ cmdline: "node C:\\w\\app\\node_modules\\@scope\\pkg\\lib\\src\\index.js" }))).toBe(
            "pkg"
        );
    });

    it("leaves a non-path token after an interpreter alone", () => {
        expect(serverLabel(row({ cmdline: "python -m http.server 8000" }))).toBe("-m http.server 8000");
    });

    it("drops each interpreter, whatever its case or extension", () => {
        expect(serverLabel(row({ cmdline: "bun run dev" }))).toBe("run dev");
        expect(serverLabel(row({ cmdline: "C:\\tools\\Deno.EXE run /w/app/main.ts" }))).toBe("run /w/app/main.ts");
        expect(serverLabel(row({ cmdline: "ruby /w/app/server.rb -p 3000" }))).toBe("server -p 3000");
        expect(serverLabel(row({ cmdline: "python3 /w/app/manage.py runserver" }))).toBe("manage runserver");
    });

    it("shortens the program's own path when it is not an interpreter", () => {
        expect(serverLabel(row({ cmdline: "C:\\Users\\me\\go\\bin\\air.exe -c .air.toml" }))).toBe("air -c .air.toml");
    });

    it("keeps a lone interpreter or a bare command as it is", () => {
        expect(serverLabel(row({ cmdline: "node" }))).toBe("node");
        expect(serverLabel(row({ cmdline: "pnpm dev --port 4321" }))).toBe("pnpm dev --port 4321");
    });

    it("reads as the process name when the command line is empty", () => {
        expect(serverLabel(row({ cmdline: "", name: "node.exe" }))).toBe("node.exe");
        expect(serverLabel(row({ cmdline: "   ", name: "node.exe" }))).toBe("node.exe");
    });

    it("cuts a long command line to 60 characters with an ellipsis", () => {
        const label = serverLabel(row({ cmdline: "x".repeat(200) }));
        expect(label).toHaveLength(60);
        expect(label.endsWith("…")).toBe(true);
        expect(label.slice(0, 59)).toBe("x".repeat(59));
    });

    it("does not cut a label of exactly 60 characters", () => {
        const cmdline = "y".repeat(60);
        expect(serverLabel(row({ cmdline }))).toBe(cmdline);
    });
});

describe("serverUrl, portsLabel, ownerLabel, copyText", () => {
    it("builds the localhost url", () => {
        expect(serverUrl(4321)).toBe("http://localhost:4321");
    });

    it("lists one or several ports", () => {
        expect(portsLabel([4321])).toBe(":4321");
        expect(portsLabel([4321, 24678])).toBe(":4321 :24678");
        expect(portsLabel([])).toBe("");
    });

    it("says who started the server", () => {
        expect(ownerLabel(row({ byagent: true }))).toBe("this agent");
        expect(ownerLabel(row({ byagent: false }))).toBe("already running");
    });

    it("copies the PID and the full command line", () => {
        const r = row({ pid: 77, cmdline: "node C:\\w\\site\\node_modules\\astro\\astro.js dev" });
        expect(copyText(r)).toBe("PID 77\nnode C:\\w\\site\\node_modules\\astro\\astro.js dev");
    });
});

describe("uptimeLabel", () => {
    const t0 = 1_700_000_000_000;
    const at = (ms: number) => uptimeLabel(t0, t0 + ms);
    const s = 1000;
    const m = 60 * s;
    const h = 60 * m;
    const d = 24 * h;

    it("reads seconds under a minute", () => {
        expect(at(0)).toBe("0s");
        expect(at(45 * s)).toBe("45s");
        expect(at(59 * s + 999)).toBe("59s");
    });

    it("reads minutes under an hour, flooring", () => {
        expect(at(60 * s)).toBe("1m");
        expect(at(12 * m + 59 * s)).toBe("12m");
        expect(at(59 * m + 59 * s)).toBe("59m");
    });

    it("reads hours and minutes under a day", () => {
        expect(at(h)).toBe("1h 0m");
        expect(at(2 * h + 14 * m + 30 * s)).toBe("2h 14m");
        expect(at(23 * h + 59 * m)).toBe("23h 59m");
    });

    it("reads days and hours from a day on", () => {
        expect(at(d)).toBe("1d 0h");
        expect(at(3 * d + 4 * h + 59 * m)).toBe("3d 4h");
    });

    it("reads a negative span as zero", () => {
        expect(uptimeLabel(t0 + 5000, t0)).toBe("0s");
    });
});

describe("matchLogTask", () => {
    interface Task {
        toolUseId: string;
        command?: string;
        status: string;
        outputFile?: string;
    }
    const task = (over: Partial<Task> = {}): Task => ({
        toolUseId: "t1",
        command: "pnpm dev --port 4321",
        status: "running",
        outputFile: "C:/tmp/t1.output",
        ...over,
    });
    const launched = row({ byagent: true, launchercmdline: 'bash -c "pnpm dev --port 4321"' });

    it("matches a running task whose command is inside the launcher command line", () => {
        const t = task();
        expect(matchLogTask(launched, [t])).toBe(t);
    });

    it("takes the first of several matches", () => {
        const first = task({ toolUseId: "a" });
        const second = task({ toolUseId: "b" });
        expect(matchLogTask(launched, [first, second])).toBe(first);
    });

    it("skips a task that is not running", () => {
        expect(matchLogTask(launched, [task({ status: "completed" })])).toBeUndefined();
        expect(matchLogTask(launched, [task({ status: "failed" }), task({ status: "stopped" })])).toBeUndefined();
    });

    it("skips a task with no output file or no command", () => {
        expect(matchLogTask(launched, [task({ outputFile: undefined })])).toBeUndefined();
        expect(matchLogTask(launched, [task({ command: undefined })])).toBeUndefined();
        expect(matchLogTask(launched, [task({ command: '""' })])).toBeUndefined();
    });

    it("skips a task whose command is not in the launcher command line", () => {
        expect(matchLogTask(launched, [task({ command: "npm run build" })])).toBeUndefined();
    });

    it("never matches a server the agent did not start", () => {
        const already = row({ byagent: false, launchercmdline: 'bash -c "pnpm dev --port 4321"' });
        expect(matchLogTask(already, [task()])).toBeUndefined();
    });

    it("never matches a row with no launcher command line", () => {
        expect(matchLogTask(row({ byagent: true }), [task()])).toBeUndefined();
        expect(matchLogTask(row({ byagent: true, launchercmdline: "" }), [task()])).toBeUndefined();
    });

    it("matches through quote and backslash differences", () => {
        const win = row({
            byagent: true,
            launchercmdline: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "cd D:\\w\\site && npm  run dev"',
        });
        const t = task({ command: "cd D:\\w\\site && npm run dev" });
        expect(matchLogTask(win, [t])).toBe(t);
        const quoted = task({ command: "cd 'D:\\w\\site' && npm run dev" });
        expect(matchLogTask(win, [quoted])).toBe(quoted);
    });

    it("keeps the caller's task type", () => {
        const t = { ...task(), extra: 1 };
        expect(matchLogTask(launched, [t])?.extra).toBe(1);
    });
});

describe("pollMs", () => {
    it("polls fast while the rail is visible and slowly otherwise", () => {
        expect(pollMs(true)).toBe(5000);
        expect(pollMs(false)).toBe(30000);
    });
});
