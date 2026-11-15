// The frame sampler every surfaces-spring-* scenario times a motion with (docs/superpowers/specs/2026-11-14-surfaces-chat-look-design.md,
// Verification): a spring is judged by where an element is on the frames between two states, not by its two ends.
//
//   await h.ev(startSampler('[data-agent-card]'));      // records every animation frame for 900 ms, from now
//   ...trigger the change, in the page or from the step...
//   const samples = await h.ev(readSampler());
//   between(samples, "top")     // slid: some frame is strictly between where it started and where it ended
//   atOnce(samples, "height")   // showed at once: it changed in one frame and stayed
//   singleCopy(samples)         // never two matches in one frame: one card, no ghost beside it
//
// startSampler(selector, { ms }) and readSampler() are page expressions for h.ev (attach.mjs), which awaits a promise:
// readSampler's resolves when the window is over. A sample is { t, n, rect }: t the milliseconds since the sampler started, n how many
// elements match the selector, rect the first match's top, left, width and height from getBoundingClientRect(), or null
// when nothing matches. The first sample is taken at once, before the change, so start the sampler first.
//
// The three verdicts are pure functions of the samples and read one rect key. They compare values exactly: the browser lays
// out in fixed-point units, so a box that has stopped moving reports the same number on every frame.

export function startSampler(selector, { ms = 900 } = {}) {
    return `(() => {
    const samples = [];
    const t0 = performance.now();
    window.__arcSpringProbe = new Promise((resolve) => {
        const tick = () => {
            const t = performance.now() - t0;
            const found = document.querySelectorAll(${JSON.stringify(selector)});
            const box = found.length ? found[0].getBoundingClientRect() : null;
            samples.push({
                t,
                n: found.length,
                rect: box ? { top: box.top, left: box.left, width: box.width, height: box.height } : null,
            });
            if (t < ${Number(ms)}) requestAnimationFrame(tick);
            else resolve(samples);
        };
        tick();
    });
    return true;
})()`;
}

export function readSampler() {
    return `(() => window.__arcSpringProbe ?? Promise.reject(new Error("readSampler: startSampler was not run first")))()`;
}

// the key's value on every sample; undefined where no element matched
const values = (samples, key) => samples.map((s) => s.rect?.[key]);

// true when some sample's value lies strictly between the first sample's and the last's: the element passed through the
// space between, so it moved there rather than jumped. False when the first or the last has no element, or they are equal.
export function between(samples, key) {
    const v = values(samples, key);
    const first = v[0];
    const last = v[v.length - 1];
    if (first === undefined || last === undefined) return false;
    const lo = Math.min(first, last);
    const hi = Math.max(first, last);
    return v.some((x) => x !== undefined && x > lo && x < hi);
}

// true when the value changes in one frame and stays: from the first sample that differs from the first one, every later
// sample equals the last. False when it never changed (nothing landed) or there are no samples.
export function atOnce(samples, key) {
    const v = values(samples, key);
    if (v.length === 0) return false;
    const first = v[0];
    const last = v[v.length - 1];
    const changed = v.findIndex((x) => x !== first);
    if (changed === -1) return false;
    return v.slice(changed).every((x) => x === last);
}

// true when no sample saw more than one match: one element at every frame, never the old and the new side by side
export function singleCopy(samples) {
    return samples.every((s) => s.n <= 1);
}
