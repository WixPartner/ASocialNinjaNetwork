/*
apps/realtime/src/yjs-adapter.ts
Dependencies:
  npm install yjs
Purpose:
  - helpers to apply loaded snapshot to a Y.Doc and to encode/decode updates
*/
import * as Y from "yjs";

export function applySnapshotToDoc(doc: Y.Doc, snapshotBuffer: Uint8Array) {
  if (!snapshotBuffer) return;
  // snapshotBuffer is expected to be a Yjs update (binary)
  Y.applyUpdate(doc, snapshotBuffer);
}

export function encodeStateAsUpdate(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

export function applyUpdateToDoc(doc: Y.Doc, update: Uint8Array) {
  Y.applyUpdate(doc, update);
}
