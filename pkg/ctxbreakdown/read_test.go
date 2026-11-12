package ctxbreakdown

import (
	"context"
	"errors"
	"os"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

// isolate swaps the runContext and now seams for the test and empties the cache before and after it.
func isolate(t *testing.T, run func(ctx context.Context, cwd string, env []string) (string, error)) {
	t.Helper()
	oldRun, oldNow := runContext, now
	reset := func() {
		mu.Lock()
		cache = map[string]*entry{}
		mu.Unlock()
	}
	reset()
	runContext = run
	t.Cleanup(func() {
		runContext, now = oldRun, oldNow
		reset()
	})
}

func report(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("testdata/context-opus-1m.md")
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestReadCachesPerFolder(t *testing.T) {
	md := report(t)
	var calls atomic.Int32
	isolate(t, func(ctx context.Context, cwd string, env []string) (string, error) {
		calls.Add(1)
		return md, nil
	})
	ctx := context.Background()
	dirA, dirB := t.TempDir(), t.TempDir()

	first, err := Read(ctx, dirA, false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := Read(ctx, dirA, false)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls after two cached reads = %d, want 1", calls.Load())
	}
	if first.ReadAt == 0 || first.ReadAt != second.ReadAt {
		t.Errorf("ReadAt = %d then %d, want the same non-zero stamp", first.ReadAt, second.ReadAt)
	}
	if _, err := Read(ctx, dirA, true); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls after a refresh = %d, want 2", calls.Load())
	}
	if _, err := Read(ctx, dirB, false); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls after another folder = %d, want 3", calls.Load())
	}
}

func TestReadSingleFlight(t *testing.T) {
	md := report(t)
	var calls atomic.Int32
	started, release := make(chan struct{}, 1), make(chan struct{})
	isolate(t, func(ctx context.Context, cwd string, env []string) (string, error) {
		calls.Add(1)
		started <- struct{}{}
		<-release
		return md, nil
	})
	dir := t.TempDir()
	const n = 3
	results := make([]*wshrpc.ContextBreakdown, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = Read(context.Background(), dir, false)
		}(i)
	}
	<-started
	time.Sleep(50 * time.Millisecond) // let the other readers reach the in-flight run
	close(release)
	wg.Wait()
	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("reader %d: %v", i, errs[i])
		}
		if results[i] != results[0] {
			t.Errorf("reader %d got a different result than reader 0", i)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("runs = %d, want 1", calls.Load())
	}
}

func TestReadErrorCachedBriefly(t *testing.T) {
	var calls atomic.Int32
	isolate(t, func(ctx context.Context, cwd string, env []string) (string, error) {
		calls.Add(1)
		return "", errors.New("boom")
	})
	clock := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	now = func() time.Time { return clock }
	ctx, dir := context.Background(), t.TempDir()

	if _, err := Read(ctx, dir, false); err == nil || err.Error() != "boom" {
		t.Fatalf("first read err = %v, want boom", err)
	}
	if _, err := Read(ctx, dir, false); err == nil || err.Error() != "boom" {
		t.Fatalf("second read err = %v, want the cached boom", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls within errTTL = %d, want 1", calls.Load())
	}
	clock = clock.Add(errTTL + time.Second)
	if _, err := Read(ctx, dir, false); err == nil {
		t.Fatal("third read should fail again")
	}
	if calls.Load() != 2 {
		t.Errorf("calls past errTTL = %d, want 2", calls.Load())
	}
}

func TestReadParseErrorIsAnError(t *testing.T) {
	isolate(t, func(ctx context.Context, cwd string, env []string) (string, error) {
		return "## Context Usage\n\nnothing here\n", nil
	})
	if b, err := Read(context.Background(), t.TempDir(), false); err == nil || b != nil {
		t.Errorf("Read = %v, %v; want nil and an error", b, err)
	}
}

func TestChildEnvDropsBlock(t *testing.T) {
	got := childEnv([]string{"PATH=x", "WAVETERM_BLOCKID=b", "WAVETERM_JWT=j", "HOME=h"})
	if want := []string{"PATH=x", "HOME=h"}; !reflect.DeepEqual(got, want) {
		t.Errorf("childEnv = %v, want %v", got, want)
	}
}
