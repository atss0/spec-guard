# Spec Guard — Privacy Policy

_Last updated: 5 November 2026_

Spec Guard is an Atlassian Forge app. It runs entirely on Atlassian's Forge platform ("Runs on Atlassian"): it has no servers of its own and sends no data outside Atlassian.

## What the app processes
- The text of Jira work items (summary, description) and of the Confluence pages they link to as specifications.
- To analyse them, this text is sent to the Atlassian-hosted large language models of Forge LLM. Atlassian states that these providers do not store prompts or use them for training.

## What the app stores (Forge storage, inside your Atlassian site's data residency)
- Analysis results (requirement lists, short verbatim quotes, scores) per work item.
- A snapshot of the text of each specification page that has been analysed, so that changes can be explained as before/after.
- An index of which work items link to which specification pages.
- The Atlassian account ID of the user who last analysed a specification page or started a background job, so that background work can run with that user's permissions (offline user impersonation). No names, email addresses or other profile data are stored.

## Access
- Every read uses the permissions of the current user. A user who cannot read a specification page never sees analyses or quotes derived from it.
- The app writes to Jira only when a user asks it to (aligning a work item, creating work items for spec gaps) or to post a "spec changed" comment on work items that link a changed specification.

## Retention and deletion
Data is kept in Forge storage while the app is installed. Atlassian deletes app storage 28 days after the app is uninstalled. To request earlier deletion, open an issue at https://github.com/atss0/spec-guard/issues.

## Contact
https://github.com/atss0/spec-guard/issues
