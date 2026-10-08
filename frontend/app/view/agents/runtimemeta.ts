// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Per-runtime chrome (label, glyph, accent classes) for the roster/header/details badges. Ports the
// RUNTIME() map from Wave-cockpit-live.dc.html. Keyed on an agent's provider string (AgentVM.agent,
// e.g. "claude" | "codex"). Unknown providers return an unknown metadata record rather than falling
// back to Claude, so an explicit invalid runtime is never mislabeled. The class strings are full
// literals so Tailwind's source scanner emits the utilities.

export interface RuntimeMeta {
    id: "claude" | "codex" | "opencode" | "pi" | "agy" | "terminal" | "unknown";
    label: string;
    glyph: string;
    text: string; // text-color utility (glyph/label tint)
    softBg: string; // soft fill utility (pill background)
    line: string; // border-color utility (pill outline)
}

const RUNTIMES: Record<string, RuntimeMeta> = {
    claude: {
        id: "claude",
        label: "Claude Code",
        glyph: "✳",
        text: "text-rt-claude",
        softBg: "bg-rt-claude-soft",
        line: "border-rt-claude-line",
    },
    codex: {
        id: "codex",
        label: "Codex",
        glyph: "◆",
        text: "text-rt-codex",
        softBg: "bg-rt-codex-soft",
        line: "border-rt-codex-line",
    },
    opencode: {
        id: "opencode",
        label: "OpenCode",
        glyph: "◇",
        text: "text-rt-opencode",
        softBg: "bg-rt-opencode-soft",
        line: "border-rt-opencode-line",
    },
    pi: {
        id: "pi",
        label: "Pi",
        glyph: "Pi",
        text: "text-rt-pi",
        softBg: "bg-rt-pi-soft",
        line: "border-rt-pi-line",
    },
    agy: {
        id: "agy",
        label: "Antigravity",
        glyph: "◭",
        text: "text-rt-agy",
        softBg: "bg-rt-agy-soft",
        line: "border-rt-agy-line",
    },
    terminal: {
        id: "terminal",
        label: "Terminal",
        glyph: "▮",
        text: "text-rt-terminal",
        softBg: "bg-rt-terminal-soft",
        line: "border-rt-terminal-line",
    },
};

const UNKNOWN: RuntimeMeta = {
    id: "unknown",
    label: "Unknown",
    glyph: "?",
    text: "text-muted",
    softBg: "bg-surface-hover",
    line: "border-border",
};

export function runtimeMeta(provider: string | undefined): RuntimeMeta {
    if (provider == null || provider === "") {
        return UNKNOWN;
    }
    return RUNTIMES[provider.toLowerCase()] ?? UNKNOWN;
}
