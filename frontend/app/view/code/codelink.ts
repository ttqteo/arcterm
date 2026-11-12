// frontend/app/view/code/codelink.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: turn a link inside a previewed markdown file into a file in the same repository. Relative
// links are how docs point at each other and at code, and the external opener refuses anything that
// is not a web or mail address, so without this they did nothing at all.

export interface DocLinkTarget {
    rel: string;
    line: number | null;
}

// a scheme ("https:", "mailto:", a drive letter) or a protocol-relative host is not a repository path
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
// GitHub's line anchors: #L12 and #L12-L20
const LINE_ANCHOR_RE = /^L(\d+)(?:-L\d+)?$/;
// what GitHub strips from a heading's text to make its anchor
const SLUG_DROP_RE = /[^\p{L}\p{M}\p{N}\s_-]/gu;

// GitHub's heading anchors, in document order: a repeat takes the next free "-n", as github-slugger does
export function slugHeadings(names: readonly string[]): string[] {
    const seen = new Map<string, number>();
    return names.map((name) => {
        const base = name.toLowerCase().replace(SLUG_DROP_RE, "").replace(/\s/g, "-");
        let slug = base;
        while (seen.has(slug)) {
            const n = seen.get(base) + 1;
            seen.set(base, n);
            slug = `${base}-${n}`;
        }
        seen.set(slug, 0);
        return slug;
    });
}

// The heading a link into another document names (`b.md#some-heading`), decoded, or null for no fragment, a line
// anchor (resolveDocLink reads those) or an in-page `#anchor` (the preview's own heading scroll handles that one).
// Kept beside resolveDocLink rather than in its answer, whose shape other callers rely on.
export function docLinkAnchor(href: string): string | null {
    const hashAt = href.indexOf("#");
    if (hashAt <= 0 || EXTERNAL_RE.test(href)) {
        return null;
    }
    let fragment: string;
    try {
        fragment = decodeURIComponent(href.slice(hashAt + 1));
    } catch {
        return null;
    }
    return fragment === "" || LINE_ANCHOR_RE.test(fragment) ? null : fragment;
}

export function resolveDocLink(fromRel: string, href: string): DocLinkTarget | null {
    if (href === "" || href.startsWith("#") || EXTERNAL_RE.test(href)) {
        return null;
    }
    const hashAt = href.indexOf("#");
    const fragment = hashAt === -1 ? "" : href.slice(hashAt + 1);
    const pathPart = href.slice(0, hashAt === -1 ? href.length : hashAt).split("?")[0];
    let decoded: string;
    try {
        decoded = decodeURIComponent(pathPart);
    } catch {
        return null;
    }
    const segs = decoded.startsWith("/") ? [] : fromRel.split("/").slice(0, -1);
    for (const seg of decoded.split("/")) {
        if (seg === "" || seg === ".") {
            continue;
        }
        if (seg === "..") {
            if (segs.length === 0) {
                return null;
            }
            segs.pop();
        } else {
            segs.push(seg);
        }
    }
    if (segs.length === 0) {
        return null;
    }
    const lineMatch = LINE_ANCHOR_RE.exec(fragment);
    return { rel: segs.join("/"), line: lineMatch ? Number(lineMatch[1]) : null };
}
