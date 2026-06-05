import { randomBytes, createHash } from "node:crypto";

export type ParticipantReconnectRecord = {
  roomId: string;
  participantId: string;
  passwordVersion: number;
  disconnected: boolean;
  validUntil: number;
};

export type ReconnectContext = {
  reconnectByHash: Map<string, ParticipantReconnectRecord>;
  reconnectTokenByParticipant: Map<string, string>;
  disconnectedParticipants: Set<string>;
};

export function createReconnectContext(): ReconnectContext {
  return {
    reconnectByHash: new Map(),
    reconnectTokenByParticipant: new Map(),
    disconnectedParticipants: new Set(),
  };
}

function getReconnectTokenPepper(): string {
  return process.env.RECONNECT_TOKEN_PEPPER ?? "vapor-dev-reconnect-pepper";
}

export function hashReconnectToken(token: string): string {
  return createHash("sha256").update(token + getReconnectTokenPepper()).digest("hex");
}

export function upsertReconnectToken(
  ctx: ReconnectContext,
  roomId: string,
  participantId: string,
  passwordVersion: number,
): string {
  const oldHash = ctx.reconnectTokenByParticipant.get(participantId);
  if (oldHash) {
    ctx.reconnectByHash.delete(oldHash);
  }

  const reconnectToken = randomBytes(24).toString("hex");
  const tokenHash = hashReconnectToken(reconnectToken);

  ctx.reconnectTokenByParticipant.set(participantId, tokenHash);
  ctx.reconnectByHash.set(tokenHash, {
    roomId,
    participantId,
    passwordVersion,
    disconnected: false,
    validUntil: 0,
  });

  return reconnectToken;
}

export function markReconnectDisconnected(
  ctx: ReconnectContext,
  participantId: string,
  validUntil: number,
): void {
  const tokenHash = ctx.reconnectTokenByParticipant.get(participantId);
  if (!tokenHash) return;

  const record = ctx.reconnectByHash.get(tokenHash);
  if (!record) return;

  record.disconnected = true;
  record.validUntil = validUntil;
}

export function clearReconnectForParticipant(
  ctx: ReconnectContext,
  participantId: string,
  clearGuestGrace: (participantId: string) => void,
): void {
  const tokenHash = ctx.reconnectTokenByParticipant.get(participantId);
  if (tokenHash) {
    ctx.reconnectByHash.delete(tokenHash);
    ctx.reconnectTokenByParticipant.delete(participantId);
  }
  clearGuestGrace(participantId);
  ctx.disconnectedParticipants.delete(participantId);
}

export function clearReconnectForRoom(
  ctx: ReconnectContext,
  roomId: string,
  clearGuestGrace: (participantId: string) => void,
): void {
  for (const [hash, record] of Array.from(ctx.reconnectByHash.entries())) {
    if (record.roomId !== roomId) continue;
    ctx.reconnectByHash.delete(hash);
    ctx.reconnectTokenByParticipant.delete(record.participantId);
    clearGuestGrace(record.participantId);
    ctx.disconnectedParticipants.delete(record.participantId);
  }
}

export function sweepExpiredReconnectTokens(
  ctx: ReconnectContext,
  nowTs: number,
): void {
  for (const [hash, record] of Array.from(ctx.reconnectByHash.entries())) {
    if (record.disconnected && record.validUntil > 0 && record.validUntil <= nowTs) {
      ctx.reconnectByHash.delete(hash);
      ctx.reconnectTokenByParticipant.delete(record.participantId);
      ctx.disconnectedParticipants.delete(record.participantId);
    }
  }
}
