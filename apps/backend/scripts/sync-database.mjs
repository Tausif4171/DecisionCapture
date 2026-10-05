import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASELINE_MIGRATION = "20261001000000_baseline";
const conflictDetectionEnabled = process.env.CONFLICT_DETECTION_ENABLED === "true";
const prisma = new PrismaClient();

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false
    });

    child.on("exit", (code, signal) => {
      resolve(signal ? 1 : code ?? 1);
    });
  });
}

async function readMigrationState() {
  const [schema] = await prisma.$queryRawUnsafe(`
    SELECT to_regclass('public.decision_memories') IS NOT NULL AS "exists"
  `);
  const [migrationTable] = await prisma.$queryRawUnsafe(`
    SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS "exists"
  `);

  if (!migrationTable?.exists) {
    return { existingSchema: Boolean(schema?.exists), hasMigrationHistory: false };
  }

  const [migrationCount] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS "count" FROM "_prisma_migrations"
  `);

  return {
    existingSchema: Boolean(schema?.exists),
    hasMigrationHistory: Number(migrationCount?.count ?? 0) > 0
  };
}

async function main() {
  let vectorReady = false;
  let migrationState;

  try {
    await prisma.$executeRawUnsafe("CREATE EXTENSION IF NOT EXISTS vector");
    vectorReady = true;
    migrationState = await readMigrationState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (conflictDetectionEnabled) {
      console.error(`Conflict detection requires pgvector before startup: ${message}`);
      process.exitCode = 1;
    } else {
      console.warn(`pgvector is unavailable; skipping database migration while conflict detection is disabled: ${message}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  if (process.exitCode === 1) {
    process.exit(1);
  }

  if (!vectorReady && !conflictDetectionEnabled) {
    return;
  }

  if (migrationState?.existingSchema && !migrationState.hasMigrationHistory) {
    console.log(`Existing schema detected without migration history; marking ${BASELINE_MIGRATION} as applied.`);
    const baselineExitCode = await runCommand("npx", [
      "prisma",
      "migrate",
      "resolve",
      "--applied",
      BASELINE_MIGRATION,
      "--schema",
      "prisma/schema.prisma"
    ]);

    if (baselineExitCode !== 0) {
      process.exitCode = baselineExitCode;
      return;
    }
  }

  process.exitCode = await runCommand("npm", ["run", "db:deploy"]);
}

await main();
