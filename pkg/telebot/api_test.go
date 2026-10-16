// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package telebot

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type recordedReq struct {
	Path   string
	Method string
	Body   map[string]any
	Raw    string
}

// fakeAPI is an httptest Bot API that records each request and answers every one with reply.
type fakeAPI struct {
	srv   *httptest.Server
	mu    sync.Mutex
	reqs  []recordedReq
	reply string
}

func newFakeAPI(t *testing.T, reply string) *fakeAPI {
	t.Helper()
	f := &fakeAPI{reply: reply}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec := recordedReq{Path: r.URL.Path, Method: r.Method, Raw: string(raw)}
		_ = json.Unmarshal(raw, &rec.Body)
		f.mu.Lock()
		f.reqs = append(f.reqs, rec)
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, f.reply)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeAPI) client() *Client {
	return &Client{Base: f.srv.URL, Token: "TKN"}
}

func (f *fakeAPI) last(t *testing.T) recordedReq {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.reqs) == 0 {
		t.Fatal("the fake API got no request")
	}
	return f.reqs[len(f.reqs)-1]
}

func TestSendMessageSendsKeyboardAndReturnsID(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":{"message_id":77,"chat":{"id":42}}}`)
	id, err := f.client().SendMessage(context.Background(), 42, "pick one", [][]Button{{{Text: "Yes", Data: "a1:0:0"}}})
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id != 77 {
		t.Errorf("message id = %d, want 77", id)
	}
	req := f.last(t)
	if req.Method != http.MethodPost || req.Path != "/botTKN/sendMessage" {
		t.Errorf("request = %s %s, want POST /botTKN/sendMessage", req.Method, req.Path)
	}
	if got, _ := req.Body["chat_id"].(float64); got != 42 {
		t.Errorf("chat_id = %v, want 42", req.Body["chat_id"])
	}
	if req.Body["text"] != "pick one" {
		t.Errorf("text = %v, want %q", req.Body["text"], "pick one")
	}
	if _, has := req.Body["parse_mode"]; has {
		t.Errorf("parse_mode is set: text goes out plain")
	}
	markup, _ := req.Body["reply_markup"].(map[string]any)
	rows, _ := markup["inline_keyboard"].([]any)
	if len(rows) != 1 {
		t.Fatalf("inline_keyboard = %v, want one row", markup["inline_keyboard"])
	}
	row, _ := rows[0].([]any)
	btn, _ := row[0].(map[string]any)
	if btn["callback_data"] != "a1:0:0" || btn["text"] != "Yes" {
		t.Errorf("button = %v, want text Yes and callback_data a1:0:0", btn)
	}
}

func TestSendMessageNilKeyboardOmitsMarkup(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":{"message_id":1}}`)
	if _, err := f.client().SendMessage(context.Background(), 42, "free text", nil); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if _, has := f.last(t).Body["reply_markup"]; has {
		t.Errorf("reply_markup is set for a nil keyboard: %s", f.last(t).Raw)
	}
}

func TestEditMessageNilKeyboardClearsButtons(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":true}`)
	if err := f.client().EditMessage(context.Background(), 42, 77, "answered", nil); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	req := f.last(t)
	if req.Path != "/botTKN/editMessageText" {
		t.Errorf("path = %s, want /botTKN/editMessageText", req.Path)
	}
	if !strings.Contains(req.Raw, `"inline_keyboard":[]`) {
		t.Errorf("body has no empty inline_keyboard: %s", req.Raw)
	}
	if got, _ := req.Body["message_id"].(float64); got != 77 {
		t.Errorf("message_id = %v, want 77", req.Body["message_id"])
	}
	if req.Body["text"] != "answered" {
		t.Errorf("text = %v, want %q", req.Body["text"], "answered")
	}
}

func TestEditMessageKeepsGivenKeyboard(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":true}`)
	kb := [][]Button{{{Text: "Go", Data: "x"}}}
	if err := f.client().EditMessage(context.Background(), 42, 77, "t", kb); err != nil {
		t.Fatalf("EditMessage: %v", err)
	}
	if !strings.Contains(f.last(t).Raw, `"callback_data":"x"`) {
		t.Errorf("body lost the keyboard: %s", f.last(t).Raw)
	}
}

func TestAPIErrorCarriesCode(t *testing.T) {
	f := newFakeAPI(t, `{"ok":false,"error_code":409,"description":"Conflict"}`)
	_, err := f.client().GetUpdates(context.Background(), 0, 0)
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("error = %v, want an *APIError", err)
	}
	if apiErr.Code != 409 || apiErr.Desc != "Conflict" {
		t.Errorf("APIError = %+v, want 409 Conflict", apiErr)
	}
}

