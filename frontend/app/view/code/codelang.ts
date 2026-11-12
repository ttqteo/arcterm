// frontend/app/view/code/codelang.ts
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure: the one place a file extension becomes a language, so the outline and the definition query
// cannot disagree about what a `.mjs` file is.

export type Lang = "go" | "ts" | "rust" | "python" | "java" | "shell" | "css" | "markdown" | "unknown";

// the families are by declaration syntax, not by toolchain: JavaScript declares the way TypeScript does
const EXTENSIONS: Record<Exclude<Lang, "unknown">, readonly string[]> = {
    go: ["go"],
    ts: ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"],
    rust: ["rs"],
    python: ["py", "pyi"],
    java: ["java"],
    shell: ["sh", "bash", "zsh"],
    css: ["css", "scss", "less"],
    markdown: ["md", "markdown", "mdx"],
};

const LANG_BY_EXT = new Map<string, Lang>(
    Object.entries(EXTENSIONS).flatMap(([lang, exts]) => exts.map((ext) => [ext, lang as Lang] as const))
);

// "" for a dotfile or a name with no extension, which no language claims
export function extOf(rel: string): string {
    const base = rel.slice(rel.lastIndexOf("/") + 1);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function langOf(rel: string): Lang {
    return LANG_BY_EXT.get(extOf(rel)) ?? "unknown";
}

// the pathspecs that scope a definition lookup to this language's files; git's default pathspec `*`
// crosses slashes, so `*.go` is every Go file at any depth
export function langGlobs(lang: Lang): string[] {
    return lang === "unknown" ? [] : EXTENSIONS[lang].map((ext) => `*.${ext}`);
}
