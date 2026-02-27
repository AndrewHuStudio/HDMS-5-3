export interface FeatureChecklistItem {
  id: string;
  name: string;
  screenshot: string | null;
  summary: string;
  rawResult: unknown;
  aiSuggestion: string;
  showAiSuggestion: boolean;
  govSuggestion: string;
}

export interface ChecklistExportState {
  projectName: string;
  items: FeatureChecklistItem[];
  isGeneratingAI: boolean;
}

export interface AISuggestionRequest {
  features: Array<{
    id: string;
    name: string;
    summary: string;
    raw_result: unknown;
  }>;
}

export interface AISuggestionResponse {
  suggestions: Array<{
    id: string;
    suggestion: string;
  }>;
}
