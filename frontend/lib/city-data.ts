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
  code: string;  // 地块编号
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
export const mockCityElements: CityElement[] = [
  // ==================== 主干道系统 ====================
  {
    id: "road-main-ew",
    name: "东西向主干道",
    type: "road",
    position: [0, 0.28, 0],
    scale: [280, 0.56, 28],
    color: "#2d2d2d",
    info: { area: 4000, usage: "城市主干道" },
    controls: [
      { id: "road-width-ew", name: "道路宽度", category: "traffic", currentValue: 40, limitValue: 40, unit: "m", status: "safe", isRigid: true },
      { id: "road-lane-ew", name: "车道数", category: "traffic", currentValue: 6, limitValue: 6, unit: "车道", status: "safe" },
      { id: "vehicle-entrance-ew", name: "车行出入口", category: "traffic", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "pedestrian-entrance-ew", name: "人行出入口", category: "traffic", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: [
      "东西向城市主干道，双向6车道",
      "设计车速60km/h，配备智能交通信号系统",
      "道路两侧设有非机动车道和人行道",
    ],
  },
  {
    id: "road-main-ns",
    name: "南北向主干道",
    type: "road",
    position: [0, 0.28, 0],
    scale: [28, 0.56, 280],
    color: "#2d2d2d",
    info: { area: 4000, usage: "城市主干道" },
    controls: [
      { id: "road-width-ns", name: "道路宽度", category: "traffic", currentValue: 40, limitValue: 40, unit: "m", status: "safe", isRigid: true },
      { id: "active-street-rate", name: "活力街道贴线率", category: "traffic", visualType: "line", currentValue: 72, limitValue: 70, unit: "%", status: "safe", isRigid: true },
      { id: "dropoff-bay", name: "落客港湾停车区", category: "traffic", visualType: "line", currentValue: "已设置", limitValue: "需设置", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: [
      "南北向城市主干道，双向6车道",
      "连接城市南北区域的交通动脉",
      "配备公交专用道和落客港湾",
    ],
  },

  // ==================== 人行道系统 ====================
  {
    id: "sidewalk-north",
    name: "北侧人行道",
    type: "sidewalk",
    position: [0, 0.42, -25.2],
    scale: [280, 0.28, 11.2],
    color: "#5a5a5a",
    info: { area: 1600, usage: "人行道" },
    controls: [
      { id: "sw-width-n", name: "步行街线位与宽度", category: "traffic", visualType: "line", currentValue: 4, limitValue: 3, unit: "m", status: "safe", isRigid: true },
      { id: "ground-passage-n", name: "地面公共通道宽度位置", category: "traffic", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["北侧人行步道，透水铺装设计", "设有盲道和无障碍坡道"],
  },
  {
    id: "sidewalk-south",
    name: "南侧人行道",
    type: "sidewalk",
    position: [0, 0.42, 25.2],
    scale: [280, 0.28, 11.2],
    color: "#5a5a5a",
    info: { area: 1600, usage: "人行道" },
    controls: [
      { id: "sw-width-s", name: "步行街线位与宽度", category: "traffic", visualType: "line", currentValue: 4, limitValue: 3, unit: "m", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["南侧人行步道，配备休憩座椅"],
  },

  // ==================== 西北象限 - 商业区 ====================
  {
    id: "land-nw",
    name: "商业用地A",
    type: "land",
    position: [-77, 0.14, -77],
    scale: [70, 0.28, 70],
    color: "#4a7daf",
    info: { area: 25000, usage: "商业用地" },
    controls: [
      { id: "land-use-nw", name: "用地性质", category: "building", currentValue: "B1商业", limitValue: "B1商业", unit: "", status: "safe", isRigid: true },
      { id: "land-red-line", name: "地块红线", category: "building", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "land-area-nw", name: "建筑面积", category: "building", visualType: "surface", currentValue: 25000, limitValue: 30000, unit: "㎡", status: "safe" },
    ],
    knowledgeBase: ["西北商业地块，CBD核心区域"],
  },
  {
    id: "building-nw-1",
    name: "商业综合体A栋",
    type: "building",
    position: [-91, 35, -91],
    scale: [28, 70, 28],
    color: "#5b8dbf",
    info: {
      area: 25000,
      usage: "商业办公",
      owner: "城市发展集团",
      floors: 18,
      height: 72,
    },
    controls: [
      // 建筑布局控制
      { id: "building-frontage-1", name: "一、二级建筑贴线", category: "building", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true, source: "城市设计导则3.2.1" },
      { id: "building-setback-1", name: "一、二级建筑退线", category: "building", visualType: "line", currentValue: 8, limitValue: 8, unit: "m", status: "safe", isRigid: true, source: "城市设计导则3.2.2" },
      // 建筑高度控制
      { id: "height-nw1", name: "建筑限高", category: "building", visualType: "surface", currentValue: 72, limitValue: 80, unit: "m", status: "safe", isRigid: true, source: "控规" },
      // 开发强度
      { id: "far-nw1", name: "容积率", category: "building", currentValue: 3.2, limitValue: 3.5, unit: "", status: "safe", isRigid: true },
      { id: "density-nw1", name: "建筑密度", category: "building", visualType: "surface", currentValue: 42, limitValue: 45, unit: "%", status: "in-progress", suggestion: "建议优化裙楼布局以降低密度" },
      // 建筑形态
      { id: "visual-corridor-1", name: "视线廊道（宽度与位置）", category: "building", visualType: "volume", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true, source: "城市设计导则4.1" },
      // 消防
      { id: "fire-access-1", name: "消防登高面", category: "building", visualType: "surface", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true, source: "消防规范" },
    ],
    knowledgeBase: [
      "该建筑位于城市核心商务区，定位为甲级写字楼与高端商业综合体",
      "项目总投资约15亿元，预计年税收贡献2000万元",
      "建筑采用绿色三星标准设计，配备智能楼宇管理系统",
      "裙楼1-4层为商业空间，5-18层为办公空间",
    ],
  },
  {
    id: "building-nw-2",
    name: "商业裙楼",
    type: "building",
    position: [-63, 14, -70],
    scale: [28, 28, 42],
    color: "#7ba3c9",
    info: {
      area: 6000,
      usage: "商业零售",
      floors: 4,
      height: 16,
    },
    controls: [
      { id: "building-frontage-2", name: "一、二级建筑贴线", category: "building", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "height-nw2", name: "建筑限高", category: "building", visualType: "surface", currentValue: 16, limitValue: 24, unit: "m", status: "safe", isRigid: true },
      { id: "fire-access-2", name: "消防登高面", category: "building", visualType: "surface", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["商业裙楼，包含购物中心和餐饮区"],
  },

  // ==================== 东北象限 - 住宅区 ====================
  {
    id: "land-ne",
    name: "住宅用地B",
    type: "land",
    position: [77, 0.14, -77],
    scale: [70, 0.28, 70],
    color: "#7a4a1a",
    info: { area: 25000, usage: "居住用地" },
    controls: [
      { id: "land-use-ne", name: "用地性质", category: "building", currentValue: "R2住宅", limitValue: "R2住宅", unit: "", status: "safe", isRigid: true },
      { id: "land-far-ne", name: "容积率上限", category: "building", currentValue: 4.2, limitValue: 4.0, unit: "", status: "exceeded", isRigid: true, suggestion: "当前建设方案超出容积率上限" },
    ],
    knowledgeBase: ["东北住宅地块，需配建幼儿园"],
  },
  {
    id: "building-ne-1",
    name: "住宅楼A栋",
    type: "building",
    position: [63, 42, -84],
    scale: [21, 84, 21],
    color: "#8b9eb8",
    info: {
      area: 18000,
      usage: "住宅",
      owner: "万科地产",
      floors: 24,
      height: 72,
    },
    controls: [
      { id: "far-ne1", name: "容积率", category: "building", currentValue: 4.2, limitValue: 4.0, unit: "", status: "exceeded", isRigid: true, suggestion: "容积率超标0.2，建议减少2层" },
      { id: "height-ne1", name: "建筑限高", category: "building", visualType: "surface", currentValue: 72, limitValue: 100, unit: "m", status: "safe", isRigid: true },
      { id: "building-setback-ne1", name: "一、二级建筑退线", category: "building", visualType: "line", currentValue: 6, limitValue: 8, unit: "m", status: "exceeded", isRigid: true, suggestion: "建筑退线不足，需向后退2米" },
      { id: "fire-access-ne1", name: "消防登高面", category: "building", visualType: "surface", currentValue: "不符合", limitValue: "符合", unit: "", status: "exceeded", isRigid: true, suggestion: "消防登高面被遮挡，需调整景观设计" },
    ],
    knowledgeBase: [
      "高端住宅社区，共计240户",
      "户型：90㎡两房30%，120㎡三房50%，150㎡四房20%",
    ],
  },
  {
    id: "building-ne-2",
    name: "住宅楼B栋",
    type: "building",
    position: [91, 35, -70],
    scale: [21, 70, 21],
    color: "#6b7d94",
    info: {
      area: 15000,
      usage: "住宅",
      floors: 20,
      height: 60,
    },
    controls: [
      { id: "far-ne2", name: "容积率", category: "building", currentValue: 3.8, limitValue: 4.0, unit: "", status: "safe", isRigid: true },
      { id: "height-ne2", name: "建筑限高", category: "building", visualType: "surface", currentValue: 60, limitValue: 100, unit: "m", status: "safe", isRigid: true },
      { id: "building-frontage-ne2", name: "一、二级建筑贴线", category: "building", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["住宅B栋，共计200户"],
  },

  // ==================== 西南象限 - 公共服务区 ====================
  {
    id: "land-sw",
    name: "公共服务用地",
    type: "land",
    position: [-77, 0.14, 77],
    scale: [70, 0.28, 70],
    color: "#1a7a4a",
    info: { area: 25000, usage: "公共服务用地" },
    controls: [
      { id: "land-use-sw", name: "用地性质", category: "building", currentValue: "A1行政", limitValue: "A1行政", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["西南公共服务地块"],
  },
  {
    id: "building-sw-1",
    name: "市民服务中心",
    type: "building",
    position: [-77, 17.5, 77],
    scale: [42, 35, 35],
    color: "#9bafc4",
    info: {
      area: 8000,
      usage: "公共服务",
      owner: "市政府",
      floors: 4,
      height: 16,
    },
    controls: [
      { id: "height-sw1", name: "建筑限高", category: "building", visualType: "surface", currentValue: 16, limitValue: 24, unit: "m", status: "safe", isRigid: true },
      { id: "fire-access-sw1", name: "消防登高面", category: "building", visualType: "surface", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "vehicle-entrance-sw", name: "车行出入口", category: "traffic", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "pedestrian-entrance-sw", name: "人行出入口", category: "traffic", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: [
      "一站式政务服务大厅，整合民政、社保、税务等窗口",
      "设有24小时自助服务区",
      "年均服务群众超过50万人次",
    ],
  },

  // ==================== 东南象限 - 混合区 ====================
  {
    id: "land-se",
    name: "混合用地",
    type: "land",
    position: [77, 0.14, 77],
    scale: [70, 0.28, 70],
    color: "#4a4a7a",
    info: { area: 25000, usage: "混合用地" },
    controls: [
      { id: "land-use-se", name: "用地性质", category: "building", currentValue: "B1/R2混合", limitValue: "B1/R2混合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["东南混合地块，商住一体化开发"],
  },
  {
    id: "building-se-1",
    name: "商住综合楼",
    type: "building",
    position: [77, 28, 77],
    scale: [28, 56, 28],
    color: "#7a8fa8",
    info: {
      area: 12000,
      usage: "商住混合",
      floors: 16,
      height: 48,
    },
    controls: [
      { id: "height-se1", name: "建筑限高", category: "building", visualType: "surface", currentValue: 48, limitValue: 60, unit: "m", status: "safe", isRigid: true },
      { id: "building-frontage-se1", name: "一、二级建筑贴线", category: "building", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "visual-corridor-se1", name: "视线廊道（宽度与位置）", category: "building", visualType: "volume", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["商住综合楼，底层商业，上层住宅"],
  },

  // ==================== 连廊系统 ====================
  {
    id: "corridor-nw",
    name: "西北商业连廊",
    type: "corridor",
    position: [-77, 21, -80.5],
    scale: [28, 4.2, 8.4],
    color: "#a8bdd0",
    info: { area: 120, usage: "空中连廊" },
    controls: [
      { id: "corridor-width-nw", name: "空中连廊宽度位置", category: "traffic", visualType: "surface", currentValue: 6, limitValue: 4, unit: "m", status: "safe", isRigid: true },
      { id: "corridor-height-nw", name: "净空高度", category: "traffic", currentValue: 4.5, limitValue: 4.5, unit: "m", status: "safe", isRigid: true },
    ],
    knowledgeBase: ["连接商业综合体A栋与商业裙楼的空中走廊", "配备空调，全天候通行"],
  },
  {
    id: "corridor-cross-south",
    name: "南区跨街连廊",
    type: "corridor",
    position: [0, 24.5, 77],
    scale: [147, 4.9, 11.2],
    color: "#b8cada",
    info: { area: 280, usage: "跨街空中连廊" },
    controls: [
      { id: "corridor-width-cs", name: "空中连廊宽度位置", category: "traffic", visualType: "surface", currentValue: 8, limitValue: 6, unit: "m", status: "safe", isRigid: true },
      { id: "corridor-clearance-cs", name: "净空高度", category: "traffic", currentValue: 5.5, limitValue: 4.5, unit: "m", status: "safe", isRigid: true },
      { id: "mountain-water-corridor", name: "山水通廊宽度位置", category: "landscape", visualType: "surface", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
    ],
    knowledgeBase: [
      "连接市民服务中心与商住综合楼的跨街空中连廊",
      "跨越南北向主干道，净空高度5.5米，满足消防车通行要求",
      "连廊宽度8米，配备自动扶梯和无障碍电梯",
    ],
  },

  // ==================== 绿地系统 ====================
  {
    id: "greenspace-nw",
    name: "商业区绿地",
    type: "greenspace",
    position: [-56, 0.7, -56],
    scale: [21, 1.4, 21],
    color: "#2a8f2a",
    info: { area: 2250, usage: "公共绿地" },
    controls: [
      { id: "green-setback-nw", name: "绿地退线控制", category: "open-space", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "green-area-nw", name: "公共绿化面积与位置", category: "open-space", currentValue: 2250, limitValue: 2000, unit: "㎡", status: "safe" },
    ],
    knowledgeBase: ["商业区休闲绿地，设有座椅和景观灯"],
  },
  {
    id: "greenspace-ne",
    name: "住宅区中央花园",
    type: "greenspace",
    position: [77, 0.7, -56],
    scale: [28, 1.4, 28],
    color: "#3a9f3a",
    info: { area: 4000, usage: "社区绿地" },
    controls: [
      { id: "green-setback-ne", name: "绿地退线控制", category: "open-space", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "green-area-ne", name: "公共绿化面积与位置", category: "open-space", currentValue: 4000, limitValue: 3500, unit: "㎡", status: "safe" },
    ],
    knowledgeBase: ["住宅社区中央花园", "设有儿童游乐设施和健身器材"],
  },
  {
    id: "greenspace-sw",
    name: "市民广场绿地",
    type: "greenspace",
    position: [-56, 0.7, 63],
    scale: [35, 1.4, 28],
    color: "#4aaf4a",
    info: { area: 5000, usage: "公共广场绿地" },
    controls: [
      { id: "plaza-setback-sw", name: "广场退线控制", category: "open-space", visualType: "line", currentValue: "符合", limitValue: "符合", unit: "", status: "safe", isRigid: true },
      { id: "green-area-sw", name: "公共绿化面积与位置", category: "open-space", currentValue: 5000, limitValue: 4000, unit: "㎡", status: "safe" },
    ],
    knowledgeBase: ["市民服务中心前广场绿地", "举办各类公共活动的场所"],
  },
];

export const mockLandPlot: LandPlot = {
  id: "plot-001",
  name: "深圳湾超级总部基地",
  code: "DU09-02地块",
  elements: mockCityElements,
  totalArea: 120000,
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
