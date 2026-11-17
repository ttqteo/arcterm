// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Copying a link in Chat without selecting its text: the bubble menu's Copy link takes the url of the nearest <a href>
// around a right-click (linkAt), and the copy button a rendered link shows on hover takes its own (copyableHref). Only a
// url worth pasting elsewhere (http, https, mailto); an in-app anchor (`#…`, a javascript: one) gives none.

type Closest = { closest(selector: string): { getAttribute(name: string): string | null } | null };

// the url of a link worth copying (http, https, mailto), trimmed; null for any other
export function copyableHref(href: string | null | undefined): string | null {
    const url = href?.trim() ?? "";
    return /^(https?:|mailto:)/i.test(url) ? url : null;
}

export function linkAt(target: unknown): string | null {
    const el = target as Partial<Closest> | null;
    if (el == null || typeof el.closest !== "function") {
        // a text node is never the target of a contextmenu event, but its parent element is reached the same way
        return null;
    }
    return copyableHref(el.closest("a[href]")?.getAttribute("href"));
}
