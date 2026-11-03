import { describe, expect, it } from "vitest";
import { langOf, type CouncilLang } from "./councillang";

// One table of cases for langOf. pkg/council/lang_test.go holds the same table for the Go rule (LangOf): change a row in
// one, change it in the other.
const CASES: { name: string; text: string; want: CouncilLang }[] = [
    { name: "tone marks", text: "Có nên ghim ứng dụng vào thanh ray không?", want: "vi" },
    { name: "a short question", text: "Cái này ổn không?", want: "vi" },
    { name: "upper case", text: "ĐƯỜNG DẪN CỦA HỘI ĐỒNG", want: "vi" },
    { name: "đ alone, no tone mark", text: "Đo RAM", want: "vi" },
    { name: "ă alone, no tone mark", text: "Ăn com", want: "vi" },
    { name: "ơ alone, no tone mark", text: "Dơn", want: "vi" },
    { name: "ê alone, no tone mark", text: "Thêm cot", want: "vi" },
    { name: "a tone mark alone", text: "Rail ảo", want: "vi" },
    { name: "a decomposed tone mark", text: "Cai này có", want: "vi" },
    { name: "a decomposed horn and tone mark", text: "ghim ứng dung", want: "vi" },
    {
        name: "Vietnamese typed with no marks at all cannot be told from English",
        text: "co nen ghim ung dung khong",
        want: "en",
    },
    { name: "English", text: "Is the pin worth it?", want: "en" },
    { name: "English with code", text: "Does pkg/council/runner.go:42 hold on a Mac?", want: "en" },
    { name: "mixed, a Vietnamese phrase in English", text: "Is the pin có đáng không?", want: "vi" },
    { name: "mixed, an English term in Vietnamese", text: "Review tính năng rail apps", want: "vi" },
    { name: "accents that are not Vietnamese", text: "Müller und señor", want: "en" },
    { name: "a decomposed umlaut", text: "Müller", want: "en" },
    { name: "a decomposed tilde on a consonant", text: "señor", want: "en" },
    { name: "empty", text: "", want: "en" },
    { name: "blank", text: "  \n\t ", want: "en" },
];

describe("langOf", () => {
    for (const c of CASES) {
        it(c.name, () => {
            expect(langOf(c.text)).toBe(c.want);
        });
    }
});
