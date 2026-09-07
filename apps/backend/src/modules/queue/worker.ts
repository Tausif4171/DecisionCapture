import { startDecisionWorker } from "./queue.js";
import { startContextWorker } from "../contexts/queue.js";
import { startRelationshipWorker } from "../relationships/queue.js";

startDecisionWorker();
startContextWorker();
startRelationshipWorker();
