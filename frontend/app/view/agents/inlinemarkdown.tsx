// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openLink } from "@/app/store/global";
import { type Components } from "react-markdown";
import { PLAIN_LINK_COMPONENTS, PlainInlineMarkdown } from "./plaininlinemarkdown";

export { condenseToLine } from "./plaininlinemarkdown";

const INLINE_COMPONENTS: Components = {
    ...PLAIN_LINK_COMPONENTS,
    a: ({ href, children }) => (
        <a
            href={href}
            onClick={(e) => {
                e.preventDefault();
                openLink(href);
            }}
            className="cursor-pointer text-accent hover:underline"
        >
            {children}
        </a>
    ),
};

export function InlineMarkdown({ text, plainLinks = false }: { text: string; plainLinks?: boolean }) {
    return <PlainInlineMarkdown text={text} components={plainLinks ? PLAIN_LINK_COMPONENTS : INLINE_COMPONENTS} />;
}
