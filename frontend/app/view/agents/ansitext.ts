// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// ANSI SGR colors in captured program output (a background task's output file, a Monitor's events), turned into styled
// runs for a plain-text view. The 16 base slots read the theme's --ansi-* custom properties (themes.ts deriveAnsi), so a
// red the program printed is the same red the live xterm draws; 256-color cube and truecolor pass through as rgb() since
// the program chose them. Style carries from line to line, as in a terminal. Every other escape (cursor moves, erase,
// OSC titles and links) is dropped, and a carriage return keeps only what was drawn last on that line.

export interface AnsiStyle {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
    strike?: boolean;
}

export interface AnsiRun {
    text: string;
    style: AnsiStyle;
}

const SLOTS = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

function slotColor(n: number): string {
    return n < 8 ? `var(--ansi-${SLOTS[n]})` : `var(--ansi-bright${SLOTS[n - 8]})`;
}

const CUBE = [0, 95, 135, 175, 215, 255];

export function color256(n: number): string | undefined {
    if (!Number.isInteger(n) || n < 0 || n > 255) {
        return undefined;
    }
    if (n < 16) {
        return slotColor(n);
    }
    if (n < 232) {
        const i = n - 16;
        return `rgb(${CUBE[Math.floor(i / 36)]}, ${CUBE[Math.floor(i / 6) % 6]}, ${CUBE[i % 6]})`;
    }
    const g = 8 + (n - 232) * 10;
    return `rgb(${g}, ${g}, ${g})`;
}

function byte(n: number | undefined): number | undefined {
    return n != null && Number.isInteger(n) && n >= 0 && n <= 255 ? n : undefined;
}

// 38/48 extended colors: `5;n` (256) or `2;r;g;b` (truecolor). Returns the color and how many params it used.
function extendedColor(params: number[], at: number): { color?: string; used: number } {
    const mode = params[at];
    if (mode === 5) {
        return { color: color256(params[at + 1]), used: 2 };
    }
    if (mode === 2) {
        const [r, g, b] = [byte(params[at + 1]), byte(params[at + 2]), byte(params[at + 3])];
        return { color: r != null && g != null && b != null ? `rgb(${r}, ${g}, ${b})` : undefined, used: 4 };
    }
    return { used: 0 };
}

export function applySgr(style: AnsiStyle, raw: string): AnsiStyle {
    // a colon-separated subparameter (38:5:n) reads the same as semicolons for the cases handled here
    const params = raw === "" ? [0] : raw.split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)));
    let s: AnsiStyle = { ...style };
    for (let i = 0; i < params.length; i++) {
        const p = params[i];
        if (p === 0) s = {};
        else if (p === 1) s.bold = true;
        else if (p === 2) s.dim = true;
        else if (p === 3) s.italic = true;
        else if (p === 4) s.underline = true;
        else if (p === 7) s.inverse = true;
        else if (p === 9) s.strike = true;
        else if (p === 21 || p === 22) s.bold = s.dim = undefined;
        else if (p === 23) s.italic = undefined;
        else if (p === 24) s.underline = undefined;
        else if (p === 27) s.inverse = undefined;
        else if (p === 29) s.strike = undefined;
        else if (p >= 30 && p <= 37) s.fg = slotColor(p - 30);
        else if (p === 39) s.fg = undefined;
        else if (p >= 40 && p <= 47) s.bg = slotColor(p - 40);
        else if (p === 49) s.bg = undefined;
        else if (p >= 90 && p <= 97) s.fg = slotColor(p - 90 + 8);
        else if (p >= 100 && p <= 107) s.bg = slotColor(p - 100 + 8);
        else if (p === 38 || p === 48) {
            const { color, used } = extendedColor(params, i + 1);
            if (color != null) {
                s[p === 38 ? "fg" : "bg"] = color;
            }
            i += used;
        }
    }
    for (const k of Object.keys(s) as (keyof AnsiStyle)[]) {
        if (s[k] === undefined) {
            delete s[k];
        }
    }
    return s;
}

// CSI (ESC [ … final), OSC (ESC ] … BEL or ESC \), any other two-byte ESC sequence, the 8-bit CSI, and a carriage
// return. Matching ESC is the point, hence the control characters.
// eslint-disable-next-line no-control-regex
const TOKEN = /\x1b\[([0-?]*)[ -/]*([@-~])|\x1b\][\s\S]*?(?:\x07|\x1b\\|$)|\x1b[\s\S]?|\x9b([0-?]*)[ -/]*([@-~])|\r/g;

function sameStyle(a: AnsiStyle, b: AnsiStyle): boolean {
    const ka = Object.keys(a) as (keyof AnsiStyle)[];
    return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/** One line's runs, starting from `style` (what the previous line left on). Returns the runs and the style after it. A
 *  carriage return mid-line starts the line over (a progress bar redrawn in place), keeping the style it had. */
export function parseAnsiLine(line: string, style: AnsiStyle = {}): { runs: AnsiRun[]; style: AnsiStyle } {
    let runs: AnsiRun[] = [];
    let cur = style;
    const emit = (t: string) => {
        if (t === "") {
            return;
        }
        const last = runs[runs.length - 1];
        if (last != null && sameStyle(last.style, cur)) {
            last.text += t;
        } else {
            runs.push({ text: t, style: cur });
        }
    };
    const text = line.replace(/\r+$/, "");
    let at = 0;
    for (const m of text.matchAll(TOKEN)) {
        emit(text.slice(at, m.index));
        at = m.index + m[0].length;
        if (m[0] === "\r") {
            runs = [];
        } else if (m[2] === "m") {
            cur = applySgr(cur, m[1]);
        } else if (m[4] === "m") {
            cur = applySgr(cur, m[3]);
        }
    }
    emit(text.slice(at));
    return { runs, style: cur };
}

/** Every line's runs, carrying style from each line into the next. */
export function parseAnsiLines(lines: string[]): AnsiRun[][] {
    let style: AnsiStyle = {};
    return lines.map((line) => {
        const r = parseAnsiLine(line, style);
        style = r.style;
        return r.runs;
    });
}

/** The inline CSS for a run. `fgDefault`/`bgDefault` are what inverse swaps in when a side is unset. */
export function runCss(style: AnsiStyle, fgDefault: string, bgDefault: string): Record<string, string | number> {
    let fg = style.fg;
    let bg = style.bg;
    if (style.inverse) {
        [fg, bg] = [bg ?? bgDefault, fg ?? fgDefault];
    }
    const css: Record<string, string | number> = {};
    if (fg != null) css.color = fg;
    if (bg != null) css.backgroundColor = bg;
    if (style.bold) css.fontWeight = 600;
    if (style.dim) css.opacity = 0.6;
    if (style.italic) css.fontStyle = "italic";
    const deco = [style.underline && "underline", style.strike && "line-through"].filter(Boolean);
    if (deco.length > 0) css.textDecoration = deco.join(" ");
    return css;
}
