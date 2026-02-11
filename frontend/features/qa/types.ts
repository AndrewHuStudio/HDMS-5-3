export type ChatRole = "user" | "assistant";

export interface SourceInfo {
  type: string;
  name: string;
  section?: string;
  source: string;
  chunk_id?: string;
  doc_id?: string;
  chunk_index?: number;
  page?: number;
  score?: number;
  quote?: string;
  pdf_url?: string;
  image_url?: string;
  image_name?: string;
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

export interface GraphNode {
  id: string;
  label: string;
  name: string;
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
}

export interface SubgraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  thinking?: string;
  sources?: SourceInfo[];
  retrievalStats?: RetrievalStats;
  subgraph?: SubgraphData;
  feedback?: "useful" | "not_useful";
  isStreaming?: boolean;
  statusMessage?: string;
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
