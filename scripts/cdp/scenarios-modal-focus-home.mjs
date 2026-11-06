// modal-focus-home: a palette pick from the Agent surface to the Cockpit leaves keyboard focus on the Cockpit's focus home
// (the container marked data-focus-home), so j/k/Enter work with no click first (ported from the fork's commit
// 172fc5360; before it, focus fell to <body> and the Cockpit's j/k, which are its own container's onKeyDown, were dead).
// Two postures the palette opens from, each picking Cockpit and pressing j:
//   - nothing focused (<body>): the palette's close handed focus "back" to <body>, which ignores focus(), so focus stayed in
//     the palette's search box through its exit animation; the Cockpit mounted meanwhile, saw a visible field holding
//     focus (focusClaimed) and left its own mount-time claim, and focus fell to <body> when the palette unmounted. The
//     close now moves on to the Agent surface's fallback (none once the Cockpit shows) and then the data-focus-home element.
//   - the Agent surface's wrapper focused (it hides under display:none as an agent's xterm does): the close blurs the
//     panel and the Cockpit's own claim takes focus. This worked before; it is here so it keeps working.
// Three fixture cards (a roster with no tab), so j has a next card to move to. No terminal runs.
// kit is scenarios.mjs's RT_KIT; this scenario takes polishWaitFor from it and imports nothing from scenarios.mjs.

import { agentPage, restoreRoster, setRoster } from "./agent-page-fixtures.mjs";

const NAME = "modal-focus-home";
const PROJECT = "fx-focus-home";
const AGENTS = ["focus home alpha", "focus home beta", "focus home gamma"];
const PALETTE_INPUT = `document.querySelector('input[data-palette-input]')`;
const PALETTE_QUERY = "Cockpit (home)";
const WAIT_MS = 8_000;

const roster = () =>
    AGENTS.map((name, i) => ({
        id: `fx-focus-home-${i}`,
        name,
        project: PROJECT,
        task: "",
        state: "working",
        // a working agent with no activity line is an empty card, which the Cockpit leaves off its grid
        activity: `reading file ${i + 1}`,
        agent: "claude",
        model: "opus",
        activeMs: 60_000 * (i + 1),
    }));

// where focus is: <body>, the Cockpit's focus home, the Agent surface's wrapper, the palette's input or something else
const focusNow = `(() => {
    const a = document.activeElement;
    return {
        at: a == null ? "none" : a === document.body ? "body" : a.hasAttribute("data-focus-home") ? "focus-home"
            : a.hasAttribute("data-cockpit-surface-wrap") ? "agent-wrap"
            : a.matches("input[data-palette-input]") ? "palette-input" : a.tagName.toLowerCase(),
        cockpit: document.querySelector("[data-cockpit-surface]") != null,
        palette: document.querySelector("input[data-palette-input]") != null,
    };
})()`;

// where focus is put before the palette opens
const POSTURES = {
    body: {
        label: "with nothing focused",
        put: `(() => { document.activeElement instanceof HTMLElement && document.activeElement.blur(); })()`,
        at: "body",
    },
    wrap: {
        label: "from the Agent surface's wrapper",
        put: `document.querySelector("[data-cockpit-surface-wrap]")?.focus()`,
        at: "agent-wrap",
    },
};

// a key sent as the browser does, to whatever has focus; React and the dispatcher read it from there
const press = async (h, key, code, keyCode) => {
    for (const type of ["keyDown", "keyUp"]) {
        await h.cdp("Input.dispatchKeyEvent", {
            type,
            key,
            code,
            windowsVirtualKeyCode: keyCode,
            ...(type === "keyDown" ? { text: key } : {}),
        });
    }
};

