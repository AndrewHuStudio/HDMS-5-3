export type ControlStatus = "safe" | "in-progress" | "exceeded";

// 管控要素类别
export type ControlCategory = 
  | "open-space"      // 开放空间与公共空间
  | "building"        // 建筑控制
  | "traffic"         // 交通系统
  | "landscape";      // 景观与环境

// 可视化计算类型
export type VisualizationType = "line" | "surface" | "volume";

// 管控要素
export interface ControlIndicator {
  id: string;
  name: string;
  category: ControlCategory;
  visualType?: VisualizationType;  // 可视化计算类型：线、面、体
  currentValue: number | string;
  limitValue: number | string;
  unit: string;
  status: ControlStatus;
  suggestion?: string;
  isRigid?: boolean;  // 是否刚性控制
  source?: string;    // 依据来源
}

// 城市要素类型
export type ElementType =
  | "building"
  | "land"
  | "corridor"
  | "road"
  | "sidewalk"
  | "greenspace"
  | "plaza"
  | "entrance";

// 城市要素
export interface CityElement {
  id: string;
  name: string;
  type: ElementType;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  info: {
    area: number;
    usage: string;
    owner?: string;
    buildDate?: string;
    floors?: number;
    height?: number;
  };
  controls: ControlIndicator[];
  knowledgeBase: string[];
}

// 地块数据
export interface LandPlot {
  id: string;
  name: string;
  code: string;
  elements: CityElement[];
  totalArea: number;
  approvalStatus: "pending" | "approved" | "rejected";
}

// 管控类别中文名称
export const controlCategoryNames: Record<ControlCategory, string> = {
  "open-space": "开放空间与公共空间",
  "building": "建筑控制",
  "traffic": "交通系统",
  "landscape": "景观与环境",
};

// 可视化类型中文名称
export const visualTypeNames: Record<VisualizationType, string> = {
  "line": "线",
  "surface": "面",
  "volume": "体",
};

// 真实城市布局的模拟数据
// Model data removed
export const mockCityElements: CityElement[] = [];

export const mockLandPlot: LandPlot = {
  id: "plot-001",
  name: "No plot loaded",
  code: "--",
  elements: mockCityElements,
  totalArea: 0,
  approvalStatus: "pending",
};

// 元素类型中文名称映射
export const elementTypeNames: Record<ElementType, string> = {
  building: "建筑",
  land: "地块",
  corridor: "连廊",
  road: "车道",
  sidewalk: "人行道",
  greenspace: "绿地",
  plaza: "广场",
  entrance: "出入口",
};

// 状态中文名称和颜色映射
export const statusConfig: Record<
  ControlStatus,
  { label: string; color: string; bgColor: string }
> = {
  safe: { label: "符合", color: "text-emerald-600", bgColor: "bg-emerald-50" },
  "in-progress": {
    label: "进展中",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
  },
  exceeded: {
    label: "超标",
    color: "text-red-600",
    bgColor: "bg-red-50",
  },
};
