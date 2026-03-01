// 详细统计信息
export interface DetailedStatistics {
  passed: {
    plots: Array<{
      name: string;
      buildings: string[];
    }>;
    totalPlots: number;
    totalBuildings: number;
  };
  failed: {
    items: Array<{
      plotName: string;
      buildingName: string;
      issue: string;
      details?: string;
    }>;
    totalPlots: number;
    totalBuildings: number;
  };
  summary: string;
}

export interface FeatureChecklistItem {
  id: string;
  name: string;
  isPass: boolean;
  screenshots: {
    northeast: string | null;
    northwest: string | null;
  };
  summary: string;
  detailedStats: DetailedStatistics | null;  // 新增
  rawResult: unknown;
  aiSuggestion: string;
  isGeneratingAI: boolean;
  aiGenerationStatus: "idle" | "queued" | "generating" | "failed" | "done";
  showAiSuggestion: boolean;
  govSuggestion: string;
}

export interface ChecklistExportState {
  projectName: string;
  items: FeatureChecklistItem[];
  isGeneratingAI: boolean;
  isCapturingScreenshot: boolean;  // 新增
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

export interface ExportPdfRequest {
  project_name?: string;
  file_name?: string;
  image_data_url: string;
}
