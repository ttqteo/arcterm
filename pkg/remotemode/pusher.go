// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"maps"
	"net/http"
	"slices"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jarvis"
)

const (
	pusherTTL = time.Hour
	// a question with no header is pushed as this, never its text
	pusherQuestionWord = "Question"
	pusherWaitingWord  = "Waiting"
)

// package vars so tests can shrink the interval and reach a fake push endpoint
var (
	pusherInterval = 5 * time.Second
	pusherClient   = &http.Client{Timeout: 30 * time.Second}
)

// the kind of wait a shown row's push names, never its reason
var pusherKindWords = map[string]string{
	jarvis.AttentionRunLandHeld:   "Run held",
	jarvis.AttentionDagBlocked:    "Run blocked",
	jarvis.AttentionEscalation:    "Escalated",
	jarvis.AttentionRunUnverified: "Run unverified",
}

// PushNote is the encrypted body of one push: the agent or run name, the question's header or the kind
// of wait, and the waiting item's key.
type PushNote struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	Key   string `json:"key"`
}

// pushNotes returns a note for each item in list that is not in seen, and leaves seen holding exactly
// list's items. A question is identified by its key and ask id, since an agent's next ask takes the same
// key; an item that leaves the list and comes back, a run held again, is new.
func pushNotes(seen map[string]bool, list WaitingList) []PushNote {
	var notes []PushNote
	current := make(map[string]bool, len(list.Questions)+len(list.Shown))
	visit := func(id string, note PushNote) {
		current[id] = true
		if !seen[id] {
			notes = append(notes, note)
		}
	}
	for _, q := range list.Questions {
		visit(q.Key+"\x00"+q.AskId, PushNote{Title: q.Source, Body: pusherQuestionBody(q), Key: q.Key})
	}
	for _, s := range list.Shown {
		visit(s.Key, PushNote{Title: s.Title, Body: pusherKindWord(s.Kind), Key: s.Key})
	}
	clear(seen)
	maps.Copy(seen, current)
	return notes
}

func pusherQuestionBody(q WaitingQuestion) string {
	if len(q.Questions) > 0 && q.Questions[0].Header != "" {
		return q.Questions[0].Header
	}
	return pusherQuestionWord
}

func pusherKindWord(kind string) string {
	if w, ok := pusherKindWords[kind]; ok {
		return w
	}
	return pusherWaitingWord
}

// startPusher pushes what starts waiting while remote mode is on. Its first read only seeds what is
// seen: what was already waiting when remote mode turned on, the owner just saw at the desk. stop
// returns once the loop has ended.
func startPusher() (stop func()) {
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		pusherLoop(ctx)
	}()
	return func() {
		cancel()
		<-done
	}
}

func pusherLoop(ctx context.Context) {
	ticker := time.NewTicker(pusherInterval)
	defer ticker.Stop()
	var seen map[string]bool
	for {
		list, err := remoteWaitingList(ctx)
		switch {
		case err != nil:
			log.Printf("remote mode: push: %v\n", err)
		case seen == nil:
			seen = map[string]bool{}
			pushNotes(seen, list)
		default:
			pusherDeliver(ctx, pushNotes(seen, list))
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// pusherDeliver sends each note to every stored subscription, dropping one the push service reports gone.
func pusherDeliver(ctx context.Context, notes []PushNote) {
	if len(notes) == 0 {
		return
	}
	cfg, err := LoadConfig()
	if err != nil {
		log.Printf("remote mode: push: %v\n", err)
		return
	}
	gone := map[string]bool{}
	for _, note := range notes {
		payload, err := json.Marshal(note)
		if err != nil {
			log.Printf("remote mode: push: encode note: %v\n", err)
			continue
		}
		for _, sub := range cfg.Subscriptions {
			if gone[sub.Endpoint] {
				continue
			}
			err := SendPush(ctx, pusherClient, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth, cfg.VapidPrivate, cfg.VapidPublic, "mailto:"+cfg.Email, payload, pusherTTL)
			switch {
			case errors.Is(err, ErrSubscriptionGone):
				gone[sub.Endpoint] = true
			case err != nil:
				log.Printf("remote mode: push: %v\n", err)
			}
		}
	}
	if len(gone) > 0 {
		pusherDropGone(gone)
	}
}

func pusherDropGone(gone map[string]bool) {
	err := remoteUpdateConfig(func(cfg *Config) error {
		cfg.Subscriptions = slices.DeleteFunc(cfg.Subscriptions, func(s PushSubscription) bool { return gone[s.Endpoint] })
		return nil
	})
	if err != nil {
		log.Printf("remote mode: push: drop %d gone subscription(s): %v\n", len(gone), err)
		return
	}
	log.Printf("remote mode: push: dropped %d subscription(s) the push service no longer knows\n", len(gone))
	publishStatus()
}
