// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let isJetBrainsMonoLoaded = false;
let isHackFontLoaded = false;
let isHackNerdFontLoaded = false;
let isInterFontLoaded = false;
let isHankenGroteskLoaded = false;
let isFiraCodeLoaded = false;
let isGoogleSansFlexLoaded = false;

function addToFontFaceSet(fontFaceSet: FontFaceSet, fontFace: FontFace) {
    // any cast to work around typing issue
    (fontFaceSet as any).add(fontFace);
}

function loadJetBrainsMonoFont() {
    if (isJetBrainsMonoLoaded) {
        return;
    }
    isJetBrainsMonoLoaded = true;
    // variable font with the full charset (Vietnamese included); the v13 latin files it replaces mapped 222 characters
    const jbmFont = new FontFace("JetBrains Mono", "url('fonts/jetbrains-mono-variable.woff2')", {
        style: "normal",
        weight: "100 800",
    });
    addToFontFaceSet(document.fonts, jbmFont);
    jbmFont.load();
}

// Hack Nerd Font Mono has no Vietnamese letters (ả, ị) but has the combining marks, each a full cell wide: Chromium
// splits a missing letter into its base and mark and draws both in Hack, so "ảnh" drew as "ả nh". Leaving the marks
// (U+0300-036F) out of its range sends the whole letter to the next face in the stack (fonts.ts: JetBrains Mono).
const HACK_RANGE = "U+0000-02FF, U+0370-10FFFF";

function loadHackNerdFont() {
    if (isHackNerdFontLoaded) {
        return;
    }
    isHackFontLoaded = true;
    const hackRegular = new FontFace("Hack", "url('fonts/hacknerdmono-regular.ttf')", {
        style: "normal",
        weight: "400",
        unicodeRange: HACK_RANGE,
    });
    const hackBold = new FontFace("Hack", "url('fonts/hacknerdmono-bold.ttf')", {
        style: "normal",
        weight: "700",
        unicodeRange: HACK_RANGE,
    });
    const hackItalic = new FontFace("Hack", "url('fonts/hacknerdmono-italic.ttf')", {
        style: "italic",
        weight: "400",
        unicodeRange: HACK_RANGE,
    });
    const hackBoldItalic = new FontFace("Hack", "url('fonts/hacknerdmono-bolditalic.ttf')", {
        style: "italic",
        weight: "700",
        unicodeRange: HACK_RANGE,
    });
    addToFontFaceSet(document.fonts, hackRegular);
    addToFontFaceSet(document.fonts, hackBold);
    addToFontFaceSet(document.fonts, hackItalic);
    addToFontFaceSet(document.fonts, hackBoldItalic);
    hackRegular.load();
    hackBold.load();
    hackItalic.load();
    hackBoldItalic.load();
}

function loadInterFont() {
    if (isInterFontLoaded) {
        return;
    }
    isInterFontLoaded = true;
    const interFont = new FontFace("Inter", "url('fonts/inter-variable.woff2')", {
        style: "normal",
        weight: "100 900",
    });
    addToFontFaceSet(document.fonts, interFont);
    interFont.load();
}

function loadHankenGroteskFont() {
    if (isHankenGroteskLoaded) {
        return;
    }
    isHankenGroteskLoaded = true;
    // variable font: a single woff2 covers the whole weight axis (same as Inter)
    const hankenFont = new FontFace("Hanken Grotesk", "url('fonts/hanken-grotesk-variable.woff2')", {
        style: "normal",
        weight: "100 900",
    });
    addToFontFaceSet(document.fonts, hankenFont);
    hankenFont.load();
}

function loadFiraCodeFont() {
    if (isFiraCodeLoaded) {
        return;
    }
    isFiraCodeLoaded = true;
    // variable font: a single woff2 covers the whole weight axis (same as Inter / Hanken)
    const firaFont = new FontFace("Fira Code", "url('fonts/fira-code-variable.woff2')", {
        style: "normal",
        weight: "300 700",
    });
    addToFontFaceSet(document.fonts, firaFont);
    firaFont.load();
}

// Google Sans Flex (SIL OFL 1.1, Antigravity's default UI face) as Google Fonts serves it: the weight axis only,
// cut into three files by script. Each FontFace carries its file's unicode-range, so a page fetches only the
// subsets its text uses; the Vietnamese file holds the precomposed letters and the marks they combine with.
const GOOGLE_SANS_FLEX_SUBSETS: { file: string; range: string }[] = [
    {
        file: "google-sans-flex-latin.woff2",
        range: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
    {
        file: "google-sans-flex-latin-ext.woff2",
        range: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
    },
    {
        file: "google-sans-flex-vietnamese.woff2",
        range: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB",
    },
];

function loadGoogleSansFlexFont() {
    if (isGoogleSansFlexLoaded) {
        return;
    }
    isGoogleSansFlexLoaded = true;
    for (const { file, range } of GOOGLE_SANS_FLEX_SUBSETS) {
        const face = new FontFace("Google Sans Flex", `url('fonts/${file}')`, {
            style: "normal",
            weight: "100 1000",
            unicodeRange: range,
        });
        addToFontFaceSet(document.fonts, face);
    }
}

function loadFonts() {
    loadGoogleSansFlexFont();
    loadHankenGroteskFont();
    loadInterFont();
    loadJetBrainsMonoFont();
    loadHackNerdFont();
    loadFiraCodeFont();
}

export { loadFonts };
