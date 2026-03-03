"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertHeightCheckToStats = convertHeightCheckToStats;
exports.convertSetbackCheckToStats = convertSetbackCheckToStats;
exports.convertSightCorridorToStats = convertSightCorridorToStats;
exports.convertFireLadderToStats = convertFireLadderToStats;
exports.convertSkyBridgeToStats = convertSkyBridgeToStats;
exports.convertVehicleEntranceToStats = convertVehicleEntranceToStats;
exports.convertPedestrianEntranceToStats = convertPedestrianEntranceToStats;
exports.convertGreenSetbackToStats = convertGreenSetbackToStats;
exports.convertPlazaSetbackToStats = convertPlazaSetbackToStats;
exports.convertBuildingLineRateToStats = convertBuildingLineRateToStats;
exports.convertResultToStats = convertResultToStats;
/**
 * 将限高检测结果转换为详细统计
 */
function convertHeightCheckToStats(rawResult) {
    // 处理不同的数据结构
    let results = [];
    if (!rawResult) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    // 如果是数组，直接使用
    if (Array.isArray(rawResult)) {
        results = rawResult;
    }
    // 如果是对象，尝试提取 results 字段
    else if (rawResult.results && Array.isArray(rawResult.results)) {
        results = rawResult.results;
    }
    // 如果是对象，尝试提取 buildings 字段
    else if (rawResult.buildings && Array.isArray(rawResult.buildings)) {
        results = rawResult.buildings;
    }
    if (results.length === 0) {
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
                buildings: p.buildings.map((b) => b.building_name || `建筑${b.building_index || ""}`),
            })),
            totalPlots: passedByPlot.length,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((f) => ({
                plotName: f.plot_name || "未知地块",
                buildingName: f.building_name || `建筑${f.building_index || ""}`,
                issue: "超高",
                details: `实际高度 ${Number(f.actual_height).toFixed(2)}m，限高 ${Number(f.height_limit).toFixed(2)}m，超高 ${Number(f.exceed_amount).toFixed(2)}m`,
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
function convertSetbackCheckToStats(result) {
    if (!result || !result.buildings) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const buildings = result.buildings || [];
    const passed = buildings.filter((b) => !b.is_exceeded);
    const failed = buildings.filter((b) => b.is_exceeded);
    return {
        passed: {
            plots: groupByPlot(passed).map((p) => ({
                name: p.plotName,
                buildings: p.buildings.map((b) => b.building_name),
            })),
            totalPlots: new Set(passed.map((b) => b.plot_name)).size,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((f) => ({
                plotName: f.plot_name || "未知地块",
                buildingName: f.building_name,
                issue: "退线违规",
                details: f.reason?.message || "违反退线要求",
            })),
            totalPlots: new Set(failed.map((b) => b.plot_name)).size,
            totalBuildings: failed.length,
        },
        summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
    };
}
/**
 * 将视线通廊检测结果转换为详细统计
 */
function convertSightCorridorToStats(result) {
    if (!result) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    // 视线通廊结果结构: { status, blocked_buildings }
    const blockedBuildings = result.blocked_buildings || [];
    const status = result.status || "unknown";
    if (status === "clear") {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "视线通廊畅通，无遮挡建筑",
        };
    }
    if (status === "missing_corridor" || status === "missing_buildings") {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: status === "missing_corridor" ? "未找到视线通廊" : "未找到建筑",
        };
    }
    return {
        passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
        failed: {
            items: blockedBuildings.map((b) => ({
                plotName: b.plot_name || "未知地块",
                buildingName: b.building_name || "未知建筑",
                issue: "视线通廊遮挡",
                details: `遮挡面积: ${b.blocking_area?.toFixed(2) || "未知"}m²`,
            })),
            totalPlots: new Set(blockedBuildings.map((b) => b.plot_name)).size,
            totalBuildings: blockedBuildings.length,
        },
        summary: `总计：${blockedBuildings.length} 栋建筑遮挡视线通廊`,
    };
}
/**
 * 将消防登高面检测结果转换为详细统计
 */
function convertFireLadderToStats(result) {
    if (!result || !result.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const results = result.results || [];
    const passed = results.filter((r) => isFireLadderPassed(r));
    const failed = results.filter((r) => !isFireLadderPassed(r));
    return {
        passed: {
            plots: groupByPlot(passed).map((p) => ({
                name: p.plotName,
                buildings: p.buildings.map((b) => b.building_name || b.building?.name || "未知建筑"),
            })),
            totalPlots: new Set(passed.map((r) => getFireLadderPlotName(r))).size,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((f) => ({
                plotName: getFireLadderPlotName(f),
                buildingName: f.building_name || f.building?.name || "未知建筑",
                issue: "消防登高面不符合要求",
                details: getFireLadderDetails(f),
            })),
            totalPlots: new Set(failed.map((r) => getFireLadderPlotName(r))).size,
            totalBuildings: failed.length,
        },
        summary: `总计：${results.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋不符合`,
    };
}
const fireLadderReasonLabels = {
    no_buildings: "无建筑无需检测",
    missing_ladder: "缺少消防登高面",
    outside_redline: "登高面超出红线",
    width_too_small: "登高面宽度不足",
    length_sum_too_short: "登高面长度总和不足",
    distance_out_of_range: "登高面距建筑不在5-10m",
};
function isFireLadderPassed(item) {
    if (typeof item?.status === "string") {
        return item.status === "pass";
    }
    if (typeof item?.has_valid_ladder_surface === "boolean") {
        return item.has_valid_ladder_surface;
    }
    return false;
}
function getFireLadderPlotName(item) {
    return item?.plot_name || item?.redline_name || "未知地块";
}
function getFireLadderDetails(item) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    if (Array.isArray(item?.reasons) && item.reasons.length > 0) {
        return item.reasons
            .map((reason) => fireLadderReasonLabels[reason] || reason)
            .join("、");
    }
    return "未满足消防登高面要求";
}
/**
 * 将空中连廊检测结果转换为详细统计
 */
function convertSkyBridgeToStats(result) {
    if (!result || !result.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const results = result.results || [];
    const passed = results.filter((r) => isSkyBridgePassed(r));
    const failed = results.filter((r) => !isSkyBridgePassed(r));
    return {
        passed: {
            plots: passed.map((item) => ({
                name: getSkyBridgeConnectionName(item),
                buildings: getSkyBridgeBuildingNames(item),
            })),
            totalPlots: new Set(passed.map((item) => getSkyBridgeConnectionName(item))).size,
            totalBuildings: passed.reduce((sum, item) => sum + getSkyBridgeObjectCount(item), 0),
        },
        failed: {
            items: failed.map((item) => ({
                plotName: getSkyBridgeConnectionName(item),
                buildingName: getSkyBridgeBuildingNames(item).join("、"),
                issue: "不符合规范",
                details: getSkyBridgeDetails(item),
            })),
            totalPlots: new Set(failed.map((item) => getSkyBridgeConnectionName(item))).size,
            totalBuildings: failed.reduce((sum, item) => sum + getSkyBridgeObjectCount(item), 0),
        },
        summary: `总计：${results.length} 条连接，${passed.length} 条通过，${failed.length} 条不符合`,
    };
}
const skyBridgeReasonLabels = {
    plot_missing: "地块缺失",
    missing_corridor: "缺少空中连廊",
    not_connecting: "未跨越两地块",
    not_closed: "连廊未闭合",
    clearance_too_low: "标高不足",
    width_too_small: "净宽不足",
    height_too_small: "净高不足",
};
function isSkyBridgePassed(item) {
    if (typeof item?.status === "string") {
        return item.status === "pass";
    }
    if (typeof item?.is_compliant === "boolean") {
        return item.is_compliant;
    }
    return false;
}
function getSkyBridgeConnectionName(item) {
    const plotA = item?.plot_a;
    const plotB = item?.plot_b;
    if (plotA && plotB) {
        return `${plotA} ↔ ${plotB}`;
    }
    return "空中连廊";
}
function getSkyBridgeBuildingNames(item) {
    if (Array.isArray(item?.corridors) && item.corridors.length > 0) {
        return item.corridors.map((corridor) => `连廊#${(corridor?.index ?? 0) + 1}`);
    }
    if (item?.bridge_name) {
        return [String(item.bridge_name)];
    }
    if (item?.bridge_index !== undefined) {
        return [`连廊${item.bridge_index}`];
    }
    return ["连廊"];
}
function getSkyBridgeObjectCount(item) {
    if (Array.isArray(item?.corridors) && item.corridors.length > 0) {
        return item.corridors.length;
    }
    return 1;
}
function getSkyBridgeDetails(item) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    const reasons = Array.isArray(item?.reasons) ? item.reasons : [];
    if (reasons.length > 0) {
        return reasons
            .map((reason) => skyBridgeReasonLabels[reason] || reason)
            .join("、");
    }
    if (Array.isArray(item?.corridors) && item.corridors.length > 0) {
        const corridorReasons = item.corridors.flatMap((corridor) => corridor?.reasons || []);
        if (corridorReasons.length > 0) {
            return corridorReasons
                .map((reason) => skyBridgeReasonLabels[reason] || reason)
                .join("、");
        }
    }
    return "违反空中连廊规范";
}
/**
 * 将车行出入口检测结果转换为详细统计
 */
function convertVehicleEntranceToStats(result) {
    if (!result || !result.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const results = result.results || [];
    const passed = results.filter((r) => isVehicleEntrancePassed(r));
    const failed = results.filter((r) => !isVehicleEntrancePassed(r));
    const passedByPlot = groupByName(passed, (item) => getVehicleEntrancePlotName(item));
    return {
        passed: {
            plots: passedByPlot.map((plot) => ({
                name: plot.plotName,
                buildings: plot.buildings.map((item) => getVehicleEntranceName(item)),
            })),
            totalPlots: new Set(passed.map((item) => getVehicleEntrancePlotName(item))).size,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((item) => ({
                plotName: getVehicleEntrancePlotName(item),
                buildingName: getVehicleEntranceName(item),
                issue: "不符合规范",
                details: getVehicleEntranceDetails(item, result?.parameters),
            })),
            totalPlots: new Set(failed.map((item) => getVehicleEntrancePlotName(item))).size,
            totalBuildings: failed.length,
        },
        summary: `总计：${results.length} 个车行出入口，${passed.length} 个通过，${failed.length} 个不符合`,
    };
}
const vehicleEntranceReasonLabels = {
    too_close_main_intersection: "主干路交叉口距离不足",
    too_close_secondary_intersection: "次干路交叉口距离不足",
    too_close_branch_intersection: "支路交叉口距离不足",
};
function isVehicleEntrancePassed(item) {
    if (typeof item?.status === "string") {
        return item.status === "pass";
    }
    if (typeof item?.is_compliant === "boolean") {
        return item.is_compliant;
    }
    return false;
}
function getVehicleEntrancePlotName(item) {
    return item?.plot_name || "车行出入口";
}
function getVehicleEntranceName(item) {
    return item?.name || item?.entrance_name || `出入口${item?.index ?? item?.entrance_index ?? ""}`;
}
function formatDistanceWithThreshold(distance, threshold) {
    if (typeof distance !== "number" || !Number.isFinite(distance)) {
        return null;
    }
    if (typeof threshold === "number" && Number.isFinite(threshold)) {
        return `${distance.toFixed(2)}m < ${threshold.toFixed(2)}m`;
    }
    return `${distance.toFixed(2)}m`;
}
function getVehicleEntranceDetails(item, parameters) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    if (!Array.isArray(item?.reasons) || item.reasons.length === 0) {
        return "违反车行出入口规范";
    }
    return item.reasons
        .map((reason) => {
        const label = vehicleEntranceReasonLabels[reason] || reason;
        if (reason === "too_close_main_intersection") {
            const text = formatDistanceWithThreshold(item?.distances?.main, parameters?.min_main_distance);
            return text ? `${label}（${text}）` : label;
        }
        if (reason === "too_close_secondary_intersection") {
            const text = formatDistanceWithThreshold(item?.distances?.secondary, parameters?.min_secondary_distance);
            return text ? `${label}（${text}）` : label;
        }
        if (reason === "too_close_branch_intersection") {
            const text = formatDistanceWithThreshold(item?.distances?.branch, parameters?.min_branch_distance);
            return text ? `${label}（${text}）` : label;
        }
        return label;
    })
        .join("、");
}
/**
 * 将人行出入口检测结果转换为详细统计
 */
function convertPedestrianEntranceToStats(result) {
    if (!result) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const redlines = Array.isArray(result?.redlines) ? result.redlines : [];
    const requiredMin = Number(result?.summary?.required_min ?? result?.parameters?.min_required_count ?? 2) || 2;
    if (redlines.length > 0) {
        const passed = redlines.filter((item) => isPedestrianRedlinePassed(item));
        const failed = redlines.filter((item) => !isPedestrianRedlinePassed(item));
        return {
            passed: {
                plots: passed.map((item) => ({
                    name: getPedestrianRedlineName(item),
                    buildings: [`出入口${Number(item?.entrance_count ?? 0)}个`],
                })),
                totalPlots: passed.length,
                totalBuildings: passed.length,
            },
            failed: {
                items: failed.map((item) => ({
                    plotName: getPedestrianRedlineName(item),
                    buildingName: `出入口${Number(item?.entrance_count ?? 0)}个`,
                    issue: "人行出入口数量不足",
                    details: getPedestrianRedlineDetails(item, requiredMin),
                })),
                totalPlots: failed.length,
                totalBuildings: failed.length,
            },
            summary: `总计：${redlines.length} 条红线，${passed.length} 条通过，${failed.length} 条不符合`,
        };
    }
    if (!result?.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const entries = result.results || [];
    const passed = entries.filter((item) => isPedestrianRedlinePassed(item));
    const failed = entries.filter((item) => !isPedestrianRedlinePassed(item));
    const passedByPlot = groupByName(passed, () => "人行出入口");
    return {
        passed: {
            plots: passedByPlot.map((plot) => ({
                name: plot.plotName,
                buildings: plot.buildings.map((item) => getPedestrianEntranceName(item)),
            })),
            totalPlots: passedByPlot.length,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((item) => ({
                plotName: "人行出入口",
                buildingName: getPedestrianEntranceName(item),
                issue: "不符合规范",
                details: getPedestrianEntranceDetails(item),
            })),
            totalPlots: failed.length > 0 ? 1 : 0,
            totalBuildings: failed.length,
        },
        summary: `总计：${entries.length} 个人行出入口，${passed.length} 个通过，${failed.length} 个不符合`,
    };
}
const pedestrianEntranceReasonLabels = {
    outside_redline: "不在建筑红线内/线上",
    insufficient_entrances: "建筑红线内/线上出入口数量不足",
};
function isPedestrianRedlinePassed(item) {
    if (typeof item?.status === "string") {
        return item.status === "pass";
    }
    if (typeof item?.is_compliant === "boolean") {
        return item.is_compliant;
    }
    return false;
}
function getPedestrianRedlineName(item) {
    if (typeof item?.plot_name === "string" && item.plot_name.trim()) {
        return item.plot_name;
    }
    if (typeof item?.redline_name === "string" && item.redline_name.trim()) {
        return item.redline_name;
    }
    if (typeof item?.index === "number") {
        return `红线${item.index + 1}`;
    }
    return "建筑红线";
}
function getPedestrianRedlineDetails(item, requiredMin) {
    const count = Number(item?.entrance_count ?? 0);
    const base = `建筑红线内/线上出入口数量：${count}/${requiredMin}`;
    if (!Array.isArray(item?.reasons) || item.reasons.length === 0) {
        return base;
    }
    const reasonText = item.reasons
        .map((reason) => pedestrianEntranceReasonLabels[reason] || reason)
        .join("、");
    return `${base}，${reasonText}`;
}
function getPedestrianEntranceName(item) {
    return item?.name || item?.entrance_name || `出入口${item?.index ?? item?.entrance_index ?? ""}`;
}
function getPedestrianEntranceDetails(item) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    if (Array.isArray(item?.reasons) && item.reasons.length > 0) {
        return item.reasons
            .map((reason) => pedestrianEntranceReasonLabels[reason] || reason)
            .join("、");
    }
    return "违反人行出入口规范";
}
/**
 * 将绿地退线检测结果转换为详细统计
 */
function convertGreenSetbackToStats(result) {
    if (!result || !result.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const buildings = result.results || [];
    const passed = buildings.filter((b) => !isGreenSetbackViolation(b));
    const failed = buildings.filter((b) => isGreenSetbackViolation(b));
    const passedByPlot = groupByName(passed, (item) => getGreenSetbackPlotName(item));
    return {
        passed: {
            plots: passedByPlot.map((p) => ({
                name: p.plotName,
                buildings: p.buildings.map((b) => b.building_name),
            })),
            totalPlots: new Set(passed.map((b) => getGreenSetbackPlotName(b))).size,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((f) => ({
                plotName: getGreenSetbackPlotName(f),
                buildingName: f.building_name,
                issue: "绿地退线违规",
                details: getGreenSetbackDetails(f),
            })),
            totalPlots: new Set(failed.map((b) => getGreenSetbackPlotName(b))).size,
            totalBuildings: failed.length,
        },
        summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
    };
}
const greenSetbackReasonLabels = {
    inside_green_setback: "侵入绿地退线范围",
    below_ignore_height: "建筑高度低于忽略阈值",
};
function isGreenSetbackViolation(item) {
    if (typeof item?.is_violation === "boolean") {
        return item.is_violation;
    }
    if (typeof item?.status === "string") {
        return item.status === "fail";
    }
    if (typeof item?.is_compliant === "boolean") {
        return !item.is_compliant;
    }
    return false;
}
function getGreenSetbackPlotName(item) {
    return item?.plot_name || item?.green_name || "未知地块";
}
function getGreenSetbackDetails(item) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    if (Array.isArray(item?.reasons) && item.reasons.length > 0) {
        return item.reasons
            .map((reason) => greenSetbackReasonLabels[reason] || reason)
            .join("、");
    }
    return item?.message || "违反绿地退线要求";
}
/**
 * 将广场退线检测结果转换为详细统计
 */
function convertPlazaSetbackToStats(result) {
    if (!result || !result.results) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const buildings = result.results || [];
    const passed = buildings.filter((b) => !isPlazaSetbackViolation(b));
    const failed = buildings.filter((b) => isPlazaSetbackViolation(b));
    const passedByPlot = groupByName(passed, (item) => getPlazaSetbackPlotName(item));
    return {
        passed: {
            plots: passedByPlot.map((p) => ({
                name: p.plotName,
                buildings: p.buildings.map((b) => b.building_name),
            })),
            totalPlots: new Set(passed.map((b) => getPlazaSetbackPlotName(b))).size,
            totalBuildings: passed.length,
        },
        failed: {
            items: failed.map((f) => ({
                plotName: getPlazaSetbackPlotName(f),
                buildingName: f.building_name,
                issue: "广场退线违规",
                details: getPlazaSetbackDetails(f),
            })),
            totalPlots: new Set(failed.map((b) => getPlazaSetbackPlotName(b))).size,
            totalBuildings: failed.length,
        },
        summary: `总计：${buildings.length} 栋建筑，${passed.length} 栋通过，${failed.length} 栋违规`,
    };
}
const plazaSetbackReasonLabels = {
    inside_plaza_setback: "侵入广场退线范围",
    below_ignore_height: "建筑高度低于忽略阈值",
};
function isPlazaSetbackViolation(item) {
    if (typeof item?.is_violation === "boolean") {
        return item.is_violation;
    }
    if (typeof item?.status === "string") {
        return item.status === "fail";
    }
    if (typeof item?.is_compliant === "boolean") {
        return !item.is_compliant;
    }
    return false;
}
function getPlazaSetbackPlotName(item) {
    return item?.plot_name || item?.plaza_name || "未知地块";
}
function getPlazaSetbackDetails(item) {
    if (typeof item?.reason === "string" && item.reason.trim()) {
        return item.reason;
    }
    if (Array.isArray(item?.reasons) && item.reasons.length > 0) {
        return item.reasons
            .map((reason) => plazaSetbackReasonLabels[reason] || reason)
            .join("、");
    }
    return item?.message || "违反广场退线要求";
}
/**
 * 将贴线率检测结果转换为详细统计
 */
function convertBuildingLineRateToStats(result) {
    if (!result || !result.plots) {
        return {
            passed: { plots: [], totalPlots: 0, totalBuildings: 0 },
            failed: { items: [], totalPlots: 0, totalBuildings: 0 },
            summary: "无检测数据",
        };
    }
    const plots = result.plots || [];
    const passed = plots.filter((p) => p.is_compliant);
    const failed = plots.filter((p) => !p.is_compliant);
    return {
        passed: {
            plots: passed.map((p) => ({
                name: p.plot_name,
                buildings: getSetbackRateBuildingNames(p),
            })),
            totalPlots: passed.length,
            totalBuildings: passed.reduce((sum, p) => sum + getSetbackRateBuildingNames(p).length, 0),
        },
        failed: {
            items: failed.map((p) => ({
                plotName: p.plot_name || "未知地块",
                buildingName: getSetbackRateBuildingNames(p).join("、"),
                issue: "贴线率不符合要求",
                details: getSetbackRateDetails(p),
            })),
            totalPlots: failed.length,
            totalBuildings: failed.reduce((sum, p) => sum + getSetbackRateBuildingNames(p).length, 0),
        },
        summary: `总计：${plots.length} 个地块，${passed.length} 个通过，${failed.length} 个不符合`,
    };
}
function getSetbackRateBuildingNames(item) {
    if (Array.isArray(item?.building_names)) {
        const names = item.building_names
            .map((name) => (typeof name === "string" ? name.trim() : ""))
            .filter((name) => name.length > 0);
        if (names.length > 0) {
            return names;
        }
    }
    if (Array.isArray(item?.buildings)) {
        const names = item.buildings
            .map((building, index) => building?.building_name ||
            building?.name ||
            building?.buildingName ||
            `建筑${index + 1}`)
            .filter((name) => typeof name === "string" && name.trim().length > 0)
            .map((name) => name.trim());
        if (names.length > 0) {
            return names;
        }
    }
    return [formatSetbackRateBuildingName(getSetbackRateBuildingCount(item))];
}
function getSetbackRateBuildingCount(item) {
    if (typeof item?.building_count === "number" && Number.isFinite(item.building_count)) {
        return item.building_count;
    }
    if (Array.isArray(item?.buildings)) {
        return item.buildings.length;
    }
    return 0;
}
function formatSetbackRateBuildingName(buildingCount) {
    if (buildingCount <= 0) {
        return "无参与建筑";
    }
    return `${buildingCount}栋建筑`;
}
function getSetbackRateDetails(item) {
    const actualRate = Number(item?.frontage_rate ?? item?.setback_rate ?? item?.actual_rate ?? 0);
    const requiredRate = item?.required_rate;
    if (typeof requiredRate === "number" && Number.isFinite(requiredRate)) {
        return `实际贴线率 ${(actualRate * 100).toFixed(2)}%，要求 ${(requiredRate * 100).toFixed(2)}%`;
    }
    return `实际贴线率 ${(actualRate * 100).toFixed(2)}%，未设置要求贴线率`;
}
function groupByName(items, getName) {
    const groups = new Map();
    items.forEach((item) => {
        const name = getName(item);
        if (!groups.has(name)) {
            groups.set(name, []);
        }
        groups.get(name).push(item);
    });
    return Array.from(groups.entries()).map(([plotName, buildings]) => ({
        plotName,
        buildings,
    }));
}
/**
 * 按地块分组
 */
function groupByPlot(buildings) {
    const groups = new Map();
    buildings.forEach((b) => {
        const plotName = b.plot_name ||
            b.redline_name ||
            b.green_name ||
            b.plaza_name ||
            (b.plot_a && b.plot_b ? `${b.plot_a} ↔ ${b.plot_b}` : null) ||
            "未知地块";
        if (!groups.has(plotName)) {
            groups.set(plotName, []);
        }
        groups.get(plotName).push(b);
    });
    return Array.from(groups.entries()).map(([plotName, buildings]) => ({
        plotName,
        buildings,
    }));
}
/**
 * 根据功能 ID 转换检测结果为详细统计
 */
function convertResultToStats(featureId, rawResult) {
    if (!rawResult)
        return null;
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
        case "vehicle-entrance-check":
            return convertVehicleEntranceToStats(rawResult);
        case "pedestrian-entrance-check":
            return convertPedestrianEntranceToStats(rawResult);
        case "green-setback-check":
            return convertGreenSetbackToStats(rawResult);
        case "plaza-setback-check":
            return convertPlazaSetbackToStats(rawResult);
        case "setback-rate-check":
            return convertBuildingLineRateToStats(rawResult);
        default:
            return null;
    }
}
