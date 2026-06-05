import type { Socket } from "socket.io";
import * as signaling from "../contracts";

const CREATE_ATTEMPT_WINDOW_MS = 60 * 1000;
const CREATE_ROOM_BURST_THRESHOLD = 5;
const CREATE_ROOM_BLOCK_DURATION_MS = 10 * 60 * 1000;
const IP_ABUSE_WINDOW_MS = 60 * 1000;
const IP_CREATE_THRESHOLD = 10;
const IP_JOIN_THRESHOLD = 30;

export type JoinAttemptRecord = {
  invalidCount: number;
  cooldownUntil?: number;
  strictLocked: boolean;
  lastAttemptAt: number;
};

type IpAbuseRecord = {
  createCount: number;
  joinCount: number;
  windowStart: number;
};

export type RateLimitingContext = {
  createAttemptsBySubject: Map<string, { count: number; firstAt: number }>;
  temporaryBlocklistBySubject: Map<string, number>;
  joinAttemptByRoomSubject: Map<string, JoinAttemptRecord>;
  ipAbuseByIp: Map<string, IpAbuseRecord>;
};

export function createRateLimitingContext(): RateLimitingContext {
  return {
    createAttemptsBySubject: new Map(),
    temporaryBlocklistBySubject: new Map(),
    joinAttemptByRoomSubject: new Map(),
    ipAbuseByIp: new Map(),
  };
}

export function deriveJoinAttemptSubject(socket: Socket): string {
  const socketLike = socket as Socket & {
    handshake?: {
      address?: string;
      headers?: Record<string, string | string[] | undefined>;
      auth?: { clientFingerprint?: string };
    };
  };

  const handshake = socketLike.handshake;
  const ip = handshake?.address ?? "unknown-ip";
  const userAgentHeader = handshake?.headers?.["user-agent"];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader.join(" ")
    : (userAgentHeader ?? "unknown-ua");
  const clientFingerprint =
    typeof handshake?.auth?.clientFingerprint === "string"
      ? handshake.auth.clientFingerprint
      : "unknown-fingerprint";

  const hasNoHandshakeSignals =
    ip === "unknown-ip" &&
    userAgent === "unknown-ua" &&
    clientFingerprint === "unknown-fingerprint";

  if (hasNoHandshakeSignals) {
    return "unknown-ip|unknown-ua|unknown-fingerprint";
  }

  return `${ip}|${userAgent}|${clientFingerprint}`;
}

export function deriveIp(socket: Socket): string {
  const socketLike = socket as Socket & { handshake?: { address?: string } };
  return socketLike.handshake?.address ?? "unknown-ip";
}

export function makeJoinAttemptKey(roomId: string, subject: string): string {
  return `${roomId}::${subject}`;
}

export function checkAndRecordCreateAttempt(
  ctx: RateLimitingContext,
  subject: string,
  ip: string,
  nowTs: number,
): boolean {
  const blockedUntil = ctx.temporaryBlocklistBySubject.get(subject);
  if (blockedUntil && nowTs < blockedUntil) return true;

  let ipRecord = ctx.ipAbuseByIp.get(ip);
  if (!ipRecord || nowTs - ipRecord.windowStart > IP_ABUSE_WINDOW_MS) {
    ipRecord = { createCount: 0, joinCount: 0, windowStart: nowTs };
    ctx.ipAbuseByIp.set(ip, ipRecord);
  }
  ipRecord.createCount += 1;
  if (ipRecord.createCount > IP_CREATE_THRESHOLD) return true;

  const prev = ctx.createAttemptsBySubject.get(subject);
  if (!prev || nowTs - prev.firstAt > CREATE_ATTEMPT_WINDOW_MS) {
    ctx.createAttemptsBySubject.set(subject, { count: 1, firstAt: nowTs });
  } else {
    prev.count += 1;
    ctx.createAttemptsBySubject.set(subject, prev);
    if (prev.count > CREATE_ROOM_BURST_THRESHOLD) {
      ctx.temporaryBlocklistBySubject.set(subject, nowTs + CREATE_ROOM_BLOCK_DURATION_MS);
      ctx.createAttemptsBySubject.delete(subject);
      return true;
    }
  }

  return false;
}

