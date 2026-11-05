// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Quick translate (docs/superpowers/specs/2026-10-29-rail-translate-design.md): what the panel decides without React or
// an RPC. The language list, the remembered pair, swap, the request a text makes, which reply is still wanted, the word
// row under the input, the history and its stars, and the words of a failure. Pure: translatestore.ts owns the state and
// the timers, and wavesrv's Translate command (pkg/translate) answers.

export type Pair = { source: string; target: string };

// field for field the Translate command's answer (CommandTranslateRtnData), so an RPC reply passes straight in
export type TranslateResult = {
    translation: string;
    source: string; // the language the engine read the text as; with source "auto" it is the one it detected
    phonetics?: string;
    classes?: { pos: string; words: string[] }[];
};

export type TranslateRequest = { source: string; target: string; text: string };

export type SwapState = { pair: Pair; input: string; result: TranslateResult | null };

// "Detect language": Google's sl=auto. Offered on the source select only, so it is not in LANGUAGES.
export const DETECT = "auto";

// the codes Google Translate takes (iw and jw are the codes it answers detection with for Hebrew and Javanese)
const GOOGLE_LANGUAGES: { code: string; name: string }[] = [
    { code: "af", name: "Afrikaans" },
    { code: "sq", name: "Albanian" },
    { code: "am", name: "Amharic" },
    { code: "ar", name: "Arabic" },
    { code: "hy", name: "Armenian" },
    { code: "az", name: "Azerbaijani" },
    { code: "eu", name: "Basque" },
    { code: "be", name: "Belarusian" },
    { code: "bn", name: "Bengali" },
    { code: "bs", name: "Bosnian" },
    { code: "bg", name: "Bulgarian" },
    { code: "ca", name: "Catalan" },
    { code: "ceb", name: "Cebuano" },
    { code: "ny", name: "Chichewa" },
    { code: "zh-CN", name: "Chinese (Simplified)" },
    { code: "zh-TW", name: "Chinese (Traditional)" },
    { code: "co", name: "Corsican" },
    { code: "hr", name: "Croatian" },
    { code: "cs", name: "Czech" },
    { code: "da", name: "Danish" },
    { code: "nl", name: "Dutch" },
    { code: "en", name: "English" },
    { code: "eo", name: "Esperanto" },
    { code: "et", name: "Estonian" },
    { code: "tl", name: "Filipino" },
    { code: "fi", name: "Finnish" },
    { code: "fr", name: "French" },
    { code: "fy", name: "Frisian" },
    { code: "gl", name: "Galician" },
    { code: "ka", name: "Georgian" },
    { code: "de", name: "German" },
    { code: "el", name: "Greek" },
    { code: "gu", name: "Gujarati" },
    { code: "ht", name: "Haitian Creole" },
    { code: "ha", name: "Hausa" },
    { code: "haw", name: "Hawaiian" },
    { code: "iw", name: "Hebrew" },
    { code: "hi", name: "Hindi" },
    { code: "hmn", name: "Hmong" },
    { code: "hu", name: "Hungarian" },
    { code: "is", name: "Icelandic" },
    { code: "ig", name: "Igbo" },
    { code: "id", name: "Indonesian" },
    { code: "ga", name: "Irish" },
    { code: "it", name: "Italian" },
    { code: "ja", name: "Japanese" },
    { code: "jw", name: "Javanese" },
    { code: "kn", name: "Kannada" },
    { code: "kk", name: "Kazakh" },
    { code: "km", name: "Khmer" },
    { code: "rw", name: "Kinyarwanda" },
    { code: "ko", name: "Korean" },
    { code: "ku", name: "Kurdish (Kurmanji)" },
    { code: "ky", name: "Kyrgyz" },
    { code: "lo", name: "Lao" },
    { code: "la", name: "Latin" },
    { code: "lv", name: "Latvian" },
    { code: "lt", name: "Lithuanian" },
    { code: "lb", name: "Luxembourgish" },
    { code: "mk", name: "Macedonian" },
    { code: "mg", name: "Malagasy" },
    { code: "ms", name: "Malay" },
    { code: "ml", name: "Malayalam" },
    { code: "mt", name: "Maltese" },
    { code: "mi", name: "Maori" },
    { code: "mr", name: "Marathi" },
    { code: "mn", name: "Mongolian" },
    { code: "my", name: "Myanmar (Burmese)" },
    { code: "ne", name: "Nepali" },
    { code: "no", name: "Norwegian" },
    { code: "or", name: "Odia" },
    { code: "ps", name: "Pashto" },
    { code: "fa", name: "Persian" },
    { code: "pl", name: "Polish" },
    { code: "pt", name: "Portuguese" },
    { code: "pa", name: "Punjabi" },
    { code: "ro", name: "Romanian" },
    { code: "ru", name: "Russian" },
    { code: "sm", name: "Samoan" },
    { code: "gd", name: "Scots Gaelic" },
    { code: "sr", name: "Serbian" },
    { code: "st", name: "Sesotho" },
    { code: "sn", name: "Shona" },
    { code: "sd", name: "Sindhi" },
    { code: "si", name: "Sinhala" },
    { code: "sk", name: "Slovak" },
    { code: "sl", name: "Slovenian" },
    { code: "so", name: "Somali" },
    { code: "es", name: "Spanish" },
    { code: "su", name: "Sundanese" },
    { code: "sw", name: "Swahili" },
    { code: "sv", name: "Swedish" },
    { code: "tg", name: "Tajik" },
    { code: "ta", name: "Tamil" },
    { code: "tt", name: "Tatar" },
    { code: "te", name: "Telugu" },
    { code: "th", name: "Thai" },
    { code: "tr", name: "Turkish" },
    { code: "tk", name: "Turkmen" },
    { code: "uk", name: "Ukrainian" },
    { code: "ur", name: "Urdu" },
    { code: "ug", name: "Uyghur" },
    { code: "uz", name: "Uzbek" },
    { code: "vi", name: "Vietnamese" },
    { code: "cy", name: "Welsh" },
    { code: "xh", name: "Xhosa" },
    { code: "yi", name: "Yiddish" },
    { code: "yo", name: "Yoruba" },
    { code: "zu", name: "Zulu" },
];

