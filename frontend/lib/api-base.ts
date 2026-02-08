export const API_BASE =
  process.env.NEXT_PUBLIC_HDMS_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://localhost:8000";

export const QA_API_BASE =
  process.env.NEXT_PUBLIC_HDMS_QA_BASE ||
  process.env.NEXT_PUBLIC_HDMS_QA_API_BASE ||
  "http://localhost:8000";

export const normalizeApiBase = (value: string) => value.replace(/\/$/, "");
