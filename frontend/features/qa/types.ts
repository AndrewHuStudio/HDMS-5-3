export type ChatRole = "user" | "assistant";

export interface SourceInfo {
  type: string;
  name: string;
  section?: string;
  source: string;
  chunk_id?: string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  thinking?: string;
  sources?: SourceInfo[];
  isStreaming?: boolean;
}

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

export interface ChatResponse {
  answer: string;
  model?: string;
  sources?: SourceInfo[];
}