/** Google's codes with their English names, sorted by name: the options of both selects (the source adds DETECT). */
export const LANGUAGES: { code: string; name: string }[] = [...GOOGLE_LANGUAGES].sort((a, b) =>
    a.name.localeCompare(b.name)
);

export const DEFAULT_PAIR: Pair = { source: "en", target: "vi" };

// the localStorage key of the last pair chosen (a per-viewer convenience, like apps.rail)
export const PAIR_KEY = "translate.pair";

// how long after the last keystroke the text is sent
export const TRANSLATE_DEBOUNCE_MS = 400;

// how long a request may take: Google's 10 s, then Apple Translation's 15 s and MyMemory's 8 s when Google could not
// answer (pkg/translate/engine.go); with no timeout wavesrv gives the call 5 s, which a cold Apple start outlasts
export const TRANSLATE_TIMEOUT_MS = 35_000;

// Google's limit; text over it is still sent, and wavesrv's refusal is the panel's error line
export const MAX_CHARS = 5000;

function isLanguage(code: string): boolean {
    return LANGUAGES.some((l) => l.code === code);
}

/** The English name for a code: "Detect language" for DETECT, the code itself when the list does not hold it. */
export function langName(code: string): string {
    if (code === DETECT) {
        return "Detect language";
    }
    return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** The pair out of localStorage; anything missing, malformed or naming a code the list does not hold reads as the
 *  default. The target is never DETECT. */
export function parsePair(raw: string | null): Pair {
    if (raw) {
        try {
            const v = JSON.parse(raw);
            if (
                v != null &&
                typeof v.source === "string" &&
                typeof v.target === "string" &&
                (v.source === DETECT || isLanguage(v.source)) &&
                isLanguage(v.target)
            ) {
                return { source: v.source, target: v.target };
            }
        } catch {
            // falls through to the default
        }
    }
    return { ...DEFAULT_PAIR };
}

/** What the ⇄ button does, as Google Translate's does: the pair flips and the translation, when there is one, becomes
 *  the input (the panel then translates it back), so the result is cleared. From DETECT the detected language becomes
 *  the target; when none has been detected (or the lists do not hold it) the state comes back as it was. */
export function swap(s: SwapState): SwapState {
    const translation = s.result?.translation ?? "";
    const input = translation !== "" ? translation : s.input;
    if (s.pair.source !== DETECT) {
        return { pair: { source: s.pair.target, target: s.pair.source }, input, result: null };
    }
    const detected = s.result?.source ?? "";
    if (!isLanguage(detected)) {
        return s;
    }
    return { pair: { source: s.pair.target, target: detected }, input, result: null };
}

/** The request a text makes: null for blank text, else the pair and the text as typed. */
export function requestFor(text: string, pair: Pair): TranslateRequest | null {
    if (text.trim() === "") {
        return null;
    }
    return { source: pair.source, target: pair.target, text };
}

/** Whether a reply is still wanted: the store bumps `latest` for every request, every clear and every blank input, so
 *  a reply for any other number is dropped. */
export function isCurrent(seq: number, latest: number): boolean {
    return seq === latest;
}

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The row under the input for a single word: the word, its phonetic, and each word class (`compaction · kəmˈpakSHən ·
 *  Noun`). Null for more than one word, or when the engine returned no phonetic or class. */
export function wordDetails(input: string, result: TranslateResult | null): string[] | null {
    const word = input.trim();
    if (word === "" || /\s/.test(word) || result == null) {
        return null;
    }
    const details: string[] = [];
    if (result.phonetics) {
        details.push(result.phonetics);
    }
    for (const c of result.classes ?? []) {
        if (c.pos) {
            details.push(capitalise(c.pos));
        }
    }
    return details.length > 0 ? [word, ...details] : null;
}

// ---- history ----

/** One translation kept in the history: the text as sent (trimmed), its translation, the pair it went through (with
 *  Detect language, the language detected, when the list holds it) and whether it is starred to learn. `at` is when it
 *  was last translated. */
export type HistoryEntry = {
    text: string;
    translation: string;
    source: string;
    target: string;
    starred: boolean;
    at: number;
};

// the localStorage key of the history (a per-viewer convenience, like the pair)
export const HISTORY_KEY = "translate.history";

// how many unstarred entries the history keeps; a starred one is kept until it is unstarred or removed
export const HISTORY_MAX = 50;

// How long an answer stands, with no edit, before it goes into the history: a pause mid-word ("compa…") gets an answer
// too, and the next keystroke within this time drops it. Closing the panel, ×, ⇄ or a new pair records it at once.
export const HISTORY_SETTLE_MS = 1500;

/** What identifies an entry: the same text through the same pair is one entry, moved to the top when translated again. */
export function entryKey(e: Pick<HistoryEntry, "text" | "source" | "target">): string {
    return `${e.source}\u0000${e.target}\u0000${e.text}`;
}

/** The entry an answer makes; null for blank text or a blank translation. */
export function historyEntryFor(text: string, pair: Pair, result: TranslateResult, at: number): HistoryEntry | null {
    const t = text.trim();
    const translation = result.translation.trim();
    if (t === "" || translation === "") {
        return null;
    }
    const source = pair.source === DETECT && isLanguage(result.source) ? result.source : pair.source;
    return { text: t, translation, source, target: pair.target, starred: false, at };
}

/** The history out of localStorage, newest first; anything malformed is dropped, and a missing or broken value reads
 *  as empty. */
export function parseHistory(raw: string | null): HistoryEntry[] {
    if (!raw) {
        return [];
    }
    let v: unknown;
    try {
        v = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(v)) {
        return [];
    }
    const out: HistoryEntry[] = [];
    for (const e of v) {
        if (
            e != null &&
            typeof e.text === "string" &&
            e.text !== "" &&
            typeof e.translation === "string" &&
            typeof e.source === "string" &&
            typeof e.target === "string" &&
            typeof e.at === "number"
        ) {
            out.push({
                text: e.text,
                translation: e.translation,
                source: e.source,
                target: e.target,
                starred: e.starred === true,
                at: e.at,
            });
        }
    }
    return out;
}

// keeps every starred entry and the newest HISTORY_MAX unstarred ones, in order
function capHistory(history: HistoryEntry[]): HistoryEntry[] {
    let unstarred = 0;
    return history.filter((e) => e.starred || ++unstarred <= HISTORY_MAX);
}

/** The history with an entry recorded at the top. The same text through the same pair replaces its old entry and
 *  keeps its star. */
export function recordEntry(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
    const key = entryKey(entry);
    const old = history.find((e) => entryKey(e) === key);
    const rest = history.filter((e) => e !== old);
    return capHistory([{ ...entry, starred: entry.starred || (old?.starred ?? false) }, ...rest]);
}

/** The history with one entry's star flipped; unstarring an old entry may drop it past HISTORY_MAX. */
export function toggleStar(history: HistoryEntry[], key: string): HistoryEntry[] {
    return capHistory(history.map((e) => (entryKey(e) === key ? { ...e, starred: !e.starred } : e)));
}

/** The history without one entry. */
export function removeEntry(history: HistoryEntry[], key: string): HistoryEntry[] {
    return history.filter((e) => entryKey(e) !== key);
}

/** The history list's two views: every entry, or the starred ones. */
export type HistoryFilter = "all" | "starred";

export function historyView(history: HistoryEntry[], filter: HistoryFilter): HistoryEntry[] {
    return filter === "starred" ? history.filter((e) => e.starred) : history;
}

/** The pair a row names, when it is not the pair chosen now (`English → Japanese`); null when it is. */
export function rowPairLabel(entry: HistoryEntry, pair: Pair): string | null {
    if (entry.source === pair.source && entry.target === pair.target) {
        return null;
    }
    // a Detect language row from the detected language reads as the same pair
    if (pair.source === DETECT && entry.target === pair.target) {
        return null;
    }
    return `${langName(entry.source)} → ${langName(entry.target)}`;
}

// ---- reading aloud ----

// Google's codes that BCP 47 spells differently (the speech voices use BCP 47)
const SPEECH_LANG: Record<string, string> = { iw: "he", jw: "jv", tl: "fil", no: "nb" };

/** The BCP 47 tag a text in a Google language is read in; null for DETECT or no language. */
export function speechLang(code: string): string | null {
    if (code === "" || code === DETECT) {
        return null;
    }
    return SPEECH_LANG[code] ?? code;
}

/** The Google language a side of the panel is read in: the input in the source (the detected one under Detect
 *  language), the translation in the target. Null while Detect language has detected nothing. */
export function speechCodeFor(side: "input" | "output", pair: Pair, result: TranslateResult | null): string | null {
    const code = side === "output" ? pair.target : pair.source === DETECT ? (result?.source ?? "") : pair.source;
    return speechLang(code) == null ? null : code;
}

// the fields of SpeechSynthesisVoice the choice reads
export type VoiceLike = { lang: string; name: string; default?: boolean; localService?: boolean };

function normTag(tag: string): string {
    return tag.replace(/_/g, "-").toLowerCase();
}

/** The voice a language is read with: one for the exact tag (zh-CN) before one for its base language (zh), and among
 *  those the system's default, then an on-device one. Null when the system has none for it. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
    const want = normTag(lang);
    const base = want.split("-")[0];
    const rank = (v: V): number => {
        const tag = normTag(v.lang);
        const match = tag === want ? 0 : tag.split("-")[0] === base ? 1 : -1;
        if (match < 0) {
            return -1;
        }
        return match * 4 + (v.default ? 0 : 2) + (v.localService ? 0 : 1);
    };
    let best: V | null = null;
    let bestRank = Infinity;
    for (const v of voices) {
        const r = rank(v);
        if (r >= 0 && r < bestRank) {
            best = v;
            bestRank = r;
        }
    }
    return best;
}

// ---- the paste suggestion ----

// The longest copied text the panel offers to paste: a word, a phrase or a sentence or two, not a document or a log.
export const SUGGEST_MAX_CHARS = 300;
export const SUGGEST_MAX_LINES = 3;

// command-line tools whose name is no everyday English word, so a copy starting with one is a command, not a phrase
const COMMANDS = new Set([
    "git",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "cd",
    "ls",
    "sudo",
    "brew",
    "cargo",
    "wsh",
    "pip",
    "python3",
    "docker",
    "kubectl",
    "curl",
    "ssh",
    "rm",
    "mkdir",
    "grep",
]);

// a link or an address in a token: a scheme (https://, file:, mailto:), www., or an email address
const LINK = /^[a-z][a-z0-9+.-]*:\/\/|^(mailto|file|data|tel):|^www\.|^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
// a path in a token: from the root, home or here, a drive letter, or a backslash
const PATH = /^(\/|~\/|\.{1,2}\/|[a-z]:[\\/])|\\/i;
// code anywhere in the text: braces, angle brackets, backticks, arrows, comparisons, shell substitutions, a line ending in ;
const CODE = /[{}<>`]|=>|==|&&|\|\||\$\(|::|\(\)|;\s*$/m;

/** Whether a copied text reads as words to translate, not a link, a path, a file name, a command, code, an identifier
 *  or a number. */
export function looksTranslatable(raw: string): boolean {
    const text = raw.trim();
    if (text === "" || text.length > SUGGEST_MAX_CHARS || text.split(/\r?\n/).length > SUGGEST_MAX_LINES) {
        return false;
    }
    // mostly letters: a price, a phone number, a version or a hash with a letter or two is not words
    const solid = text.replace(/\s/g, "");
    const letters = solid.match(/\p{L}/gu)?.length ?? 0;
    if (letters === 0 || letters / solid.length < 0.5) {
        return false;
    }
    // code, or a command after a shell prompt
    if (CODE.test(text) || /^[$%] /.test(text)) {
        return false;
    }
    const tokens = text.split(/\s+/);
    // a link, a path or a flag (-v, --help) anywhere
    if (tokens.some((t) => LINK.test(t) || PATH.test(t) || /^--?\p{L}/u.test(t))) {
        return false;
    }
    if (tokens.length > 1) {
        return !COMMANDS.has(tokens[0].toLowerCase());
    }
    // one token: not a file name (photo.png), a path (src/app), an identifier (snake_case, camelCase) or letters mixed
    // with digits (a hash, an id, a version)
    const word = tokens[0];
    return !(
        /^[\p{L}\p{N}_-]+(\.[\p{L}\p{N}_-]+)*\.[a-z0-9]{1,5}$/iu.test(word) ||
        word.includes("/") ||
        word.includes("_") ||
        /\p{Ll}\p{Lu}/u.test(word) ||
        (/\p{N}/u.test(word) && /\p{L}/u.test(word))
    );
}

/** The copied text the panel offers to paste, trimmed; null when there is none: nothing copied, not words to translate,
 *  or what the box already holds, or the translation the panel just made (its copy button put it there). */
export function pasteSuggestion(clip: string | null, input: string, translation: string): string | null {
    const text = clip?.trim() ?? "";
    if (!looksTranslatable(text) || text === input.trim() || text === translation.trim()) {
        return null;
    }
    return text;
}

/** The one line under the input when a translation failed. */
export function translateErrorLine(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw
        .replace(/^Error: /, "")
        .replace(/\.$/, "")
        .replace(/\s*\n\s*/g, " ")
        .trim();
    const what = message === "" ? "Couldn't translate" : `Couldn't translate: ${message}`;
    // after a 429 wavesrv leaves Google alone until the time it names, so an edit before then does not try Google again
    if (/\bagain after \d{1,2}:\d{2}\b/.test(message)) {
        return `${what}. Your text stays here.`;
    }
    return `${what}. Your text stays here, and your next edit tries again.`;
}
