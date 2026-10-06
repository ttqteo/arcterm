// the pure half of answering AskUserQuestion from Arc's cockpit card beside claude's own dialog: which
// calls the card can take, what `wsh ask --wait` reads, and the card's reply as the hook's answer.
// register.ts does the I/O.

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

// the card shows choice questions only, so one text or number question leaves the whole call to
// claude's dialog alone
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

export type CardAnswer<Q> = { deny: string } | { result: { questions: Q; answers: Record<string, string> } };

// what the hook answers the call with once the card replied; null when it did not (wsh failed or hit
// its ceiling), which leaves the question to claude's dialog
export function cardAnswer<Q extends readonly AskQuestion[]>(
    questions: Q,
    reply: AskReply | null
): CardAnswer<Q> | null {
    if (!reply) {
        return null;
    }
    if (reply.cancelled) {
        return { deny: "The user dismissed the question." };
    }
    return { result: { questions, answers: answersFor(questions, reply) } };
}