func TestErrorsNeverContainToken(t *testing.T) {
	const token = "123456:SECRET-TOKEN"
	srv := httptest.NewServer(http.NotFoundHandler())
	base := srv.URL
	srv.Close()
	c := &Client{Base: base, Token: token}
	ctx := context.Background()

	calls := map[string]func() error{
		"GetMe":          func() error { _, err := c.GetMe(ctx); return err },
		"GetUpdates":     func() error { _, err := c.GetUpdates(ctx, 0, 0); return err },
		"SendMessage":    func() error { _, err := c.SendMessage(ctx, 1, "x", nil); return err },
		"EditMessage":    func() error { return c.EditMessage(ctx, 1, 2, "x", nil) },
		"AnswerCallback": func() error { return c.AnswerCallback(ctx, "cb", "x") },
	}
	for name, call := range calls {
		err := call()
		if err == nil {
			t.Errorf("%s: no error from a closed server", name)
			continue
		}
		if strings.Contains(err.Error(), token) {
			t.Errorf("%s: error holds the token: %v", name, err)
		}
		if !strings.Contains(err.Error(), "<token>") {
			t.Errorf("%s: error does not show the redacted URL: %v", name, err)
		}
	}
}

func TestAPIErrorDescriptionIsRedacted(t *testing.T) {
	f := newFakeAPI(t, `{"ok":false,"error_code":401,"description":"bad token TKN"}`)
	_, err := f.client().GetMe(context.Background())
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != 401 {
		t.Fatalf("error = %v, want an *APIError with code 401", err)
	}
	if strings.Contains(err.Error(), "TKN") {
		t.Errorf("error holds the token: %v", err)
	}
}

func TestErrorsKeepContextCancel(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":[]}`)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := f.client().GetUpdates(ctx, 0, 0)
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want one that wraps context.Canceled", err)
	}
	if err != nil && strings.Contains(err.Error(), "TKN") {
		t.Errorf("error holds the token: %v", err)
	}
}

func TestGetUpdatesPassesOffsetAndTimeout(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":[
		{"update_id":10,"message":{"message_id":5,"chat":{"id":42,"first_name":"Q"},"text":"hi",
			"reply_to_message":{"message_id":4,"chat":{"id":42}}}},
		{"update_id":11,"callback_query":{"id":"cb1","data":"a1:0:0","message":{"message_id":4,"chat":{"id":42}}}}]}`)
	ups, err := f.client().GetUpdates(context.Background(), 10, 50)
	if err != nil {
		t.Fatalf("GetUpdates: %v", err)
	}
	req := f.last(t)
	if req.Path != "/botTKN/getUpdates" {
		t.Errorf("path = %s, want /botTKN/getUpdates", req.Path)
	}
	if got, _ := req.Body["offset"].(float64); got != 10 {
		t.Errorf("offset = %v, want 10", req.Body["offset"])
	}
	if got, _ := req.Body["timeout"].(float64); got != 50 {
		t.Errorf("timeout = %v, want 50", req.Body["timeout"])
	}
	allowed, _ := req.Body["allowed_updates"].([]any)
	if len(allowed) != 2 || allowed[0] != "message" || allowed[1] != "callback_query" {
		t.Errorf("allowed_updates = %v, want [message callback_query]", req.Body["allowed_updates"])
	}
	if len(ups) != 2 {
		t.Fatalf("got %d updates, want 2", len(ups))
	}
	m := ups[0].Message
	if ups[0].UpdateID != 10 || m == nil || m.Text != "hi" || m.Chat.ID != 42 || m.Chat.FirstName != "Q" {
		t.Errorf("update 0 = %+v, want message 'hi' in chat 42", ups[0])
	}
	if m.ReplyTo == nil || m.ReplyTo.MessageID != 4 {
		t.Errorf("update 0 reply_to_message = %+v, want message 4", m.ReplyTo)
	}
	cb := ups[1].Callback
	if cb == nil || cb.ID != "cb1" || cb.Data != "a1:0:0" || cb.Message == nil || cb.Message.MessageID != 4 {
		t.Errorf("update 1 callback = %+v, want cb1 a1:0:0 on message 4", cb)
	}
}

func TestGetMeAndAnswerCallback(t *testing.T) {
	f := newFakeAPI(t, `{"ok":true,"result":{"id":9,"username":"arc_bot"}}`)
	u, err := f.client().GetMe(context.Background())
	if err != nil {
		t.Fatalf("GetMe: %v", err)
	}
	if u.ID != 9 || u.Username != "arc_bot" {
		t.Errorf("user = %+v, want 9 arc_bot", u)
	}
	if f.last(t).Path != "/botTKN/getMe" {
		t.Errorf("path = %s, want /botTKN/getMe", f.last(t).Path)
	}

	f.reply = `{"ok":true,"result":true}`
	if err := f.client().AnswerCallback(context.Background(), "cb1", "Sent"); err != nil {
		t.Fatalf("AnswerCallback: %v", err)
	}
	req := f.last(t)
	if req.Path != "/botTKN/answerCallbackQuery" || req.Body["callback_query_id"] != "cb1" || req.Body["text"] != "Sent" {
		t.Errorf("request = %s %v, want answerCallbackQuery for cb1 with text Sent", req.Path, req.Body)
	}
}
