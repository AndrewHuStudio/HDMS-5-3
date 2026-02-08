import type { SourceInfo } from "@/features/qa/types";

export interface SSECallbacks {
  onSources: (sources: SourceInfo[]) => void;
  onThinking: (token: string) => void;
  onAnswer: (token: string) => void;
  onDone: (meta: { model?: string; context_used?: boolean }) => void;
  onError: (detail: string) => void;
}

/**
 * Stream a chat question via SSE and dispatch events through callbacks.
 */
export async function streamChat(
  question: string,
  history: { role: string; content: string }[],
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/qa/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;

  const processLines = (lines: string[]) => {
    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith("data: ") && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          switch (currentEvent) {
            case "sources":
              callbacks.onSources(data.sources || []);
              break;
            case "thinking":
              callbacks.onThinking(data.content || "");
              break;
            case "answer":
              callbacks.onAnswer(data.content || "");
              break;
            case "done":
              callbacks.onDone(data);
              receivedDone = true;
              break;
            case "error":
              callbacks.onError(data.detail || "Unknown error");
              receivedDone = true;
              break;
          }
        } catch {
          // skip malformed JSON lines
        }
        currentEvent = "";
      } else if (line.trim() === "") {
        currentEvent = "";
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    processLines(lines);
  }

  // Flush remaining buffer after stream ends
  if (buffer.trim()) {
    processLines(buffer.split("\n"));
  }

  // Safety fallback: if we never received a done event, fire it
  if (!receivedDone) {
    callbacks.onDone({});
  }
}
