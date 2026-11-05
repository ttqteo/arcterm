// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package translate

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// MyMemory's public API takes no key; anonymously it translates about 5,000 characters a day per address, and at most
// myMemoryMaxBytes in one request.
const (
	myMemoryTimeout  = 8 * time.Second
	myMemoryMaxBytes = 500
)

// myMemoryURL is a variable so a test can point MyMemory at httptest.
var myMemoryURL = "https://api.mymemory.translated.net/get"

// Google's codes where MyMemory (ISO 639-1) names the language otherwise
var googleToMyMemory = map[string]string{"iw": "he", "jw": "jv"}

func myMemoryCode(google string) string {
	if google == "auto" {
		return "autodetect"
	}
	if c, ok := googleToMyMemory[google]; ok {
		return c
	}
	return google
}

// googleCodeFromMyMemory answers the Google code of a language MyMemory detected ("en", "en-US", "zh-CN", "he").
func googleCodeFromMyMemory(code string) string {
	for g, m := range googleToMyMemory {
		if m == code {
			return g
		}
	}
	switch code {
	case "zh-CN", "zh-TW":
		return code
	}
	base, _, _ := strings.Cut(code, "-")
	return base
}

// myMemoryAnswer is the part of MyMemory's answer read. responseStatus is a number, or a string on some errors.
type myMemoryAnswer struct {
	ResponseData struct {
		TranslatedText   string `json:"translatedText"`
		DetectedLanguage string `json:"detectedLanguage"`
	} `json:"responseData"`
	QuotaFinished   bool            `json:"quotaFinished"`
	ResponseDetails string          `json:"responseDetails"`
	ResponseStatus  json.RawMessage `json:"responseStatus"`
}

// MyMemory translates text through MyMemory's public API (mymemory.translated.net), the fallback that needs nothing on
// the device: source is a Google code or "auto", target a Google code. It answers the translation and, on "auto", the
// language detected; no phonetics or word classes.
func MyMemory(ctx context.Context, source, target, text string) (Answer, error) {
	if n := len(text); n > myMemoryMaxBytes {
		return Answer{}, fmt.Errorf("it translates at most %d bytes at a time, and the text is %d", myMemoryMaxBytes, n)
	}
	ctx, cancel := context.WithTimeout(ctx, myMemoryTimeout)
	defer cancel()
	q := url.Values{"q": {text}, "langpair": {myMemoryCode(source) + "|" + myMemoryCode(target)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, myMemoryURL+"?"+q.Encode(), nil)
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't build the request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't reach it: %v", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAnswerBytes))
	if err != nil {
		return Answer{}, fmt.Errorf("couldn't read its answer: %v", err)
	}
	var mm myMemoryAnswer
	if err := json.Unmarshal(body, &mm); err != nil {
		if resp.StatusCode != http.StatusOK {
			return Answer{}, fmt.Errorf("it answered %s", resp.Status)
		}
		return Answer{}, fmt.Errorf("unreadable answer: %v", err)
	}
	if mm.QuotaFinished {
		return Answer{}, fmt.Errorf("today's free translations are used up")
	}
	if status := strings.Trim(string(mm.ResponseStatus), `"`); resp.StatusCode != http.StatusOK || status != "200" {
		why := strings.TrimSpace(mm.ResponseDetails)
		if why == "" {
			why = "it answered " + resp.Status
			if status != "" && status != "200" {
				why += " (status " + status + ")"
			}
		}
		return Answer{}, fmt.Errorf("%s", why)
	}
	a := Answer{Translation: strings.TrimSpace(html.UnescapeString(mm.ResponseData.TranslatedText))}
	if d := mm.ResponseData.DetectedLanguage; d != "" {
		a.Source = googleCodeFromMyMemory(d)
	}
	return a, nil
}
