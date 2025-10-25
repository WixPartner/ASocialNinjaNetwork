/*
apps/worker/src/jobs/aiJob.ts
Dependencies:
  - uses packages/lib-ai and packages/lib-db
Purpose:
  - Given a prompt, call Gemini via lib-ai and persist result in ai_jobs collection
*/
import { Job } from "bullmq";
import { GeminiClient } from "../../../packages/lib-ai/src/geminiClient";
import { connect as connectDb, getCollection } from "../../../packages/lib-db/src/index";
import dotenv from "dotenv";

dotenv.config();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGODB_URI!;
const DB_NAME = process.env.DB_NAME ?? "asn_dev";

if (!GEMINI_KEY) console.warn("No GEMINI_API_KEY set for AI jobs (will error if executed)");

export async function aiJobProcessor(job: Job) {
  // job.data = { prompt: string, boardId?: string, userId?: string, options?: {} }
  console.log("aiJobProcessor", job.id, job.data);
  if (!MONGO_URI) throw new Error("MONGODB_URI required");

  await connectDb({ uri: MONGO_URI, dbName: DB_NAME });

  const client = new GeminiClient(GEMINI_KEY ?? "");
  const inputPrompt = String(job.data.prompt ?? "");
  const prediction = await client.predict(inputPrompt, { maxTokens: 512 });

  // persist result
  const coll = getCollection("ai_jobs");
  const doc = {
    boardId: job.data.boardId,
    userId: job.data.userId,
    input: inputPrompt,
    result: prediction,
    status: "completed",
    createdAt: new Date(),
    completedAt: new Date(),
  } as any;
  await coll.insertOne(doc);

  return { resultId: doc._id };
}
