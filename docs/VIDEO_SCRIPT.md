# Spec Guard — demo video script (target 2:45, hard limit 3:00)

Judges are not required to watch past 3 minutes, so everything important happens in the first 2:45.

| time | screen | voice-over |
|---|---|---|
| 0:00–0:15 | Title card: shield logo, "Spec Guard". Then a Confluence spec next to a Jira ticket, the mismatching values highlighted (24 h vs 48 h). | "The spec says the reset link expires in 24 hours. The ticket says 48. Your developer — or your AI coding agent — builds from the ticket. Spec Guard stops that drift before it ships." |
| 0:15–0:45 | Jira work item → Spec Guard in the sidebar → Check alignment → the report with Conflict/Missing cards. Zoom on one card's two quotes. | "Spec Guard reads the linked spec, works out what this ticket is responsible for, and checks every requirement. Four conflicts — each one quoted from both sides, so you can trust it. Requirements that belong to other tickets are recognised, not flagged." |
| 0:45–1:10 | Click Align work item with spec → preview of changes → Apply → re-check shows 27% → 89%. | "One click proposes corrected acceptance criteria with the spec's exact values. Preview, apply — the ticket is fixed and an audit comment records why. Twenty-seven percent to eighty-nine." |
| 1:10–1:35 | Confluence spec page → Spec Guard byline → coverage map (gaps, conflicts) → Create work items for gaps → new tickets. | "On the spec itself: which tickets deliver each requirement, and which requirements nobody is building. Three gaps — one click creates the missing tickets, linked back to the spec." |
| 1:35–1:55 | Edit the spec (24 h → 1 h), publish → Jira comment from Spec Guard with before/after → sidebar shows "Spec changed — re-check". | "When the spec changes, every affected ticket hears about it — with exactly what changed and why it matters." |
| 1:55–2:30 | Terminal: Claude Code with the Spec Guard MCP server. Prompt: "Implement PLAT-33510." Claude calls get-spec-context, writes code, calls verify-change, gets a finding, fixes it. | "And for AI agents: Spec Guard is an MCP server. Claude Code asks for the real requirements before it codes, and checks its own work after. The agent builds from the spec — not from a stale ticket." |
| 2:30–2:40 | Rovo chat: "Which requirements of this spec are not covered?" → answer with gaps. | "The same skills live in Rovo for everyone else." |
| 2:40–2:50 | Architecture slide: Forge UI Kit, Forge LLM (Runs on Atlassian), Rovo + MCP, events queue with user impersonation. End card with name + "Try with demo data". | "Built entirely on Forge — your data never leaves Atlassian. Spec Guard: build with context, ship with confidence." |

## Recording notes
- Use the demo site (Rovo enabled) for Rovo and MCP; record at 1920×1080, browser zoom 110%.
- Pre-create the demo scenario so nothing waits on screen; cut waiting time in editing.
- Voice-over: calm, clear English (ElevenLabs or own voice). No copyrighted music.
