// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// The one store behind every session search box (the New agent dialog's Session column, Conversation History): a
// SearchSessions call per settled query, debounced as the person types. An answer for an older query than the latest
// is dropped, so a slow search never overwrites a newer one; an incomplete answer (the backend is still reading
// transcripts) is asked again while its query is unchanged, so results fill in. Nothing is kept past the component.

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useEffect, useRef, useState } from "react";
import { nextAskDelay, type AskState } from "./sessionsearch";
import { findTerms } from "./sessionsfind";

// a search may wait on the backend reading transcripts
const SEARCH_TIMEOUT_MS = 30_000;

export interface SessionSearchScope {
    runtime?: string; // only this agent's sessions (claude or pi; another answers nothing)
    projectPath?: string; // only this project's sessions
}

export interface SessionSearch {
    results: SessionSearchResult[] | null; // null = no answer yet for the current query, or no query
    // what the backend matched; findTerms of the query until it answers, so titles can be filtered at once
    terms: string[];
    incomplete: boolean; // the backend is still indexing: more results may come
    truncated: boolean; // more sessions matched than the answer holds (newest are kept)
    error: string | null;
}

interface Answer {
    key: string; // the query and scope this answers
    search: SessionSearch;
}

function answerKey(query: string, scope: SessionSearchScope): string {
    return JSON.stringify([query, scope.runtime ?? "", scope.projectPath ?? ""]);
}

export function useSessionSearch(query: string, scope: SessionSearchScope): SessionSearch {
    const q = query.trim();
    const { runtime, projectPath } = scope;
    const key = answerKey(q, scope);
    const [answer, setAnswer] = useState<Answer | null>(null);
    const seq = useRef(0);

    useEffect(() => {
        const mine = seq.current;
        const terms = findTerms(q);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const schedule = (state: AskState) => {
            const delay = nextAskDelay(terms, state);
            if (delay != null) {
                timer = setTimeout(ask, delay);
            }
        };
        const ask = async () => {
            try {
                const rtn = await RpcApi.SearchSessionsCommand(
                    TabRpcClient,
                    { query: q, runtime, projectpath: projectPath },
                    { timeout: SEARCH_TIMEOUT_MS }
                );
                if (mine !== seq.current) {
                    return;
                }
                const incomplete = !!rtn.incomplete;
                setAnswer({
                    key,
                    search: {
                        results: rtn.results ?? [],
                        terms: rtn.terms ?? [],
                        incomplete,
                        truncated: !!rtn.truncated,
                        error: null,
                    },
                });
                schedule(incomplete ? "incomplete" : "settled");
            } catch (e) {
                if (mine !== seq.current) {
                    return;
                }
                // kept for the box to show; a failed query is not retried on a timer, typing asks again
                setAnswer({
                    key,
                    search: {
                        results: null,
                        terms,
                        incomplete: false,
                        truncated: false,
                        error: String((e as Error)?.message ?? e),
                    },
                });
            }
        };
        schedule("fresh");
        return () => {
            clearTimeout(timer);
            // an answer still in flight, or one that would schedule another ask, belongs to a query that is gone
            seq.current++;
        };
        // key is these three
    }, [q, runtime, projectPath]);

    if (answer != null && answer.key === key) {
        return answer.search;
    }
    return { results: null, terms: findTerms(q), incomplete: false, truncated: false, error: null };
}
