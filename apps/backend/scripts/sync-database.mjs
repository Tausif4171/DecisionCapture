import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const conflictDetectionEnabled = process.env.CONFLICT_DETECTION_ENABLED === "true";
const prisma = new PrismaClient();

let vectorReady = false;

try {
  await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
  vectorReady = true;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  if (conflictDetectionEnabled) {
    console.error(`Conflict detection requires pgvector before startup: ${message}`);
    process.exitCode = 1;
  } else {
    console.warn(`pgvector is unavailable; skipping schema sync while conflict detection is disabled: ${message}`);
  }
} finally {
  await prisma.$disconnect();
}

if (process.exitCode === 1) {
  process.exit(1);
}

if (!vectorReady && !conflictDetectionEnabled) {
  process.exit(0);
}

const child = spawn("npm", ["run", "db:push"], {
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});
