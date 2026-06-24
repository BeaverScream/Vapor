export type RoomPolicyRecord = {
  expiresAt: number;
  hasEverHadGuest: boolean;
  roomTtlTimeoutRef?: NodeJS.Timeout;
  soloDeadlineAt?: number;
  soloTimeoutRef?: NodeJS.Timeout;
  hostGraceDeadlineAt?: number;
  hostGraceTimeoutRef?: NodeJS.Timeout;
};

export type GuestGraceRecord = {
  roomId: string;
  participantId: string;
  deadlineAt: number;
  timeoutRef?: NodeJS.Timeout;
};

export type GraceWindowContext = {
  roomPolicyById: Map<string, RoomPolicyRecord>;
  guestGraceByParticipant: Map<string, GuestGraceRecord>;
};

export function createGraceWindowContext(): GraceWindowContext {
  return {
    roomPolicyById: new Map(),
    guestGraceByParticipant: new Map(),
  };
}

export function clearRoomPolicyTimers(policy: RoomPolicyRecord): void {
  if (policy.roomTtlTimeoutRef) clearTimeout(policy.roomTtlTimeoutRef);
  if (policy.soloTimeoutRef) clearTimeout(policy.soloTimeoutRef);
  if (policy.hostGraceTimeoutRef) clearTimeout(policy.hostGraceTimeoutRef);
}

export function clearHostGrace(policy: RoomPolicyRecord): void {
  if (policy.hostGraceTimeoutRef) clearTimeout(policy.hostGraceTimeoutRef);
  policy.hostGraceTimeoutRef = undefined;
  policy.hostGraceDeadlineAt = undefined;
}

export function clearGuestGrace(ctx: GraceWindowContext, participantId: string): void {
  const grace = ctx.guestGraceByParticipant.get(participantId);
  if (grace?.timeoutRef) clearTimeout(grace.timeoutRef);
  ctx.guestGraceByParticipant.delete(participantId);
}

export function createRoomPolicy(
  ctx: GraceWindowContext,
  roomId: string,
  createdAt: number,
  maxDurationMs: number,
  soloTimeoutMs: number,
  onTtlExpired: () => void,
  onSoloExpired: () => void,
): RoomPolicyRecord {
  const policy: RoomPolicyRecord = {
    expiresAt: createdAt + maxDurationMs,
    hasEverHadGuest: false,
    soloDeadlineAt: createdAt + soloTimeoutMs,
  };

  policy.roomTtlTimeoutRef = setTimeout(onTtlExpired, maxDurationMs);
  policy.roomTtlTimeoutRef.unref?.();

  policy.soloTimeoutRef = setTimeout(onSoloExpired, soloTimeoutMs);
  policy.soloTimeoutRef.unref?.();

  ctx.roomPolicyById.set(roomId, policy);

  return policy;
}

export function beginHostGrace(
  ctx: GraceWindowContext,
  roomId: string,
  nowTs: number,
  graceMs: number,
  onExpired: () => void,
): number | null {
  const policy = ctx.roomPolicyById.get(roomId);
  if (!policy) return null;

  clearHostGrace(policy);

  const deadlineAt = nowTs + graceMs;
  policy.hostGraceDeadlineAt = deadlineAt;
  policy.hostGraceTimeoutRef = setTimeout(onExpired, graceMs);
  policy.hostGraceTimeoutRef.unref?.();

  return deadlineAt;
}

export function restartSoloTimer(
  policy: RoomPolicyRecord,
  soloTimeoutMs: number,
  nowFn: () => number,
  onExpired: () => void,
): number {
  if (policy.soloTimeoutRef) clearTimeout(policy.soloTimeoutRef);
  const deadline = nowFn() + soloTimeoutMs;
  policy.soloDeadlineAt = deadline;
  policy.soloTimeoutRef = setTimeout(onExpired, soloTimeoutMs);
  policy.soloTimeoutRef.unref?.();
  return deadline;
}

export function beginGuestGrace(
  ctx: GraceWindowContext,
  roomId: string,
  participantId: string,
  nowTs: number,
  graceMs: number,
  disconnectedParticipants: Set<string>,
  onExpired: (participantId: string, roomId: string) => void,
): number | null {
  clearGuestGrace(ctx, participantId);

  const deadlineAt = nowTs + graceMs;
  const timeoutRef = setTimeout(() => {
    ctx.guestGraceByParticipant.delete(participantId);

    if (!disconnectedParticipants.has(participantId)) return;
    disconnectedParticipants.delete(participantId);

    onExpired(participantId, roomId);
  }, graceMs);
  timeoutRef.unref?.();

  ctx.guestGraceByParticipant.set(participantId, {
    roomId,
    participantId,
    deadlineAt,
    timeoutRef,
  });

  return deadlineAt;
}
