# Spec Guard: demo video script (target 2:45, hard limit 3:00)

Judges do not have to watch past 3 minutes, so everything important is in the first 2:45.

| time | screen | voice-over |
|---|---|---|
| 0:00–0:12 | Logo, then a Confluence spec next to a Jira work item with the mismatching values highlighted (24 h vs 48 h). | "The spec says the reset link expires after 24 hours. The work item says 48. Whoever builds from the work item, a developer or a coding agent, builds 48." |
| 0:12–0:42 | Jira work item → Spec Guard in the sidebar → Check alignment → report. Zoom on one conflict card with its two quotes, then on the line "11 of 11 quotes found word for word in the sources". | "Spec Guard reads the linked spec, works out which requirements this work item owns, and checks each one. Every finding quotes both sides, and every quote is checked against the source text. Requirements owned by other work items are marked as delivered elsewhere, not as missing." |
| 0:42–1:05 | Align work item with spec → preview of the new acceptance criteria → Apply → automatic re-check: 27% → 89%. | "It proposes acceptance criteria with the spec's values. You review them and apply. Only the acceptance criteria section changes, a comment records what changed, and the work item is re-checked: 27 to 89 percent." |
| 1:05–1:30 | Confluence spec page → Spec Guard byline → coverage map: covered, conflicts, gaps (including a work item nobody opened) → Create work items for gaps. | "On the spec page: which work items deliver each requirement, where they contradict each other, and which requirements nobody is building. It also finds work items that link the spec but were never checked. Gaps become linked work items in one click." |
| 1:30–1:45 | Edit the spec (24 h → 1 h) and publish → the work item's comment "the spec changed, 1 change affects this work item" → panel shows before/after. JQL search `specGuardSpecChanged = 1`. | "When the spec changes, affected work items are told, and the details are shown only to people who can read the spec. Drift is searchable with JQL." |
| 1:45–2:25 | Terminal, Claude Code with the Spec Guard MCP server. Prompt: "Implement PLAT-33510." Calls `get-spec-context`, writes code, calls `verify-change`, gets "fails spec: 48 h instead of 24 h", fixes it, verifies again: pass. Then "fix the work item": `align-work-item` shows the proposal, user says yes, `apply-alignment`. | "Coding agents get the same checks over MCP. Claude Code reads the spec before it writes code and checks the change afterwards. It can also fix the work item, but only after you approve the proposal." |
| 2:25–2:35 | Rovo chat on the spec: "Which requirements are not covered?" → answer listing the gaps. | "The same actions are available in Rovo." |
| 2:35–2:45 | One slide: Forge UI Kit, Forge LLM, Rovo + MCP, events queue with user impersonation, evaluation numbers (11/12 conflicts, 0 false conflicts, 107/107 quotes verified). End card: name, "Try with demo data". | "Built on Forge; the data stays in Atlassian. Spec Guard." |

## Recording notes
- Use the demo site (Rovo enabled) for Rovo and MCP. Record at 1920×1080, browser zoom 110%.
- Create the demo scenario beforehand and cut waiting time in editing.
- Voice-over in plain English, own voice or a TTS voice. No copyrighted music.
