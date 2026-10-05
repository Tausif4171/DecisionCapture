# V3 Phase 2 Decision Intelligence Runbook

This runbook covers proactive conflict detection for open pull requests. It is separate from V1 merged-PR capture, V2 GitHub issue synchronization, and V3 Phase 1 post-approval relationships.

## What It Does

When an eligible PR is opened or updated, DecisionCapture compares its text and changed files with a bounded set of earlier approved or rejected decisions from the same repository. A structured analyzer may create a **potential conflict** warning when both similarity and evidence thresholds pass.

The warning is advisory. It never blocks a merge and never turns into a confirmed engineering decision automatically.

```text
GitHub pull_request webhook
  -> verify signature and delivery id
  -> save the latest PR snapshot
  -> enqueue one scan for repository + PR + head SHA + content hash
  -> lexical candidate limit (100 by default)
  -> embedding rank (20 by default)
  -> strict Ollama contradiction analysis
  -> persist supported conflicts only
  -> update one GitHub Check and one stable bot comment
  -> show the warning in the dashboard
```

## Scope and Configuration

Apply the additive Prisma migration before enabling the flag. The migration requires PostgreSQL with the `vector` extension and creates a 768-dimension vector column. Keep the configured embedding model at a compatible dimension. Docker startup uses `npm run db:sync`: it attempts to enable the extension and applies checked-in Prisma migrations when pgvector is available; with the feature disabled, it leaves an existing non-vector deployment bootable. Enabling conflict detection must fail fast if pgvector cannot be prepared.

```env
CONFLICT_DETECTION_ENABLED=false
CONFLICT_DETECTION_REPOSITORIES=Tausif4171/DecisionCapture
CONFLICT_EMBEDDING_PROVIDER=ollama
CONFLICT_EMBEDDING_MODEL=nomic-embed-text
CONFLICT_EMBEDDING_DIMENSIONS=768
CONFLICT_MAX_CANDIDATES=20
CONFLICT_LEXICAL_CANDIDATE_LIMIT=100
CONFLICT_SIMILARITY_THRESHOLD=0.72
CONFLICT_CONFIDENCE_THRESHOLD=0.75
CONFLICT_COMMENT_ENABLED=true
CONFLICT_CHECK_ENABLED=true
CONFLICT_SHADOW_MODE=true
CONFLICT_QUEUE_CONCURRENCY=2

QUEUE_MODE=bullmq
QUEUE_WORKER_ENABLED=true
```

Defaults keep Phase 2 disabled. Configure these values on the backend and the worker.

## Database and Health Checks

Deploy the migration with the backend package:

```bash
npm run db:generate -w @decisioncapture/backend
npm run db:deploy -w @decisioncapture/backend
```

The Render Docker startup runs `npm run db:sync -w @decisioncapture/backend` before starting the server. When pgvector is available, that script runs `prisma migrate deploy` automatically, so a Render free instance does not require Shell or one-off job access. Keep the feature disabled while the migration is being applied.

Check readiness before enabling warnings:

```bash
BACKEND_URL="https://your-backend.example.com"
curl -sS "$BACKEND_URL/health/queue" | jq
curl -sS "$BACKEND_URL/health/ai" | jq
curl -sS "$BACKEND_URL/health/conflicts" | jq
```

The conflict health response should show `queue.workerEnabled: true`, `embedding.vectorExtensionReady: true`, `embedding.modelAvailable: true`, and an available analysis model. If vector support or Ollama is unavailable, leave the feature disabled or use shadow mode while fixing the dependency.

## GitHub Setup

The existing GitHub Action remains responsible for merged-PR V1 capture. Phase 2 pre-review detection uses a signed GitHub App or repository webhook pointed to:

```text
POST https://your-backend.example.com/github/webhook
```

Configure the same `GITHUB_WEBHOOK_SECRET` on GitHub and the backend. Subscribe to `pull_request` events. The backend processes `opened`, `edited`, `reopened`, `synchronize`, `ready_for_review`, and `closed` for lifecycle cleanup. Merged `closed` capture continues through its existing V1 branch.

The GitHub App or token needs read access to repository metadata, pull requests, contents, and issues, plus write access for checks and issue comments. Draft PRs are stored as snapshots but skipped until `ready_for_review`.

## Scan and Conflict States

```text
PENDING -> RUNNING -> COMPLETED
                    -> FAILED

OPEN -> DISMISSED
OPEN -> RESOLVED
OPEN -> STALE
```

