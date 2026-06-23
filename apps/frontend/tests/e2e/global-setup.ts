import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDirectory = fileURLToPath(new URL("../../../../", import.meta.url));
const composeFile = fileURLToPath(new URL("../../../../docker-compose.e2e.yml", import.meta.url));

export default async function globalSetup() {
  if (process.env.E2E_USE_EXISTING_STACK === "true") {
    return;
  }

  const composeArgs = [
    "compose",
    "--project-name",
    "decisioncapture-e2e",
    "--file",
    composeFile
  ];

  try {
    await execFileAsync(
      "docker",
      [
        ...composeArgs,
        "up",
        "--detach",
        "--build",
        "--wait",
        "--wait-timeout",
        "240"
      ],
      { cwd: rootDirectory }
    );
  } catch (error) {
    await execFileAsync("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
      cwd: rootDirectory
    }).catch(() => undefined);
    throw error;
  }
}