export default function (kit) {
    const { polishWaitFor } = kit;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const cursor = (h) => agentPage(h, `return globalStore.get(agentsModel().cursorIdAtom) ?? null;`);

    // One pass: the Agent surface with focus put as `posture` says, the palette opened over it (as Ctrl+P and g p open it),
    // Cockpit picked as a person does (its name typed, Enter on the row the palette highlights), then j.
    async function pass(h, posture, shots) {
        const p = POSTURES[posture];
        await h.goto("agent");
        await agentPage(h, `globalStore.set(agentsModel().cursorIdAtom, undefined); return true;`);
        await h.ev(p.put);
        const before = await h.ev(focusNow);
        await agentPage(h, `globalStore.set(agentsModel().paletteOpenAtom, true); return true;`);
        const opened = await polishWaitFor(h, `!!(${PALETTE_INPUT})`, WAIT_MS);
        await h.shot(shots.palette);
        const open = { posture, before, opened };

        await h.ev(`(() => {
            const input = ${PALETTE_INPUT};
            if (!input) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            setter.call(input, ${JSON.stringify(PALETTE_QUERY)});
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        })()`);
        const rowKey = `(document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute("data-palette-key") ?? null)`;
        const highlighted = await polishWaitFor(h, `${rowKey} === "go:cockpit"`, WAIT_MS);
        const picked = await h.ev(rowKey);
        await h.ev(`(() => {
            const input = ${PALETTE_INPUT};
            if (!input) return false;
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
            return true;
        })()`);
        // the palette outlives the pick through its exit animation; focus lands, or falls to <body>, when it unmounts
        const closed = await polishWaitFor(
            h,
            `!document.querySelector("input[data-palette-input]") && document.querySelector("[data-cockpit-surface]") != null`,
            WAIT_MS
        );
        await sleep(400);
        const after = await h.ev(focusNow);
        await h.shot(shots.cockpit);
        const landed = { highlighted, picked, closed, after };

        // j with no click first: the Cockpit's own onKeyDown takes it, so the cursor moves to the next card
        const cards = await h.ev(`document.querySelectorAll("[data-cockpit-surface] [data-agent-id]").length`);
        const from = await cursor(h);
        await press(h, "j", "KeyJ", 74);
        let moved = null;
        for (let i = 0; i < 40 && moved == null; i++) {
            const now = await cursor(h);
            if (now != null && now !== from) {
                moved = now;
            } else {
                await sleep(100);
            }
        }
        await h.shot(shots.moved);
        return { p, open, landed, key: { cards, from, moved } };
    }

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                try {
                    // cards, not the office: j walks the cards
                    ctx.prevView = await agentPage(
                        h,
                        `const O = await mod("app/view/agents/officestore.ts");
                        const prev = globalStore.get(O.cockpitViewAtom);
                        globalStore.set(O.cockpitViewAtom, "cards");
                        return prev;`
                    );
                    await setRoster(h, roster());
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok, detail });
                if (ctx.arrangeError != null) {
                    rec(`${NAME}: arrange`, false, ctx.arrangeError);
                    return steps;
                }
                // a thrown call (the page went away, a CDP timeout) must not discard the steps recorded so far
                try {
                    const n = { body: 1, wrap: 4 };
                    for (const posture of ["body", "wrap"]) {
                        const r = await pass(h, posture, {
                            palette: `cdp-shots/modal-focus-home-${posture}-1-palette.png`,
                            cockpit: `cdp-shots/modal-focus-home-${posture}-2-cockpit.png`,
                            moved: `cdp-shots/modal-focus-home-${posture}-3-j-moved.png`,
                        });
                        const i = n[posture];
                        rec(
                            `${i}. the palette opens over the Agent surface ${r.p.label}, with no Cockpit mounted`,
                            r.open.before.at === r.p.at && r.open.opened && !r.open.before.cockpit,
                            JSON.stringify(r.open)
                        );
                        rec(
                            `${i + 1}. picking Cockpit ${r.p.label} closes the palette and leaves focus on the Cockpit's focus home, not <body>`,
                            r.landed.highlighted &&
                                r.landed.picked === "go:cockpit" &&
                                r.landed.closed &&
                                r.landed.after.cockpit &&
                                !r.landed.after.palette &&
                                r.landed.after.at === "focus-home",
                            JSON.stringify(r.landed)
                        );
                        rec(
                            `${i + 2}. j then moves the Cockpit's selection to the next card with no click first`,
                            r.key.cards >= AGENTS.length &&
                                r.key.from != null &&
                                r.key.moved != null &&
                                r.key.moved !== r.key.from,
                            JSON.stringify(r.key)
                        );
                    }
                } catch (e) {
                    rec("the scenario ran to its end", false, String(e?.message ?? e));
                }
                return steps;
            },
            // best-effort, so one failed step does not strand the rest
            async teardown(h, ctx) {
                const step = async (what, fn) => {
                    try {
                        await fn();
                    } catch (e) {
                        console.error(`${NAME} teardown: ${what} failed: ${e?.message ?? e}`);
                    }
                };
                await step("close the palette", () =>
                    agentPage(h, `globalStore.set(agentsModel().paletteOpenAtom, false); return true;`)
                );
                await step("restore the roster", () => restoreRoster(h));
                await step("clear the cursor", () =>
                    agentPage(h, `globalStore.set(agentsModel().cursorIdAtom, undefined); return true;`)
                );
                if (ctx.prevView !== undefined) {
                    await step("restore the Cockpit view", () =>
                        agentPage(
                            h,
                            `const O = await mod("app/view/agents/officestore.ts");
                            globalStore.set(O.cockpitViewAtom, ${JSON.stringify(ctx.prevView)});
                            return true;`
                        )
                    );
                }
                await step("go home", () => h.goto("cockpit"));
            },
        },
    ];
}
