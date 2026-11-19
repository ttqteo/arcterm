// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A shell command and its output drawn in colour, shared by every view that shows one: Chat's opened step
// (chatstepsview.tsx CommandDetail), the live feed and the full view (narrationtimeline.tsx ToolDetailBody), and a git
// command that failed (gitstatepanels.tsx). The command takes the shell's colours (shellhighlight.ts); output that
// prints source with no ANSI of its own is drawn as code (stepoutput.ts), any other in its ANSI colours or the tones
// its text calls for (OutputLines).

import { Fragment, useMemo } from "react";
import { OutputLines, type OutputColors } from "./outputlines";
import { shellLine } from "./shellhighlight";
import { codeOutputLine, readsCode } from "./stepoutput";

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
    if (!outputAsCode(command, output)) {
        return <OutputLines lines={lines} colors={colors} />;
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
