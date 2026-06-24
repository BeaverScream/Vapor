import type { Server, Socket } from "socket.io";
import * as signaling from "./contracts";
import type {
  CreateRoomPayload,
  HostReconnectGracePayload,
  JoinRoomPayload,
  KickParticipantPayload,
  ParticipantKickedPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  ResumeSessionPayload,
  SignalingErrorCode,
  SignalAnswerPayload,
  SignalIcePayload,
  SignalOfferPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomPasswordUpdatePayload,
  RoomPasswordUpdatedPayload,
  NicknameUpdatePayload,
  NicknameUpdatedPayload,
} from "./contracts";
import type { SignalingState } from "./state";
import {
  createRoomRecord,
  joinRoomRecord,
  removeParticipantBySocket,
  type RoomIdentityFactories,
} from "./roomLifecycle";
import { validateRoomName } from "./backendUtils";
import * as passwordAuth from "./handlers/passwordAuth";
import * as rateLimiting from "./handlers/rateLimiting";
import type { RateLimitingContext } from "./handlers/rateLimiting";
import * as reconnect from "./handlers/reconnectionManager";
import * as grace from "./handlers/graceWindowManager";
import * as relay from "./handlers/signalRelay";
import type { DestroyReason, MetricsErrorCode } from "../admin/metrics";

type MetricsAdapter = {
  recordConnection: (socketId: string, now?: number) => void;
  recordRoomJoin: (socketId: string, roomId: string) => void;
  recordDisconnect: (socketId: string, now?: number) => void;
  recordRoomCreated: (roomId: string, now?: number) => void;
  recordRoomDestroyed: (roomId: string, now?: number) => void;
  incrementParticipantsJoined?: () => void;
  incrementRoomsCreated?: () => void;
  incrementRoomDestroyed?: (reason: DestroyReason) => void;
  incrementErrorCount?: (code: MetricsErrorCode) => void;
  updateRoomLifetimeRolling?: (lifetimeMs: number) => void;
  updatePeakMarks?: () => void;
};

const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 60 * 1000;

type RegisterSocketHandlersArgs = {
  io: Server;
  state: SignalingState;
  metrics: MetricsAdapter;
  now: () => number;
  factories: RoomIdentityFactories;
  sweepIntervalMs?: number;
  rateLimitCtx?: RateLimitingContext;
};

type ExitSource = "disconnect" | "leave";

function emitSocketError(socket: Socket, code: SignalingErrorCode): void {
  socket.emit(signaling.SERVER_EVENTS.error, signaling.makeSocketErrorPayload(code));
}

function emitInvalidSignalPayload(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.invalidSignalPayload);
}

function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  v = v.replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 24) return null;
  if (/\p{C}/u.test(v)) return null;
  if (!/^[\p{L}\p{N} _-]+$/u.test(v)) return null;
  return v;
}

function emitParticipantExit(
  socket: Socket,
  removed: ReturnType<typeof removeParticipantBySocket>,
  source: ExitSource,
  extras?: { liveCount?: number; soloDeadlineAt?: number | null },
): void {
  if (!removed) return;

  if (removed.roomStillActive) {
    const payload: PeerLeftPayload = {
      participantId: removed.participantId,
      reason: source,
      participantCount: extras?.liveCount ?? removed.participantCount,
      ...(extras?.soloDeadlineAt != null ? { soloDeadlineAt: extras.soloDeadlineAt } : {}),
    };
    socket.to(removed.roomId).emit(signaling.SERVER_EVENTS.peerLeft, payload);
    return;
  }

  if (removed.isHost) {
    socket.to(removed.roomId).emit(signaling.SERVER_EVENTS.roomDestroyed, {
      reason: "host_left",
    } as RoomDestroyedPayload);
  }
}

function getLiveParticipantCount(room: { participants: Map<string, { socketId: string }> }): number {
  let count = 0;
  for (const p of room.participants.values()) {
    if (!p.socketId.startsWith("disconnected:")) count++;
  }
  return count;
}

