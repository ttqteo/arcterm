// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import "errors"

// AskToo is Ask <seat> too: it reopens the person's whole-council message that the router sent to a seat or two, so one
// more seat (expertId) answers it under the same message. It is refused unless replyId is the person's reply, taken up by
// the router and no longer pending, and expertId is a seat on the panel that is not in the reply's To. It appends the seat
// to To, clears Answered, and posts as ReplyWith does (post): a council that is done, stopped or failed with no run on
// starts a follow-up for the seat at once, and any other state saves the change for the run that is on, or the next
// round, to take up. The seat is not the first answerer (the reply already has answers), so the answers pass runs it
// after them and shows it what they said (othersAnsweredRule), so it adds only what is new. The message is not posted
// twice, and the router does not run again: Routed marks the reply as routed.
//
// Not built yet: it refuses every call. The task that builds the routing in the runner fills it in.
func (r *Runner) AskToo(id, replyId, expertId string) (*Council, error) {
	return nil, errors.New("ask seat too is not built yet")
}
