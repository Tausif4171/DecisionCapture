# V3 Decision Relationships Runbook

This runbook covers the controlled rollout, verification, recovery, and rollback of V3 decision relationships.

V3 compares an approved decision with a bounded set of older approved decisions from the same repository. Ollama returns evidence-backed suggestions. A human reviewer must accept a suggestion before it becomes a confirmed relationship.

## Scope and Safety

V3 is separate from:

- V1 merged pull request capture and review.
- V2 GitHub issue linking and synchronization.
- Manual context linking.

V3 is disabled by default. Disabling V3 hides the relationship UI and stops new relationship analysis; it does not delete existing relationship records.

## Configuration

Set these values on the backend and on the worker when they run as separate services:

```env
AI_PROVIDER=ollama
OLLAMA_BASE_URL=https://your-ollama-host
OLLAMA_MODEL=llama3.1
OLLAMA_REQUEST_TIMEOUT_MS=120000

QUEUE_MODE=bullmq
QUEUE_WORKER_ENABLED=true

RELATIONSHIP_ANALYSIS_ENABLED=true
RELATIONSHIP_ANALYSIS_MAX_CANDIDATES=12
RELATIONSHIP_CONFIDENCE_THRESHOLD=0.65
```

The candidate limit is capped at 25 by configuration validation. Candidate selection is deterministic and uses repository, approval status, decision age, files, code areas, text, and linked-context signals.

For rollback, set:

```env
RELATIONSHIP_ANALYSIS_ENABLED=false
```

Restart or redeploy the backend after changing environment variables.

## Health Checks

Use the backend URL for direct checks:

```bash
BACKEND_URL="https://your-backend.example.com"

curl -sS "$BACKEND_URL/health/queue" | jq
curl -sS "$BACKEND_URL/health/ai" | jq
```

When the frontend proxies the backend, the equivalent browser-facing paths are:

```bash
FRONTEND_URL="https://your-frontend.example.com"

curl -sS "$FRONTEND_URL/api/health/queue" | jq
curl -sS "$FRONTEND_URL/api/health/ai" | jq
```

Expected queue response:

```json
{
  "status": "ok",
  "queueMode": "bullmq",
  "workerEnabled": true
}
```

The AI response should report `reachable: true` and `modelAvailable: true`. If `OLLAMA_BASE_URL` points to localhost in a hosted deployment, it points to the backend container, not a developer laptop.

## Roles and Permissions

- `ADMIN`, `MAINTAINER`, and `REVIEWER` can analyze, accept, and dismiss relationship suggestions.
- `VIEWER` can read permitted decisions and relationships but cannot manage relationship analysis.
- The backend returns `403` for viewer analyze, accept, and dismiss requests.
- With `AUTH_GITHUB_PUBLIC_VIEWERS=true`, unlisted GitHub accounts can sign in as viewers.
- With public viewers disabled, add a viewer login to `AUTH_ALLOWED_LOGINS` and keep it out of the role-specific lists.

Manual verification with a viewer account:

1. Sign in with a GitHub account that has the `VIEWER` role.
2. Open an approved decision with relationship data.
3. Confirm confirmed relationships and suggestions are readable.
4. Confirm Analyze, Accept, and Dismiss actions are unavailable.
5. In browser DevTools, confirm the relationship GET request succeeds and a POST to `/api/decisions/:id/relationships/analyze` returns `403`.
6. Confirm no audit entry or relationship state changes.

## Relationship Lifecycle

```text
Feature disabled
    |
    v
Feature enabled + approved decision
    |
    v
Pending -> Running -> Completed
                    |
                    +-> suggestions needing review
                    +-> no suggestions
                    +-> Failed

Suggestion --accept--> Confirmed relationship
Suggestion --dismiss-> Dismissed and retained to prevent repeated noise
Confirmed/Suggested --reopen connected decision--> Stale
```

Relationships are directional in storage: the newer decision is the source and the older decision is the target. The confirmed relationship is visible from both decision pages. A newer decision says `Supersedes` or `Builds on`; the older decision shows the inverse wording such as `Superseded by` or `Built on by`.

## End-to-End Verification

Use staging or a disposable production test record for state-changing checks.

1. Confirm the queue and AI health checks pass.
2. Confirm at least two older decisions are approved and belong to the same repository.
3. Enable V3 and deploy the backend and worker.
4. Create or use an approved decision with related files or topic.
5. Open the decision and run analysis.
6. Confirm the state moves from `Pending` to `Running` to `Completed`.
7. Confirm each suggestion includes a relationship type, confidence, explanation, evidence, and related decision.
8. Accept one defensible suggestion and confirm it appears as a confirmed relationship on both decision pages.
9. Dismiss a weak suggestion and run analysis again. Confirm the dismissed suggestion does not return.
10. Run analysis again and confirm confirmed relationships are not duplicated.
11. Reopen one connected decision. Confirm the active relationship becomes stale and disappears from the active relationship list immediately.
12. Re-approve the decision. Confirm V3 shows Analyze relationships again and does not silently restore the old relationship.
13. Test a viewer account using the permission steps above.
14. On staging or local only, make Ollama unreachable or configure an invalid model. Confirm relationship analysis becomes `Failed` while V1 capture and V2 GitHub issue linking continue to work.
15. Check desktop and mobile layouts for relationship cards, evidence, and actions.

## Failure Recovery

If analysis fails:

1. Check `/health/queue` and `/health/ai`.
2. Check backend and worker logs for the decision ID.
3. Verify Redis connectivity, the Ollama URL, and the configured model.
4. Restore the dependency and run Analyze relationships again.
5. Confirm the failure did not change the decision status or remove GitHub context links.

If the worker is unhealthy, restart the worker or backend service according to the deployment platform. Do not manually edit relationship rows to recover a failed analysis.

## Rollback

For an immediate V3 rollback:

1. Set `RELATIONSHIP_ANALYSIS_ENABLED=false`.
2. Redeploy or restart the backend and worker.
3. Confirm the relationship section is hidden.
4. Confirm V1 capture, review, and V2 GitHub synchronization still work.
5. Keep the database records for later investigation; rollback does not delete them.

## Sign-Off Checklist

- [ ] Production commit recorded.
- [ ] Database schema is deployed.
- [ ] Queue health reports BullMQ with the worker enabled.
- [ ] Ollama health reports reachable and model available.
- [ ] Approved relationship accepted and visible from both sides.
- [ ] Weak suggestion dismissed and not returned.
- [ ] Duplicate analysis does not create duplicate relationships.
- [ ] Reopen marks relationships stale and the UI refreshes without a browser reload.
- [ ] Re-approval requires fresh analysis.
- [ ] Viewer read-only behavior and backend `403` protection verified.
- [ ] Ollama failure isolation verified in staging or local.
- [ ] V1 and V2 smoke checks pass.
- [ ] Rollback with `RELATIONSHIP_ANALYSIS_ENABLED=false` verified.
