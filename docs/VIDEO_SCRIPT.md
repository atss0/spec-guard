# Spec Guard: demo video (2:26)

The rendered video follows this script. Every screen is a real capture from the demo site; the terminal scene shows real `claude -p` runs against the Spec Guard MCP server, shortened. Voice-over: neural text to speech.

| # | Screen | Voice-over |
|---|---|---|
| 1 | Title card | This is Spec Guard. |
| 2 | Spec page (FR-3: 24 hours) and the Jira work item (48 hours), highlighted | The spec in Confluence says the password reset link expires after twenty-four hours. The Jira work item says forty-eight. Whoever builds from the work item, a developer or a coding agent, builds forty-eight. |
| 3 | Sidebar: Check alignment → 20% aligned, 4 conflicts, 4 missing | Spec Guard checks the work item against its linked spec. One click in the sidebar: twenty percent aligned, four conflicts, four requirements missing. |
| 4 | Report: "18 of 18 quotes found word for word", a conflict card with both quotes | Every finding quotes both sides, and every quote is checked against the source text. Here, eighteen of eighteen quotes were found word for word. |
| 5 | Cards for requirements delivered by other work items | It also knows what this work item is not responsible for. Account lockout and analytics belong to other work items, so they are not reported as missing. |
| 6 | Proposed acceptance criteria | Align work item with spec proposes new acceptance criteria with the spec's values. You review them, then apply. |
| 7 | Rewritten acceptance criteria; sidebar shows 100% aligned | Only the acceptance criteria change, a comment records why, and the re-check gives one hundred percent. |
| 8 | Confluence byline: coverage map with 3 gaps and 4 conflicts; conflict cards | On the spec page, the coverage map shows each requirement, the work items that deliver it, and the ones that contradict it. Three requirements have no work item at all. |
| 9 | Create work items for the gaps → map shows 0 gaps | One click creates linked work items for the gaps. |
| 10 | Spec edited (24 h → 1 h): out-of-date warning with before/after; Spec Guard comment | When the spec changes, here from twenty-four hours to one hour, affected work items get a comment and an out-of-date warning with the exact before and after. The details are shown only to people who can read the spec. |
| 11 | JQL search specGuardConflicts > 0 | Drift is searchable with JQL. |
| 12 | Split screen, left: Claude Code from the work item text builds 48 h / SMS / 8 chars | Coding agents get the same checks through MCP. Without Spec Guard, Claude Code implements the work item as written: forty-eight hours, SMS, and eight characters. |
| 13 | Left: verify-change → FAIL with spec quotes → fix → PASS | Spec Guard's verify-change fails that change and quotes the spec. The agent fixes the code, and the second check passes. |
| 14 | Right: Claude Code with Spec Guard: get-spec-context → 24 h → PASS | With Spec Guard connected from the start, the agent reads the spec before writing code, and gets it right the first time. |
| 15 | Rovo chat with the Spec Guard agent on the spec page | The same actions are available in Rovo. |
| 16 | Built on Forge + smoke test numbers | Spec Guard runs entirely on Forge with Forge LLM, so the data stays in Atlassian. Each job runs with the permissions of the person who started it, and changes to a work item are only applied after a person approves them. |
| 17 | End card | Spec Guard. Build what the spec says. |
