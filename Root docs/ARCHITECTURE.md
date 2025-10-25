# ASocialNinjaNetwork — Architecture, Real-time Choices, Data Serialization, & Initial Data Model
(Designed as a mentor-oriented guide for a backend engineer building a Figma/Miro-like whiteboard:
focus on clarity, maintainability, and a phased path from MVP → scale.)

---

## 1) High-level architecture (one-page summary + why)

Overview
- Monorepo (Node.js + TypeScript) with workspaces:
  - apps/web — React (SSG/SPA) + client-side Yjs CRDT integration.
  - apps/api — HTTP API (Fastify or Fastify-like) for auth, metadata, uploads.
  - apps/realtime — WebSocket gateway handling Yjs updates, presence, and persistence API.
  - apps/worker — background jobs (AI tasks, snapshot compaction, exports).
  - packages/{lib-db, lib-crdt, lib-ai, lib-auth, types} — shared libs & domain types.
- Infra pieces:
  - MongoDB Atlas — durable storage for users, board metadata, snapshots.
  - Redis (managed) — ephemeral presence, awareness, and cross-instance pub/sub.
  - Gemini/AI Studio — generative features invoked via workers.
  - GCP (GKE / Cloud Run) for runtime; Secret Manager for secrets.
- Observability: OpenTelemetry tracing, Prometheus metrics, structured logs, SLO alerts.

Why this shape (short)
- Monorepo + TypeScript: share types & validators between client/server, reduce friction when schema evolves.
- Separation: Realtime paths (low-latency) and API paths (auth, uploads) scale differently — split to scale independently.
- Managed infra: reduces ops burden so team focuses on product features.

Phased approach (practical)
- MVP: Single-process monolith combining API + Realtime; snapshot to Mongo periodically. Yjs + WebSocket.
- Phase 1: Split realtime service, add Redis pub/sub, add worker queue (BullMQ).
- Phase 2+: Autoscaling, sharding/resiliency, model orchestration, performance optimizations.

---

## 2) Real-time tech choice & core challenges (choice = Yjs + WebSockets + Redis + periodic Mongo snapshots)

Choice summary
- CRDT: Yjs (binary deltas, efficient merges, robust client ecosystem).
- Transport: WebSocket (server relay) initially. Optionally WebRTC peer channels for P2P in future.
- Cross-instance broadcast: Redis pub/sub (fast, battle-tested).
- Persistence: Periodic Yjs snapshots stored as binary (BSON BinData) in Mongo; optional append-op log for auditing.

Why Yjs + WebSockets
- Yjs advantages: compact binary updates, efficient merge semantics, good libraries (y-websocket provider, y-protocols).
- WebSockets: simpler to operate in corporate/firewall contexts; straightforward to add TLS and run behind LBs.
- Alternative OT/Automerge tradeoffs: OT needs central transformation server; Automerge has larger delta sizes and memory overhead—Yjs is a pragmatic middle ground for rich structured state.

Core implementation pattern (conceptual)
- Client holds local Y.Doc (Yjs).
- Client applies local changes and immediately applies them to UI.
- Client sends Yjs update (binary) over WebSocket to Realtime server.
- Realtime server applies update to an in-memory Y.Doc instance, immediately broadcasts the minimal delta to other connected clients (via Redis pub/sub if multi-node), and schedules persistence.
- Worker periodically compacts history into snapshots, truncates op logs.

Real-time challenges and mitigations
1. Memory usage and in-memory docs
   - Challenge: keeping a Y.Doc per active board consumes RAM; long-lived large boards grow memory.
   - Mitigation: idle eviction policy, persist snapshots, reload on demand; cap size per board with eviction/snapshotting heuristics.
2. Recovery & resume tokens
   - Challenge: nodes restart lose ephemeral in-memory state; clients must re-sync.
   - Mitigation: persist snapshots to Mongo and let clients re-sync from snapshot + small op window; use awareness sync protocol.
3. Ordering / duplication / idempotency
   - Challenge: network retries can produce duplicate ops.
   - Mitigation: delegate merge semantics to CRDT (Yjs) which is idempotent for merges; track sequence numbers for ops if using append logs.
4. Bandwidth & large diffs
   - Challenge: very large updates (images, attachments) bloat realtime channel.
   - Mitigation: move large binary assets to blob storage (GCS), exchange references over Yjs; chunk/stream large payload uploads via HTTP.
