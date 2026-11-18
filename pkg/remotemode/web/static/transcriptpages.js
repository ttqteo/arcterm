// What the phone chat holds of one agent's transcript: the history it paged in above the first backlog,
// the live tail below it, and the byte offset where the history starts. Pure, so vitest covers it; chat.js
// owns the requests and the drawing. A cursor is the byte offset of the start of the first line a chunk
// holds (0 is the session's start), so it never moves while the file grows.

// the live tail keeps this many lines; the history above it is never trimmed
export const MAX_LINES = 2000;
// older pages load until this many chat items have been gained, or the start is reached
export const SCREENFUL = 20;

/** No lines yet, and no cursor until the first backlog sets one. */
export function createPages() {
    return { history: [], tail: [], oldest: null, start: false };
}

function capped(lines) {
    return lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;
}

/**
 * Adds one `lines` event of the stream. The first connection's backlog sets the cursor (where the history
 * above it will stop) and is the tail; once a cursor is held, every chunk, a reconnect's backlog included,
 * continues the tail, because a reconnect resumes at the byte after the last line the page already has.
 */
export function merge(pages, chunk) {
    const lines = chunk?.lines ?? [];
    if (pages.oldest !== null) {
        return { ...pages, tail: capped(pages.tail.concat(lines)) };
    }
    if (chunk?.backlog && Number.isInteger(chunk.cursor) && chunk.cursor >= 0) {
        return { ...pages, tail: capped(lines), oldest: chunk.cursor, start: chunk.cursor === 0 };
    }
    // lines with no backlog before them: the transcript was empty, so nothing lies earlier
    return { ...pages, tail: capped(pages.tail.concat(lines)), oldest: 0, start: true };
}

/**
 * Puts a page of older lines (the answer to `?before=<oldest>`) above the history and moves the cursor to
 * its start. A page that did not move the cursor back, or that has no usable one, ends the paging rather
 * than ask for the same page again.
 */
export function prependPage(pages, page) {
    if (pages.oldest === null) {
        return pages;
    }
    const cursor = page?.cursor;
    if (!Number.isInteger(cursor) || cursor < 0 || cursor >= pages.oldest) {
        return { ...pages, start: true };
    }
    return { ...pages, history: (page.lines ?? []).concat(pages.history), oldest: cursor, start: cursor === 0 };
}

/** True while an older page can still be asked for. */
export function canLoadOlder(pages) {
    return pages.oldest !== null && !pages.start && pages.oldest > 0;
}

/** True until `itemsGained` chat items fill a screenful. */
export function needMore(itemsGained) {
    return !(itemsGained >= SCREENFUL);
}

/** The lines to project: the history, then the tail. */
export function allLines(pages) {
    return pages.history.length ? pages.history.concat(pages.tail) : pages.tail;
}
