import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  webhookEvent: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn()
  },
  externalContext: {
    findUnique: vi.fn(),
    findFirst: vi.fn()
  },
  providerConnection: {
    findUnique: vi.fn(),
    upsert: vi.fn()
  }
}));
const queueMock = vi.hoisted(() => ({
  enqueueContextWebhook: vi.fn()
}));
const syncMock = vi.hoisted(() => ({
  contextSyncService: {
    sync: vi.fn()
  }
}));

vi.mock("../src/modules/database/prisma.js", () => ({ prisma: prismaMock }));
vi.mock("../src/modules/contexts/queue.js", () => queueMock);
vi.mock("../src/modules/contexts/sync.service.js", () => syncMock);

import { ContextWebhookService } from "../src/modules/contexts/webhook.service.js";

function webhookEvent(eventType: string, payload: Record<string, unknown>) {
  return {
    id: "webhook-1",
    eventType,
    status: "QUEUED",
    payload
  };
}

describe("ContextWebhookService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.webhookEvent.create.mockResolvedValue({ id: "webhook-1" });
    prismaMock.webhookEvent.update.mockResolvedValue({ id: "webhook-1" });
    prismaMock.externalContext.findUnique.mockResolvedValue({ id: "context-91" });
    prismaMock.externalContext.findFirst.mockResolvedValue(null);
    prismaMock.providerConnection.findUnique.mockResolvedValue(null);
    prismaMock.providerConnection.upsert.mockResolvedValue({ id: "connection-1" });
    queueMock.enqueueContextWebhook.mockResolvedValue(undefined);
    syncMock.contextSyncService.sync.mockResolvedValue({ status: "SYNCED" });
  });

  it("stores and queues a webhook delivery once", async () => {
    const result = await new ContextWebhookService().receive("issues", "delivery-1", {
      action: "edited"
    });

    expect(result).toEqual({ status: "queued", webhookEventId: "webhook-1" });
    expect(prismaMock.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalDeliveryId: "delivery-1",
          eventType: "issues",
          status: "QUEUED"
        })
      })
    );
    expect(queueMock.enqueueContextWebhook).toHaveBeenCalledWith("webhook-1");
  });

  it("treats a repeated GitHub delivery as an idempotent duplicate", async () => {
    prismaMock.webhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6.19.0"
      })
    );

    await expect(
      new ContextWebhookService().receive("issues", "delivery-1", { action: "edited" })
    ).resolves.toEqual({ status: "duplicate" });
    expect(queueMock.enqueueContextWebhook).not.toHaveBeenCalled();
  });

  it("synchronizes a linked issue from issue events", async () => {
    prismaMock.webhookEvent.findUnique.mockResolvedValue(
      webhookEvent("issues", {
        action: "edited",
        repository: { full_name: "acme/api" },
        issue: { id: 91, number: 91 }
      })
    );

    await expect(new ContextWebhookService().process("webhook-1")).resolves.toEqual({
      status: "processed"
    });
    expect(syncMock.contextSyncService.sync).toHaveBeenCalledWith("context-91");
    expect(prismaMock.webhookEvent.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PROCESSED" })
      })
    );
  });

  it("ignores pull request comments in the issue comment webhook", async () => {
    prismaMock.webhookEvent.findUnique.mockResolvedValue(
      webhookEvent("issue_comment", {
        action: "created",
        repository: { full_name: "acme/api" },
        issue: { id: 92, number: 92, pull_request: {} }
      })
    );

    await new ContextWebhookService().process("webhook-1");

    expect(syncMock.contextSyncService.sync).not.toHaveBeenCalled();
  });

  it("marks a deleted GitHub App installation disconnected", async () => {
    prismaMock.webhookEvent.findUnique.mockResolvedValue(
      webhookEvent("installation", {
        action: "deleted",
        installation: {
          id: 1234,
          account: { id: 42, login: "acme" },
          permissions: { issues: "read" }
        }
      })
    );

    await new ContextWebhookService().process("webhook-1");

    expect(prismaMock.providerConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ status: "DISCONNECTED" }),
        create: expect.objectContaining({
          status: "DISCONNECTED",
          scopes: ["issues:read"]
        })
      })
    );
  });
});
