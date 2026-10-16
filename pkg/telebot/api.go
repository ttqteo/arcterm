// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package telebot sends an agent's pending ask to the paired Telegram chat and turns a tap or a reply there into
// the same answer the cockpit delivers. It answers asks only: it never sends a prompt or starts anything.
package telebot

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultAPIBase = "https://api.telegram.org"

// httpTimeout sits above the 50 s long poll, so a healthy poll is never cut off by the client.
const httpTimeout = 70 * time.Second

// maxReplyBytes caps a Bot API reply: a getUpdates page of 100 updates is far under it.
const maxReplyBytes = 8 << 20

type Client struct {
	Base  string // defaultAPIBase in production, an httptest URL in tests
	Token string
	HTTP  *http.Client
}

// APIError is a Bot API "ok": false reply. Code 401 means the token is wrong; 409 means another process polls it.
type APIError struct {
	Code int
	Desc string
}

func (e *APIError) Error() string { return fmt.Sprintf("telegram: %d %s", e.Code, e.Desc) }

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

type Chat struct {
	ID        int64  `json:"id"`
	Title     string `json:"title"`
	Username  string `json:"username"`
	FirstName string `json:"first_name"`
}

type Message struct {
	MessageID int      `json:"message_id"`
	Chat      Chat     `json:"chat"`
	Text      string   `json:"text"`
	ReplyTo   *Message `json:"reply_to_message"`
}

type CallbackQuery struct {
	ID      string   `json:"id"`
	Message *Message `json:"message"`
	Data    string   `json:"data"`
}

type Update struct {
	UpdateID int            `json:"update_id"`
	Message  *Message       `json:"message"`
	Callback *CallbackQuery `json:"callback_query"`
}

type Button struct {
	Text string `json:"text"`
	Data string `json:"callback_data"`
}

type apiReply struct {
	OK          bool            `json:"ok"`
	Result      json.RawMessage `json:"result"`
	ErrorCode   int             `json:"error_code"`
	Description string          `json:"description"`
}

func (c *Client) GetMe(ctx context.Context) (User, error) {
	var u User
	err := c.call(ctx, "getMe", map[string]any{}, &u)
	return u, err
}

// GetUpdates long-polls: timeout is seconds, allowed_updates is ["message","callback_query"].
func (c *Client) GetUpdates(ctx context.Context, offset, timeout int) ([]Update, error) {
	var ups []Update
	err := c.call(ctx, "getUpdates", map[string]any{
		"offset":          offset,
		"timeout":         timeout,
		"allowed_updates": []string{"message", "callback_query"},
	}, &ups)
	return ups, err
}

func (c *Client) SendMessage(ctx context.Context, chatID int64, text string, kb [][]Button) (int, error) {
	params := map[string]any{"chat_id": chatID, "text": text}
	if len(kb) > 0 {
		params["reply_markup"] = map[string]any{"inline_keyboard": kb}
	}
	var sent struct {
		MessageID int `json:"message_id"`
	}
	if err := c.call(ctx, "sendMessage", params, &sent); err != nil {
		return 0, err
	}
	return sent.MessageID, nil
}

// EditMessage replaces the text; a nil kb removes the keyboard.
func (c *Client) EditMessage(ctx context.Context, chatID int64, msgID int, text string, kb [][]Button) error {
	if kb == nil {
		kb = [][]Button{} // marshals as [], which clears the buttons; null would leave them
	}
	return c.call(ctx, "editMessageText", map[string]any{
		"chat_id":      chatID,
		"message_id":   msgID,
		"text":         text,
		"reply_markup": map[string]any{"inline_keyboard": kb},
	}, nil)
}

func (c *Client) AnswerCallback(ctx context.Context, id, text string) error {
	params := map[string]any{"callback_query_id": id}
	if text != "" {
		params["text"] = text
	}
	return c.call(ctx, "answerCallbackQuery", params, nil)
}

// call POSTs params as JSON to the method and decodes the reply's result into out (nil to ignore it). Every error
// leaves through redact: net/http quotes the request URL, and the URL holds the token.
func (c *Client) call(ctx context.Context, method string, params any, out any) error {
	return redact(c.do(ctx, method, params, out), c.Token)
}

func (c *Client) do(ctx context.Context, method string, params any, out any) error {
	body, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("telegram: encode %s: %w", method, err)
	}
	base := c.Base
	if base == "" {
		base = defaultAPIBase
	}
	endpoint := strings.TrimRight(base, "/") + "/bot" + c.Token + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	hc := c.HTTP
	if hc == nil {
		hc = &http.Client{Timeout: httpTimeout}
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxReplyBytes))
	if err != nil {
		return err
	}
	var reply apiReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return fmt.Errorf("telegram: %s: http %d with a reply that is not JSON", method, resp.StatusCode)
	}
	if !reply.OK {
		code := reply.ErrorCode
		if code == 0 {
			code = resp.StatusCode
		}
		return &APIError{Code: code, Desc: reply.Description}
	}
	if out == nil || len(reply.Result) == 0 {
		return nil
	}
	if err := json.Unmarshal(reply.Result, out); err != nil {
		return fmt.Errorf("telegram: %s: decode result: %w", method, err)
	}
	return nil
}

// redact replaces the bot token in err with <token>. A *url.Error keeps its wrapped error, so a cancelled context
// still reads as one through errors.Is; an *APIError keeps its code, so a 409 still reads as one through errors.As.
func redact(err error, token string) error {
	if err == nil || token == "" {
		return err
	}
	scrub := func(s string) string { return strings.ReplaceAll(s, token, "<token>") }
	switch e := err.(type) {
	case *APIError:
		return &APIError{Code: e.Code, Desc: scrub(e.Desc)}
	case *url.Error:
		err = &url.Error{Op: e.Op, URL: scrub(e.URL), Err: e.Err}
	}
	if msg := err.Error(); strings.Contains(msg, token) {
		return errors.New(scrub(msg))
	}
	return err
}
