import type { Socket } from "socket.io";
import * as signaling from "../contracts";

const CREATE_ROOM_BURST_THRESHOLD = 5;
const CREATE_ROOM_BLOCK_DURATION_MS = 10 * 60 * 1000;

type IpAbuseRecord = {
  joinCount: number;
  windowStart: number;
};

export type RateLimitingContext = {
  createAttemptsByIp: Map<string, { count: number; firstAt: number }>;
  temporaryBlocklistByIp: Map<string, number>;
  ipAbuseByIp: Map<string, IpAbuseRecord>;
};

export function createRateLimitingContext(): RateLimitingContext {
  return {
    createAttemptsByIp: new Map(),
    temporaryBlocklistByIp: new Map(),
    ipAbuseByIp: new Map(),
  };
}

// IP-only keying is intentional (VP-11.2): behind a NAT or reverse-proxy all
// clients share one bucket; configure X-Forwarded-For extraction in production.
export function deriveIp(socket: Socket): string {
  const socketLike = socket as Socket & { handshake?: { address?: string } };
  return socketLike.handshake?.address ?? "unknown-ip";
}

export function checkAndRecordCreateAttempt(
  ctx: RateLimitingContext,
  ip: string,
  nowTs: number,
): boolean {
  const blockedUntil = ctx.temporaryBlocklistByIp.get(ip);
  if (blockedUntil && nowTs < blockedUntil) return true;

  const prev = ctx.createAttemptsByIp.get(ip);
  if (!prev || nowTs - prev.firstAt > signaling.CREATE_RATE_LIMIT_WINDOW_MS) {
    ctx.createAttemptsByIp.set(ip, { count: 1, firstAt: nowTs });
  } else {
    prev.count += 1;
    ctx.createAttemptsByIp.set(ip, prev);
    if (prev.count > CREATE_ROOM_BURST_THRESHOLD) {
      ctx.temporaryBlocklistByIp.set(ip, nowTs + CREATE_ROOM_BLOCK_DURATION_MS);
      ctx.createAttemptsByIp.delete(ip);
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
  if (!ipRecord || nowTs - ipRecord.windowStart > signaling.JOIN_RATE_LIMIT_WINDOW_MS) {
    ipRecord = { joinCount: 0, windowStart: nowTs };
    ctx.ipAbuseByIp.set(ip, ipRecord);
  }
  ipRecord.joinCount += 1;
  return ipRecord.joinCount > signaling.JOIN_RATE_LIMIT_MAX;
}

export function sweepRateLimitRecords(
  ctx: RateLimitingContext,
  nowTs: number,
): void {
  for (const [ip, expiry] of Array.from(ctx.temporaryBlocklistByIp.entries())) {
    if (expiry <= nowTs) ctx.temporaryBlocklistByIp.delete(ip);
  }

  for (const [ip, attempt] of Array.from(ctx.createAttemptsByIp.entries())) {
    if (nowTs - attempt.firstAt > signaling.CREATE_RATE_LIMIT_WINDOW_MS) {
      ctx.createAttemptsByIp.delete(ip);
    }
  }

  for (const [ip, record] of Array.from(ctx.ipAbuseByIp.entries())) {
    if (nowTs - record.windowStart > signaling.JOIN_RATE_LIMIT_WINDOW_MS) {
      ctx.ipAbuseByIp.delete(ip);
    }
  }
}
