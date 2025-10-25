/*
apps/realtime/src/index.ts
Dependencies:
  npm install ws yjs ioredis dotenv
Purpose:
  - Minimal WebSocket server that accepts Yjs binary updates and relays them to other clients.
  - Uses Redis pub/sub for multi-node broadcasts.
  - Periodically persists snapshots to Mongo via packages/lib-db.
Notes:
  - This is a readable minimal server for MVP. Add auth, rate limits, backpressure for production.
*/
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import Redis from "ioredis";
import * as Y from "yjs";
import { connect as connectDb, loadLatestSnapshot, saveSnapshot } from "../../packages/lib-db/src/index";
import { applySnapshotToDoc, applyUpdateToDoc, encodeStateAsUpdate } from "./yjs-adapter";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const MONGO_URI = process.env.MONGODB_URI!;
const DB_NAME = process.env.DB_NAME ?? "asn_dev";

if (!MONGO_URI) {
  console.warn("MONGODB_URI not set — realtime cannot persist snapshots without it");
}

type BoardState = {
  doc: Y.Doc;
  clients: Set<WebSocket>;
  persistTimer?: NodeJS.Timeout;
};

const boards = new Map<string, BoardState>();

async function init() {
  if (MONGO_URI) {
    await connectDb({ uri: MONGO_URI, dbName: DB_NAME });
  }
  const pub = new Redis(REDIS_URL);
  const sub = new Redis(REDIS_URL);

  // subscribe pattern for boards
  sub.on("messageBuffer", (channelBuf: Buffer, messageBuf: Buffer) => {
    try {
      const channel = channelBuf.toString();
      if (!channel.startsWith("board:")) return;
      const boardId = channel.slice("board:".length);
      const update = messageBuf; // Buffer (Uint8Array) of Yjs update
      const st = boards.get(boardId);
      if (st) {
        // apply to local doc and broadcast to local clients
        applyUpdateToDoc(st.doc, update);
        for (const ws of st.clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(update);
          }
        }
      }
    } catch (err) {
      console.error("Error handling pubsub message", err);
    }
  });

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    // Expect query params: ?boardId=... (and optionally token)
    const url = req.url ?? "/";
    const params = new URL("http://example.com" + url).searchParams;
    const boardId = params.get("boardId");
    if (!boardId) {
      ws.close(1008, "missing boardId");
      return;
    }

    // simple per-board state
    let st = boards.get(boardId);
    if (!st) {
      const doc = new Y.Doc();
      st = { doc, clients: new Set() };
      boards.set(boardId, st);

      // try load last snapshot from DB (non-blocking)
      if (MONGO_URI) {
        loadLatestSnapshot(boardId)
          .then((docSnapshot: any) => {
            if (docSnapshot && docSnapshot.yjsSnapshot) {
              applySnapshotToDoc(doc, docSnapshot.yjsSnapshot.buffer ? new Uint8Array(docSnapshot.yjsSnapshot.buffer) : docSnapshot.yjsSnapshot);
            }
          })
          .catch((err) => {
            console.warn("failed to load snapshot for board", boardId, err);
          });
      }

      // subscribe to redis channel for this board
      sub.subscribe("board:" + boardId).catch((e) => console.error(e));
    }

    st.clients.add(ws);

    ws.on("message", (data: WebSocket.RawData) => {
      try {
        // Expect binary frames containing Yjs updates (Uint8Array / Buffer)
        const update = Buffer.isBuffer(data) ? new Uint8Array(data as Buffer) : new Uint8Array(data as any);
        // apply locally
        applyUpdateToDoc(st!.doc, update);
        // broadcast to local clients
        for (const client of st!.clients) {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(update);
          }
        }
        // publish to redis for other nodes
        pub.publishBuffer("board:" + boardId, Buffer.from(update));
        // schedule persistence (debounced)
        schedulePersist(boardId, st!);
      } catch (err) {
        console.error("error processing incoming ws message", err);
      }
    });

    ws.on("close", () => {
      st!.clients.delete(ws);
      // optional: if no clients, consider unloading doc after idle timeout
      if (st!.clients.size === 0) {
        // schedule unload after X seconds
        setTimeout(() => {
          const cur = boards.get(boardId);
          if (cur && cur.clients.size === 0) {
            // persist final snapshot synchronously (best-effort)
            persistNow(boardId, cur).catch((e) => console.warn("persist on unload failed", e));
            boards.delete(boardId);
            sub.unsubscribe("board:" + boardId).catch(() => {});
          }
        }, 30_000); // 30s idle
      }
    });

    // send initial state: encode all state as update
    const initUpdate = encodeStateAsUpdate(st.doc);
    if (ws.readyState === WebSocket.OPEN) ws.send(initUpdate);
  });

  server.listen(PORT, () => {
    console.log(`Realtime WS server listening on :${PORT}`);
  });

  async function persistNow(boardId: string, st: BoardState) {
    if (!MONGO_URI) return;
    try {
      const snapshot = encodeStateAsUpdate(st.doc);
      await saveSnapshot(boardId, snapshot, { persistedBy: "realtime-node" });
      console.log("persisted snapshot for", boardId);
    } catch (err) {
      console.warn("failed to persist snapshot", err);
    }
  }

  function schedulePersist(boardId: string, st: BoardState) {
    if (st.persistTimer) {
      clearTimeout(st.persistTimer);
    }
    // debounce persistence by 2s (tune for workload)
    st.persistTimer = setTimeout(() => {
      persistNow(boardId, st).catch((e) => console.warn(e));
      st!.persistTimer = undefined;
    }, 2000);
  }
}

init().catch((err) => {
  console.error("Realtime server failed to start", err);
  process.exit(1);
});
