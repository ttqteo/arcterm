// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remotemode

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

// takeTestFlags reads a hand-over's phone and acted flags; ok is false when the tab is not handed over.
func takeTestFlags(tab string) (phone, acted, ok bool) {
	handMu.Lock()
	defer handMu.Unlock()
	h := handed[tab]
	if h == nil {
		return false, false, false
	}
	return h.phone, h.acted, true
}

func takeTestHanded(t *testing.T) []string {
	t.Helper()
	return slices.Sorted(slices.Values(Status().Handed))
}

func TestRemoteTake(t *testing.T) {
	ctx := context.Background()

	t.Run("an eligible agent is handed over, marked as a phone take", func(t *testing.T) {
		fakes, _ := handTestEnv(t, handTestClaude("t-a"), handTestPi("t-b"))
		if err := remoteTake(ctx, "t-a"); err != nil {
			t.Fatalf("remoteTake(t-a): %v", err)
		}
		if got := takeTestHanded(t); !slices.Equal(got, []string{"t-a"}) {
			t.Errorf("Status().Handed = %v, want [t-a]", got)
		}
		if phone, acted, ok := takeTestFlags("t-a"); !ok || !phone || acted {
			t.Errorf("flags of t-a = phone %v, acted %v, handed %v; want a handed phone take, not yet acted on", phone, acted, ok)
		}
		if err := remoteTake(ctx, "t-b"); err != nil {
			t.Fatalf("remoteTake(t-b), a pi agent: %v", err)
		}
		if got := takeTestHanded(t); !slices.Equal(got, []string{"t-a", "t-b"}) {
			t.Errorf("Status().Handed = %v, want [t-a t-b]", got)
		}
		if n := fakes.starts.Load(); n != 0 {
			t.Errorf("a take started the remote listener %d times: the phone is already talking to it", n)
		}
	})

	refused := []struct {
		name string
		tab  string
		edit func(*Agent)
		want string
	}{
		{"a run worker", "t-a", func(a *Agent) { a.RunWorker = true }, "run worker"},
		{"a claude session that exited to its shell", "t-a", func(a *Agent) { a.HasStream = false }, "exited"},
		{"an agent with no terminal block", "t-a", func(a *Agent) { a.BlockId = "" }, "block"},
		{"an agent of another harness", "t-a", func(a *Agent) { a.Harness = "codex" }, "codex"},
		{"a tab that is not in the roster", "t-gone", func(*Agent) {}, "its tab is gone"},
		{"a tab named by a prefix only", "t-", func(*Agent) {}, "its tab is gone"},
	}
	for _, c := range refused {
		t.Run("refuses "+c.name, func(t *testing.T) {
			a := handTestClaude("t-a")
			c.edit(&a)
			handTestEnv(t, a)
			err := remoteTake(ctx, c.tab)
			if !errors.Is(err, ErrRefused) {
				t.Fatalf("remoteTake(%s) = %v, want an error wrapping ErrRefused", c.tab, err)
			}
			if !strings.Contains(err.Error(), c.want) {
				t.Errorf("remoteTake(%s) = %q, want a reason naming %q", c.tab, err, c.want)
			}
			if got := takeTestHanded(t); len(got) != 0 {
				t.Errorf("a refused take left %v handed", got)
			}
		})
	}

	t.Run("a roster that cannot be read is no refusal", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		prev := AgentsHook
		AgentsHook = func(context.Context) ([]Agent, error) { return nil, errors.New("roster down") }
		t.Cleanup(func() { AgentsHook = prev })
		err := remoteTake(ctx, "t-a")
		if err == nil || errors.Is(err, ErrRefused) {
			t.Errorf("remoteTake with a failing roster = %v, want a plain error the handler answers 500", err)
		}
	})

	t.Run("a tab already handed keeps its flags", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-desk"), handTestClaude("t-phone"))
		handTestHand(t, "t-desk")
		if err := remoteTake(ctx, "t-desk"); err != nil {
			t.Fatalf("remoteTake of a desk hand-over: %v", err)
		}
		if phone, _, ok := takeTestFlags("t-desk"); !ok || phone {
			t.Errorf("a take of a hand-over made with Hand turned it into a phone take (phone %v, handed %v)", phone, ok)
		}

		if err := remoteTake(ctx, "t-phone"); err != nil {
			t.Fatal(err)
		}
		handMarkActed("t-phone")
		if err := remoteTake(ctx, "t-phone"); err != nil {
			t.Fatalf("taking t-phone again: %v", err)
		}
		if phone, acted, ok := takeTestFlags("t-phone"); !ok || !phone || !acted {
			t.Errorf("a second take reset the flags of t-phone: phone %v, acted %v, handed %v", phone, acted, ok)
		}
	})
}

