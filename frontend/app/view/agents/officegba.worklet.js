// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The office's music file as a GBA plays it (officeaudio.ts): each channel is sampled at the GBA's mixing rate, held
// between samples and rounded to 8 bits. Nothing smooths it after: the highs the hold folds down are the crunch. Plain
// JS, loaded by URL: an AudioWorklet module runs in its own scope (sampleRate, registerProcessor).

/* global AudioWorkletProcessor, registerProcessor, sampleRate */

class OfficeGba extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const { rate, bits } = options.processorOptions;
        this.step = rate / sampleRate;
        this.levels = 2 ** (bits - 1);
        this.phase = 1;
        this.held = [];
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        let phase = this.phase;
        for (let c = 0; c < output.length; c++) {
            const inp = input[c] ?? input[0];
            const out = output[c];
            if (!inp) {
                out.fill(0);
                continue;
            }
            let held = this.held[c] ?? 0;
            phase = this.phase;
            for (let i = 0; i < out.length; i++) {
                phase += this.step;
                if (phase >= 1) {
                    phase -= 1;
                    held = Math.round(inp[i] * this.levels) / this.levels;
                }
                out[i] = held;
            }
            this.held[c] = held;
        }
        this.phase = phase;
        return true;
    }
}

registerProcessor("office-gba", OfficeGba);
