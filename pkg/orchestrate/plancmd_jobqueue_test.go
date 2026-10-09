// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package orchestrate

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/jobqueue"
	"github.com/wavetermdev/waveterm/pkg/memgate"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
)

const testGB = uint64(1) << 30

// useJobQueue makes a one-slot job queue wavesrv's for the test, with the slot taken by the returned release.
func useJobQueue(t *testing.T) (q *jobqueue.Queue, releaseHeld func()) {
	t.Helper()
	q = jobqueue.New(jobqueue.Config{
		Slots:     func() int { return 1 },
		Available: func(context.Context) (uint64, error) { return 64 * testGB, nil },
	})
	prev := jobqueue.Default
	jobqueue.Default = q
	t.Cleanup(func() { jobqueue.Default = prev })
	held, err := q.Acquire(context.Background(), jobqueue.Request{Name: "held"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(held.Release)
	return q, held.Release
}

type planResult struct {
	out string
	err error
}

func runPlanAsync(ctx context.Context, t *testing.T, command string) <-chan planResult {
	t.Helper()
	done := make(chan planResult, 1)
	dir := t.TempDir()
	go func() {
		out, err := execPlanCommandEnv(ctx, dir, command, nil, time.Minute, nil)
		done <- planResult{out, err}
	}()
	return done
}

// queuedJob waits for the snapshot to hold a queued job and returns it.
func queuedJob(t *testing.T, q *jobqueue.Queue) jobqueue.Job {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, j := range q.Snapshot().Jobs {
			if !j.Running {
				return j
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("no job queued")
	return jobqueue.Job{}
}

func expectOutput(t *testing.T, done <-chan planResult, want string) {
	t.Helper()
	select {
	case r := <-done:
		if r.err != nil || strings.TrimSpace(r.out) != want {
			t.Fatalf("out = %q, err = %v, want %q", r.out, r.err, want)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("%q did not finish", want)
	}
}

func TestPlanCommandQueues(t *testing.T) {
	t.Run("a Verify waits for the slot, then runs", func(t *testing.T) {
		q, release := useJobQueue(t)
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{RunId: "700db4a1-xx", Label: "Verify", Always: true})
		done := runPlanAsync(ctx, t, "echo ok")
		job := queuedJob(t, q)
		if !job.Engine || job.Name != "Verify" || job.Bytes != engineStepBytes || job.Source.RunId != "700db4a1-xx" {
			t.Fatalf("queued job = %+v", job)
		}
		select {
		case r := <-done:
			t.Fatalf("returned while the slot was held: %+v", r)
		case <-time.After(100 * time.Millisecond):
		}
		release()
		expectOutput(t, done, "ok")
	})

	t.Run("a light command without Always runs at once", func(t *testing.T) {
		useJobQueue(t)
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Setup"})
		expectOutput(t, runPlanAsync(ctx, t, "echo light"), "light")
	})

	t.Run("a heavy command without Always queues under memgate's name", func(t *testing.T) {
		q, release := useJobQueue(t)
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Setup"})
		heavy, _ := memgate.Classify("npm install")
		done := runPlanAsync(ctx, t, "false && npm install; echo installed")
		job := queuedJob(t, q)
		if !job.Engine || job.Name != heavy.Name || job.Bytes != heavy.Bytes {
			t.Fatalf("queued job = %+v, want %+v", job, heavy)
		}
		release()
		select {
		case <-done:
		case <-time.After(30 * time.Second):
			t.Fatal("did not finish")
		}
	})

	t.Run("a Final claims a dev app's RAM", func(t *testing.T) {
		q, release := useJobQueue(t)
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Final", Always: true, Peak: memgate.DevBytes})
		done := runPlanAsync(ctx, t, "echo final")
		job := queuedJob(t, q)
		if job.Name != "Final" || job.Bytes != memgate.DevBytes {
			t.Fatalf("queued job = %+v", job)
		}
		release()
		expectOutput(t, done, "final")
	})

	t.Run("time queued does not count against the timeout", func(t *testing.T) {
		q, release := useJobQueue(t)
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Verify", Always: true})
		dir := t.TempDir()
		done := make(chan planResult, 1)
		go func() {
			out, err := execPlanCommandEnv(ctx, dir, "echo ok", nil, 1500*time.Millisecond, nil)
			done <- planResult{out, err}
		}()
		queuedJob(t, q)
		// queued longer than the timeout: it would have run out had its clock started at the call
		time.Sleep(1800 * time.Millisecond)
		release()
		expectOutput(t, done, "ok")
	})

	t.Run("a cancelled ctx leaves the queue", func(t *testing.T) {
		q, _ := useJobQueue(t)
		ctx, cancel := context.WithCancel(jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Verify", Always: true}))
		done := runPlanAsync(ctx, t, "echo never")
		queuedJob(t, q)
		cancel()
		select {
		case r := <-done:
			if r.err == nil {
				t.Fatalf("out = %q, want an error", r.out)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("did not return")
		}
		for _, j := range q.Snapshot().Jobs {
			if !j.Running {
				t.Fatalf("job still queued: %+v", j)
			}
		}
	})

	t.Run("no default queue runs at once", func(t *testing.T) {
		prev := jobqueue.Default
		jobqueue.Default = nil
		t.Cleanup(func() { jobqueue.Default = prev })
		ctx := jobqueue.WithSource(context.Background(), jobqueue.Source{Label: "Verify", Always: true})
		expectOutput(t, runPlanAsync(ctx, t, "echo ok"), "ok")
	})
}

func TestTaskStepLabel(t *testing.T) {
	g := &waveobj.TaskGroup{Tasks: []waveobj.TaskNode{{ID: "t-1", Label: "Build the chip"}, {ID: "t-2"}}}
	for _, c := range []struct{ id, want string }{
		{"t-1", "Verify · Build the chip"},
		{"t-2", "Verify · t-2"},
		{"t-9", "Verify"},
	} {
		if got := taskStepLabel("Verify", g, c.id); got != c.want {
			t.Errorf("taskStepLabel(%q) = %q, want %q", c.id, got, c.want)
		}
	}
}
