// client sends Yjs update to server (binary)
const update = Y.encodeStateAsUpdate(doc);
socket.send(update); // use binary frame
