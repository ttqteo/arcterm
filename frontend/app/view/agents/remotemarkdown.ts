// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Entry of the phone page's markdown bundle (pkg/remotemode/web/static/markdown.js, built by
// scripts/sync-remote-web.mjs): the parser under the cockpit's react-markdown + remark-gfm, without
// React, so a handed-over agent's reply parses on the phone as it does at the desk. It returns the
// mdast tree; the phone page draws it node by node, never as HTML.

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function parseMarkdown(text: string) {
    return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}
