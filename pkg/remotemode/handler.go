// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/baseds"
)

// ErrAskGone means the ask the phone answered was answered or withdrawn meanwhile.
var ErrAskGone = errors.New("ask is gone")

// a push subscription or an answer is a few KB at most
const handlerMaxBody = 64 << 10

const handlerJSONType = "application/json"

// go's mime table has neither and the windows registry rarely does, so without these the manifest
// is sniffed as text/plain and a font's type depends on the machine
var handlerStaticTypes = map[string]string{
	".webmanifest": "application/manifest+json",
	".woff2":       "font/woff2",
}

// Deps is everything the phone handler calls out to, so it can be tested and previewed with fakes.
type Deps struct {
	Static fs.FS
	Verify func(*http.Request) error
	// Origin is the only Origin a POST may carry: https://<hostname>.
	Origin      string
	VapidPublic string
	Waiting     func(context.Context) (WaitingList, error)
	Answer      func(ctx context.Context, oref, askID string, answers []baseds.AgentAnswerItem) error
	Off         func(context.Context) error
	Subscribe   func(context.Context, PushSubscription) error
	Handed      func(context.Context) ([]HandedAgent, error)
	// Agents lists the live roster agents and the runs their workers belong to; a failure leaves both lists
	// empty rather than failing the page
	Agents func(context.Context) ([]ListedAgent, []ListedRun, error)
	// Stream returns a *GoneError when it ends for a reason, and nil when ctx ends. from is the byte offset
	// the page's Last-Event-ID names, -1 when the request has none or it is malformed.
	Stream func(ctx context.Context, tab string, from int64, sink StreamSink) error
	// Act and TakeBack return a *GoneError for a tab not handed over; Act wraps ErrWrongState
	Act      func(ctx context.Context, tab string, act AgentAction) error
	TakeBack func(ctx context.Context, tab string) error
	// Take hands a listed agent to the phone; a refusal wraps ErrRefused. Release gives a take the owner
	// never acted on back to the desk, and returns nil when there is nothing to release. Transcript gives
	// the page of lines before a byte offset, and a *GoneError for a tab not handed over.
	Take       func(ctx context.Context, tab string) error
	Release    func(ctx context.Context, tab string) error
	Transcript func(ctx context.Context, tab string, before int64) (TranscriptChunk, error)
	// PCLock locks the computer, and PCVolume presses one volume key (a pcVolumeSteps value). A nil dep is
	// a computer that cannot: its route answers 501 and the waiting list's pc flag is false.
	PCLock   func(ctx context.Context) error
	PCVolume func(ctx context.Context, step string) error
	// PCLocked reads whether the computer's session is locked. Nil, or a failed read, leaves the waiting
	// list's locked null, and the page then says nothing about it.
	PCLocked func(ctx context.Context) (bool, error)
}

// handlerUnsupported is what a route answers when its dep is nil.
const handlerUnsupported = "Not supported on this computer"

// keeps an open stream under cloudflared's 100 s idle cut; a var so tests can shorten it
var remoteStreamHeartbeat = 25 * time.Second

type handlerTextBody struct {
	Text string `json:"text"`
}

type handlerAnswerBody struct {
	ORef    string                   `json:"oref"`
	AskId   string                   `json:"askid"`
	Answers []baseds.AgentAnswerItem `json:"answers"`
}

type handlerStepBody struct {
	Step string `json:"step"`
}

