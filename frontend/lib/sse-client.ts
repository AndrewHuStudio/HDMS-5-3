/**
 * SSE 客户端模块
 *
 * 通过 Server-Sent Events 流式接收 QA 助手的回答，
 * 支持自动重试、非流式降级（NEXT_PUBLIC_QA_STREAM_FALLBACK_ENABLED=true）。
 *
 * 事件类型：
 * - sources: 检索到的来源文档
 * - retrieval_stats: 检索统计信息
 * - graph: 知识图谱数据
 * - thinking: 思考过程 token
 * - answer: 答案 token
 * - status: 状态更新
 * - done: 完成
 * - error: 错误
 */
import type { SourceInfo, RetrievalStats, SubgraphData } from "@/features/qa/types";

export interface SSECallbacks {
  onSources: (sources: SourceInfo[]) => void;
  onRetrievalStats: (stats: RetrievalStats) => void;
  onGraph: (data: SubgraphData) => void;
  onThinking: (token: string) => void;
  onThinkingDone?: () => void;
  onAnswer: (token: string) => void;
  onAnswerReplaced?: (fullAnswer: string, sources?: SourceInfo[]) => void;
  onStatus: (stage: string, message: string) => void;
  onDone: (meta: { model?: string; context_used?: boolean; cached?: boolean }) => void;
  onError: (detail: string) => void;
}

/** Generate a short unique request ID for tracing. */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** SSE retry delay in ms. */
const SSE_RETRY_DELAY_MS = 1500;

type SSEPhase = "connecting" | "streaming" | "done" | "error";

/** Check if non-streaming fallback is enabled via env var. */
function isStreamFallbackEnabled(): boolean {
  try {
    return process.env.NEXT_PUBLIC_QA_STREAM_FALLBACK_ENABLED === "true";
  } catch {
    return false;
  }
}

/**
 * Stream a chat question via SSE and dispatch events through callbacks.
 * Includes one automatic short retry on transient network errors (same request_id).
 * If QA_STREAM_FALLBACK_ENABLED=true and SSE fails after retry, falls back to
 * non-streaming /qa/chat endpoint.
 */
export async function streamChat(
  question: string,
  history: { role: string; content: string }[],
  callbacks: SSECallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const requestId = generateRequestId();
  let attempt = 0;
  const maxRetries = 1;

  const log = (phase: SSEPhase, msg: string, extra?: Record<string, unknown>) => {
    // eslint-disable-next-line no-console
    console.debug(`[sse][${requestId}][${phase}]`, msg, extra ?? "");
  };

  let lastError: unknown;

  while (attempt <= maxRetries) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    log("connecting", attempt > 0 ? `retry #${attempt}` : "initial");

    try {
      await _streamChatOnce(question, history, callbacks, signal, requestId, log);
      return; // success
    } catch (err) {
      const aborted =
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error && err.name === "AbortError");
      if (aborted) throw err;

      lastError = err;

      if (attempt < maxRetries) {
        log("error", `attempt ${attempt} failed, retrying in ${SSE_RETRY_DELAY_MS}ms`, {
          error: err instanceof Error ? err.message : String(err),
        });
        attempt++;
        await new Promise((r) => setTimeout(r, SSE_RETRY_DELAY_MS));
        continue;
      }
      break;
    }
  }

  // SSE exhausted — try non-streaming fallback if enabled
  if (isStreamFallbackEnabled()) {
    log("connecting", "SSE exhausted, falling back to non-streaming /qa/chat");
    try {
      await _nonStreamingFallback(question, history, callbacks, signal, requestId, log);
      return;
    } catch (fallbackErr) {
      const aborted =
        (fallbackErr instanceof DOMException && fallbackErr.name === "AbortError") ||
        (fallbackErr instanceof Error && fallbackErr.name === "AbortError");
      if (aborted) throw fallbackErr;
      log("error", "non-streaming fallback also failed", {
        error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
      });
      // Fall through to throw the original SSE error
    }
  }

  throw lastError;
}

/**
 * Non-streaming fallback: POST to /qa/chat and synthesize SSE-like callbacks.
 */
