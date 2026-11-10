// Chat's /btw, which the cockpit hands this mod as a side question (control-core.ts): the prompt the session's fork
// answers, and the notice the answer is written as. The notice is a system row the model never reads, which the TUI
// draws as a dim line and arcterm's Chat reads back with parseBtwNotice (frontend transcriptprojection.ts). Kept free of
// the engine so vitest runs it and the frontend imports it.

// the notice's first line: the command as it was asked, its question on one line
const HEAD = "/btw ";
// the one line a notice holds in place of an answer, around why there is none
const NONE = "(no side answer: ";

export type BtwReply = { answer: string } | { failure: string };
export type BtwNotice = { question: string } & BtwReply;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The text the fork answers: Claude Code's own /btw rules (one answer from the conversation, no tools, the main work
 *  goes on unaware), then the question. */
export function btwPrompt(question: string): string {
    return [
        "<system-reminder>This is a side question from the person, asked while the main work goes on. Answer it directly, in one response.",
        "- You are a separate, one-off instance that shares the conversation's context. The main agent is not interrupted and never sees this question or your answer: do not speak of being interrupted or of what you were doing.",
        "- You have no tools: you cannot read files, run commands or search. Write no tool calls, and promise no action. If answering needs any of that, say it can't be checked from a side question and suggest asking in the main conversation.",
        "- Answer only from what the conversation already holds. If you don't know, say so.</system-reminder>",
        "",
        question.trim(),
    ].join("\n");
}

/** The notice for a side question: `/btw <question>` on its first line, then the answer, or why there is none. */
export function btwNotice(question: string, reply: BtwReply): string {
    const head = HEAD + oneLine(question);
    return "answer" in reply ? `${head}\n${reply.answer.trim()}` : `${head}\n${NONE}${oneLine(reply.failure)})`;
}

/** The side question a notice's text holds, or null for any other notice. */
export function parseBtwNotice(text: string): BtwNotice | null {
    if (!text.startsWith(HEAD)) {
        return null;
    }
    const nl = text.indexOf("\n");
    const question = nl < 0 ? "" : text.slice(HEAD.length, nl).trim();
    if (question === "") {
        return null;
    }
    const body = text.slice(nl + 1).trim();
    if (body.startsWith(NONE) && body.endsWith(")") && !body.includes("\n")) {
        return { question, failure: body.slice(NONE.length, -1) };
    }
    return { question, answer: body };
}

/** Why the fork gave no answer, in words for the person: `$.model.fork`'s reasons. */
export function forkFailure(r: { reason: string; status?: number | null }): string {
    switch (r.reason) {
        case "nothing-to-fork":
            return "this session has not finished a turn since it started or was cleared; ask after its next turn, or in the Terminal";
        case "api-error":
            return r.status != null ? `the API answered an error (${r.status})` : "the API answered an error";
        case "empty-reply":
            return "the reply was empty";
        case "aborted":
            return "it was cut off";
        default:
            return r.reason;
    }
}