// NewHandler serves the phone page and its API. Every request, static files included, passes Verify
// first; a POST must also be JSON from the phone's own origin, since Cloudflare adds the Access token to
// any request carrying the owner's cookie, a cross-site form post included.
func NewHandler(d Deps) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/waiting", d.handleWaiting)
	mux.Handle("POST /api/answer", d.handlerPost(d.handleAnswer))
	mux.Handle("POST /api/off", d.handlerPost(d.handleOff))
	mux.Handle("POST /api/subscribe", d.handlerPost(d.handleSubscribe))
	mux.HandleFunc("GET /api/agents/{tab}/stream", d.handleStream)
	for _, kind := range []string{ActionSend, ActionStop, ActionApprove, ActionDeny} {
		mux.Handle("POST /api/agents/{tab}/"+kind, d.handlerPost(d.handleAct(kind)))
	}
	mux.Handle("POST /api/agents/{tab}/takeback", d.handlerPost(d.handleTakeBack))
	mux.Handle("POST /api/agents/{tab}/hand", d.handlerPost(d.handleTake))
	mux.Handle("POST /api/agents/{tab}/release", d.handlerPost(d.handleRelease))
	mux.HandleFunc("GET /api/agents/{tab}/transcript", d.handleTranscript)
	mux.Handle("POST /api/pc/lock", d.handlerPost(d.handlePCLock))
	mux.Handle("POST /api/pc/volume", d.handlerPost(d.handlePCVolume))
	static := http.FileServerFS(d.Static)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if ct, ok := handlerStaticTypes[path.Ext(r.URL.Path)]; ok {
			w.Header().Set("Content-Type", ct)
		}
		static.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := d.Verify(r); err != nil {
			log.Printf("remote mode: refused %s %s: %v\n", r.Method, r.URL.Path, err)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (d Deps) handlerPost(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != d.Origin {
			log.Printf("remote mode: refused %s %s: origin %q\n", r.Method, r.URL.Path, origin)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != handlerJSONType {
			handlerWriteJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "content type must be " + handlerJSONType})
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, handlerMaxBody)
		next(w, r)
	})
}

