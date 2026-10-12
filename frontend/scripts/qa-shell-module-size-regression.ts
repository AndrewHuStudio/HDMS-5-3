import fs from "node:fs";
import path from "node:path";


const shellPath = path.resolve(process.cwd(), "components/qa-new/qa-shell.tsx");
const lineCount = fs.readFileSync(shellPath, "utf8").split(/\r?\n/).length;

if (lineCount > 600) {
  throw new Error(`qa-shell.tsx must be at most 600 lines, received ${lineCount}`);
}

console.log(`qa-shell-module-size-regression passed (${lineCount} lines)`);
