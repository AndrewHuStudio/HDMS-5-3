/** 问答助手 - 核心类型定义（消息、来源、检索统计、图谱数据等） */

export type ChatRole = "user" | "assistant";

export interface SourceInfo {
  type: string;
  name: string;
  citation_label?: string;
  doc_num?: number;
  chunk_seq?: number;
  section?: string;
  source: string;
  chunk_id?: string;
  chunk_ids?: string[];
  doc_id?: string;
  chunk_index?: number;
  page?: number;
  page_end?: number;
  score?: number;
  quote?: string;
  pdf_url?: string;
  has_table?: boolean;
  table_markdown?: string;
  image_url?: string;
  image_name?: string;
  image_urls?: string[];
  image_names?: string[];
  image_figures?: string[];
  image_captions?: string[];
}

export interface RetrievalStats {
  vector_count: number;
  graph_count: number;
  keyword_count: number;
  fused_count: number;
  reranked: boolean;
  cached: boolean;
  weights: Record<string, number>;
  document_count?: number;
  document_names?: string[];
}

export type AssistantRenderState =
  | "understanding"
  | "retrieving"
  | "reasoning"
  | "answering"
  | "finalizing"
  | "done"
  | "error";

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
  renderState?: AssistantRenderState;
  subgraph?: SubgraphData;
  feedback?: "useful" | "not_useful";
  isStreaming?: boolean;
  thinkingDone?: boolean;
  statusMessage?: string;
  statusStage?: string;
  finalizedByServer?: boolean;
}

export interface ChatHistoryMessage {
  role: ChatRole;
  content: string;
}

