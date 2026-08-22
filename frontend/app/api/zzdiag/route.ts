export const runtime = "nodejs";
import { appendFileSync, readFileSync, existsSync } from "fs";

const LOG = "e:/MyPrograms/HDMS/frontend/.zzdiag.log";

export async function POST(req: Request) {
  const body = await req.text();
  appendFileSync(LOG, body + "\n", "utf8");
  return new Response("ok");
}

export async function GET() {
  const text = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
  return new Response(text, { headers: { "Content-Type": "text/plain" } });
}
