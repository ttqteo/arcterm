// agent-account: the Claude account word an agent shows while the open claude agents run on two accounts or more
// (agentaccountbadge.ts, agentaccountstore.ts): [data-chat-account] left of the model under the chat box (chatfooter.tsx)
// and [data-row-account] first on the agent's sidebar row meta line (agenttree.tsx ParentRow).
// The page's claudeIdentityAtom is set to the /login account plus a Work token account (a dev store holds no second
// account), and a mock roster holds two claude agents: A, a real tab whose chat is open, on the /login account (its usage
// names none), and B on Work. Steps: two accounts, both rows and A's footer name their account, the footer's word left of
// the model chip, a long label truncated with its full name in the title; B moved to /login, every word goes; B back on
// Work, they come back. The tree is opened for the run. Teardown puts the identity, the roster, the tree's fold and the
// tab back.

import * as AC from "./agent-page-fixtures.mjs";

const NAME = "agent-account";
const PROJECT = "verify-agent-account";
const LOGIN = "me@verify.test";
const WORK = { id: "awork", label: "Work", email: "work@verify.test" };
const LONG = "a-very-long-account-label-someone-typed-for-the-spare-subscription";
const WAIT_MS = 10_000;

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

export default function (kit) {
    const { makeTab, closeTabs } = AC.tabFixtures({ waveService: kit.waveService });

    async function waitFor(h, expr, ms = WAIT_MS) {
        for (let waited = 0; waited < ms; waited += 150) {
            if (await h.ev(expr).catch(() => false)) return true;
            await nap(150);
        }
        return false;
    }

    const setIdentity = (h, identity) =>
        AC.agentPage(
            h,
            `const R = await mod("app/view/agents/ratelimitstore.ts");
            if (!("__agentAccountPrevIdentity" in window)) window.__agentAccountPrevIdentity = globalStore.get(R.claudeIdentityAtom);
            globalStore.set(R.claudeIdentityAtom, ${JSON.stringify(identity)});
            return true;`
        );

    const roster = (ctx, bAccount) => [
        {
            id: ctx.tab.tabId,
            name: "account A",
            blockId: ctx.tab.blockId,
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "opus 4.8",
            state: "idle",
            usage: { contextpct: 20 },
        },
        {
            id: "fx-account-b",
            name: "account B",
            project: PROJECT,
            task: "",
            agent: "claude",
            model: "sonnet 4.8",
            state: "idle",
            usage: bAccount ? { contextpct: 10, account: bAccount } : { contextpct: 10 },
        },
    ];

    // what the two rows and A's footer draw of the account, with where A's word and model chip sit
    const read = (h, a) =>
        h.ev(`(() => {
            const flat = (el) => (el?.textContent ?? "").replace(/\\s+/g, " ").trim();
            const row = (id) => document.querySelector('[data-agent-row="' + id + '"] [data-row-account]');
            const footer = document.querySelector('[data-agent-chat="${a}"] [data-chat-footer]');
            const word = footer?.querySelector("[data-chat-account]");
            const chip = footer?.firstElementChild?.nextElementSibling ?? null;
            const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) }; };
            const inner = word?.querySelector(".truncate");
            return {
                rowA: row("${a}") ? { text: flat(row("${a}")), title: row("${a}").getAttribute("title") } : null,
                rowB: row("fx-account-b") ? { text: flat(row("fx-account-b")), title: row("fx-account-b").getAttribute("title") } : null,
                footer: !!footer,
                word: word ? { text: flat(word), title: word.getAttribute("title"), box: box(word), clipped: inner ? inner.scrollWidth > inner.clientWidth : false } : null,
                chip: box(chip),
                footerBox: box(footer),
            };
        })()`);

    return [
        {
            name: NAME,
            surface: "agent",
            async arrange(h) {
                const ctx = {};
                try {
                    ctx.tab = await makeTab(h, ctx, { label: "account A" });
                    // the tree drawn open, whatever this store last left it
                    ctx.folded = await AC.agentPage(h, `const B = await mod("app/view/boards/boardsplitstore.ts"); const was = globalStore.get(B.treeFoldedAtom); globalStore.set(B.treeFoldedAtom, false); return was;`);
                    await setIdentity(h, { loginEmail: LOGIN, accounts: [{ id: WORK.id, label: WORK.label, email: WORK.email }] });
                    ctx.identity = true;
                    await AC.setRoster(h, roster(ctx, WORK.id));
                    ctx.roster = true;
                    await AC.agentPage(h, `const M = await mod("app/view/agents/chatmodestore.ts"); M.setChatMode(${JSON.stringify(ctx.tab.tabId)}, "chat"); return true;`);
                    await AC.focusAgent(h, ctx.tab.tabId);
                } catch (e) {
                    ctx.arrangeError = String(e?.message ?? e);
                }
                return ctx;
            },
            async assert(h, ctx) {
                const steps = [];
                const rec = (step, ok, detail) => steps.push({ step, ok: ok === true, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
                if (ctx.arrangeError != null) {
                    rec("0. the fixture tab, the identity and the roster", false, ctx.arrangeError);
                    return steps;
                }
                const A = ctx.tab.tabId;
                const sel = `document.querySelector('[data-agent-chat="${A}"] [data-chat-account]')`;

                // 1. two accounts in play
                const up = await waitFor(h, `!!${sel}`);
                await nap(500);
                let got = await read(h, A);
                await h.shot("cdp-shots/agent-account-1-two.png");
                rec(
                    `1. two accounts: A's row reads "${LOGIN}", B's row "Work", A's footer "${LOGIN}" titled "Claude account: ${LOGIN}", left of the model chip`,
                    up &&
                        got.rowA?.text === LOGIN &&
                        got.rowA?.title === `Claude account: ${LOGIN}` &&
                        got.rowB?.text === "Work" &&
                        got.word?.text === LOGIN &&
                        got.word?.title === `Claude account: ${LOGIN}` &&
                        got.chip != null &&
                        got.word.box.right <= got.chip.left,
                    got
                );

                // 2. a long label: truncated in the footer and on the row, its full name in the title
                await setIdentity(h, { loginEmail: LOGIN, accounts: [{ id: WORK.id, label: LONG, email: WORK.email }] });
                await waitFor(h, `document.querySelector('[data-agent-row="fx-account-b"] [data-row-account]')?.textContent === ${JSON.stringify(LONG)}`);
                await nap(400);
                const rowB = await h.ev(`(() => { const el = document.querySelector('[data-agent-row="fx-account-b"] [data-row-account]'); const row = document.querySelector('[data-agent-row="fx-account-b"]'); if (!el || !row) return null; return { clipped: el.scrollWidth > el.clientWidth, title: el.getAttribute("title"), inside: el.getBoundingClientRect().right <= row.getBoundingClientRect().right }; })()`);
                await h.shot("cdp-shots/agent-account-2-long.png");
                rec(`2. a long label: B's row word is cut with an ellipsis, titled with the whole label, and stays inside its row`, rowB?.clipped === true && rowB?.title === `Claude account: ${LONG}` && rowB?.inside === true, rowB);
                await setIdentity(h, { loginEmail: LOGIN, accounts: [{ id: WORK.id, label: WORK.label, email: WORK.email }] });

                // 3. B moves to the /login account: one account in play, every word goes
                await AC.setRoster(h, roster(ctx, null));
                const gone = await waitFor(h, `!${sel} && !document.querySelector("[data-row-account]")`);
                await nap(500);
                got = await read(h, A);
                await h.shot("cdp-shots/agent-account-3-one.png");
                rec(`3. one account: no [data-chat-account], no [data-row-account], the footer still drawn`, gone && got.footer && got.word == null && got.rowA == null && got.rowB == null, got);

                // 4. B back on Work: the words come back
                await AC.setRoster(h, roster(ctx, WORK.id));
                const back = await waitFor(h, `!!${sel} && document.querySelectorAll("[data-row-account]").length === 2`);
                rec(`4. back to two accounts: the footer word and both row words return`, back, await read(h, A));
                return steps;
            },
            async teardown(h, ctx) {
                if (ctx.identity) {
                    await AC.agentPage(
                        h,
                        `const R = await mod("app/view/agents/ratelimitstore.ts");
                        if ("__agentAccountPrevIdentity" in window) { globalStore.set(R.claudeIdentityAtom, window.__agentAccountPrevIdentity); delete window.__agentAccountPrevIdentity; }
                        return true;`
                    ).catch(() => {});
                }
                if (ctx.roster) await AC.restoreRoster(h).catch(() => {});
                if (ctx.folded === true) {
                    await AC.agentPage(h, `const B = await mod("app/view/boards/boardsplitstore.ts"); globalStore.set(B.treeFoldedAtom, true); return true;`).catch(() => {});
                }
                await closeTabs(h, ctx).catch(() => {});
            },
        },
    ];
}