5. Scaling cross-region
   - Challenge: real-time traffic requires low-latency; single region may cause lag for far users.
   - Mitigation: start single region; later add regional gateways + cross-region replication strategies for selected hot boards.
6. Security
   - Challenge: authorizing socket connections and guarding AI costs.
   - Mitigation: authenticate WS on handshake (JWT bound to session), enforce per-user quotas and rate limits at gateway and worker levels.
7. Testing concurrency
   - Challenge: concurrency surprises with CRDTs and snapshots.
   - Mitigation: property tests that simulate concurrent edits (multiple clients making conflicting operations).

Operational patterns
- Snapshots: persist yjsState = Y.encodeStateAsUpdate(doc) or encoded snapshot binary to Mongo board_snapshots.
- Heartbeats: clients send periodic presence to Redis with TTL to indicate active sessions.
- Backpressure: limit incoming message rate per socket and per board to protect workers.

---

## 3) Data serialization: pros/cons & recommendation

Quick table (human-friendly):
- JSON
  - Pros: readable, universal, easy in browser/server.
  - Cons: verbose, no native binary for CRDT snapshots, not ideal for high-throughput binary deltas.
  - Where: API payloads, admin endpoints, logs.
- BSON (Mongo native)
  - Pros: supports binary blobs (BinData), natural fit for MongoDB.
  - Cons: slightly larger than compact binary formats; limited outside Mongo.
  - Where: store Yjs snapshots (BinData) and attachments metadata.
- MessagePack / CBOR
  - Pros: compact binary, fast parsing, good for internal RPC.
  - Cons: tooling overhead, less human-readable.
  - Where: internal pub/sub if optimizing bandwidth.
- Protobuf / FlatBuffers
  - Pros: smallest payloads, strict schema, versionable, fast parsing.
  - Cons: schema management overhead; not convenient for rapid iteration.
  - Where: internal RPC in performance-critical stages.

Recommendation (practical)
- API endpoints: JSON (developer-friendly).
- Realtime CRDT deltas: use Yjs binary Uint8Array over WebSocket (binary frames), store as BSON BinData in Mongo.
- Internal bridge messages (Redis pub/sub): use binary Yjs updates (MessagePack only if later optimizing).
- If network cost becomes dominant: migrate internal RPC to protobuf.

Example wire format (WebSocket)
- Use binary frames for Yjs updates:
  - [frame-type: 1 byte][payload: Uint8Array]
  - frame-type 0x01 = YJS_UPDATE (payload = Y.encodeStateAsUpdate)
  - frame-type 0x02 = PRESENCE/awareness (JSON small)
- Advantages: small overhead, no JSON serialization cost.

---

## 4) Initial data model sketch (TypeScript interfaces + collections)

Design goals
- Keep board state (hot CRDT data) separate from metadata to avoid scanning large blobs.
- Store CRDT snapshots as opaque binary blobs with metadata (versioning, createdBy).
- Keep small collections for ephemeral/session data TTL-indexed in Redis or Mongo with TTL.

TypeScript interfaces (starter)
```ts
// packages/types/src/index.ts
export type UID = string;

export interface User {
  _id: UID;
  email: string;
  username: string;
  hashedPassword?: string; // absent for SSO users
  roles: string[]; // e.g., ['admin', 'user']
  createdAt: string; // ISO
}

export interface Board {
  _id: UID;
  title: string;
  ownerId: UID;
  collaborators: { userId: UID; role: 'viewer' | 'editor' }[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  // Do NOT put Yjs binary here — use board_snapshots
}

export interface BoardSnapshot {
  _id: UID;
  boardId: UID;
  version: number; // monotonic, incremented per snapshot
  yjsSnapshot: Uint8Array; // store as BSON BinData in Mongo
  sizeBytes?: number;
  createdAt: string;
  createdBy?: UID; // who triggered snapshot
}

// Optional small append-only op log (only if you need incremental replay)
export interface BoardOp {
  _id: UID;
  boardId: UID;
  seq: number;
  op: Uint8Array; // Yjs delta
  userId?: UID;
  createdAt: string;
}

// Sessions / presence (ephemeral, usually stored in Redis)
export interface SessionPresence {
  sessionId: string;
  userId?: UID;
  boardId?: UID;
  socketId?: string;
  lastSeenAt: string; // ISO
}
