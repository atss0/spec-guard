# Spec Guard — Devpost submission text

**Category:** Apps for Software Teams
**Bonus prize:** Best app with Atlassian MCP (also eligible: Best Agents)
**Tagline:** Keep Jira work items — and the code your AI agents write — in sync with your Confluence specs.

## Inspiration
Every team we know has shipped the wrong thing for the same reason: the spec in Confluence said one thing, the Jira ticket said another, and the developer built from the ticket. A PM tightens a security requirement from 48 to 24 hours; the ticket still says 48; QA finds it a week later — or a customer does.

AI coding agents make this worse. An agent reads the ticket it is given and nothing else. If the ticket is stale, the agent confidently builds the stale requirement, faster than ever.

## What it does
Spec Guard treats the Confluence specification as the source of truth and keeps everything downstream aligned with it.

- **Alignment report on every work item.** Spec Guard reads the linked spec, works out the work item's scope, and lists every in-scope requirement as covered, missing, conflicting or delivered by another work item — with verbatim quotes from both sides, so you can check its reasoning in seconds.
- **Align work item with spec.** One click proposes corrected acceptance criteria with the spec's exact values; you preview the diff, apply it, and an audit comment records what changed. In our demo, alignment jumps from 27% to 89%.
- **Requirement coverage map on the spec.** On the Confluence page: every requirement → the work items that deliver it, the conflicts, and the gaps no work item covers — and one click creates linked work items for the gaps.
- **Spec change propagation.** When a spec changes, every linked work item gets a comment with the before/after of the changed requirements and their impact, and its report is flagged for re-check.
- **Verify a change.** Paste a summary or diff; Spec Guard says pass / needs attention / fails spec — judging only the change, and separately flagging where the ticket itself is wrong.
- **For AI agents — Rovo and MCP.** The same capabilities are a Rovo agent and seven MCP tools. Claude Code or Cursor call `get-spec-context` before coding and `verify-change` after, so the agent builds from the real requirements, not a stale ticket — and can `align-work-item` or `create-gap-work-items` itself.

## How we built it
- **Atlassian Forge**, UI Kit: Jira issue panel, issue context (sidebar), global page; Confluence byline item.
- **Forge LLM** (Atlassian-hosted Claude) for every analysis — nothing leaves Atlassian; the app is eligible for **Runs on Atlassian**.
- **Rovo**: `rovo:agent` with seven actions; the same actions are exposed through **`rovo:mcp`**.
- **Forge events queue** for long-running AI work, with **offline user impersonation**: each background job runs with the permissions of the user who started it.
- **Forge KVS** for analyses, spec snapshots (for before/after diffs) and the spec ↔ work item index.
- **Confluence product events** plus an hourly scheduled fallback for spec-change notifications.
- Prompts are built around transparency: verbatim quotes, explicit scope, sibling-work-item awareness, and a strict separation between "the change is wrong" and "the ticket is wrong".

## Challenges we ran into
- Reading Confluence from background jobs as the app user failed on restricted spaces; switching to offline user impersonation fixed it and made the security model cleaner.
- A Forge platform bug blocks MCP tools for apps installed in both Jira and Confluence; we found the workaround (enable tools while the app is Jira-only) and documented it.
- Early versions flagged requirements that belonged to other tickets. Teaching the model a work item's scope and its sibling work items made the reports trustworthy.

## Accomplishments we're proud of
- A full loop: detect drift → explain it with quotes → fix the ticket → find gaps → create tickets → notify on spec changes → let AI agents check their own work.
- Permission-aware by design: a user who cannot read a spec never sees analyses derived from it — in Jira, Confluence, Rovo or MCP.
- "Try with demo data" lets anyone see it working on an empty site in under a minute.

## What we learned
Specification drift is less a writing problem than a context problem — and AI agents need the same context humans do, delivered through the tools they already use.

## What's next
- Pull request checks once Forge supports Bitbucket in multi-app apps.
- Teamwork Graph to discover spec ↔ work item links automatically.
- Requirement-level traceability fields and JQL search (e.g. "all work items with spec conflicts").

## Try it
Installation link: https://developer.atlassian.com/console/install/00236d0b-a8f0-4b50-82c2-f1d2d34642cc?signature=AYABeANXnkRj8HTUktLBcipDCiMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB5R7YMDOdYQ2qI8zw%2BemziAAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDIfsHqTrZqFxohTPugIBEIA7bizlk2Qdd0QT%2BV1mWdRnlwi2XODKze6VP7WW2FxGnY47pQcZarof5zdfwBXbv1wJfCZQRU8n5o85GQYAB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgFLc99DspU4OhiaWHU6POCdAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMt0HI%2BPj7h2Vw6v3EAgEQgDuryNSL7I8e6qig9heuqBYzRJ0dl9IkJTGTQgr4ZUqpykeIApCgkb%2B3Vfvkkp4ZjfzrECmXWRHp9v7M%2FQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEASJNilwFMGMO8xJXG3kf%2B5EAAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyMypGgeVX9Ft8XNs0CARCAO7JMtclSUtw5VQdZRIuetcDvbAI1rjjrEJGPGMs2h0GooMXWEjSWRBC86NP%2FK%2BDyMkhbrdT2V5Z0MY%2BdAgAAAAAMAAAQAAAAAAAAAAAAAAAAACvZFdow3E1JwxQ6vTpoIS3%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADIKPmz3jAqCHdRqw83sRUGfZI5zE6O7idEUKNLBh7NjpzO7%2FSSrUDyzkoxaN%2FmMVMjgASJCBBzU3WWcy9exyDVJsgM%3D&product=jira&product=confluence
Code: https://github.com/atss0/spec-guard
