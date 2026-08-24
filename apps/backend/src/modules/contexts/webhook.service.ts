import { Prisma } from "@prisma/client";
import { HttpError } from "../../middleware/error.js";
import { prisma } from "../database/prisma.js";
import { enqueueContextWebhook } from "./queue.js";
import { contextSyncService } from "./sync.service.js";

type WebhookPayload = Record<string, unknown>;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDuplicateRecordError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function installationFromPayload(payload: WebhookPayload) {
  const installation = objectValue(payload.installation);
  const installationId = numberValue(installation?.id);
  if (!installationId) {
    return null;
  }

  return {
    installationId: String(installationId),
    account: objectValue(installation?.account),
    permissions: objectValue(installation?.permissions)
  };
}

function connectionStatusForAction(action: string | null) {
  if (action === "deleted") {
    return "DISCONNECTED" as const;
  }

  if (action === "suspend") {
    return "ERROR" as const;
  }

  return "ACTIVE" as const;
}

export class ContextWebhookService {
  async receive(eventType: string, deliveryId: string, payload: WebhookPayload) {
    let event: { id: string };

    try {
      event = await prisma.webhookEvent.create({
        data: {
          provider: "GITHUB",
          externalDeliveryId: deliveryId,
          eventType,
          payload: payload as Prisma.InputJsonObject,
          status: "QUEUED"
        },
        select: { id: true }
      });
    } catch (error) {
      if (isDuplicateRecordError(error)) {
        return { status: "duplicate" as const };
      }

      throw error;
    }

    try {
      await enqueueContextWebhook(event.id);
      return { status: "queued" as const, webhookEventId: event.id };
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Webhook queueing failed"
        }
      });
      throw error;
    }
  }

  async process(webhookEventId: string) {
    const event = await prisma.webhookEvent.findUnique({ where: { id: webhookEventId } });
    if (!event) {
      throw new HttpError(404, "Webhook event not found");
    }

    if (event.status === "PROCESSED") {
      return { status: "processed" as const };
    }

    const payload = objectValue(event.payload);
    if (!payload) {
      throw new Error("GitHub webhook payload must be an object");
    }

    await prisma.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: "QUEUED",
        attempts: { increment: 1 },
        lastError: null
      }
    });

    try {
      if (event.eventType === "issues" || event.eventType === "issue_comment") {
        await this.processIssueEvent(payload);
      } else if (event.eventType === "installation" || event.eventType === "installation_repositories") {
        await this.processInstallationEvent(payload);
      }

      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          lastError: null
        }
      });
      return { status: "processed" as const };
    } catch (error) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: "FAILED",
          lastError: error instanceof Error ? error.message : "Webhook processing failed"
        }
      });
      throw error;
    }
  }

  private async processIssueEvent(payload: WebhookPayload) {
    const repository = objectValue(payload.repository);
    const issue = objectValue(payload.issue);
    const repositoryName = stringValue(repository?.full_name);
    const issueNumber = numberValue(issue?.number);
    const githubIssueId = numberValue(issue?.id);

    if (!repositoryName || !issueNumber || issue?.pull_request) {
      return;
    }

    let context = await prisma.externalContext.findUnique({
      where: {
        provider_providerAccountId_externalId: {
          provider: "GITHUB",
          providerAccountId: repositoryName.toLowerCase(),
          externalId: `issue:${issueNumber}`
        }
      },
      select: { id: true }
    });

    if (!context && githubIssueId) {
      context = await prisma.externalContext.findFirst({
        where: {
          provider: "GITHUB",
          metadata: {
            path: ["githubIssueId"],
            equals: githubIssueId
          }
        },
        select: { id: true }
      });
    }

    if (context) {
      await contextSyncService.sync(context.id);
    }
  }

  private async processInstallationEvent(payload: WebhookPayload) {
    const installation = installationFromPayload(payload);
    if (!installation) {
      return;
    }

    const action = stringValue(payload.action);
    const accountLogin =
      stringValue(installation.account?.login) ??
      stringValue(installation.account?.slug) ??
      (numberValue(installation.account?.id) ? String(installation.account?.id) : null);
    const providerAccountId = `installation:${installation.installationId}`;
    const scopes = Object.entries(installation.permissions ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([permission, access]) => `${permission}:${access}`);
    const existing = await prisma.providerConnection.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "GITHUB",
          providerAccountId
        }
      }
    });
    const existingMetadata = objectValue(existing?.metadata) ?? {};

    await prisma.providerConnection.upsert({
      where: {
        provider_providerAccountId: {
          provider: "GITHUB",
          providerAccountId
        }
      },
      update: {
        status: connectionStatusForAction(action),
        ...(scopes.length ? { scopes } : {}),
        metadata: {
          ...existingMetadata,
          installationId: installation.installationId,
          accountLogin,
          lastWebhookAction: action
        }
      },
      create: {
        provider: "GITHUB",
        providerAccountId,
        status: connectionStatusForAction(action),
        scopes,
        metadata: {
          installationId: installation.installationId,
          accountLogin,
          lastWebhookAction: action
        }
      }
    });
  }
}

export const contextWebhookService = new ContextWebhookService();
