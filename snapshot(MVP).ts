async function persistSnapshot(boardId: string, doc: Y.Doc, createdBy?: string) {
  const snapshot = Y.encodeStateAsUpdate(doc); // compact binary
  await saveSnapshot(boardId, snapshot, { createdBy });
}
