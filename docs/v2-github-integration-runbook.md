# V2 GitHub Integration Closeout

This runbook closes the current V2 GitHub integration scope before V3 work
begins. It is operational documentation only; it does not change runtime
behavior.

## Scope

The current V2 production flow is:

```text
Merged PR
  -> GitHub Action or webhook
  -> DecisionCapture ingestion
  -> BullMQ decision worker
  -> Decision
  -> Explicit GitHub issue reference or manual context link
  -> Context-sync worker
  -> Synced issue metadata and audit history
```

V2 GitHub scope is complete when the checks in this document pass. Linear,
Jira, ADR, architecture-document, and meeting integrations remain deferred.

## Production Baseline

The repository baseline for this closeout is the merged `master` commit:

```text
0df288c7c1745780f30d0d622a386670842e4eb2
```

Confirm the live Render deployment shows the same commit before recording it
as the production commit. The health endpoint confirms configuration, but it
does not report the deployed Git commit.

Verify the repository target locally:

```bash
git fetch origin
git rev-parse origin/master
git log -1 --format='%H %s' origin/master
```

Record the live commit from the Render deployment page in the release notes
or deployment record. Do not infer it from a successful health response.

## GitHub App Setup

In GitHub App settings, confirm these repository permissions:

- Metadata: Read-only
- Issues: Read-only
- Pull requests: Read and write

The pull-request write permission is needed when the backend posts or updates
the DecisionCapture review comment. The workflow itself separately uses its
GitHub Actions token with contents read and pull requests read permissions.

Confirm these app events are enabled:

- Pull request
- Issues
- Issue comment
- Installation
- Installation repositories

Install or update the App on every repository that should be available to the
issue picker. When permissions change, approve the updated permissions for
the existing installation.

Keep these credential types separate:

- GitHub App credentials: backend repository access, issue synchronization,
  webhook processing, and PR comments.
- GitHub OAuth App credentials: human dashboard sign-in.

Never put App private keys, installation tokens, OAuth secrets, or ingestion
tokens in the frontend or in a PR body.

## Queue Health

The current Render service starts both BullMQ workers in the backend process
when `QUEUE_MODE=bullmq` and `QUEUE_WORKER_ENABLED=true`. A separate worker
service is not required for the current deployment.

Check the backend directly:

```bash
curl -fsS https://decisioncapture.onrender.com/health/queue | jq
```

Expected response:

```json
{
  "status": "ok",
  "queueMode": "bullmq",
  "workerEnabled": true
}
```

If the frontend proxy is the production entry point, also check:

```bash
curl -fsS https://decision-capture.vercel.app/api/health/queue | jq
```

This endpoint confirms the configured queue mode and worker flag. It does not
prove that Redis is reachable or that a particular job completed. Confirm
real processing with the smoke test below and the Render logs.

## Production Smoke Test

Use a disposable GitHub issue and a small real PR in the installed test
repository.

1. Create an open issue with a title, description, labels, and one comment.
2. Create a PR with a harmless real file change and put `Fixes #<issue-number>`
   in its body.
3. Merge the PR.
4. Confirm the GitHub Action succeeds and its summary says `queued` or
   `processed`, with a non-empty message.
5. Confirm one DecisionCapture decision is created for that PR.
6. Confirm the issue is automatically linked to that decision.
7. Confirm the linked issue reaches `Synced` and displays title, description,
   labels, author, comments, and state.
8. Edit the issue title, description, labels, and comments; close and reopen
   it; confirm webhook updates arrive without a manual page reload.
9. Confirm the audit history records the automatic link.
10. Confirm the original PR receives the expected DecisionCapture comment.

`queued` is expected for BullMQ mode: the Action submitted the job and the
worker completes it asynchronously.

## Required Edge-Case Checks

### Duplicate webhook delivery

Use GitHub's webhook delivery page to redeliver the same delivery in a test
environment or for a non-destructive production issue.

Expected result:

- The duplicate delivery is recognized safely.
- No second decision-context relationship is created.
- The existing context remains available and synchronized.

The database uniqueness rule is the final protection against duplicate links.

### Missing credentials

Do not remove production credentials to test this. Use a preview, staging, or
local environment with GitHub App credentials disabled.

Expected result:

- Existing decisions and relationships remain.
- Synchronization reports a failure or unavailable state.
- Existing context metadata is not deleted.
- Manual URL linking remains available when configured by the product policy.

Restore credentials and restart the service before continuing.

### Failed queue or stopped worker

Inject this only in staging or local Docker by stopping Redis or the worker,
then restore the dependency and restart the service.

Expected result:

- The failure is visible in the service logs or sync state.
- BullMQ retries according to its configured retry policy.
- Restarting the worker allows queued work to finish.
- No duplicate relationship is created.

Do not intentionally break the production Redis connection as a test.

## Recovery Procedures

### GitHub Action capture

List recent runs:

```bash
gh run list \
  --repo Tausif4171/DecisionCapture \
  --workflow decisioncapture.yml \
  --event pull_request \
  --limit 10
```

Rerun a failed or intentionally selected capture run:

```bash
gh run rerun <RUN_ID> --repo Tausif4171/DecisionCapture
gh run watch <RUN_ID> \
  --repo Tausif4171/DecisionCapture \
  --exit-status
```

Rerunning the Action re-submits PR analysis. It does not replace the GitHub
issue webhook or manually refresh an existing context.

### Render service and workers

Because the current deployment runs both workers in the backend service:

1. Open the DecisionCapture web service in Render.
2. Confirm the deployment commit is the intended `master` commit.
3. Deploy or restart that service.
4. Wait for the service to become live.
5. Re-run the queue-health command.
6. Check Render logs for worker startup and processing messages.

Useful log messages include:

- `Starting DecisionCapture BullMQ worker`
- `Processing PR analysis job`
- `Processing context job`
- `GitHub issue context synchronized`
- `Decision job completed`
- `Context job failed`

### GitHub webhook delivery

1. Open the GitHub App or repository webhook settings.
2. Open the failed delivery and inspect the response code and response body.
3. Confirm the endpoint is the deployed backend route:
   `POST /github/webhook`.
4. Redeliver after the backend is healthy.
5. Confirm the linked issue eventually reaches `Synced`.

Webhook signatures are verified before processing. A redelivery with the same
delivery ID is intentionally deduplicated.

## Closeout Record

Mark the following as complete only after the production smoke test passes:

- [ ] GitHub App permissions and events confirmed
- [ ] Installed test repository confirmed
- [ ] Queue mode and worker confirmed
- [ ] Production commit recorded from the deployment provider
- [ ] Automatic issue-linking smoke test passed
- [ ] Issue metadata webhook update passed
- [ ] Duplicate delivery handled safely
- [ ] Missing-credential behavior verified outside production
- [ ] Failed-queue recovery verified outside production
- [ ] No regression in V1 capture, review, approval, rejection, or audit flow

Once these checks are complete, the release can be described as:

```text
V2 GitHub integration complete.
V2 multi-provider integrations remain deferred.
V3 reasoning and decision-relationship work may begin.
```
