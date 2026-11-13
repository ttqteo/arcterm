// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Check, Copy, X } from "lucide-react";
import { useCopyFeedback, type ClipboardContent } from "./copyfeedback";
import { CrossFade } from "./crossfade";
import { IconButton } from "./iconbutton";

type CopyButtonProps = {
    title: string;
    className?: string;
    // a function is read at the click, so content that is costly to build (a table's HTML) waits for one
    content: ClipboardContent | (() => ClipboardContent);
};

// outline glyphs, as the lucide icons beside it in a row (Flag, Fork) draw, sized to the button's font size
const ICON = { idle: Copy, copied: Check, failed: X } as const;
const TONE = { idle: undefined, copied: "opacity-100 *:text-success", failed: "opacity-100 *:text-error" } as const;

const CopyButton = ({ title, className, content }: CopyButtonProps) => {
    const { state, copy } = useCopyFeedback();
    const Glyph = ICON[state];
    return (
        <IconButton
            decl={{
                elemtype: "iconbutton",
                icon: (
                    <CrossFade swapKey={state}>
                        <Glyph size="1em" strokeWidth={2} aria-hidden />
                    </CrossFade>
                ),
                title: state === "failed" ? "Copy failed" : title,
                className: TONE[state],
                click: () => copy(typeof content === "function" ? content() : content),
            }}
            className={className}
        ></IconButton>
    );
};

export { CopyButton };
