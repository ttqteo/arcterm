// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { useCopyFeedback, type ClipboardContent } from "./copyfeedback";
import { CrossFade } from "./crossfade";
import { IconButton } from "./iconbutton";

type CopyButtonProps = {
    title: string;
    className?: string;
    // a function is read at the click, so content that is costly to build (a table's HTML) waits for one
    content: ClipboardContent | (() => ClipboardContent);
};

const ICON = { idle: "copy", copied: "check", failed: "xmark" } as const;
const TONE = { idle: undefined, copied: "opacity-100 *:text-success", failed: "opacity-100 *:text-error" } as const;

const CopyButton = ({ title, className, content }: CopyButtonProps) => {
    const { state, copy } = useCopyFeedback();
    return (
        <IconButton
            decl={{
                elemtype: "iconbutton",
                icon: (
                    <CrossFade swapKey={state}>
                        <i className={makeIconClass(ICON[state], true)} />
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
