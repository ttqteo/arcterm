// the pure half of answering AskUserQuestion from Arc's cockpit card or the terminal's band: which
// calls the card can take, what `wsh ask --wait` reads, the band picker's steps, and a reply mapped
// onto the tool's answers. register.ts does the I/O, ask-band.tsx the drawing.
import type { Picker, PickerSite } from "../types";

export type AskOption = { label: string; description?: string; preview?: string };
export type AskQuestion = {
    question: string;
    header: string;
    multiSelect: boolean;
    kind?: string;
    options?: readonly AskOption[];
};
export type AskAnswer = { selectedindexes?: number[]; text?: string };
export type AskReply = { answers: AskAnswer[]; cancelled: boolean };

// the card shows choice questions only, so one text or number question sends the whole call to
// claude's own dialog
export function cardCanAsk(questions: readonly AskQuestion[]): boolean {
    return (
        questions.length > 0 &&
        questions.every((q) => (q.kind ?? "choice") === "choice" && (q.options?.length ?? 0) > 0)
    );
}

// sent on stdin, not --questions-json: option previews can outrun a windows command line
export function askPayload(questions: readonly AskQuestion[]): string {
    return JSON.stringify({
        questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            multiSelect: q.multiSelect,
            options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description, preview: o.preview })),
        })),
    });
}

export function parseAskReply(stdout: string): AskReply | null {
    const line = stdout.trim().split("\n").pop();
    if (!line) {
        return null;
    }
    try {
        const v = JSON.parse(line);
        if (typeof v?.cancelled !== "boolean") {
            return null;
        }
        return { answers: Array.isArray(v.answers) ? v.answers : [], cancelled: v.cancelled };
    } catch {
        return null;
    }
}

// the terminal's picker: where it is drawn, the questions less their previews (the card shows
// those), which one is up, the answers so far, and the options marked in a multi-select
export function openPicker(questions: readonly AskQuestion[], site: PickerSite): Picker {
    return {
        site,
        questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            multiSelect: q.multiSelect,
            options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description })),
        })),
        index: 0,
        answers: [],
        marked: [],
    };
}

function answered(p: Picker, answer: AskAnswer): Picker {
    return { ...p, answers: [...p.answers, answer], index: p.index + 1, marked: [] };
}

// a single-select pick answers the question; a multi-select pick toggles the option's mark
export function pickOption(p: Picker, n: number): Picker {
    const q = p.questions[p.index];
    if (!q?.options[n]) {
        return p;
    }
    if (!q.multiSelect) {
        return answered(p, { selectedindexes: [n] });
    }
    const marked = p.marked.includes(n) ? p.marked.filter((m) => m !== n) : [...p.marked, n].sort((a, b) => a - b);
    return { ...p, marked };
}

export function confirmMarked(p: Picker): Picker {
    return p.marked.length === 0 || !p.questions[p.index] ? p : answered(p, { selectedindexes: p.marked });
}

export function typeOther(p: Picker, text: string): Picker {
    const typed = text.trim();
    return typed === "" || !p.questions[p.index] ? p : answered(p, { text: typed });
}

// header, question, Other and hint rows around the options
const PICKER_CHROME_ROWS = 4;

// body rows the picker needs for its tallest question
export function pickerRows(p: Picker): number {
    return Math.max(...p.questions.map((q) => q.options.length + (q.multiSelect ? 1 : 0))) + PICKER_CHROME_ROWS;
}

// the reply once every question is answered, in the shape `wsh ask --wait` prints
export function pickerReply(p: Picker): AskReply | null {
    return p.index >= p.questions.length ? { answers: p.answers, cancelled: false } : null;
}

// question text -> answer, as AskUserQuestion's result spells it: typed "Other" text verbatim, else the
// chosen labels joined the way claude joins a multi-select
export function answersFor(questions: readonly AskQuestion[], reply: AskReply): Record<string, string> {
    const out: Record<string, string> = {};
    questions.forEach((q, i) => {
        const a = reply.answers[i];
        if (a?.text) {
            out[q.question] = a.text;
            return;
        }
        const labels = (a?.selectedindexes ?? []).map((n) => q.options?.[n]?.label).filter((l): l is string => !!l);
        if (labels.length > 0) {
            out[q.question] = labels.join(", ");
        }
    });
    return out;
}
