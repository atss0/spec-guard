# Evaluation

A small, repeatable smoke test of how reliable Spec Guard's analysis is. It is not a benchmark: the spec and work items were written by the builder, and the sample is small. It does measure the things that matter for trust: does it find planted conflicts, does it invent problems, does it give the same answer twice, and are its quotes real.

## Setup

- Spec: "Notifications — Requirements", 7 requirements (NT-1 … NT-7), one Confluence page.
- Four Jira work items linked to it, each responsible for part of the spec:

| Work item | Scope | Planted conflicts |
|---|---|---|
| Email notification settings and digest | NT-1 … NT-4 | NT-2 (09:00 UTC vs 08:00 local time), NT-3 (mentions in the digest vs immediate email), NT-4 (unsubscribe requires login vs works without login) |
| Fast delivery of notification emails | NT-5 | none |
| Mobile push notifications | NT-6 | NT-6 (20 per hour vs 10 per hour) |
| Admin notification log | NT-7 | none |

- Each work item was analysed 3 times with `check-alignment` through the MCP endpoint, and the coverage map was built once with `get-spec-coverage` (model: Claude Sonnet via Forge LLM).
- Script: [`scripts/eval.mjs`](../scripts/eval.mjs). Raw results of the latest run: [`eval-result.json`](eval-result.json).

## Results (5 November 2026)

The evaluation was run twice on the same day. The second run used the stricter quote check (empty quotes are not counted; a quote shortened with "..." needs pieces of at least 10 characters that are close together in the source).

| Measure | Run 1 | Run 2 (latest) |
|---|---|---|
| Planted conflicts detected (4 conflicts × 3 runs) | 11 of 12 | 12 of 12 |
| False conflicts (reported where none exists) | 0 | 1 |
| False "missing" (requirements owned by another work item reported as missing) | 0 | 0 |
| Quotes found word for word in the spec or work item | 107 of 107 (old counting) | 105 of 105 |
| Coverage map | 4 of 4 conflicts, 0 false gaps | 4 of 4 conflicts, 0 false gaps |
| Score spread across 3 runs | 0 points for three work items, 5 for one | 0 points for three work items, 50 for one |
| Median time per analysis | 14 s | 14 s |

**Run 1 miss:** in one run the digest-time requirement (NT-2) was reported as *missing* instead of *conflict*. It was still flagged, but under the wrong label.

**Run 2 false conflict:** in one of three runs, the "fast delivery" work item (scope NT-5) also had NT-3 (mentions are emailed immediately) marked as a conflict. NT-3 belongs to another work item, and the other two runs correctly marked it as delivered elsewhere. That work item owns only one requirement, so the single wrong finding halves its score, which is the 50-point spread.

We did not tune the prompt to this data set; both runs are reported as measured. Taken together: planted conflicts are found reliably, and a wrong finding about a requirement owned by another work item happens occasionally. That is why every finding carries quotes that the reader can check.

## Limitations

- This is a smoke test, not a benchmark: one spec, four work items, builder-authored data. Real specs are longer and messier.
- Small samples: 3 runs per work item. Run-to-run variation is real (see the false conflict above).
- One model and one language (English). The prompts are language-agnostic, but this was not measured.
- Quote verification proves a quote exists in the source, not that the model interpreted it correctly.