func TestRemoteRelease(t *testing.T) {
	ctx := context.Background()

	t.Run("ends a take nobody acted on", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		if err := remoteTake(ctx, "t-a"); err != nil {
			t.Fatal(err)
		}
		if err := remoteRelease(ctx, "t-a"); err != nil {
			t.Fatalf("remoteRelease: %v", err)
		}
		if got := takeTestHanded(t); len(got) != 0 {
			t.Errorf("Status().Handed after a release = %v, want none", got)
		}
		if got := handTestGoneReason(t, "t-a"); got != EndTaken {
			t.Errorf("the ended reason = %q, want %q", got, EndTaken)
		}
		// the agent is listed again and can be taken again
		if err := remoteTake(ctx, "t-a"); err != nil {
			t.Errorf("taking t-a after its release: %v", err)
		}
	})

	t.Run("is a no-op after the owner sent something", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		rec := agentsTestRecordInput(t)
		if err := remoteTake(ctx, "t-a"); err != nil {
			t.Fatal(err)
		}
		if err := remoteAct(ctx, "t-a", AgentAction{Kind: ActionSend, Text: "go on"}); err != nil {
			t.Fatalf("remoteAct send: %v", err)
		}
		if _, writes := rec.get(); len(writes) == 0 {
			t.Fatal("the send typed nothing")
		}
		if err := remoteRelease(ctx, "t-a"); err != nil {
			t.Fatalf("remoteRelease: %v", err)
		}
		if got := takeTestHanded(t); !slices.Equal(got, []string{"t-a"}) {
			t.Errorf("Status().Handed after a release of an acted-on take = %v, want [t-a]", got)
		}
		if _, acted, _ := takeTestFlags("t-a"); !acted {
			t.Error("a send did not mark the take as acted on")
		}
	})

	t.Run("a refused action leaves the take releasable", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		rec := agentsTestRecordInput(t)
		if err := remoteTake(ctx, "t-a"); err != nil {
			t.Fatal(err)
		}
		// an idle agent takes no approval
		if err := remoteAct(ctx, "t-a", AgentAction{Kind: ActionApprove}); !errors.Is(err, ErrWrongState) {
			t.Fatalf("approve on an idle agent = %v, want ErrWrongState", err)
		}
		if _, writes := rec.get(); len(writes) != 0 {
			t.Fatalf("a refused action typed %q", writes)
		}
		if err := remoteRelease(ctx, "t-a"); err != nil {
			t.Fatal(err)
		}
		if got := takeTestHanded(t); len(got) != 0 {
			t.Errorf("a refused action stopped the release: still handed %v", got)
		}
	})

	t.Run("is a no-op for a hand-over made with Hand", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		handTestHand(t, "t-a")
		if err := remoteRelease(ctx, "t-a"); err != nil {
			t.Fatalf("remoteRelease: %v", err)
		}
		if got := takeTestHanded(t); !slices.Equal(got, []string{"t-a"}) {
			t.Errorf("Status().Handed after a release of a desk hand-over = %v, want [t-a]", got)
		}
	})

	t.Run("is a no-op for a tab that is not handed over", func(t *testing.T) {
		handTestEnv(t, handTestClaude("t-a"))
		if err := remoteRelease(ctx, "t-a"); err != nil {
			t.Errorf("remoteRelease of a tab never taken: %v", err)
		}
		if err := remoteRelease(ctx, "t-nope"); err != nil {
			t.Errorf("remoteRelease of a tab not in the roster: %v", err)
		}
	})
}