async function _nonStreamingFallback(
  question: string,
  history: { role: string; content: string }[],
  callbacks: SSECallbacks,
  signal: AbortSignal | undefined,
  requestId: string,
  log: (phase: SSEPhase, msg: string, extra?: Record<string, unknown>) => void,
): Promise<void> {
  callbacks.onStatus("reasoning", "流式连接失败，正在使用备用通道...");

  const res = await fetch("/qa/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify({ question, history, request_id: requestId }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Fallback request failed: ${res.status}`);
  }

  const data = await res.json();
  log("done", "non-streaming fallback completed");

  // Synthesize callback events from the non-streaming response
  if (data.sources) {
    callbacks.onSources(data.sources);
  }
  if (data.answer) {
    callbacks.onAnswer(data.answer);
  }
  callbacks.onDone({ model: data.model, context_used: data.context_used });
}

async function _streamChatOnce(
  question: string,
  history: { role: string; content: string }[],
  callbacks: SSECallbacks,
  signal: AbortSignal | undefined,
  requestId: string,
  log: (phase: SSEPhase, msg: string, extra?: Record<string, unknown>) => void,
): Promise<void> {
  const res = await fetch("/qa/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify({ question, history, request_id: requestId }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  log("streaming", "connected");

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;
  let pendingThinkingToken = "";
  let pendingAnswerToken = "";
  let pendingEvent = "";
  let pendingDataLines: string[] = [];

  const flushTokenBuffers = () => {
    if (pendingThinkingToken) {
      callbacks.onThinking(pendingThinkingToken);
      pendingThinkingToken = "";
    }
    if (pendingAnswerToken) {
      callbacks.onAnswer(pendingAnswerToken);
      pendingAnswerToken = "";
    }
  };

  const dispatchPendingEvent = () => {
    if (!pendingEvent) {
      pendingDataLines = [];
      return;
    }

    const payload = pendingDataLines.join("\n");
    try {
      const data = JSON.parse(payload);
      switch (pendingEvent) {
        case "sources":
          flushTokenBuffers();
          callbacks.onSources(data.sources || []);
          break;
        case "retrieval_stats":
          flushTokenBuffers();
          callbacks.onRetrievalStats(data);
          break;
        case "graph":
          flushTokenBuffers();
          callbacks.onGraph({
            nodes: data.nodes || [],
            edges: data.edges || [],
          });
          break;
        case "thinking":
          pendingThinkingToken += data.content || "";
          break;
        case "thinking_done":
          flushTokenBuffers();
          callbacks.onThinkingDone?.();
          break;
        case "status":
          flushTokenBuffers();
          callbacks.onStatus(data.stage || "", data.message || "");
          break;
        case "answer":
          pendingAnswerToken += data.content || "";
          break;
        case "answer_replaced":
          flushTokenBuffers();
          callbacks.onAnswerReplaced?.(data.content || "", data.sources);
          break;
        case "done":
          flushTokenBuffers();
          callbacks.onDone(data);
          receivedDone = true;
          log("done", "stream completed");
          break;
        case "error":
          flushTokenBuffers();
          callbacks.onError(data.detail || "Unknown error");
          receivedDone = true;
          log("error", "server error event", { detail: data.detail });
          break;
      }
    } catch {
      // skip malformed JSON events
    } finally {
      pendingEvent = "";
      pendingDataLines = [];
    }
  };

  const processLines = (lines: string[]) => {
    for (const line of lines) {
      const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;

      if (normalizedLine.trim() === "") {
        dispatchPendingEvent();
        continue;
      }

      // SSE comment/heartbeat lines start with ":" and should be ignored.
      if (normalizedLine.startsWith(":")) {
        continue;
      }

      const separatorIndex = normalizedLine.indexOf(":");
      if (separatorIndex < 0) {
        continue;
      }

      const field = normalizedLine.slice(0, separatorIndex);
      let value = normalizedLine.slice(separatorIndex + 1);
      if (value.startsWith(" ")) {
        value = value.slice(1);
      }

      if (field === "event") {
        pendingEvent = value.trim();
      } else if (field === "data") {
        pendingDataLines.push(value);
      }
    }
    flushTokenBuffers();
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
  // Flush a final pending event if stream ended without a trailing blank line.
  dispatchPendingEvent();

  // Safety fallback: if we never received a done event, fire it
  if (!receivedDone) {
    log("done", "stream ended without done event, firing fallback");
    callbacks.onDone({});
  }
}