export function checkAndRecordJoinIp(
  ctx: RateLimitingContext,
  ip: string,
  nowTs: number,
): boolean {
  let ipRecord = ctx.ipAbuseByIp.get(ip);
  if (!ipRecord || nowTs - ipRecord.windowStart > IP_ABUSE_WINDOW_MS) {
    ipRecord = { createCount: 0, joinCount: 0, windowStart: nowTs };
    ctx.ipAbuseByIp.set(ip, ipRecord);
  }
  ipRecord.joinCount += 1;
  return ipRecord.joinCount > IP_JOIN_THRESHOLD;
}

export function getJoinAttemptStatus(
  ctx: RateLimitingContext,
  roomId: string,
  subject: string,
  nowTs: number,
): "ok" | "rate_limited" {
  const key = makeJoinAttemptKey(roomId, subject);
  const attempt = ctx.joinAttemptByRoomSubject.get(key);
  if (!attempt) return "ok";

  if (attempt.strictLocked) return "rate_limited";

  if (attempt.cooldownUntil) {
    if (nowTs < attempt.cooldownUntil) return "rate_limited";
    attempt.cooldownUntil = undefined;
    ctx.joinAttemptByRoomSubject.set(key, attempt);
  }

  return "ok";
}

export function recordInvalidPasswordAttempt(
  ctx: RateLimitingContext,
  roomId: string,
  subject: string,
  nowTs: number,
): "emit_invalid_password" | "emit_rate_limited" {
  const key = makeJoinAttemptKey(roomId, subject);
  const existing = ctx.joinAttemptByRoomSubject.get(key);
  const nextInvalidCount = (existing?.invalidCount ?? 0) + 1;

  const nextAttempt: JoinAttemptRecord = {
    invalidCount: nextInvalidCount,
    strictLocked: false,
    lastAttemptAt: nowTs,
  };

  if (nextInvalidCount <= signaling.JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX) {
    ctx.joinAttemptByRoomSubject.set(key, nextAttempt);
    return "emit_invalid_password";
  }

  if (nextInvalidCount <= signaling.JOIN_INVALID_ATTEMPT_COOLDOWN_MAX) {
    nextAttempt.cooldownUntil = nowTs + signaling.JOIN_INVALID_ATTEMPT_COOLDOWN_MS;
    ctx.joinAttemptByRoomSubject.set(key, nextAttempt);
    return "emit_rate_limited";
  }

  nextAttempt.strictLocked = true;
  ctx.joinAttemptByRoomSubject.set(key, nextAttempt);
  return "emit_rate_limited";
}

export function clearSuccessfulJoinAttempt(
  ctx: RateLimitingContext,
  roomId: string,
  subject: string,
): void {
  ctx.joinAttemptByRoomSubject.delete(makeJoinAttemptKey(roomId, subject));
}

export function purgeJoinAttemptsForRoom(
  ctx: RateLimitingContext,
  roomId: string,
): void {
  const roomPrefix = `${roomId}::`;
  for (const key of Array.from(ctx.joinAttemptByRoomSubject.keys())) {
    if (key.startsWith(roomPrefix)) {
      ctx.joinAttemptByRoomSubject.delete(key);
    }
  }
}

export function sweepRateLimitRecords(
  ctx: RateLimitingContext,
  nowTs: number,
): void {
  for (const [subject, expiry] of Array.from(ctx.temporaryBlocklistBySubject.entries())) {
    if (expiry <= nowTs) ctx.temporaryBlocklistBySubject.delete(subject);
  }

  for (const [subject, attempt] of Array.from(ctx.createAttemptsBySubject.entries())) {
    if (nowTs - attempt.firstAt > CREATE_ATTEMPT_WINDOW_MS) {
      ctx.createAttemptsBySubject.delete(subject);
    }
  }

  for (const [ip, record] of Array.from(ctx.ipAbuseByIp.entries())) {
    if (nowTs - record.windowStart > IP_ABUSE_WINDOW_MS) {
      ctx.ipAbuseByIp.delete(ip);
    }
  }
}