export function registerSocketHandlers({
  io,
  state,
  metrics,
  now,
  factories,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  rateLimitCtx: providedRateLimitCtx,
}: RegisterSocketHandlersArgs): NodeJS.Timeout {
  const authCtx = passwordAuth.createPasswordAuthContext();
  const rateLimitCtx = providedRateLimitCtx ?? rateLimiting.createRateLimitingContext();
  const reconnectCtx = reconnect.createReconnectContext();
  const graceCtx = grace.createGraceWindowContext();
  const roomLockChains = new Map<string, Promise<void>>();

  // Error emit helpers with counter tracking. Keep these inside the closure so every
  // handler binds the instrumented version — do not add un-instrumented module-level twins.
  const emitRoomNotFound = (socket: Socket): void => {
    metrics.incrementErrorCount?.("ROOM_NOT_FOUND");
    emitSocketError(socket, signaling.ERROR_CODES.roomNotFound);
  };
  const emitInvalidPassword = (socket: Socket): void => {
    metrics.incrementErrorCount?.("INVALID_PASSWORD");
    emitSocketError(socket, signaling.ERROR_CODES.invalidPassword);
  };
  const emitRoomFull = (socket: Socket): void => {
    metrics.incrementErrorCount?.("ROOM_FULL");
    emitSocketError(socket, signaling.ERROR_CODES.roomFull);
  };
  const emitRateLimited = (socket: Socket): void => {
    metrics.incrementErrorCount?.("RATE_LIMITED");
    emitSocketError(socket, signaling.ERROR_CODES.rateLimited);
  };
  const emitNotAuthorized = (socket: Socket): void => {
    metrics.incrementErrorCount?.("NOT_AUTHORIZED");
    emitSocketError(socket, signaling.ERROR_CODES.notAuthorized);
  };

  // Shorthand helpers that bind the context objects
  const clearGuestGraceFn = (participantId: string): void =>
    grace.clearGuestGrace(graceCtx, participantId);

  const clearReconnectForParticipantFn = (participantId: string): void =>
    reconnect.clearReconnectForParticipant(reconnectCtx, participantId, clearGuestGraceFn);

  const clearReconnectForRoomFn = (roomId: string): void =>
    reconnect.clearReconnectForRoom(reconnectCtx, roomId, clearGuestGraceFn);

  async function withRoomLock(roomId: string, fn: () => unknown): Promise<void> {
    const prev = roomLockChains.get(roomId);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    roomLockChains.set(roomId, barrier);

    const executeCallback = async (): Promise<void> => {
      try {
        await Promise.resolve(fn());
      } finally {
        release();
      }
    };

    if (!prev) {
      // No previous lock, execute immediately
      await executeCallback();
    } else {
      // Wait for previous lock
      await prev.then(executeCallback);
    }
  }

  const clearRoomArtifacts = (roomId: string): void => {
    const room = state.rooms.get(roomId);
    if (room?.roomName) state.roomNameToId.delete(room.roomName);
    passwordAuth.deleteRoomAuth(authCtx, roomId);
    const policy = graceCtx.roomPolicyById.get(roomId);
    if (policy) grace.clearRoomPolicyTimers(policy);
    graceCtx.roomPolicyById.delete(roomId);
    rateLimiting.purgeJoinAttemptsForRoom(rateLimitCtx, roomId);
    clearReconnectForRoomFn(roomId);
    roomLockChains.delete(roomId);
  };

  const destroyRoom = (roomId: string, reason: RoomDestroyedPayload["reason"]): void => {
    const nowTs = now();
    metrics.recordRoomDestroyed(roomId, nowTs);
    const room = state.rooms.get(roomId);
    // Only count rooms that still exist — a sweep/timer double-fire against an
    // already-deleted room must not inflate the destruction reason counters.
    if (room) {
      metrics.incrementRoomDestroyed?.(reason);
      metrics.updateRoomLifetimeRolling?.(nowTs - room.createdAt);
    }

    const policy = graceCtx.roomPolicyById.get(roomId);
    if (policy) grace.clearRoomPolicyTimers(policy);

    if (room) {
      for (const participant of room.participants.values()) {
        clearGuestGraceFn(participant.participantId);
        reconnectCtx.disconnectedParticipants.delete(participant.participantId);
      }
    }

    if (room) {
      for (const participant of room.participants.values()) {
        state.participantToRoom.delete(participant.participantId);
        state.socketToParticipant.delete(participant.socketId);
      }
      room.nicknameToParticipant.clear();
      room.participants.clear();
      if (room.roomName) state.roomNameToId.delete(room.roomName);
    }

    clearReconnectForRoomFn(roomId);
    passwordAuth.deleteRoomAuth(authCtx, roomId);
    graceCtx.roomPolicyById.delete(roomId);
    rateLimiting.purgeJoinAttemptsForRoom(rateLimitCtx, roomId);
    roomLockChains.delete(roomId);
    state.rooms.delete(roomId);

    if (room) {
      io.to(roomId).emit(signaling.SERVER_EVENTS.roomDestroyed, { reason } as RoomDestroyedPayload);
    }
  };

  // Restart the solo-host timer when exactly one live participant remains, returning
  // the new deadline (or null). Shared by the kick, leave, host-disconnect, and
  // guest-disconnect paths so the solo-timeout policy stays consistent across all four.
  const restartSoloTimerIfSolo = (roomId: string, liveCount: number): number | null => {
    if (liveCount !== 1) return null;
    const policy = graceCtx.roomPolicyById.get(roomId);
    if (!policy) return null;
    return grace.restartSoloTimer(
      policy,
      signaling.SOLO_HOST_ROOM_TIMEOUT_MS,
      now,
      () => destroyRoom(roomId, "solo_timeout_expired"),
    );
  };

  const handleGuestGraceExpired = (participantId: string, roomId: string): void => {
    const activeRoom = state.rooms.get(roomId);
    if (!activeRoom) {
      clearReconnectForParticipantFn(participantId);
      return;
    }

    if (!activeRoom.participants.has(participantId)) {
      clearReconnectForParticipantFn(participantId);
      return;
    }

    const leavingRecord = activeRoom.participants.get(participantId);
    if (leavingRecord?.nickname && activeRoom.nicknameToParticipant) {
      const key = leavingRecord.nickname.toLowerCase();
      if (activeRoom.nicknameToParticipant.get(key) === participantId) {
        activeRoom.nicknameToParticipant.delete(key);
      }
    }

    activeRoom.participants.delete(participantId);
    state.participantToRoom.delete(participantId);
    clearReconnectForParticipantFn(participantId);

    const participantCount = activeRoom.participants.size;
    if (participantCount === 0) {
      const nowTs = now();
      metrics.incrementRoomDestroyed?.("host_grace_expired");
      metrics.updateRoomLifetimeRolling?.(nowTs - activeRoom.createdAt);
      // clearRoomArtifacts reads room.roomName from state.rooms, so it must run
      // before the room is deleted or the roomNameToId cleanup is skipped.
      clearRoomArtifacts(roomId);
      state.rooms.delete(roomId);
      return;
    }
    io.to(roomId).emit(signaling.SERVER_EVENTS.peerLeft, {
      participantId,
      reason: "disconnect",
      participantCount,
    } as PeerLeftPayload);
  };

  io.on("connection", (socket) => {
    metrics.recordConnection(socket.id);

    socket.on("heartbeat", () => {
      const participantId = state.socketToParticipant.get(socket.id);
      if (!participantId) return;
      const roomId = state.participantToRoom.get(participantId);
      if (!roomId) return;
      const room = state.rooms.get(roomId);
      if (!room) return;
      const participant = room.participants.get(participantId);
      if (!participant) return;
      participant.lastSeenAt = now();
    });

    socket.on(
      signaling.CLIENT_EVENTS.createRoom,
      (payload: CreateRoomPayload | undefined) => {
        if (typeof payload?.password === "string" && payload.password !== "" && payload.password.trim() === "") {
          emitInvalidPassword(socket);
          return;
        }

        const normalizedPassword = passwordAuth.normalizePassword(payload?.password);
        const normalizedNickname = normalizeNickname(payload?.nickname);
        if (!normalizedNickname) {
          emitInvalidSignalPayload(socket);
          return;
        }

        let normalizedRoomName: string | undefined;
        if (payload?.roomName !== undefined && payload.roomName !== "") {
          const validated = validateRoomName(payload.roomName);
          if (!validated || state.roomNameToId.has(validated)) {
            socket.emit(signaling.SERVER_EVENTS.error, {
              code: signaling.ERROR_CODES.invalidSignalPayload,
              message: "Room name already taken or invalid.",
            });
            return;
          }
          normalizedRoomName = validated;
        }

        const subject = rateLimiting.deriveJoinAttemptSubject(socket);
        const ip = rateLimiting.deriveIp(socket);
        const createdAt = now();

        if (rateLimiting.checkAndRecordCreateAttempt(rateLimitCtx, subject, ip, createdAt)) {
          emitRateLimited(socket);
          return;
        }

        const { room, participantId } = createRoomRecord(state, socket.id, createdAt, factories);

        if (normalizedRoomName) {
          room.roomName = normalizedRoomName;
          state.roomNameToId.set(normalizedRoomName, room.roomId);
        }

        const participant = room.participants.get(participantId);
        if (participant) {
          participant.nickname = normalizedNickname;
          participant.nicknameUpdatedAt = createdAt;
          room.nicknameToParticipant.set(normalizedNickname.toLowerCase(), participantId);
        }

        passwordAuth.initRoomAuth(authCtx, room.roomId, normalizedPassword);
        const reconnectToken = reconnect.upsertReconnectToken(reconnectCtx, room.roomId, participantId, 1);
        const policy = grace.createRoomPolicy(
          graceCtx,
          room.roomId,
          createdAt,
          signaling.ROOM_MAX_DURATION_MS,
          signaling.SOLO_HOST_ROOM_TIMEOUT_MS,
          () => destroyRoom(room.roomId, "room_ttl_expired"),
          () => destroyRoom(room.roomId, "solo_timeout_expired"),
        );

        socket.join(room.roomId);
        metrics.recordRoomJoin(socket.id, room.roomId);
        metrics.recordRoomCreated(room.roomId, createdAt);
        metrics.incrementRoomsCreated?.();
        // Concurrency can only rise here — sample peaks now, not just on the 5-hourly sweep.
        metrics.updatePeakMarks?.();

        const response: RoomCreatedPayload = {
          roomId: room.roomId,
          participantId,
          hostId: room.hostId,
          reconnectToken,
          participantNickname: normalizedNickname,
          expiresAt: policy.expiresAt,
          soloDeadlineAt: policy.soloDeadlineAt,
          participantCount: room.participants.size,
          hasPassword: !!normalizedPassword,
          roomName: normalizedRoomName,
        };

        socket.emit(signaling.SERVER_EVENTS.roomCreated, response);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.joinRoom,
      (payload: JoinRoomPayload | undefined) => {
        const inputRoomId = payload?.roomId;
        if (!inputRoomId) {
          emitRoomNotFound(socket);
          return;
        }

        const roomId = state.rooms.has(inputRoomId)
          ? inputRoomId
          : (state.roomNameToId.get(inputRoomId.toLowerCase()) ?? inputRoomId);

        const room = state.rooms.get(roomId);
        if (!room) {
          emitRoomNotFound(socket);
          return;
        }

        // Room exists but all live participants have disconnected — treat as non-existent.
        if (getLiveParticipantCount(room) === 0) {
          emitRoomNotFound(socket);
          return;
        }

        if (typeof payload?.password === "string" && payload.password !== "" && payload.password.trim() === "") {
          emitInvalidPassword(socket);
          return;
        }

        const normalizedPassword = passwordAuth.normalizePassword(payload?.password);
        const subject = rateLimiting.deriveJoinAttemptSubject(socket);
        const attemptTimestamp = now();

        if (rateLimiting.getJoinAttemptStatus(rateLimitCtx, roomId, subject, attemptTimestamp) === "rate_limited") {
          emitRateLimited(socket);
          return;
        }

        const ip = rateLimiting.deriveIp(socket);
        if (rateLimiting.checkAndRecordJoinIp(rateLimitCtx, ip, attemptTimestamp)) {
          emitRateLimited(socket);
          return;
        }

        const normalizedNickname = normalizeNickname(payload?.nickname);
        if (!normalizedNickname) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const existing = room.nicknameToParticipant.get(normalizedNickname.toLowerCase());
        if (existing) {
          const existingParticipant = room.participants.get(existing);
          const isDisconnected = existingParticipant?.socketId.startsWith("disconnected:") ?? false;
          if (!isDisconnected) {
            emitInvalidSignalPayload(socket);
            return;
          }
          // The existing holder is in a disconnect grace window. Evict them so this
          // fresh join can claim the nickname (the holder lost their reconnect token
          // on page refresh and cannot resume).
          // peer_left was already broadcast at disconnect time; only clean up server state
          room.nicknameToParticipant.delete(normalizedNickname.toLowerCase());
          room.participants.delete(existing);
          state.participantToRoom.delete(existing);
          clearReconnectForParticipantFn(existing);
          reconnectCtx.disconnectedParticipants.delete(existing);
        }

        const auth = passwordAuth.getRoomAuth(authCtx, roomId);
        if (!auth) {
          emitRoomNotFound(socket);
          return;
        }

        const isOpenRoom = !auth.passwordHash;
        if (!isOpenRoom) {
          if (!normalizedPassword || !passwordAuth.verifyPassword(normalizedPassword, auth)) {
            const outcome = rateLimiting.recordInvalidPasswordAttempt(rateLimitCtx, roomId, subject, attemptTimestamp);
            if (outcome === "emit_invalid_password") {
              emitInvalidPassword(socket);
            } else {
              emitRateLimited(socket);
            }
            return;
          }
        }

        rateLimiting.clearSuccessfulJoinAttempt(rateLimitCtx, roomId, subject);

        if (room.participants.size >= signaling.MAX_PARTICIPANTS_PER_ROOM) {
          emitRoomFull(socket);
          return;
        }

        const joined = joinRoomRecord(state, roomId, socket.id, now(), factories.generateParticipantId);
        if (!joined) {
          emitRoomNotFound(socket);
          return;
        }

        const reconnectToken = reconnect.upsertReconnectToken(
          reconnectCtx,
          roomId,
          joined.participantId,
          auth.passwordVersion,
        );

        const joinedParticipant = joined.room.participants.get(joined.participantId);
        if (joinedParticipant) {
          joinedParticipant.nickname = normalizedNickname;
          joinedParticipant.nicknameUpdatedAt = now();
          joined.room.nicknameToParticipant.set(normalizedNickname.toLowerCase(), joined.participantId);
        }

        const policy = graceCtx.roomPolicyById.get(roomId);
        if (policy) {
          if (!policy.hasEverHadGuest) policy.hasEverHadGuest = true;
          if (policy.soloTimeoutRef) {
            clearTimeout(policy.soloTimeoutRef);
            policy.soloTimeoutRef = undefined;
            policy.soloDeadlineAt = undefined;
          }
        }

        socket.join(roomId);
        metrics.recordRoomJoin(socket.id, roomId);
        metrics.incrementParticipantsJoined?.();
        metrics.updatePeakMarks?.();

        const joinLiveCount = getLiveParticipantCount(joined.room);
        const roomJoinedPayload: RoomJoinedPayload = {
          roomId,
          participantId: joined.participantId,
          hostId: joined.room.hostId,
          peers: joined.peers,
          reconnectToken,
          expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
          participantNickname: normalizedNickname,
          participantCount: joinLiveCount,
          hasPassword: !isOpenRoom,
          roomName: room.roomName,
        };

        socket.emit(signaling.SERVER_EVENTS.roomJoined, roomJoinedPayload);

        const peerJoinedPayload: PeerJoinedPayload = {
          participantId: joined.participantId,
          nickname: normalizedNickname,
          participantCount: joinLiveCount,
        };

        socket.to(roomId).emit(signaling.SERVER_EVENTS.peerJoined, peerJoinedPayload);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalOffer,
      (payload: SignalOfferPayload | undefined) => {
        relay.handleSignalOffer(socket, payload, state, io,
          () => emitRoomNotFound(socket),
          () => emitInvalidSignalPayload(socket));
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalAnswer,
      (payload: SignalAnswerPayload | undefined) => {
        relay.handleSignalAnswer(socket, payload, state, io,
          () => emitRoomNotFound(socket),
          () => emitInvalidSignalPayload(socket));
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalIce,
      (payload: SignalIcePayload | undefined) => {
        relay.handleSignalIce(socket, payload, state, io,
          () => emitRoomNotFound(socket),
          () => emitInvalidSignalPayload(socket));
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.resumeSession,
      async (payload: ResumeSessionPayload | undefined) => {
        const roomId = payload?.roomId;
        const reconnectToken = payload?.reconnectToken;

        if (!roomId || typeof reconnectToken !== "string" || reconnectToken.trim().length === 0) {
          emitRoomNotFound(socket);
          return;
        }

        await withRoomLock(roomId, () => {
          const reconnectHash = reconnect.hashReconnectToken(reconnectToken);
          const reconnectRecord = reconnectCtx.reconnectByHash.get(reconnectHash);
          if (!reconnectRecord || reconnectRecord.roomId !== roomId) {
            emitRoomNotFound(socket);
            return;
          }

                  if (!reconnectRecord.disconnected || now() > reconnectRecord.validUntil) {
            emitRoomNotFound(socket);
            return;
          }

          const room = state.rooms.get(roomId);
          const auth = passwordAuth.getRoomAuth(authCtx, roomId);
          if (!room || !auth) {
            emitRoomNotFound(socket);
            return;
          }

          if (reconnectRecord.passwordVersion !== auth.passwordVersion) {
            emitInvalidPassword(socket);
            return;
          }

          const participant = room.participants.get(reconnectRecord.participantId);
          if (!participant) {
            emitRoomNotFound(socket);
            return;
          }

          reconnectCtx.disconnectedParticipants.delete(reconnectRecord.participantId);
          clearGuestGraceFn(reconnectRecord.participantId);

          if (room.hostId === reconnectRecord.participantId) {
            const policy = graceCtx.roomPolicyById.get(roomId);
            if (policy) grace.clearHostGrace(policy);
          }

          participant.socketId = socket.id;
          state.socketToParticipant.set(socket.id, reconnectRecord.participantId);
          state.participantToRoom.set(reconnectRecord.participantId, roomId);

          const freshToken = reconnect.upsertReconnectToken(
            reconnectCtx,
            roomId,
            reconnectRecord.participantId,
            auth.passwordVersion,
          );

          socket.join(roomId);
          metrics.recordRoomJoin(socket.id, roomId);

          const peers = Array.from(room.participants.values())
            .filter((peer) => peer.participantId !== reconnectRecord.participantId && !peer.socketId.startsWith("disconnected:"))
            .map((peer) => ({ participantId: peer.participantId, nickname: peer.nickname ?? null }));

          const resumeLiveCount = getLiveParticipantCount(room);
          const policy = graceCtx.roomPolicyById.get(roomId);
          // Solo-host policy is host-only. A guest resuming as the sole live participant
          // must not reset the deadline or be handed a soloDeadlineAt it doesn't own.
          const isHostResuming = room.hostId === reconnectRecord.participantId;
          if (policy) {
            if (resumeLiveCount >= 2) {
              clearTimeout(policy.soloTimeoutRef);
              policy.soloTimeoutRef = undefined;
              policy.soloDeadlineAt = undefined;
            } else if (resumeLiveCount === 1 && isHostResuming) {
              grace.restartSoloTimer(
                policy,
                signaling.SOLO_HOST_ROOM_TIMEOUT_MS,
                now,
                () => destroyRoom(roomId, "solo_timeout_expired"),
              );
            }
          }
          const roomJoinedPayload: RoomJoinedPayload = {
            roomId,
            participantId: reconnectRecord.participantId,
            hostId: room.hostId,
            peers,
            reconnectToken: freshToken,
            expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
            participantNickname: participant.nickname ?? null,
            participantCount: resumeLiveCount,
            hasPassword: !!auth.passwordHash,
            roomName: room.roomName,
            soloDeadlineAt: isHostResuming ? (policy?.soloDeadlineAt ?? null) : null,
          };

          socket.emit(signaling.SERVER_EVENTS.roomJoined, roomJoinedPayload);

          socket.to(roomId).emit(signaling.SERVER_EVENTS.peerJoined, {
            participantId: reconnectRecord.participantId,
            nickname: participant.nickname ?? undefined,
            participantCount: resumeLiveCount,
          } as PeerJoinedPayload);
        });
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.roomPasswordUpdate,
      async (payload: RoomPasswordUpdatePayload | undefined) => {
        const roomId = payload?.roomId;
        if (!roomId) {
          emitRoomNotFound(socket);
          return;
        }

        const normalizedPassword = passwordAuth.normalizePassword(payload?.newPassword);
        if (!normalizedPassword) {
          emitInvalidPassword(socket);
          return;
        }

        const participantId = state.socketToParticipant.get(socket.id);
        const participantRoomId = participantId ? state.participantToRoom.get(participantId) : undefined;
        const room = state.rooms.get(roomId);
        if (!participantId || participantRoomId !== roomId || !room || room.hostId !== participantId) {
          emitRoomNotFound(socket);
          return;
        }

        await withRoomLock(roomId, () => {
          const auth = passwordAuth.getRoomAuth(authCtx, roomId);
          if (!auth) {
            emitRoomNotFound(socket);
            return;
          }

          if (!auth.passwordHash) {
            emitNotAuthorized(socket);
            return;
          }

          const updatedAuth = passwordAuth.rotateRoomPassword(authCtx, roomId, normalizedPassword);
          if (!updatedAuth) {
            emitRoomNotFound(socket);
            return;
          }

          const changedAt = now();
          const updatePayload: RoomPasswordUpdatedPayload = {
            passwordVersion: updatedAuth.passwordVersion,
            changedAt,
          };

          socket.emit(signaling.SERVER_EVENTS.roomPasswordUpdated, updatePayload);
          socket.to(roomId).emit(signaling.SERVER_EVENTS.roomPasswordUpdated, updatePayload);
        });
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.nicknameUpdate,
      async (payload: NicknameUpdatePayload | undefined) => {
        const participantId = state.socketToParticipant.get(socket.id);
        if (!participantId) {
          emitRoomNotFound(socket);
          return;
        }

        const roomId = state.participantToRoom.get(participantId);
        if (!roomId) {
          emitRoomNotFound(socket);
          return;
        }

        const normalizedNickname = normalizeNickname(payload?.nickname);
        if (!normalizedNickname) {
          emitInvalidSignalPayload(socket);
          return;
        }

        await withRoomLock(roomId, () => {
          const room = state.rooms.get(roomId);
          if (!room) {
            emitRoomNotFound(socket);
            return;
          }

          const participant = room.participants.get(participantId);
          if (!participant) {
            emitRoomNotFound(socket);
            return;
          }

          const nowTs = now();
          const cooldown = signaling.NICKNAME_CHANGE_COOLDOWN_MS;
          if (participant.nicknameUpdatedAt && nowTs < participant.nicknameUpdatedAt + cooldown) {
            emitRateLimited(socket);
            return;
          }

          const key = normalizedNickname.toLowerCase();
          const existingHolder = room.nicknameToParticipant.get(key);
          if (existingHolder && existingHolder !== participantId) {
            emitInvalidSignalPayload(socket);
            return;
          }

          if (participant.nickname) {
            room.nicknameToParticipant.delete(participant.nickname.toLowerCase());
          }
          participant.nickname = normalizedNickname;
          participant.nicknameUpdatedAt = nowTs;
          room.nicknameToParticipant.set(key, participantId);

          const updatePayload: NicknameUpdatedPayload = { participantId, nickname: normalizedNickname };
          io.to(roomId).emit(signaling.SERVER_EVENTS.nicknameUpdated, updatePayload);
        });
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.kickParticipant,
      (payload: KickParticipantPayload | undefined) => {
        const roomId = payload?.roomId;
        const targetParticipantId = payload?.targetParticipantId;

        if (!roomId || typeof targetParticipantId !== "string" || targetParticipantId.trim().length === 0) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const callerParticipantId = state.socketToParticipant.get(socket.id);
        if (!callerParticipantId) {
          emitRoomNotFound(socket);
          return;
        }

        const callerRoomId = state.participantToRoom.get(callerParticipantId);
        if (callerRoomId !== roomId) {
          emitRoomNotFound(socket);
          return;
        }

        const room = state.rooms.get(roomId);
        if (!room) {
          emitRoomNotFound(socket);
          return;
        }

        if (room.hostId !== callerParticipantId) {
          emitNotAuthorized(socket);
          return;
        }

        if (targetParticipantId === callerParticipantId) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const targetParticipant = room.participants.get(targetParticipantId);
        if (!targetParticipant) {
          emitRoomNotFound(socket);
          return;
        }

        const targetSocketId = targetParticipant.socketId;
        const kickedPayload: ParticipantKickedPayload = { participantId: targetParticipantId };
        io.to(roomId).emit(signaling.SERVER_EVENTS.participantKicked, kickedPayload);

        if (targetParticipant.nickname) {
          const key = targetParticipant.nickname.toLowerCase();
          if (room.nicknameToParticipant.get(key) === targetParticipantId) {
            room.nicknameToParticipant.delete(key);
          }
        }

        room.participants.delete(targetParticipantId);
        state.participantToRoom.delete(targetParticipantId);

        if (!targetSocketId.startsWith("disconnected:")) {
          state.socketToParticipant.delete(targetSocketId);
        }

        clearReconnectForParticipantFn(targetParticipantId);

        const remainingCount = getLiveParticipantCount(room);
        const soloDeadlineAt = restartSoloTimerIfSolo(roomId, remainingCount);

        const peerLeftPayload: PeerLeftPayload = {
          participantId: targetParticipantId,
          reason: "leave",
          participantCount: remainingCount,
          ...(soloDeadlineAt !== null ? { soloDeadlineAt } : {}),
        };
        io.to(roomId).emit(signaling.SERVER_EVENTS.peerLeft, peerLeftPayload);

        if (!targetSocketId.startsWith("disconnected:")) {
          const ioServer = io as unknown as {
            sockets: { sockets: Map<string, { disconnect: (close?: boolean) => void }> };
          };
          ioServer.sockets?.sockets?.get(targetSocketId)?.disconnect(true);
        }
      },
    );

    socket.on(signaling.CLIENT_EVENTS.leaveRoom, () => {
      const leavingParticipantId = state.socketToParticipant.get(socket.id);
      const leavingRoomId = leavingParticipantId ? state.participantToRoom.get(leavingParticipantId) : undefined;
      const leavingRoomCreatedAt = leavingRoomId ? state.rooms.get(leavingRoomId)?.createdAt : undefined;

      const removed = removeParticipantBySocket(state, socket.id);

      let leaveExtras: { liveCount?: number; soloDeadlineAt?: number | null } | undefined;
      if (removed?.roomStillActive) {
        const remainingRoom = state.rooms.get(removed.roomId);
        if (remainingRoom) {
          const liveCount = getLiveParticipantCount(remainingRoom);
          if (liveCount === 0) {
            // Last live participant left; destroy the room rather than letting it linger.
            // Leave the Socket.IO room first so the leaving socket doesn't receive room_destroyed.
            socket.leave(removed.roomId);
            destroyRoom(removed.roomId, "host_grace_expired");
            metrics.recordDisconnect(socket.id);
            return;
          }
          leaveExtras = { liveCount };
          const deadline = restartSoloTimerIfSolo(removed.roomId, liveCount);
          if (deadline !== null) {
            leaveExtras = { liveCount, soloDeadlineAt: deadline };
          }
        }
      }

      emitParticipantExit(socket, removed, "leave", leaveExtras);
      if (removed) clearReconnectForParticipantFn(removed.participantId);
      if (removed && !removed.roomStillActive) {
        const nowTs = now();
        metrics.recordRoomDestroyed(removed.roomId, nowTs);
        if (removed.isHost && leavingRoomCreatedAt !== undefined) {
          metrics.incrementRoomDestroyed?.("host_left");
          metrics.updateRoomLifetimeRolling?.(nowTs - leavingRoomCreatedAt);
        }
        clearRoomArtifacts(removed.roomId);
      }
      metrics.recordDisconnect(socket.id);
    });

    socket.on("disconnect", () => {
      const participantId = state.socketToParticipant.get(socket.id);
      const roomId = participantId ? state.participantToRoom.get(participantId) : undefined;
      const room = roomId ? state.rooms.get(roomId) : undefined;
      const isHostDisconnect = Boolean(
        participantId && roomId && room && room.hostId === participantId,
      );

      if (participantId && roomId && room) {
        state.socketToParticipant.delete(socket.id);
        reconnectCtx.disconnectedParticipants.add(participantId);

        const participant = room.participants.get(participantId);
        if (participant) {
          participant.socketId = `disconnected:${participantId}`;
        }

        if (isHostDisconnect) {
          const deadlineAt = grace.beginHostGrace(
            graceCtx,
            roomId,
            now(),
            signaling.HOST_DISCONNECT_GRACE_MS,
            () => destroyRoom(roomId, "host_grace_expired"),
          );
          if (deadlineAt !== null) {
            reconnect.markReconnectDisconnected(reconnectCtx, participantId, deadlineAt);
            const liveCount = getLiveParticipantCount(room);
            const hostSoloDeadlineAt = restartSoloTimerIfSolo(roomId, liveCount);
            socket.to(roomId).emit(signaling.SERVER_EVENTS.peerLeft, {
              participantId,
              reason: "disconnect",
              participantCount: liveCount,
              ...(hostSoloDeadlineAt !== null ? { soloDeadlineAt: hostSoloDeadlineAt } : {}),
            } as PeerLeftPayload);
            socket.to(roomId).emit(signaling.SERVER_EVENTS.hostReconnectGrace, { deadlineAt } as HostReconnectGracePayload);
          }
          metrics.recordDisconnect(socket.id);
          return;
        }

        if (room.hostId !== participantId) {
          const deadlineAt = grace.beginGuestGrace(
            graceCtx,
            roomId,
            participantId,
            now(),
            signaling.GUEST_DISCONNECT_GRACE_MS,
            reconnectCtx.disconnectedParticipants,
            handleGuestGraceExpired,
          );
          if (deadlineAt !== null) {
            reconnect.markReconnectDisconnected(reconnectCtx, participantId, deadlineAt);
          }

          // Guest stays visible until guest-grace expires (see T1.6-01): no peer_left is
          // emitted here. The solo timer still restarts so the now host-solo room is bounded.
          const liveCount = getLiveParticipantCount(room);
          restartSoloTimerIfSolo(roomId, liveCount);
        }

        metrics.recordDisconnect(socket.id);
        return;
      }

      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "disconnect");
      if (removed && !removed.roomStillActive) {
        metrics.recordRoomDestroyed(removed.roomId, now());
        clearRoomArtifacts(removed.roomId);
      }
      metrics.recordDisconnect(socket.id);
    });
  });

  const sweep = (): void => {
    const nowTs = now();

    for (const [roomId, policy] of Array.from(graceCtx.roomPolicyById.entries())) {
      if (policy.expiresAt <= nowTs) {
        destroyRoom(roomId, "room_ttl_expired");
      }
    }

    reconnect.sweepExpiredReconnectTokens(reconnectCtx, nowTs);
    rateLimiting.sweepRateLimitRecords(rateLimitCtx, nowTs);

    for (const [participantId, roomId] of Array.from(state.participantToRoom.entries())) {
      const room = state.rooms.get(roomId);
      if (!room || !room.participants.has(participantId)) {
        state.participantToRoom.delete(participantId);
      }
    }

    for (const [socketId, participantId] of Array.from(state.socketToParticipant.entries())) {
      if (!state.participantToRoom.has(participantId)) {
        state.socketToParticipant.delete(socketId);
      }
    }

    metrics.updatePeakMarks?.();
  };

  const sweepRef = setInterval(sweep, sweepIntervalMs);
  sweepRef.unref?.();
  return sweepRef;
}