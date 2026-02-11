export type ChatRole = "user" | "assistant";

export interface SourceInfo {
  type: string;
  name: string;
  section?: string;
  source: string;
  chunk_id?: string;
}

export interface RetrievalStats {
  vector_count: number;
  graph_count: number;
  keyword_count: number;
  fused_count: number;
  reranked: boolean;
  cached: boolean;
  weights: Record<string, number>;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  thinking?: string;
  sources?: SourceInfo[];
  retrievalStats?: RetrievalStats;
  feedback?: "useful" | "not_useful";
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
