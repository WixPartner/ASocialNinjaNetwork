/**
apps/web/src/index.tsx
Minimal React entry that mounts YjsEditor.
*/
import React from "react";
import { createRoot } from "react-dom/client";
import { YjsEditor } from "./components/YjsEditor";

const container = document.getElementById("root")!;
const root = createRoot(container);

root.render(<YjsEditor boardId={"demo-board-1"} wsUrl={process.env.REACT_APP_WS_URL} />);
