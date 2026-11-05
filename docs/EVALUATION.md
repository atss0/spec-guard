# Evaluation

A small, repeatable check of how reliable Spec Guard's analysis is. It is not a benchmark: the spec and work items were written by the builder, and the sample is small. It does measure the things that matter for trust: does it find planted conflicts, does it invent problems, does it give the same answer twice, and are its quotes real.

## Setup

- Spec: "Notifications — Requirements", 7 requirements (NT-1 … NT-7), one Confluence page.
- Four Jira work items linked to it, each responsible for part of the spec:

| Work item | Scope | Planted conflicts |
|---|---|---|
| Email notification settings and digest | NT-1 … NT-4 | NT-2 (09:00 UTC vs 08:00 local time), NT-3 (mentions in the digest vs immediate email), NT-4 (unsubscribe requires login vs works without login) |
| Fast delivery of notification emails | NT-5 | none |
| Mobile push notifications | NT-6 | NT-6 (20 per hour vs 10 per hour) |
| Admin notification log | NT-7 | none |

- Each work item was analysed 3 times with `check-alignment` through the MCP endpoint, and the coverage map was built once (model: Claude Sonnet via Forge LLM). The map is cached until the spec or its linked work items change, so repeated calls return the same map.
- Script: [`scripts/eval.mjs`](../scripts/eval.mjs). Raw results: [`eval-result.json`](eval-result.json).

## Results (5 November 2026)

| Measure | Result |
|---|---|
| Planted conflicts detected | 11 of 12 (4 conflicts × 3 runs) |
| False conflicts (reported where none exists) | 0 |
| False "missing" (requirements owned by another work item reported as missing) | 0 |
| Quotes found word for word in the spec or work item | 107 of 107 |
| Coverage map | 4 of 4 conflicts found, 0 false gaps |
| Score spread across 3 runs | 0 points for three work items, 5 points for one |
| Median time per analysis | 14 s (all completed inside the tool call) |

The one miss: in one run the digest-time requirement (NT-2) was reported as *missing* instead of *conflict*. It was still flagged, but under the wrong label. Requirements owned by the other three work items were reported as "delivered by another work item" in every run, which is what keeps the reports free of false "missing" findings.

## Limitations

- Builder-authored data; real specs are longer and messier.
- One model and one language (English). The prompts are language-agnostic, but this was not measured.
- Quote verification proves a quote exists in the source, not that the model interpreted it correctly.
