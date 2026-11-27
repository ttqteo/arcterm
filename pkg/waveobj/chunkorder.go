// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package waveobj

import "sort"

// The order of work: which open chunk of an initiative opens next. One rule, kept here because pkg/jarvis (advance),
// pkg/jarvisstate (the summary's ActiveChunk), pkg/dume (the queue) and cmd/wsh (show) all read it, and pkg/dume
// imports only waveobj. The frontend keeps its twin in frontend/app/view/jarvis/chunkorder.ts; both are checked
// against testdata/chunkorder-cases.json, so neither can drift without a test failing.
//
// The order is, as one list:
//  1. the active chunks, in plan order (priority never takes the active slot from a chunk);
//  2. the pending chunks, highest rank first, ties in plan order;
//  3. the blocked and deferred chunks, highest rank first, ties in plan order (parked work opens only when nothing
//     is pending, whatever its level).
//
// Done, skipped and proposed chunks are not in it. The next chunk is the first entry.
//
// Input shape: callers hold []EffortChunk (jarvis, dume, wsh) or []wshrpc.EffortChunkSummary (jarvisstate, the
// frontend's twin), and waveobj cannot import wshrpc. So the rule takes the chunk count and an accessor that reads one
// chunk's status and priority. ChunkOrderOfWorkOf and NextChunkIndexOf are the []EffortChunk forms.

// ChunkPriorities are the levels a chunk can carry, lowest to highest.
var ChunkPriorities = []string{"information", "low", "medium", "high", "critical"}

// unsetChunkRank is what a chunk with no priority ranks as: medium.
var unsetChunkRank = chunkRankOf("medium")

func chunkRankOf(p string) int {
	for i, level := range ChunkPriorities {
		if level == p {
			return i
		}
	}
	return -1
}

// ValidChunkPriority reports whether p is a level a chunk may carry: "" (none) or one of ChunkPriorities.
func ValidChunkPriority(p string) bool {
	return p == "" || chunkRankOf(p) >= 0
}

// ChunkRank is a level's place on the scale, 0 (information) up to 4 (critical). A chunk with no priority ranks as
// medium, and so does a level this build does not know (a synced edit from a newer build), so neither can jump the
// queue or sink under it.
func ChunkRank(p string) int {
	if r := chunkRankOf(p); r >= 0 {
		return r
	}
	return unsetChunkRank
}

// ChunkOrderOfWork returns the indices of the open chunks in the order of work (see the file comment). at reads chunk
// i's status and priority, for i in [0, n). It returns an empty list when no chunk is open.
func ChunkOrderOfWork(n int, at func(i int) (status, priority string)) []int {
	var active, pending, parked []int
	rank := make([]int, n)
	for i := range n {
		status, priority := at(i)
		switch status {
		case "active":
			active = append(active, i)
		case "pending":
			pending = append(pending, i)
		case "blocked", "deferred":
			parked = append(parked, i)
		default:
			continue
		}
		rank[i] = ChunkRank(priority)
	}
	byRank := func(idx []int) {
		// stable: chunks of one rank keep their plan order
		sort.SliceStable(idx, func(a, b int) bool { return rank[idx[a]] > rank[idx[b]] })
	}
	byRank(pending)
	byRank(parked)
	order := make([]int, 0, len(active)+len(pending)+len(parked))
	order = append(order, active...)
	order = append(order, pending...)
	order = append(order, parked...)
	return order
}

// NextChunkIndex is the first chunk in the order of work, or -1 when no chunk is open.
func NextChunkIndex(n int, at func(i int) (status, priority string)) int {
	if order := ChunkOrderOfWork(n, at); len(order) > 0 {
		return order[0]
	}
	return -1
}

// chunkWorkAt reads chunk i for the order of work. A later chunk (EffortChunk.Later) is saved for later, not the
// initiative's work, so it reads as no status and is in no order: the filter comes before the rank, so a later chunk
// of any priority is never next. The indices stay positions in chunks.
func chunkWorkAt(chunks []EffortChunk) func(i int) (string, string) {
	return func(i int) (string, string) {
		if chunks[i].Later {
			return "", ""
		}
		return chunks[i].Status, chunks[i].Priority
	}
}

// ChunkOrderOfWorkOf is ChunkOrderOfWork over an effort's chunks, later chunks left out.
func ChunkOrderOfWorkOf(chunks []EffortChunk) []int {
	return ChunkOrderOfWork(len(chunks), chunkWorkAt(chunks))
}

// NextChunkIndexOf is NextChunkIndex over an effort's chunks, later chunks left out.
func NextChunkIndexOf(chunks []EffortChunk) int {
	return NextChunkIndex(len(chunks), chunkWorkAt(chunks))
}
