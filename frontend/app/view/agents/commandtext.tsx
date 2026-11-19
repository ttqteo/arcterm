// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A shell command and its output drawn in colour, shared by every view that shows one: Chat's opened step
// (chatstepsview.tsx CommandDetail), the live feed and the full view (narrationtimeline.tsx ToolDetailBody), and a git
// command that failed (gitstatepanels.tsx). The command takes the shell's colours (shellhighlight.ts); output that
// prints source with no ANSI of its own is drawn as code (stepoutput.ts), any other in its ANSI colours or the tones
// its text calls for (OutputLines), with the commands Task echoed in it in the shell's colours (taskecho.ts). Chat's
// `!` bubble (chatconversation.tsx) draws its output with it too.

import { Fragment, useMemo, type ReactNode } from "react";
import { OutputLines, type OutputColors } from "./outputlines";
import { shellLine } from "./shellhighlight";
import { codeOutputLine, readsCode } from "./stepoutput";
import { taskEchoes } from "./taskecho";

const DEFAULT_COLORS: OutputColors = { fg: "var(--color-secondary)", bg: "var(--color-surface-code)" };

/** The command's text in the shell's colours, one line per line it has; no `$` in front. */
export function ShellCommand({ command }: { command: string }) {
    return (
        <>
            {command.split("\n").map((ln, i) => (
                <Fragment key={i}>
                    {i > 0 ? "\n" : null}
                    {shellLine(ln).map((tk, k) => (
                        <span key={k} className={tk.cls}>
                            {tk.t}
                        </span>
                    ))}
                </Fragment>
            ))}
        </>
    );
}

/** Pure: whether `command`'s output is drawn as code rather than as terminal output. */
export function outputAsCode(command: string, output: string): boolean {
    return !output.includes("\u001b") && readsCode(command);
}

/** A command's output lines in colour, for the caller's `<pre>`; `command` decides whether they are drawn as code. */
export function CommandOutput({
    command,
    output,
    colors = DEFAULT_COLORS,
}: {
    command: string;
    output: string;
    colors?: OutputColors;
}) {
    const lines = useMemo(() => output.replace(/\n$/, "").split("\n"), [output]);
    // the commands Task echoed before running them, in a plain output (a coloured one carries Task's own colours)
    const echoes = useMemo(() => (output.includes("\u001b") ? [] : taskEchoes(lines)), [output, lines]);
    if (!outputAsCode(command, output)) {
        if (echoes.length === 0) {
            return <OutputLines lines={lines} colors={colors} />;
        }
        const parts: ReactNode[] = [];
        let at = 0;
        for (const e of echoes) {
            if (e.start > at) {
                parts.push(<OutputLines key={`o${at}`} lines={lines.slice(at, e.start)} colors={colors} />);
            }
            parts.push(
                <div key={`e${e.start}`} data-task-echo>
                    <span className="text-muted">{e.prefix}</span>
                    <ShellCommand command={lines.slice(e.start, e.end).join("\n").slice(e.prefix.length)} />
                </div>
            );
            at = e.end;
        }
        if (at < lines.length) {
            parts.push(<OutputLines key={`o${at}`} lines={lines.slice(at)} colors={colors} />);
        }
        return <>{parts}</>;
    }
    return (
        <>
            {lines.map((ln, i) => (
                <div key={i}>
                    {ln === ""
                        ? "\n"
                        : codeOutputLine(ln).map((tk, k) => (
                              <span key={k} className={tk.cls}>
                                  {tk.t}
                              </span>
                          ))}
                </div>
            ))}
        </>
    );
}
