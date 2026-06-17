import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./app.js";
import { startDecisionWorker } from "./modules/queue/queue.js";

const app = createApp();

if (env.QUEUE_MODE === "bullmq" && env.QUEUE_WORKER_ENABLED) {
  logger.info(
    {
      queueMode: env.QUEUE_MODE
    },
    "Starting DecisionCapture BullMQ worker"
  );
  startDecisionWorker();
}

app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      queueMode: env.QUEUE_MODE,
      aiProvider: env.AI_PROVIDER
    },
    "DecisionCapture backend listening"
  );
});
