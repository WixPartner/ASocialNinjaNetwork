/*
packages/lib-db/src/index.ts
Dependencies:
  npm install mongodb p-retry
Purpose:
  - Singleton Mongo client
  - getCollection, watchCollection
  - saveSnapshot/loadLatestSnapshot for Yjs binary blobs (Uint8Array stored as BinData)
*/
import { MongoClient, Db, Collection, Document } from "mongodb";
import pRetry from "p-retry";

export type DBConfig = {
  uri: string;
  dbName: string;
  poolSize?: number;
  tls?: boolean;
};

let client: MongoClient | null = null;
let dbInstance: Db | null = null;

export async function connect(config: DBConfig): Promise<Db> {
  if (dbInstance) return dbInstance;

  const connectFn = async () => {
    const c = new MongoClient(config.uri, {
      maxPoolSize: config.poolSize ?? 10,
      tls: config.tls ?? true,
      appName: "asn-lib-db",
    });
    await c.connect();
    // ping ensures connection usable
    await c.db(config.dbName).command({ ping: 1 });
    return c;
  };

  client = await pRetry(connectFn, {
    retries: 5,
    factor: 2,
    minTimeout: 1000,
  });

  dbInstance = client.db(config.dbName);
  return dbInstance;
}

export function getDb(): Db {
  if (!dbInstance) throw new Error("Mongo not connected. Call connect() first.");
  return dbInstance;
}

export function getCollection<T = Document>(name: string): Collection<T> {
  return getDb().collection<T>(name);
}

/**
 * watchCollection - lightweight change stream subscriber
 * onEvent receives the change document
 */
export function watchCollection(name: string, pipeline: object[] = [], onEvent: (change: any) => Promise<void>) {
  const coll = getCollection(name);
  const stream = coll.watch(pipeline, { fullDocument: "updateLookup" });
  stream.on("change", async (change) => {
    try {
      await onEvent(change);
    } catch (err) {
      console.error("Error processing change stream event", err);
    }
  });
  stream.on("error", (err) => {
    console.error("Change stream error", err);
    // production: persist resume token & restart logic
  });
  return () =>*

