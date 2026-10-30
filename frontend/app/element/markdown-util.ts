// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import parseSrcSet from "parse-srcset";
import { BlobCache } from "./markdown-imagecache";

export type MarkdownContentBlockType = {
    type: string;
    id: string;
    content: string;
    opts?: Record<string, any>;
};

const idMatchRe = /^("(?:[^"\\]|\\.)*")/;

function formatInlineContentBlock(block: MarkdownContentBlockType): string {
    return `!!!${block.type}[${block.id}]!!!`;
}

function parseOptions(str: string): Record<string, any> {
    const trimmed = str.trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);
        // Ensure it's an object (not array or primitive)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function makeMarkdownWaveBlockKey(block: MarkdownContentBlockType): string {
    return `${block.type}[${block.id}]`;
}

export function transformBlocks(content: string): { content: string; blocks: Map<string, MarkdownContentBlockType> } {
    const lines = content.split("\n");
    const blocks = new Map();
    let currentBlock = null;
    let currentContent = [];
    let processedLines = [];

    for (const line of lines) {
        // Check for start marker
        if (line.startsWith("@@@start ")) {
            // Already in a block? Add as content
            if (currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the start line
            const [, type, rest] = line.slice(9).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                // Invalid format - treat as regular content
                processedLines.push(line);
                continue;
            }

            // Get the ID (everything between first set of quotes)
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                processedLines.push(line);
                continue;
            }

            // Parse options if any exist after the ID
            const afterId = rest.slice(idMatch[0].length).trim();
            const opts = parseOptions(afterId);

            currentBlock = {
                type,
                id: idMatch[1],
                opts,
            };
            continue;
        }

        // Check for end marker
        if (line.startsWith("@@@end ")) {
            // If we're not in a block, treat as content
            if (!currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the end line
            const [, type, rest] = line.slice(7).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                currentContent.push(line);
                continue;
            }

            // Get the ID
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                currentContent.push(line);
                continue;
            }

            const endId = idMatch[1];

            // If this doesn't match our current block, treat as content
            if (type !== currentBlock.type || endId !== currentBlock.id) {
                currentContent.push(line);
                continue;
            }

            // Found matching end - store block and add placeholder
            const key = makeMarkdownWaveBlockKey(currentBlock);
            blocks.set(key, {
                type: currentBlock.type,
                id: currentBlock.id,
                opts: currentBlock.opts,
                content: currentContent.join("\n"),
            });

            processedLines.push(formatInlineContentBlock(currentBlock));
            currentBlock = null;
            currentContent = [];
            continue;
        }

        // Regular line - add to current block or processed lines
        if (currentBlock) {
            currentContent.push(line);
        } else {
            processedLines.push(line);
        }
    }

    // Handle unclosed block - add what we have so far
    if (currentBlock) {
        const key = makeMarkdownWaveBlockKey(currentBlock);
        blocks.set(key, {
            type: currentBlock.type,
            id: currentBlock.id,
            opts: currentBlock.opts,
            content: currentContent.join("\n"),
        });
        processedLines.push(formatInlineContentBlock(currentBlock));
    }

    return {
        content: processedLines.join("\n"),
        blocks: blocks,
    };
}

// about the figures of a long report; past it the least recently drawn are read again when next drawn
const LOCAL_IMAGE_BUDGET = 32 * 1024 * 1024;
// long enough for an <img> still loading a dropped URL to finish with it
const RETIRE_MS = 30_000;
const localImages = new BlobCache(LOCAL_IMAGE_BUDGET, (url) => setTimeout(() => URL.revokeObjectURL(url), RETIRE_MS));
// one read per file and stamp, however many <img>s ask for it at once
const reading = new Map<string, Promise<string | null>>();

const isWebSrc = (src: string) => src.startsWith("http://") || src.startsWith("https://");
const localImageKey = (filepath: string, resolveOpts: MarkdownResolveOpts) =>
    `${resolveOpts.connName ?? ""}|${resolveOpts.baseDir}|${filepath}`;

// the blob: URL a local image was last drawn from, for the first render of a remounted <img>; resolveRemoteFile then
// checks the file again
export function cachedLocalImage(filepath: string, resolveOpts: MarkdownResolveOpts): string | null {
    if (!filepath || resolveOpts == null || isWebSrc(filepath) || filepath.startsWith("data:")) {
        return null;
    }
    return localImages.get(localImageKey(filepath, resolveOpts))?.url ?? null;
}

// A web image's URL as it is. A local one is read through wavesrv into a blob: URL, as ImageFrame's are (useBlobSrc):
// the packaged app's CSP keeps an <img> off wavesrv, and /wave/stream-file wants the auth key an <img> can't send.
export const resolveRemoteFile = async (filepath: string, resolveOpts: MarkdownResolveOpts): Promise<string | null> => {
    if (!filepath || isWebSrc(filepath)) {
        return filepath;
    }
    try {
        const baseDirUri = formatRemoteUri(resolveOpts.baseDir, resolveOpts.connName);
        const fileInfo = await RpcApi.FileJoinCommand(TabRpcClient, [baseDirUri, filepath]);
        if (fileInfo == null || fileInfo.notfound || fileInfo.isdir) {
            return null;
        }
        const key = localImageKey(filepath, resolveOpts);
        const modtime = fileInfo.modtime ?? 0;
        const stamp = `${fileInfo.size ?? 0}:${modtime}`;
        const hit = localImages.get(key, stamp);
        if (hit != null) {
            return hit.url;
        }
        const id = `${key}|${stamp}`;
        let read = reading.get(id);
        if (read == null) {
            const usp = new URLSearchParams();
            usp.set("path", formatRemoteUri(fileInfo.path, resolveOpts.connName));
            usp.set("authkey", getApi().getAuthKey());
            usp.set("v", String(modtime)); // the route allows caching: a rewritten file is another URL
            read = readBlob(getWebServerEndpoint() + "/wave/stream-file?" + usp.toString(), key, stamp).finally(() =>
                reading.delete(id)
            );
            reading.set(id, read);
        }
        return await read;
    } catch (err) {
        console.warn("Failed to resolve remote file:", filepath, err);
        return null;
    }
};

async function readBlob(url: string, key: string, stamp: string): Promise<string | null> {
    const resp = await fetch(url);
    if (!resp.ok) {
        return null;
    }
    const blob = await resp.blob();
    const src = URL.createObjectURL(blob);
    localImages.put(key, { stamp, url: src, bytes: blob.size });
    return src;
}

export const resolveSrcSet = async (srcSet: string, resolveOpts: MarkdownResolveOpts): Promise<string> => {
    if (!srcSet) return null;

    // Parse the srcset
    const candidates = parseSrcSet(srcSet);

    // Resolve each URL in the array of candidates
    const resolvedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
            const resolvedUrl = await resolveRemoteFile(candidate.url, resolveOpts);
            return {
                ...candidate,
                url: resolvedUrl,
            };
        })
    );

    // Reconstruct the srcset string
    return resolvedCandidates
        .map((candidate) => {
            let part = candidate.url;
            if (candidate.w) part += ` ${candidate.w}w`;
            if (candidate.h) part += ` ${candidate.h}h`;
            if (candidate.d) part += ` ${candidate.d}x`;
            return part;
        })
        .join(", ");
};
