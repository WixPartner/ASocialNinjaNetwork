import * as Y from 'yjs';

const docs = new Map<string, Y.Doc>(); // boardId => doc

function handleYjsUpdate(boardId: string, update: Uint8Array) {
  let doc = docs.get(boardId);
  if (!doc) {
    doc = new Y.Doc();
    // load latest snapshot from DB here (async) and apply
    docs.set(boardId, doc);
  }
  Y.applyUpdate(doc, update);
  // broadcast update to other nodes/clients via Redis pub/sub (publish the binary update)
  redis.publish(`board:${boardId}`, update);
  // schedule snapshot persistence via debounce/threshold
}
