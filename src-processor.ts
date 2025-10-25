/*
apps/worker/src/jobs/compactionJob.ts
Purpose:
  - Compact / force-save a snapshot for a given boardId.
Notes:
  - In a real system compaction would read ops log, apply them to a doc, and write a single snapshot.
  - For MVP we load latest snapshot (if any) and re-save it to bump version / metadata.
*/
import { Job } from "bullmq";
import { connect as connectDb, loadLatestSnapshot, saveSnapshot, getCollection } from "../../../packages/lib-db/src/index";
import dotenv from "dotenv";
import * as Y from "yjs";

dotenv.config();
const MONGO_URI = process.env.MONGODB_URI!;
const DB_NAME = process.env.DB_NAME ?? "asn_dev";

export async function compactionJobProcessor(job: Job) {
  // job.data = { boardId: string }
  const boardId = String(job.data.boardId);
  if (!MONGO_URI) throw new Error("MONGODB_URI required");
  await connectDb({ uri: MONGO_URI, dbName: DB_NAME });

  // load latest snapshot doc
  const latest = await loadLatestSnapshot(boardId);
  const doc = new Y.Doc();
  if (latest && latest.yjsSnapshot) {
    // apply existing snapshot if present (we expect a Yjs update binary)
    const buf = latest.yjsSnapshot.buffer ? new Uint8Array(latest.yjsSnapshot.buffer) : latest.yjsSnapshot;
    Y.applyUpdate(doc, buf);
  }

  // In a real compaction: apply pending ops and produce a new compact snapshot.
  const newSnapshot = Y.encodeStateAsUpdate(doc);
  const insertedId = await saveSnapshot(boardId, newSnapshot, { compaction: true, source: "worker" });
  return { insertedId };
}
