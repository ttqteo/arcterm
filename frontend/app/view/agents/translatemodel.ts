// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// Quick translate (docs/superpowers/specs/2026-10-29-rail-translate-design.md): what the panel decides without React or
// an RPC. The language list, the remembered pair, swap, the request a text makes, which reply is still wanted, the word
// row under the input and the words of a failure. Pure: translatestore.ts owns the state and the debounce timer, and
// wavesrv's Translate command (pkg/translate) answers.

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

/** The one line under the input when a translation failed. */
export function translateErrorLine(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw
        .replace(/^Error: /, "")
        .replace(/\.$/, "")
        .replace(/\s*\n\s*/g, " ")
        .trim();
    const what = message === "" ? "Couldn't translate" : `Couldn't translate: ${message}`;
    return `${what}. Your text stays here, and your next edit tries again.`;
}
