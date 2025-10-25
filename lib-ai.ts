/*
packages/lib-ai/src/geminiClient.ts
Dependencies:
  - p-retry (already used)
  - fetch is available in Node 18+; for older Node install node-fetch
Purpose:
  - Minimal wrapper around an LLM endpoint (Gemini/AI Studio).
  - Provide predict() with retries and a streaming stub.
*/
import pRetry from "p-retry";

export type PredictOptions = {
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export class GeminiClient {
  private apiKey: string;
  private endpoint: string;

  constructor(apiKey: string, opts?: { endpoint?: string }) {
    if (!apiKey) throw new Error("GEMINI_API_KEY required");
    this.apiKey = apiKey;
    // NOTE: Replace with actual AI Studio endpoint you will use.
    this.endpoint = opts?.endpoint ?? "https://api.example.com/v1/generate";
  }

  async predict(prompt: string, opts?: PredictOptions) {
    const call = async () => {
      const body = {
        prompt,
        model: opts?.model ?? "gemini-pro",
        max_tokens: opts?.maxTokens ?? 512,
      };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);

      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal as any,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`AI request failed ${res.status}: ${text}`);
        }
        const json = await res.json();
        return json;
      } finally {
        clearTimeout(timeout);
      }
    };

    return pRetry(call, { retries: 3, factor: 2 });
  }

  // streaming left as an exercise to adapt to the vendor SSE/websocket streaming style.
  async streamPredict(): Promise<void> {
    throw new Error("streamPredict not implemented in this example stub");
  }
}
