// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// A skill's or note's frontmatter as a quiet card above the document, so the fields that steer an agent
// (name, description) stay readable without passing for the document's title. Shared by the Code preview and the
// Agent panel's File tab.
export function FrontmatterCard({ fields }: { fields: [string, string][] }) {
    return (
        <dl className="mb-7 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-5 gap-y-2 rounded-md border border-edge-mid bg-surface-raised px-4 py-3 text-[13px] leading-[1.55]">
            {fields.map(([key, value]) => (
                <div key={key} className="contents">
                    <dt className="pt-px font-mono text-[11.5px] text-muted">{key}</dt>
                    <dd className="min-w-0 break-words text-secondary">{value === "" ? "—" : value}</dd>
                </div>
            ))}
        </dl>
    );
}
