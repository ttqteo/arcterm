// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package storage

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func houseEnv(t *testing.T) *Env {
	base := t.TempDir()
	return &Env{
		Now:              time.Now,
		DataDir:          filepath.Join(base, "data"),
		TrashDir:         filepath.Join(base, "trash"),
		WebviewCacheDirs: []string{filepath.Join(base, "cache", "NetworkCache"), filepath.Join(base, "cache", "CacheStorage")},
	}
}

func aged(t *testing.T, path string, age time.Duration) {
	t.Helper()
	when := time.Now().Add(-age)
	if err := os.Chtimes(path, when, when); err != nil {
		t.Fatal(err)
	}
}

func TestHousekeepingListsRolledLogsTrashAndCache(t *testing.T) {
	env := houseEnv(t)
	writeFile(t, filepath.Join(env.DataDir, "waveapp.log"), 30)
	writeFile(t, filepath.Join(env.DataDir, "waveapp.1.log"), 40)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	writeFile(t, filepath.Join(env.WebviewCacheDirs[0], "blob"), 5)
	rep := housekeeping{}.measure(context.Background(), env)
	if it := itemByID(rep.Items, filepath.Join(env.DataDir, "waveapp.1.log")); it.Kind != KindLog || it.Bytes != 40 || !it.Cleanable {
		t.Fatalf("rolled log: %+v", it)
	}
	if it := itemByID(rep.Items, filepath.Join(env.DataDir, "waveapp.log")); it.ID != "" {
		t.Fatal("the live log must never be listed")
	}
	if it := itemByID(rep.Items, "trash"); it.Bytes != 60 || !it.Cleanable {
		t.Fatalf("trash: %+v", it)
	}
	if it := itemByID(rep.Items, "webviewcache"); it.Bytes != 5 || !it.Cleanable {
		t.Fatalf("cache: %+v", it)
	}
}

func TestCleaningTheCacheOnlyLeavesTheMarker(t *testing.T) {
	env := houseEnv(t)
	blob := filepath.Join(env.WebviewCacheDirs[0], "blob")
	writeFile(t, blob, 5)
	res := housekeeping{}.clean(context.Background(), env, []string{"webviewcache"}, CleanOpts{})
	if !res.Deferred || res.Reclaimed != 0 || len(res.Cleaned) != 1 {
		t.Fatalf("got %+v, want it deferred to the next launch", res)
	}
	if !fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("the marker must be written")
	}
	if !fileExists(blob) {
		t.Fatal("the cache must not be touched while the app runs")
	}
	if it := itemByID(housekeeping{}.measure(context.Background(), env).Items, "webviewcache"); it.Cleanable || it.Reason != "clears when arcterm next opens" {
		t.Fatalf("a scheduled cache: %+v", it)
	}
}

func TestNoCacheDirsMeansNoCacheItemAndNoMarker(t *testing.T) {
	env := houseEnv(t)
	env.WebviewCacheDirs = nil
	if it := itemByID(housekeeping{}.measure(context.Background(), env).Items, "webviewcache"); it.ID != "" {
		t.Fatalf("a build with no interface cache must not list one: %+v", it)
	}
	res := housekeeping{}.clean(context.Background(), env, []string{"webviewcache"}, CleanOpts{})
	if len(res.Cleaned) != 0 || res.Deferred || len(res.Skipped) != 1 || res.Skipped[0].Reason != "no interface cache to clear here" {
		t.Fatalf("got %+v, want it skipped with the reason", res)
	}
	if fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("no marker may be written when there is no cache to clear")
	}
}

func TestEmptyingTheTrashKeepsTheTrashDir(t *testing.T) {
	env := houseEnv(t)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	res := housekeeping{}.clean(context.Background(), env, []string{"trash"}, CleanOpts{})
	if res.Reclaimed != 60 || len(res.Cleaned) != 1 {
		t.Fatalf("got %+v, want 60 bytes freed", res)
	}
	entries, err := os.ReadDir(env.TrashDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("the trash dir must stay, empty: %v %v", entries, err)
	}
}

func TestAutoCleanTakesOnlyOldRolledLogs(t *testing.T) {
	env := houseEnv(t)
	oldLog := filepath.Join(env.DataDir, "waveapp.1.log")
	newLog := filepath.Join(env.DataDir, "waveapp.2.log")
	writeFile(t, oldLog, 40)
	writeFile(t, newLog, 40)
	aged(t, oldLog, 8*24*time.Hour)
	writeFile(t, filepath.Join(env.TrashDir, "1700000000000-abc", "abc.jsonl"), 60)
	res := housekeeping{}.clean(context.Background(), env, []string{oldLog, newLog, "trash", "webviewcache"}, CleanOpts{Auto: true})
	if !reflect.DeepEqual(res.Cleaned, []string{oldLog}) {
		t.Fatalf("auto-clean cleaned %v, want only the old rolled log", res.Cleaned)
	}
	if fileExists(filepath.Join(env.DataDir, CacheMarkerName)) {
		t.Fatal("auto-clean must never schedule the cache")
	}
}

func TestCleanRefusesAnythingButARolledLog(t *testing.T) {
	env := houseEnv(t)
	live := filepath.Join(env.DataDir, "waveapp.log")
	writeFile(t, live, 30)
	other := filepath.Join(t.TempDir(), "waveapp.1.log")
	writeFile(t, other, 30)
	res := housekeeping{}.clean(context.Background(), env, []string{live, other, filepath.Join(env.DataDir, "..", "data", "db")}, CleanOpts{})
	if len(res.Cleaned) != 0 || len(res.Skipped) != 3 {
		t.Fatalf("got %+v, want all three refused", res)
	}
	if !fileExists(live) || !fileExists(other) {
		t.Fatal("nothing may be removed")
	}
}

func TestWebviewCacheDirs(t *testing.T) {
	home := filepath.Join("/", "Users", "me")
	mac := filepath.Join(home, "Library", "Application Support", "dev.arc.app-dev", "data")
	wk := filepath.Join(home, "Library", "Caches", "dev.arc.app", "WebKit")
	if got := WebviewCacheDirs("darwin", home, mac); !reflect.DeepEqual(got, []string{filepath.Join(wk, "NetworkCache"), filepath.Join(wk, "CacheStorage")}) {
		t.Fatalf("darwin: %v (a dev base's -dev suffix is not part of the identifier)", got)
	}
	win := filepath.Join("C:", "u", "AppData", "Local", "dev.arc.app", "data")
	d := filepath.Join("C:", "u", "AppData", "Local", "dev.arc.app", "EBWebView", "Default")
	if got := WebviewCacheDirs("windows", home, win); !reflect.DeepEqual(got, []string{filepath.Join(d, "Cache"), filepath.Join(d, "Code Cache"), filepath.Join(d, "GPUCache")}) {
		t.Fatalf("windows: %v (EBWebView sits beside data)", got)
	}
	if got := WebviewCacheDirs("linux", home, win); got != nil {
		t.Fatalf("linux: %v, want none", got)
	}
}
