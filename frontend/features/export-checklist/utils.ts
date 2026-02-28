import type { DetailedStatistics } from "./types";

/**
 * 将限高检测结果转换为详细统计
 */
export function convertHeightCheckToStats(results: any[]): DetailedStatistics {
  if (!results || results.length === 0) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const passed = results.filter((r) => !r.is_exceeded);
  const failed = results.filter((r) => r.is_exceeded);

  // 按地块分组
  const passedByPlot = groupByPlot(passed);
  const failedByPlot = groupByPlot(failed);

  return {
    passed: {
      plots: passedByPlot.map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map(
          (b: any) => b.building_name || `建筑${b.building_index || ""}`
        ),
      })),
      totalPlots: passedByPlot.length,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name || `建筑${f.building_index || ""}`,
        issue: "超高",
        details: `实际高度 ${f.actual_height}m，限高 ${f.height_limit}m，超高 ${f.exceed_amount}m`,
      })),
      totalPlots: failedByPlot.length,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋超高`,
  };
}

/**
 * 将退线检测结果转换为详细统计
 */
export function convertSetbackCheckToStats(result: any): DetailedStatistics {
  if (!result || !result.buildings) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const buildings = result.buildings || [];
  const passed = buildings.filter((b: any) => !b.is_exceeded);
  const failed = buildings.filter((b: any) => b.is_exceeded);

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name),
      })),
      totalPlots: new Set(passed.map((b: any) => b.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name,
        issue: "退线违规",
        details: f.reason?.message || "违反退线要求",
      })),
      totalPlots: new Set(failed.map((b: any) => b.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
  };
}

/**
 * 将视线通廊检测结果转换为详细统计
 */
export function convertSightCorridorToStats(result: any): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.status === "通过");
  const failed = results.filter((r: any) => r.status !== "通过");

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name || b.name),
      })),
      totalPlots: new Set(passed.map((r: any) => r.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name || f.name || "未知建筑",
        issue: "视线通廊遮挡",
        details: f.message || "遮挡视线通廊",
      })),
      totalPlots: new Set(failed.map((r: any) => r.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋遮挡`,
  };
}

/**
 * 将消防登高面检测结果转换为详细统计
 */
export function convertFireLadderToStats(result: any): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.has_valid_ladder_surface);
  const failed = results.filter((r: any) => !r.has_valid_ladder_surface);

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name),
      })),
      totalPlots: new Set(passed.map((r: any) => r.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name,
        issue: "消防登高面不符合要求",
        details: f.reason || "未满足消防登高面要求",
      })),
      totalPlots: new Set(failed.map((r: any) => r.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋不符合`,
  };
}

/**
 * 将空中连廊检测结果转换为详细统计
 */
export function convertSkyBridgeToStats(result: any): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.is_compliant);
  const failed = results.filter((r: any) => !r.is_compliant);

  return {
    passed: {
      plots: [],
      totalPlots: 0,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: "空中连廊",
        buildingName: f.bridge_name || `连廊${f.bridge_index || ""}`,
        issue: "不符合规范",
        details: f.reason || "违反空中连廊规范",
      })),
      totalPlots: 0,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 个连廊，${passed.length} 个通过，${failed.length} 个不符合`,
  };
}

/**
 * 将车行出入口检测结果转换为详细统计
 */
export function convertVehicleEntranceToStats(result: any): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.is_compliant);
  const failed = results.filter((r: any) => !r.is_compliant);

  return {
    passed: {
      plots: [],
      totalPlots: 0,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.entrance_name || `出入口${f.entrance_index || ""}`,
        issue: "不符合规范",
        details: f.reason || "违反车行出入口规范",
      })),
      totalPlots: 0,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 个出入口，${passed.length} 个通过，${failed.length} 个不符合`,
  };
}

/**
 * 将人行出入口检测结果转换为详细统计
 */
export function convertPedestrianEntranceToStats(
  result: any
): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.is_compliant);
  const failed = results.filter((r: any) => !r.is_compliant);

  return {
    passed: {
      plots: [],
      totalPlots: 0,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.entrance_name || `出入口${f.entrance_index || ""}`,
        issue: "不符合规范",
        details: f.reason || "违反人行出入口规范",
      })),
      totalPlots: 0,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 个出入口，${passed.length} 个通过，${failed.length} 个不符合`,
  };
}