func (d Deps) handleWaiting(w http.ResponseWriter, r *http.Request) {
	list, err := d.Waiting(r.Context())
	if err != nil {
		log.Printf("remote mode: waiting list: %v\n", err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	list.VapidPublic = d.VapidPublic
	if list.Questions == nil {
		list.Questions = []WaitingQuestion{}
	}
	if list.Shown == nil {
		list.Shown = []WaitingShown{}
	}
	if d.Handed != nil {
		if list.Handed, err = d.Handed(r.Context()); err != nil {
			log.Printf("remote mode: handed-over list: %v\n", err)
			handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
	}
	if list.Handed == nil {
		list.Handed = []HandedAgent{}
	}
	if d.Agents != nil {
		if list.Agents, list.Runs, err = d.Agents(r.Context()); err != nil {
			log.Printf("remote mode: agents list: %v\n", err)
			list.Agents, list.Runs = nil, nil
		}
	}
	if list.Agents == nil {
		list.Agents = []ListedAgent{}
	}
	if list.Runs == nil {
		list.Runs = []ListedRun{}
	}
	list.PC = d.PCLock != nil && d.PCVolume != nil
	if d.PCLocked != nil {
		if locked, err := d.PCLocked(r.Context()); err != nil {
			log.Printf("remote mode: lock state: %v\n", err)
		} else {
			list.Locked = &locked
		}
	}
	handlerWriteJSON(w, http.StatusOK, list)
}

// sseSink writes SSE frames; the stream's goroutines and the heartbeat share it.
type sseSink struct {
	mu sync.Mutex
	w  http.ResponseWriter
	rc *http.ResponseController
}

func (s *sseSink) Agent(a HandedAgent) error { return s.event("agent", a) }

// Lines sends the chunk as a lines event whose id is the byte offset after its last line, which the browser
// returns as Last-Event-ID when it reconnects.
func (s *sseSink) Lines(c TranscriptChunk) error {
	if c.Lines == nil {
		c.Lines = []string{}
	}
	return s.eventWithID("lines", strconv.FormatInt(c.End, 10), c)
}

func (s *sseSink) event(name string, v any) error {
	return s.eventWithID(name, "", v)
}

// eventWithID's data is one line: json.Marshal escapes every newline. An empty id leaves the id line out, so
// the browser keeps the last id it was given.
func (s *sseSink) eventWithID(name, id string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("encode %s event: %w", name, err)
	}
	frame := "event: " + name + "\n"
	if id != "" {
		frame += "id: " + id + "\n"
	}
	return s.write(frame + "data: " + string(data) + "\n\n")
}

func (s *sseSink) write(frame string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := io.WriteString(s.w, frame); err != nil {
		return err
	}
	return s.rc.Flush()
}

// handleStream answers 200 even for a tab not handed over, with one ended event, since EventSource cannot
// read a 4xx body. A stream that ends without a reason (the phone left, or remote mode stopped) closes
// without an ended event, so the page's EventSource reconnects. It returns only once Stream has, so no
// write reaches the sink after the response is done.
func (d Deps) handleStream(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	sink := &sseSink{w: w, rc: http.NewResponseController(w)}
	if err := sink.write(""); err != nil {
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	tab := r.PathValue("tab")
	from := handlerLastEventID(r)
	done := make(chan error, 1)
	go func() { done <- d.Stream(ctx, tab, from, sink) }()
	beat := time.NewTicker(remoteStreamHeartbeat)
	defer beat.Stop()
	for {
		select {
		case err := <-done:
			var gone *GoneError
			switch {
			case errors.As(err, &gone):
				sink.event("ended", map[string]string{"reason": gone.Reason})
			case err != nil && ctx.Err() == nil:
				log.Printf("remote mode: stream of tab %s: %v\n", tab, err)
			}
			return
		case <-beat.C:
			if err := sink.write(": ping\n\n"); err != nil {
				cancel()
				<-done
				return
			}
		}
	}
}

// handlerLastEventID is the byte offset a reconnecting EventSource names in Last-Event-ID, or -1 when the
// header is absent, not a whole number or negative.
func handlerLastEventID(r *http.Request) int64 {
	n, err := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	if err != nil || n < 0 {
		return -1
	}
	return n
}

func (d Deps) handleAct(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body handlerTextBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && !errors.Is(err, io.EOF) {
			handlerBadRequest(w, "malformed body")
			return
		}
		act := AgentAction{Kind: kind}
		switch kind {
		case ActionSend, ActionDeny:
			act.Text = strings.TrimSpace(body.Text)
		}
		if kind == ActionSend && act.Text == "" {
			handlerBadRequest(w, "text is required")
			return
		}
		handlerAgentResult(w, r, d.Act(r.Context(), r.PathValue("tab"), act))
	}
}

func (d Deps) handleTakeBack(w http.ResponseWriter, r *http.Request) {
	handlerAgentResult(w, r, d.TakeBack(r.Context(), r.PathValue("tab")))
}

// handleTake answers a refused take with 409 and the reason, which the phone shows on the agent's row.
func (d Deps) handleTake(w http.ResponseWriter, r *http.Request) {
	if d.Take == nil {
		handlerUnsupportedResult(w)
		return
	}
	err := d.Take(r.Context(), r.PathValue("tab"))
	switch {
	case err == nil:
		handlerOK(w)
	case errors.Is(err, ErrRefused):
		reason := err.Error()
		if _, after, ok := strings.Cut(reason, ErrRefused.Error()+": "); ok {
			reason = after
		}
		handlerWriteJSON(w, http.StatusConflict, map[string]string{"error": "refused", "reason": reason})
	default:
		log.Printf("remote mode: %s: %v\n", r.URL.Path, err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

// handleRelease treats a tab that is no longer handed over as released: the page leaves the agent view
// whatever became of the take.
func (d Deps) handleRelease(w http.ResponseWriter, r *http.Request) {
	if d.Release == nil {
		handlerUnsupportedResult(w)
		return
	}
	err := d.Release(r.Context(), r.PathValue("tab"))
	var gone *GoneError
	if errors.As(err, &gone) {
		err = nil
	}
	handlerAgentResult(w, r, err)
}

// handleTranscript serves one page of older lines: the byte offset it ends at is the required before.
func (d Deps) handleTranscript(w http.ResponseWriter, r *http.Request) {
	if d.Transcript == nil {
		handlerUnsupportedResult(w)
		return
	}
	before, err := strconv.ParseInt(r.URL.Query().Get("before"), 10, 64)
	if err != nil || before < 0 {
		handlerBadRequest(w, "before must be a byte offset, 0 or more")
		return
	}
	chunk, err := d.Transcript(r.Context(), r.PathValue("tab"), before)
	if err != nil {
		handlerAgentResult(w, r, err)
		return
	}
	if chunk.Lines == nil {
		chunk.Lines = []string{}
	}
	handlerWriteJSON(w, http.StatusOK, struct {
		Lines  []string `json:"lines"`
		Cursor int64    `json:"cursor"`
	}{chunk.Lines, chunk.Cursor})
}

func (d Deps) handlePCLock(w http.ResponseWriter, r *http.Request) {
	if d.PCLock == nil {
		handlerUnsupportedResult(w)
		return
	}
	handlerPCResult(w, r, d.PCLock(r.Context()))
}

func (d Deps) handlePCVolume(w http.ResponseWriter, r *http.Request) {
	if d.PCVolume == nil {
		handlerUnsupportedResult(w)
		return
	}
	var body handlerStepBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !slices.Contains(pcVolumeSteps, body.Step) {
		handlerBadRequest(w, "step must be one of "+strings.Join(pcVolumeSteps, ", "))
		return
	}
	handlerPCResult(w, r, d.PCVolume(r.Context(), body.Step))
}

func handlerPCResult(w http.ResponseWriter, r *http.Request, err error) {
	if err != nil {
		log.Printf("remote mode: %s: %v\n", r.URL.Path, err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	handlerOK(w)
}

func handlerUnsupportedResult(w http.ResponseWriter) {
	handlerWriteJSON(w, http.StatusNotImplemented, map[string]string{"error": handlerUnsupported})
}

func handlerAgentResult(w http.ResponseWriter, r *http.Request, err error) {
	var gone *GoneError
	switch {
	case err == nil:
		handlerOK(w)
	case errors.As(err, &gone):
		handlerWriteJSON(w, http.StatusGone, map[string]string{"error": "gone", "reason": gone.Reason})
	case errors.Is(err, ErrWrongState):
		handlerWriteJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		log.Printf("remote mode: %s: %v\n", r.URL.Path, err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func (d Deps) handleAnswer(w http.ResponseWriter, r *http.Request) {
	var body handlerAnswerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		handlerBadRequest(w, "malformed body")
		return
	}
	if body.ORef == "" || body.AskId == "" || len(body.Answers) == 0 {
		handlerBadRequest(w, "oref, askid and answers are required")
		return
	}
	err := d.Answer(r.Context(), body.ORef, body.AskId, body.Answers)
	switch {
	case errors.Is(err, ErrAskGone):
		handlerWriteJSON(w, http.StatusConflict, map[string]string{"error": "gone"})
	case err != nil:
		log.Printf("remote mode: answer %s: %v\n", body.ORef, err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	default:
		handlerOK(w)
	}
}

// handleOff answers before turning off, and turns off on its own goroutine: Off closes the listener this
// request runs on, and a graceful shutdown would wait on this very handler.
func (d Deps) handleOff(w http.ResponseWriter, r *http.Request) {
	handlerOK(w)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	go func() {
		if err := d.Off(context.Background()); err != nil {
			log.Printf("remote mode: turn off from the phone: %v\n", err)
		}
	}()
}

func (d Deps) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	var sub PushSubscription
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil {
		handlerBadRequest(w, "malformed body")
		return
	}
	// the server posts to this endpoint, so it must be a push service's https url
	u, err := url.Parse(sub.Endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || sub.Keys.P256dh == "" || sub.Keys.Auth == "" {
		handlerBadRequest(w, "endpoint must be an https url, and keys.p256dh and keys.auth are required")
		return
	}
	if err := d.Subscribe(r.Context(), sub); err != nil {
		log.Printf("remote mode: store push subscription: %v\n", err)
		handlerWriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	handlerOK(w)
}

func handlerBadRequest(w http.ResponseWriter, msg string) {
	handlerWriteJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
}

func handlerOK(w http.ResponseWriter) {
	handlerWriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handlerWriteJSON sets Content-Length so a flushed response is complete even if the connection closes
// right after.
func handlerWriteJSON(w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		log.Printf("remote mode: encode response: %v\n", err)
		status = http.StatusInternalServerError
		body = []byte(`{"error":"encode response"}`)
	}
	h := w.Header()
	h.Set("Content-Type", handlerJSONType)
	h.Set("Cache-Control", "no-store")
	h.Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	w.Write(body)
}
