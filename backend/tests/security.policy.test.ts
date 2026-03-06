/// <reference types="node" />
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

const BACKEND_SRC_ROOT = path.resolve(process.cwd(), "src");

const FORBIDDEN_SECRET_PATTERNS: RegExp[] = [
  /console\.(log|info|debug|warn|error)\([^\n]*password/i,
  /console\.(log|info|debug|warn|error)\([^\n]*reconnecttoken/i,
  /console\.(log|info|debug|warn|error)\([^\n]*\bsdp\b/i,
  /console\.(log|info|debug|warn|error)\([^\n]*\bice\b/i,
  /console\.(log|info|debug|warn|error)\([^\n]*candidate/i
];

const FORBIDDEN_PERSISTENCE_PATTERNS: RegExp[] = [
  /from\s+"node:fs"/,
  /from\s+"fs"/,
  /writeFile\(/,
  /appendFile\(/,
  /createWriteStream\(/,
  /better-sqlite3/,
  /mongoose/,
  /typeorm/,
  /prisma/
];

async function collectTypeScriptFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry: Dirent) => {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        return collectTypeScriptFiles(fullPath);
      }

      if (entry.isFile() && fullPath.endsWith(".ts")) {
        return [fullPath];
      }

      return [];
    })
  );

  return files.flat();
}

test("P1-ZP-012: backend source contains no obvious secret-logging statements", async () => {
  const files = await collectTypeScriptFiles(BACKEND_SRC_ROOT);
  assert.ok(files.length > 0, "Expected backend TypeScript source files");

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");

    for (const pattern of FORBIDDEN_SECRET_PATTERNS) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden secret logging pattern matched in ${filePath}: ${pattern}`
      );
    }
  }
});

test("P0-RS-004: backend source avoids persistence APIs/libraries in Phase 0 runtime paths", async () => {
  const files = await collectTypeScriptFiles(BACKEND_SRC_ROOT);

  for (const filePath of files) {
    if (!filePath.includes(`${path.sep}signaling${path.sep}`) && !filePath.endsWith(`${path.sep}server.ts`)) {
      continue;
    }

    const content = await fs.readFile(filePath, "utf8");

    for (const pattern of FORBIDDEN_PERSISTENCE_PATTERNS) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden persistence pattern matched in ${filePath}: ${pattern}`
      );
    }
  }
});
