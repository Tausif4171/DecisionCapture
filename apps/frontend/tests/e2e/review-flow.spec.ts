import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:4010";
const ROOT_ENV_PATH = fileURLToPath(new URL("../../../../.env", import.meta.url));
const API_READY_TIMEOUT_MS = 45_000;
const API_RETRY_DELAY_MS = 1_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRootEnvValue(name: string) {
  const content = await readFile(ROOT_ENV_PATH, "utf8");
  const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));

  if (!match) {
    throw new Error(`Missing ${name} in .env`);
  }

  return match[1]!.trim();
}

async function waitForApi() {
  const deadline = Date.now() + API_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_URL}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Health check failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(API_RETRY_DELAY_MS);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`DecisionCapture API was not ready at ${API_URL}: ${message}`);
}

async function fetchWithRetry(input: string, init: RequestInit) {
  const deadline = Date.now() + API_READY_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(input, init);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`Request failed with ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await sleep(API_RETRY_DELAY_MS);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Request to DecisionCapture API did not complete: ${message}`);
}

async function seedPendingDecision() {
  const token =
    process.env.INGEST_API_TOKEN ??
    process.env.DECISIONCAPTURE_TOKEN ??
    (process.env.E2E_USE_EXISTING_STACK === "true"
      ? await readRootEnvValue("INGEST_API_TOKEN")
      : "decisioncapture-e2e-token");

  await waitForApi();

  const prNumber = 900000 + Math.floor(Date.now() % 100000);
  const expectedDecision = "Log worker startup when DecisionCapture runs in BullMQ mode.";
  const request = await fetchWithRetry(`${API_URL}/decisions/analyze?wait=true`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-decisioncapture-token": token
    },
    body: JSON.stringify({
      prNumber,
      title: "Log BullMQ worker startup for async decision processing",
      description:
        "Decision: Log worker startup when DecisionCapture runs in BullMQ mode. Reason: merged-PR analysis depends on the queue worker being active, so startup visibility helps confirm async processing is healthy. Alternative: rely only on generic container boot logs. Impact: queue-based processing becomes easier to verify and debug in local and deployed environments.",
      author: "Tausif4171",
      url: `https://github.com/Tausif4171/DecisionCapture/pull/${prNumber}`,
      repository: "Tausif4171/DecisionCapture",
      filesChanged: [
        "apps/backend/src/server.ts",
        "apps/backend/src/modules/e2e/second.ts",
        "apps/backend/src/modules/e2e/third.ts",
        "apps/backend/src/modules/e2e/fourth.ts",
        "apps/backend/src/modules/e2e/fifth.ts",
        "apps/backend/src/modules/e2e/sixth.ts",
        "apps/backend/src/modules/e2e/seventh.ts",
        "apps/backend/src/modules/e2e/eighth.ts",
        "apps/backend/src/modules/e2e/ninth.ts",
        "apps/backend/src/modules/e2e/tenth.ts"
      ],
      commits: ["feat: log BullMQ worker startup for async decision processing"],
      reviewers: [],
      reviewComments: [],
      approvals: [],
      labels: ["infrastructure"],
      diffSummary: "Add a backend startup log for the BullMQ worker."
    })
  });

  if (!request.ok) {
    throw new Error(`Seed request failed with ${request.status}`);
  }

  const body = (await request.json()) as {
    status?: string;
    decision?: { id: string; status: string; decision: string };
  };
  const decision = body.decision;

  if (
    body.status !== "processed" ||
    decision?.status !== "PENDING" ||
    !decision?.id ||
    decision.decision !== expectedDecision
  ) {
    throw new Error(`Expected a pending decision, got ${JSON.stringify(body)}`);
  }

  return decision;
}

test("pending review can be saved as draft and approved separately", async ({ page }) => {
  const seededDecision = await seedPendingDecision();
  const editedDecision = "Updated draft decision for smoke test";

  await page.goto("/pending");

  const pendingCard = page.getByTestId(`pending-decision-${seededDecision.id}`);

  await expect(pendingCard).toBeVisible();
  await expect(pendingCard.getByRole("button", { name: "Save draft" })).toBeDisabled();

  await pendingCard.getByLabel("Decision").fill(editedDecision);
  await expect(pendingCard.getByRole("button", { name: "Save draft" })).toBeEnabled();

  await pendingCard.getByRole("button", { name: "Save draft" }).click();
  await expect(pendingCard.getByText("Draft saved. This decision is still pending.")).toBeVisible();

  await pendingCard.getByRole("button", { name: "Approve" }).click();

  await page.goto(`/decisions/${seededDecision.id}`);
  await expect(page.getByText("Approved decisions are locked to preserve an auditable record.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: editedDecision })).toBeVisible();
  await expect(page.getByText("apps/backend/src/modules/e2e/eighth.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("apps/backend/src/modules/e2e/ninth.ts", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Show all 10 files" }).click();
  await expect(page.getByText("apps/backend/src/modules/e2e/ninth.ts", { exact: true })).toBeVisible();
  await expect(page.getByText("apps/backend/src/modules/e2e/tenth.ts", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show fewer" }).click();
  await expect(page.getByText("apps/backend/src/modules/e2e/ninth.ts", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Reopen review" }).click();
  const reopenDialog = page.getByRole("dialog", { name: "Reopen review" });
  await reopenDialog.getByLabel("Reason for reopening").fill("New evidence requires another decision review.");
  await reopenDialog.getByRole("button", { name: "Reopen review" }).click();

  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Review reopened by DecisionCapture")).toBeVisible();
  await expect(page.getByText("New evidence requires another decision review.")).toBeVisible();
});

test("rejection requires a reason and records it in audit history", async ({ page }) => {
  const seededDecision = await seedPendingDecision();
  const rejectionReason = "This extraction is implementation detail rather than a durable decision.";

  await page.goto("/pending");

  const pendingCard = page.getByTestId(`pending-decision-${seededDecision.id}`);
  await pendingCard.getByRole("button", { name: "Reject" }).click();

  const rejectDialog = page.getByRole("dialog", { name: "Reject decision" });
  const confirmButton = rejectDialog.getByRole("button", { name: "Reject decision" });

  await expect(confirmButton).toBeDisabled();
  await rejectDialog.getByLabel("Reason for rejection").fill("Too short");
  await expect(confirmButton).toBeDisabled();
  await rejectDialog.getByLabel("Reason for rejection").fill(rejectionReason);
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(pendingCard).toHaveCount(0);
  await page.goto(`/decisions/${seededDecision.id}`);
  await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(page.getByText(rejectionReason)).toBeVisible();
});

test("decision search uses URL-backed automatic filters", async ({ page }) => {
  const seededDecision = await seedPendingDecision();

  await page.goto("/decisions");

  await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
  await page.getByPlaceholder("Search decisions...").fill("BullMQ");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("BullMQ");
  await expect(page.getByRole("heading", { name: seededDecision.decision }).first()).toBeVisible();

  await page.getByRole("button", { name: "Filter status" }).click();
  await page.getByRole("option", { name: "Pending" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("status")).toBe("PENDING");

  await page.getByRole("button", { name: "Sort decisions" }).click();
  await page.getByRole("option", { name: "Highest confidence" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("confidence");

  await page.getByRole("button", { name: "Clear search" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("");
});
