/**
apps/web/src/components/YjsEditor.tsx
Dependencies:
  npm install react react-dom yjs
Purpose:
  - Minimal React component demonstrating Yjs <-> WebSocket sync.
  - Client sends binary updates and applies incoming updates.
Note:
  - The server expects a query param `boardId` on the WS URL.
*/
import React, { useEffect, useRef, useState } from "react";
import * as Y from "yjs";

type Props = { boardId: string; wsUrl?: string };

export function YjsEditor({ boardId, wsUrl }: Props) {
  const [text, setText] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const ytextRef = useRef<Y.Text | null>(null);

  useEffect(() => {
    const doc = new Y.Doc();
    docRef.current = doc;
    const ytext = doc.getText("content");
    ytextRef.current = ytext;

    // update local state when ytext changes
    const obs = () => setText(ytext.toString());
    ytext.observe(() => obs());
    obs();

    // open websocket
    const url = `${wsUrl ?? "ws://localhost:8080"}?boardId=${encodeURIComponent(boardId)}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // send nothing; server will send init state
      console.log("ws open");
    };

    ws.onmessage = (ev) => {
      // binary Yjs update from server
      if (ev.data instanceof ArrayBuffer) {
        const update = new Uint8Array(ev.data);
        Y.applyUpdate(doc, update);
      } else if (typeof ev.data === "string") {
        // optional text messages
        console.log("ws msg:", ev.data);
      }
    };

    // when local Yjs doc updates, transmit the delta to server
    const onLocal = (update: Uint8Array) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(update);
      }
    };
    const handler = (u: Uint8Array) => onLocal(u);
    // Yjs doc:update event uses encodeStateVector or awareness; using observeUpdates API:
    // we register observer to send updates produced locally
    (doc as any).on("update", handler);

    return () => {
      ytext.unobserveAll();
      (doc as any).off("update", handler);
      ws.close();
      doc.destroy();
    };
  }, [boardId, wsUrl]);

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    // apply transaction to local Yjs text - this will cause update event and send delta
    docRef.current?.transact(() => {
      ytextRef.current?.delete(0, ytextRef.current.length);
      ytextRef.current?.insert(0, val);
    });
    // setText will be updated by Yjs observer, but set here for immediate UI responsiveness
    setText(val);
  }

  return (
    <div>
      <h3>Board: {boardId}</h3>
      <textarea value={text} onChange={onChange} rows={12} cols={80} />
    </div>
  );
}
