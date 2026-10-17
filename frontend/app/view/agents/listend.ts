// The pixel distance from a list's end at which it loads its next page.
export const LIST_END_PX = 120;

// True when the list is within LIST_END_PX of its end. A list with no scrollbar (its content fits) is always at its
// end, which is how a short list keeps loading older pages: it never gets a scroll event to ask for them.
export function nearListEnd(el: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight < LIST_END_PX;
}
