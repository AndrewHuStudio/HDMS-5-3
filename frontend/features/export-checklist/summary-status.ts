export function getSummaryTextClass(summary: string, isPass?: boolean): string {
  if (summary === "未检测") {
    return "text-gray-400";
  }

  if (typeof isPass === "boolean") {
    return isPass ? "text-green-600" : "text-red-600";
  }

  const passedByKeyword = summary.includes("通过") && !summary.includes("不");
  return passedByKeyword ? "text-green-600" : "text-red-600";
}
