import { startDecisionWorker } from "./queue.js";
import { startContextWorker } from "../contexts/queue.js";

startDecisionWorker();
startContextWorker();
