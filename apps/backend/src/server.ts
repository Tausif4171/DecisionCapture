import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { createApp } from "./app.js";
import { startDecisionWorker } from "./modules/queue/queue.js";
import { startContextWorker } from "./modules/contexts/queue.js";
import { startRelationshipWorker } from "./modules/relationships/queue.js";

const app = createApp();

if (env.QUEUE_MODE === "bullmq" && env.QUEUE_WORKER_ENABLED) {
  logger.info(
    {
      queueMode: env.QUEUE_MODE
    },
    "Starting DecisionCapture BullMQ worker"
  );
  startDecisionWorker();
  startContextWorker();
  startRelationshipWorker();
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
