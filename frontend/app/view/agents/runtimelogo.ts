// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Real brand marks for the coding-agent runtimes, so a channel author avatar shows the tool's actual
// logo instead of an ambiguous colored initial (claude and codex both start with "C"). The main app has
// no svgr, so .svg imports are URLs (Vite assets); render as <img src>. Unknown authors: undefined.

import AntigravityLogo from "@/app/asset/antigravity.svg";
import ClaudeLogo from "@/app/asset/claude-color.svg";
import CodexLogo from "@/app/asset/codex.svg";
import OpenCodeLogo from "@/app/asset/opencode.png";
import PiLogo from "@/app/asset/pi.svg";

const RUNTIME_LOGO: Record<string, string> = {
    claude: ClaudeLogo,
    codex: CodexLogo,
    opencode: OpenCodeLogo,
    pi: PiLogo,
    agy: AntigravityLogo,
};

// The brand mark URL for a runtime author name (case-insensitive), or undefined for
// humans/jarvis/roster — and for booting rows whose status reporter hasn't registered a
// runtime yet (AgentVM.agent is optional there, mirroring runtimeMeta's provider arg).
export function runtimeLogo(name: string | undefined): string | undefined {
    return name ? RUNTIME_LOGO[name.toLowerCase()] : undefined;
}
