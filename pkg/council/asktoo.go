// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package council

import (
	"fmt"
	"slices"
)

// AskToo is Ask <seat> too: it reopens the person's whole-council message that the router sent to a seat or two, so one
// more seat (expertId) answers it under the same message. It is refused unless replyId is the person's reply, taken up by
// the router and no longer pending, and expertId is a seat on the panel (not the coordinator) that is not in the reply's
// To. It appends the seat to To, clears Answered, and posts as ReplyWith does (post): a council that is done, stopped or
// failed with no run on starts a follow-up for the seat at once, and any other state saves the change for the run that is
// on, or the next round, to take up. The seat is not the first answerer (the reply already has answers), so the answers
// pass runs it after them and shows it what they said (othersAnsweredRule), so it adds only what is new. The message is
// not posted twice, and the router does not run again: Routed marks the reply as routed, and nothing else on it changes
// (Chose and Reason keep saying whom the router picked).
//
// Every refusal is made inside post's change, so a refused call saves nothing and starts no follow-up.
func (r *Runner) AskToo(id, replyId, expertId string) (*Council, error) {
	return r.post(id, func(c *Council) error {
		pr := findReply(c, replyId)
		switch {
		case pr == nil:
			return fmt.Errorf("council %s has no reply %s", id, replyId)
		case pr.Author != YouId:
			return fmt.Errorf("reply %s is not your message: only your own message can be asked of another seat", replyId)
		case pr.Routed == nil:
			return fmt.Errorf("reply %s was not routed: it went to the seats it names", replyId)
		case pr.Routed.Pending:
			return fmt.Errorf("the router has not chosen a seat for reply %s yet", replyId)
		case !slices.ContainsFunc(panelOf(c), func(e CouncilExpert) bool { return e.Id == expertId }):
			return fmt.Errorf("%s is not a seat on the panel of council %s", expertId, id)
		case slices.Contains(pr.To, expertId):
			return fmt.Errorf("%s already has reply %s", expertId, replyId)
		}
		pr.To = append(pr.To, expertId)
		pr.Answered = false
		return nil
	})
}
