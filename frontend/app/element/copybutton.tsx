// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { useCopyFeedback } from "./copyfeedback";
import { CrossFade } from "./crossfade";
import { IconButton } from "./iconbutton";

type CopyButtonProps = {
    title: string;
    className?: string;
    text: string;
};

const ICON = { idle: "copy", copied: "check", failed: "xmark" } as const;
const TONE = { idle: undefined, copied: "opacity-100 *:text-success", failed: "opacity-100 *:text-error" } as const;

const CopyButton = ({ title, className, text }: CopyButtonProps) => {
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
                click: () => copy(text),
            }}
            className={className}
        ></IconButton>
    );
};

export { CopyButton };