/**
 * 将绿地退线检测结果转换为详细统计
 */
export function convertGreenSetbackToStats(result: any): DetailedStatistics {
  if (!result || !result.buildings) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const buildings = result.buildings || [];
  const passed = buildings.filter((b: any) => !b.is_exceeded);
  const failed = buildings.filter((b: any) => b.is_exceeded);

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name),
      })),
      totalPlots: new Set(passed.map((b: any) => b.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name,
        issue: "绿地退线违规",
        details: f.reason?.message || "违反绿地退线要求",
      })),
      totalPlots: new Set(failed.map((b: any) => b.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
  };
}

/**
 * 将广场退线检测结果转换为详细统计
 */
export function convertPlazaSetbackToStats(result: any): DetailedStatistics {
  if (!result || !result.buildings) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const buildings = result.buildings || [];
  const passed = buildings.filter((b: any) => !b.is_exceeded);
  const failed = buildings.filter((b: any) => b.is_exceeded);

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name),
      })),
      totalPlots: new Set(passed.map((b: any) => b.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name,
        issue: "广场退线违规",
        details: f.reason?.message || "违反广场退线要求",
      })),
      totalPlots: new Set(failed.map((b: any) => b.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
  };
}

/**
 * 将贴线率检测结果转换为详细统计
 */
export function convertBuildingLineRateToStats(result: any): DetailedStatistics {
  if (!result || !result.results) {
    return {
      passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
      failed: { items: [], totalPlots: 0, totalBuildings: 0 },
      summary: "无检测数据",
    };
  }

  const results = result.results || [];
  const passed = results.filter((r: any) => r.is_compliant);
  const failed = results.filter((r: any) => !r.is_compliant);

  return {
    passed: {
      plots: groupByPlot(passed).map((p) => ({
        name: p.plotName,
        buildings: p.buildings.map((b: any) => b.building_name),
      })),
      totalPlots: new Set(passed.map((r: any) => r.plot_name)).size,
      totalBuildings: passed.length,
    },
    failed: {
      items: failed.map((f: any) => ({
        plotName: f.plot_name || "未知地块",
        buildingName: f.building_name,
        issue: "贴线率不符合要求",
        details: f.reason || `实际贴线率 ${f.actual_rate}%，要求 ${f.required_rate}%`,
      })),
      totalPlots: new Set(failed.map((r: any) => r.plot_name)).size,
      totalBuildings: failed.length,
    },
    summary: `总计：${results.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋不符合`,
  };
}

/**
 * 按地块分组
 */
function groupByPlot(buildings: any[]) {
  const groups = new Map<string, any[]>();
  buildings.forEach((b) => {
    const plotName = b.plot_name || "未知地块";
    if (!groups.has(plotName)) {
      groups.set(plotName, []);
    }
    groups.get(plotName)!.push(b);
  });
  return Array.from(groups.entries()).map(([plotName, buildings]) => ({
    plotName,
    buildings,
  }));
}

/**
 * 根据功能 ID 转换检测结果为详细统计
 */
export function convertResultToStats(
  featureId: string,
  rawResult: any
): DetailedStatistics | null {
  if (!rawResult) return null;

  switch (featureId) {
    case "height-check":
      return convertHeightCheckToStats(rawResult);
    case "setback-check":
      return convertSetbackCheckToStats(rawResult);
    case "sight-corridor":
      return convertSightCorridorToStats(rawResult);
    case "fire-ladder":
      return convertFireLadderToStats(rawResult);
    case "sky-bridge":
      return convertSkyBridgeToStats(rawResult);
    case "vehicle-entrance":
      return convertVehicleEntranceToStats(rawResult);
    case "pedestrian-entrance":
      return convertPedestrianEntranceToStats(rawResult);
    case "green-setback":
      return convertGreenSetbackToStats(rawResult);
    case "plaza-setback":
      return convertPlazaSetbackToStats(rawResult);
    case "building-line-rate":
      return convertBuildingLineRateToStats(rawResult);
    default:
      return null;
  }
}
