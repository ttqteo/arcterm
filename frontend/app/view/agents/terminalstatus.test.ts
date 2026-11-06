import { describe, expect, it } from "vitest";
import { commandLabel, terminalStatus, terminalStatusLine } from "./terminalstatus";

function row(p: Partial<ProcessInfo> & { pid: number; depth: number }): ProcessInfo {
    return { mem: 0, mempct: 0, cpu: 0, numthreads: 0, ...p };
}

function group(rows: ProcessInfo[]): ResMonGroup {
    return { key: "job:1:1", ownerkind: "agenttab", ownerid: "b1", label: "t", killable: true, cpu: 0, mem: 0, rows };
}

const shell = row({ pid: 1, depth: 0, name: "pwsh.exe", command: "pwsh.exe", tag: "shell", createts: 100 });
const conhost = row({ pid: 2, ppid: 1, depth: 1, name: "conhost.exe", command: "conhost.exe 0xffffffff" });

const MIN = 60_000;

describe("terminalStatus", () => {
    it("has nothing to say without a group or a shell row", () => {
        expect(terminalStatus(undefined)).toBeNull();
        expect(terminalStatus(group([row({ pid: 9, depth: 0, name: "x.exe" })]))).toBeNull();
    });

    it("reads a shell with only its console host as idle", () => {
        expect(terminalStatus(group([shell, conhost]))).toEqual({ running: false });
    });

    it("reports the newest child as the running command, with its subtree's ports and its start", () => {
        const old = row({
            pid: 3,
            ppid: 1,
            depth: 1,
            name: "python.exe",
            command: "python.exe -m http.server",
            createts: 200,
            ports: [8000],
        });
        const dev = row({
            pid: 4,
            ppid: 1,
            depth: 1,
            name: "task.exe",
            command: String.raw`"C:\bin\task.exe" dev`,
            createts: 300,
        });
        const vite = row({
            pid: 5,
            ppid: 4,
            depth: 2,
            name: "node.exe",
            command: "node.exe vite.js",
            ports: [5174, 9222],
        });
        const ws = row({ pid: 6, ppid: 5, depth: 3, name: "node.exe", ports: [5174] });
        expect(terminalStatus(group([shell, conhost, old, dev, vite, ws]))).toEqual({
            running: true,
            command: "task dev",
            ports: [5174, 9222],
            since: 300,
        });
    });

    it("looks through a cmd.exe wrapper to the command it runs", () => {
        const cmd = row({
            pid: 3,
            ppid: 1,
            depth: 1,
            name: "cmd.exe",
            command: 'cmd.exe /d /s /c "npm run dev"',
            createts: 200,
        });
        const node = row({
            pid: 4,
            ppid: 3,
            depth: 2,
            name: "node.exe",
            command: String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev`,
            ports: [3000],
        });
        expect(terminalStatus(group([shell, cmd, node]))).toEqual({
            running: true,
            command: "npm run dev",
            ports: [3000],
            since: 200,
        });
    });

    it("yields nothing when the foreground command could not be read at all", () => {
        // an unreadable process: no image name and no command line
        const blind = row({ pid: 3, ppid: 1, depth: 1, createts: 200 });
        expect(terminalStatus(group([shell, conhost, blind]))).toBeNull();
    });
});

describe("terminalStatusLine", () => {
    const dev = row({
        pid: 3,
        ppid: 1,
        depth: 1,
        name: "cmd.exe",
        command: 'cmd.exe /d /s /c "npm run dev"',
        createts: 1_000_000,
    });
    const vite = row({
        pid: 4,
        ppid: 3,
        depth: 2,
        name: "node.exe",
        command: String.raw`"C:\Program Files\nodejs\node.exe" "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run dev`,
        ports: [5174, 3000],
    });

    it("words a running command with its run time and its ports", () => {
        expect(terminalStatusLine(group([shell, conhost, dev, vite]), 1_000_000 + 38 * MIN)).toEqual({
            kind: "running",
            command: "npm run dev",
            age: "38m",
            text: "npm run dev  38m",
            ports: [3000, 5174],
        });
    });

    it("counts a run time in seconds, hours and days", () => {
        const at = (ms: number) => terminalStatusLine(group([shell, dev, vite]), 1_000_000 + ms);
        expect(at(12_000)).toMatchObject({ age: "12s", text: "npm run dev  12s" });
        expect(at(90 * MIN)).toMatchObject({ age: "1h 30m" });
        expect(at(49 * 60 * MIN)).toMatchObject({ age: "2d 1h" });
    });

    it("leaves the run time off a command whose start the sample could not read", () => {
        const unknownStart = { ...dev, createts: undefined };
        expect(terminalStatusLine(group([shell, unknownStart, vite]), 5 * MIN)).toEqual({
            kind: "running",
            command: "npm run dev",
            age: "",
            text: "npm run dev",
            ports: [3000, 5174],
        });
    });

    it("says idle for a shell with nothing running, and no ports", () => {
        expect(terminalStatusLine(group([shell, conhost]), 5 * MIN)).toEqual({
            kind: "idle",
            text: "idle",
            ports: [],
        });
    });

    it("yields no line for a partial sample: no group, no shell row, or an unreadable command", () => {
        expect(terminalStatusLine(undefined, 5 * MIN)).toBeNull();
        expect(terminalStatusLine(group([]), 5 * MIN)).toBeNull();
        expect(terminalStatusLine(group([dev, vite]), 5 * MIN)).toBeNull();
        const blind = row({ pid: 3, ppid: 1, depth: 1, createts: 200 });
        expect(terminalStatusLine(group([shell, blind]), 5 * MIN)).toBeNull();
    });

    it("shows the command with no ports chip where the host cannot read listening ports", () => {
        // a sample from a platform that samples no ports leaves `ports` off every row
        const bare = { ...vite, ports: undefined };
        expect(terminalStatusLine(group([shell, dev, bare]), 1_000_000 + 2 * MIN)).toMatchObject({
            kind: "running",
            text: "npm run dev  2m",
            ports: [],
        });
    });
});

describe("commandLabel", () => {
    it("drops the path and .exe from the image", () => {
        expect(
            commandLabel(
                row({
                    pid: 1,
                    depth: 0,
                    name: "docker.exe",
                    command: String.raw`"C:\Program Files\Docker\docker.exe" compose up`,
                })
            )
        ).toBe("docker compose up");
    });

    it("names a node tool by its package, scoped or not", () => {
        expect(
            commandLabel(
                row({ pid: 1, depth: 0, command: String.raw`node C:\app\node_modules\vite\bin\vite.js --port 5174` })
            )
        ).toBe("vite --port 5174");
        expect(
            commandLabel(row({ pid: 1, depth: 0, command: "node /app/node_modules/@angular/cli/bin/ng.js serve" }))
        ).toBe("@angular/cli serve");
        expect(commandLabel(row({ pid: 1, depth: 0, command: "node server.js" }))).toBe("node server.js");
    });

    it("falls back to the image name when the command line is unreadable", () => {
        expect(commandLabel(row({ pid: 1, depth: 0, name: "python.exe", command: "" }))).toBe("python");
    });

    it("is empty when there is neither a name nor a command line", () => {
        expect(commandLabel(row({ pid: 1, depth: 0 }))).toBe("");
    });
});
