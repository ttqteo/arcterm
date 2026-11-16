// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { releaseWebGlCanvases, type WebGlCanvasLike } from "./webglrelease";

function glCanvas(loseContext = vi.fn()): WebGlCanvasLike & { loseContext: typeof loseContext } {
    return {
        loseContext,
        getContext: () => ({ getExtension: () => ({ loseContext }) }),
    };
}

const canvas2d: WebGlCanvasLike = { getContext: () => null };

describe("releaseWebGlCanvases", () => {
    it("loses the context of each WebGL canvas", () => {
        const a = glCanvas();
        const b = glCanvas();
        expect(releaseWebGlCanvases([a, b])).toBe(2);
        expect(a.loseContext).toHaveBeenCalledTimes(1);
        expect(b.loseContext).toHaveBeenCalledTimes(1);
    });

    it("leaves a 2D canvas alone", () => {
        const gl = glCanvas();
        expect(releaseWebGlCanvases([canvas2d, gl])).toBe(1);
    });

    it("skips a context without the lose extension", () => {
        const bare: WebGlCanvasLike = { getContext: () => ({ getExtension: () => null }) };
        expect(releaseWebGlCanvases([bare])).toBe(0);
    });

    it("carries on past a canvas that throws", () => {
        const bad: WebGlCanvasLike = {
            getContext: () => {
                throw new Error("taken");
            },
        };
        const gl = glCanvas();
        expect(releaseWebGlCanvases([bad, gl])).toBe(1);
        expect(gl.loseContext).toHaveBeenCalled();
    });
});
