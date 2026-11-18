// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// A command's output drawn in colour, line by line: a line the program coloured keeps its ANSI colours (ansitext.ts),
// and one it printed plain (a command run with no terminal: the engine's Verify and Final, an agent's background task)
// gets the colours its text calls for (outputtone.ts). The final stage (finalstageviews.tsx FinalOutput) and a
// background task's peek (backgroundtaskpeek.tsx) draw their output with it.

import { useMemo } from "react";
import { parseAnsiLines, runCss, type AnsiRun } from "./ansitext";
import { toneLine, type OutputTone } from "./outputtone";

// a toned line's colours: a failure's whole line, a pass's mark, a heading brighter
const TONE_LINE: Record<OutputTone, string> = {
    pass: "",
    fail: "text-error",
    warn: "text-warning",
    skip: "text-muted",
    head: "text-ink-hi",
    mod: "",
    plain: "",
};
const TONE_MARK: Record<OutputTone, string> = {
    pass: "text-success",
    fail: "",
    warn: "",
    skip: "",
    head: "",
    mod: "text-error",
    plain: "",
};

/** what an inverse run swaps in for an unset side: the view's own text and background */
export interface OutputColors {
    fg: string;
    bg: string;
}

function OutputLine({ runs, colors }: { runs: AnsiRun[]; colors: OutputColors }) {
    if (runs.some((r) => Object.keys(r.style).length > 0)) {
        return (
            <div>
                {runs.map((r, i) => (
                    <span key={i} style={runCss(r.style, colors.fg, colors.bg)}>
                        {r.text}
                    </span>
                ))}
            </div>
        );
    }
    const line = toneLine(runs.map((r) => r.text).join(""));
    // an empty line keeps its height
    if (line.mark === "" && line.body === "" && line.time === "") {
        return <div>{"\n"}</div>;
    }
    return (
        <div data-output-tone={line.tone} className={TONE_LINE[line.tone]}>
            {line.mark !== "" ? <span className={TONE_MARK[line.tone]}>{line.mark}</span> : null}
            {line.body}
            {line.time !== "" ? <span className="text-muted">{line.time}</span> : null}
        </div>
    );
}

/** The lines, one `<div>` each, in their colours. The caller sets the face, the wrapping and the plain colour. */
export function OutputLines({ lines, colors }: { lines: string[]; colors: OutputColors }) {
    const parsed = useMemo(() => parseAnsiLines(lines), [lines]);
    return parsed.map((runs, i) => <OutputLine key={i} runs={runs} colors={colors} />);
}
