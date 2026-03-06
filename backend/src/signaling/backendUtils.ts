import { randomBytes } from "node:crypto";

export function generateToken(size = 8): string {
  return randomBytes(size).toString("hex");
}