- A new head SHA creates a new scan.
- Repeated deliveries for the same delivery id are ignored.
- Repeated deliveries for the same PR snapshot use the unique scan key and do not duplicate work.
- A changed PR makes older open conflicts stale.
- Closing a PR resolves active warnings because they are no longer actionable.
- Dismissed warnings remain recorded and are not recreated for the same scan.
- Reopening a PR creates a fresh scan.
- Changing the historical decision requires fresh review; no conflict is silently restored.

## GitHub Feedback

The check name is `DecisionCapture: Potential conflict review`. Possible outcomes are queued, running, no potential conflicts found, potential conflicts found, and analysis unavailable. A warning or analysis failure uses a neutral check conclusion so the PR remains mergeable.

One bot comment is maintained using a stable HTML marker. It is updated for a new commit, changed result, dismissal, resolution, or failure. It says “may conflict” and includes the historical decision, status, evidence, confidence, and dashboard link.

## Dashboard and Permissions

The `/conflicts` page lists open warnings. Decision detail pages show conflicts connected to that historical decision. Reviewers see the PR title and number, historical approved or rejected decision, explanation, evidence from both sides, similarity, confidence, detected commit, and links to both records.

`ADMIN`, `MAINTAINER`, and `REVIEWER` can dismiss or resolve. `VIEWER` can read conflicts but receives `403` for mutation endpoints. Every mutation writes `ConflictAuditLog` with actor, previous state, next state, and note.

## Verification Checklist

Run these checks in a disposable repository or staging environment:

1. Keep `CONFLICT_DETECTION_ENABLED=false`; confirm V1 capture, V2 issue linking, and Phase 1 relationships behave as before.
2. Apply the migration and confirm `/health/conflicts` reports vector and model readiness.
3. Enable shadow mode and open an unrelated PR. Confirm one scan is created and no GitHub warning is posted.
4. Add an approved or rejected historical decision such as “Remove JWT because of security risk”. Open a PR titled “Bring back JWT authentication” with the same auth files. Confirm a bounded scan completes and the dashboard shows evidence-backed potential conflict data.
5. Confirm the GitHub Check and stable comment are updated, not duplicated, on a repeated delivery.
6. Push a new commit. Confirm the new head SHA gets a new scan and the old open conflict becomes stale.
7. Dismiss the warning. Repeat the same scan and confirm its status stays dismissed and its audit log records the actor.
8. Resolve a separate warning and confirm the dashboard and GitHub feedback update.
9. Edit the PR to remove the conflicting proposal. Confirm the new scan produces no warning.
10. Close and reopen the PR. Confirm active warnings are resolved or stale and a new scan starts after reopening.
11. Sign in as a viewer. Confirm conflicts are readable, actions are hidden or disabled, and direct `PATCH /conflicts/:id` returns `403` with no audit or database change.
12. Stop Ollama or use an invalid model in staging/local. Confirm the scan is `FAILED`, feedback says analysis is unavailable, and V1/V2 remain operational.
13. Check the mobile layout for no horizontal scrolling and usable links/actions.

## Observability and Recovery

The conflict queue logs job id, job kind, scan id, repository, PR number, candidate count, and failure details. The scan stores candidate count, conflict count, last attempt, last success, and a bounded error message. GitHub API errors include the endpoint and response status.

Alert on repeated conflict job failures, growing queue depth, Ollama or embedding outages, and repeated GitHub check/comment failures. Recovery is: check `/health/conflicts`, `/health/queue`, and `/health/ai`; restore the dependency or permission; retry the failed job or deliver a new PR event; then verify the scan, audit trail, and GitHub feedback. Always smoke-test V1 capture and V2 issue linking after recovery.

## Rollback

Set `CONFLICT_DETECTION_ENABLED=false` and restart or redeploy the backend and worker. This stops new scans and feedback without deleting existing records. V1 capture, V2 issue linking, and Phase 1 relationships remain available.

## Limitations Before Broad Production Rollout

The current implementation provides bounded lexical retrieval, pgvector ranking, a dedicated queue, structured logs, and a health endpoint. Before a broad rollout, add production metrics export and alert wiring for the hosting platform, run 1,000/10,000/100,000-record benchmarks, and validate the JWT and non-conflict scenarios with real repository data. Do not weaken evidence or permission checks to improve recall.
