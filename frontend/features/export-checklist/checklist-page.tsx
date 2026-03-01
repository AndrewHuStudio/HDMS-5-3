"use client";

import type { FeatureChecklistItem } from "./types";

interface ChecklistPageProps {
  projectName: string;
  items: FeatureChecklistItem[];
  hideAISuggestions?: boolean;
}

export function ChecklistPage({
  projectName,
  items,
  hideAISuggestions = false,
}: ChecklistPageProps) {
  const date = new Date().toLocaleDateString("zh-CN");

  return (
    <div
      className="bg-white text-black p-8"
      style={{
        width: "210mm",
        minHeight: "297mm",
        fontFamily: "SimSun, serif",
      }}
    >
      {/* 标题 */}
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold mb-2">
          {projectName || "____"}管控审核清单
        </h1>
        <p className="text-sm text-gray-600">日期：{date}</p>
      </div>

      {/* 分隔线 */}
      <div className="border-t-2 border-gray-800 mb-6" />

      {/* 检测项列表 */}
      <div className="space-y-6">
        {items.map((item, index) => (
          <div key={item.id} className="border-b border-gray-300 pb-4">
            {/* 序号和名称 */}
            <h2 className="text-lg font-bold mb-3">
              {index + 1}、{item.name}
            </h2>

            {/* 渲染图 */}
            {(item.screenshots.northeast || item.screenshots.northwest) && (
              <div className="mb-3 grid grid-cols-2 gap-3">
                {item.screenshots.northeast && (
                  <div>
                    <img
                      src={item.screenshots.northeast}
                      alt={`${item.name}东北视角检测结果图`}
                      className="w-full border border-gray-300"
                    />
                    <p className="mt-1 text-[11px] text-gray-500 text-center">
                      {item.name}东北视角检测结果图
                    </p>
                  </div>
                )}
                {item.screenshots.northwest && (
                  <div>
                    <img
                      src={item.screenshots.northwest}
                      alt={`${item.name}西北视角检测结果图`}
                      className="w-full border border-gray-300"
                    />
                    <p className="mt-1 text-[11px] text-gray-500 text-center">
                      {item.name}西北视角检测结果图
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* 检测结果摘要 */}
            <div className="mb-2">
              <span className="font-semibold">检测结果：</span>
              <span>{item.summary}</span>
            </div>

            {/* AI 审查建议（可隐藏） */}
            {!hideAISuggestions && item.aiSuggestion && item.showAiSuggestion && (
              <div className="mb-2 bg-blue-50 p-2 rounded">
                <span className="font-semibold text-blue-800">AI 审查建议：</span>
                <span className="text-blue-900">{item.aiSuggestion}</span>
              </div>
            )}

            {/* 政府单位建议 */}
            {item.govSuggestion && (
              <div className="mb-2">
                <span className="font-semibold">政府单位建议：</span>
                <span>{item.govSuggestion}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
