// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The model behind the initiative form's Parent initiative picker: which initiatives can be a parent, in what order,
// and the name the picker shows for the one picked. The view is effortparentpicker.tsx.

type ParentSource = Pick<EffortSummary, "oref" | "title" | "project" | "ticket" | "status" | "parentoid" | "updatedts">;

export const bareEffortOid = (s: string): string => s.trim().replace(/^effort:/, "");

// An initiative and everything under it: none of them can be its parent, or the tree would loop.
function selfAndDescendants(efforts: ParentSource[], selfOid: string): Set<string> {
    const blocked = new Set<string>([selfOid]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const e of efforts) {
            const oid = bareEffortOid(e.oref);
            if (!blocked.has(oid) && e.parentoid != null && blocked.has(bareEffortOid(e.parentoid))) {
                blocked.add(oid);
                grew = true;
            }
        }
    }
    return blocked;
}

/** The initiatives the picker lists for `query`: not archived, never the one being edited (`self`, an oref, or null
 *  for a new one) nor any under it; those in `project` first, then the most recently updated. A query matches the
 *  title, project, ticket or id, ignoring case. */
export function parentOptions<T extends ParentSource>(
    efforts: T[],
    self: string | null,
    project: string,
    query: string
): T[] {
    const blocked = self ? selfAndDescendants(efforts, bareEffortOid(self)) : new Set<string>();
    const q = query.trim().toLowerCase();
    const proj = project.trim();
    const inProject = (e: T) => (proj !== "" && e.project === proj ? 0 : 1);
    return efforts
        .filter((e) => e.status !== "archived" && !blocked.has(bareEffortOid(e.oref)))
        .filter(
            (e) =>
                q === "" ||
                [e.title, e.project ?? "", e.ticket ?? "", bareEffortOid(e.oref)].some((s) =>
                    s.toLowerCase().includes(q)
                )
        )
        .sort((a, b) => inProject(a) - inProject(b) || b.updatedts - a.updatedts);
}

/** What the picker's box reads for the picked parent: its title, or its short id when this client does not know it
 *  (an archived parent, or the list not loaded yet); null when there is no parent. */
export function parentLabel(efforts: ParentSource[], parent: string): string | null {
    const oid = bareEffortOid(parent);
    if (oid === "") {
        return null;
    }
    const found = efforts.find((e) => bareEffortOid(e.oref) === oid);
    return found != null ? found.title : oid.slice(0, 8);
}
