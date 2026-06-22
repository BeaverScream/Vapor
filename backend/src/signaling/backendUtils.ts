import { randomBytes } from "node:crypto";

export function generateToken(size = 8): string {
  return randomBytes(size).toString("hex");
}

export function validateRoomName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const normalized = name.toLowerCase();
  if (normalized.length < 3 || normalized.length > 24) return null;
  if (!/^[a-z0-9-]+$/.test(normalized)) return null;
  return normalized;
}