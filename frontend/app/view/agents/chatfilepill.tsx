// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// An `@path` you mentioned, drawn as a pill: a file icon and the file's short name, the whole path on hover. It opens the
// file in the File tab as a path link does (a relative path resolves against the agent's folder); with no agent around
// it, the pill is the same, only not a link.

import { File } from "lucide-react";
import { mentionBaseName } from "./filementiontokens";
import { PathLink } from "./pathlinkcontext";

export function FilePill({ path }: { path: string }) {
    return (
        // The link is inline-flex, not its own inline-block: a block's line box carries the text's strut, taller than the
        // pill, which pulls the pill ~0.6px below where align-middle puts it. align-middle puts the pill's centre half an
        // x-height over the baseline, below the centre of the text's line (capitals and ascenders reach higher), so -top
        // lifts it onto that centre; it moves nothing around it. The lift is on the link, not the pill: the link clips
        // what overflows it, and a lifted pill would lose its top border.
        <PathLink path={path} className="relative -top-[1.5px] inline-flex max-w-full align-middle">
            {/* align-middle + leading-none: an inline-flex box whose first child is an icon sits on the icon's bottom
                edge otherwise, and rides high on the line */}
            <span
                data-chat-file-pill={path}
                title={path}
                className="inline-flex h-5 max-w-full items-center gap-1 rounded-[6px] border border-edge-mid bg-surface px-1.5 align-middle text-[12.5px] leading-none text-ink-hi hover:bg-surface-hover"
            >
                <File size={12} className="shrink-0 text-muted" aria-hidden />
                <span className="max-w-[220px] truncate">{mentionBaseName(path)}</span>
            </span>
        </PathLink>
    );
}
