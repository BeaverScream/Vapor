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
import * as passwordAuth from "./handlers/passwordAuth";
import * as rateLimiting from "./handlers/rateLimiting";
import * as reconnect from "./handlers/reconnectionManager";
import * as grace from "./handlers/graceWindowManager";
import * as relay from "./handlers/signalRelay";

type MetricsAdapter = {
  recordConnection: (socketId: string, now?: number) => void;
  recordRoomJoin: (socketId: string, roomId: string) => void;
  recordDisconnect: (socketId: string, now?: number) => void;
  recordRoomCreated: (roomId: string, now?: number) => void;
  recordRoomDestroyed: (roomId: string, now?: number) => void;
};

const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 60 * 1000;

type RegisterSocketHandlersArgs = {
  io: Server;
  state: SignalingState;
  metrics: MetricsAdapter;
  now: () => number;
  factories: RoomIdentityFactories;
  sweepIntervalMs?: number;
};

type ExitSource = "disconnect" | "leave";

function emitSocketError(socket: Socket, code: SignalingErrorCode): void {
  socket.emit(signaling.SERVER_EVENTS.error, signaling.makeSocketErrorPayload(code));
}

function emitRoomNotFound(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.roomNotFound);
}

function emitInvalidPassword(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.invalidPassword);
}

function emitRoomFull(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.roomFull);
}

function emitRateLimited(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.rateLimited);
}

function emitInvalidSignalPayload(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.invalidSignalPayload);
}

function emitNotAuthorized(socket: Socket): void {
  emitSocketError(socket, signaling.ERROR_CODES.notAuthorized);
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
): void {
  if (!removed) return;

  if (removed.roomStillActive) {
    const payload: PeerLeftPayload = {
      participantId: removed.participantId,
      reason: source,
      participantCount: removed.participantCount,
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

export function registerSocketHandlers({
  io,
  state,
  metrics,
  now,
  factories,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
}: RegisterSocketHandlersArgs): NodeJS.Timeout {
  const authCtx = passwordAuth.createPasswordAuthContext();
  const rateLimitCtx = rateLimiting.createRateLimitingContext();
  const reconnectCtx = reconnect.createReconnectContext();
  const graceCtx = grace.createGraceWindowContext();
  const roomLockChains = new Map<string, Promise<void>>();

  // Shorthand helpers that bind the context objects
  const clearGuestGraceFn = (participantId: string): void =>
    grace.clearGuestGrace(graceCtx, participantId);

  const clearReconnectForParticipantFn = (participantId: string): void =>
    reconnect.clearReconnectForParticipant(reconnectCtx, participantId, clearGuestGraceFn);

  const clearReconnectForRoomFn = (roomId: string): void =>
    reconnect.clearReconnectForRoom(reconnectCtx, roomId, clearGuestGraceFn);

  function withRoomLock(roomId: string, fn: () => unknown): Promise<void> {
    const prev = roomLockChains.get(roomId) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    roomLockChains.set(roomId, barrier);
    return prev.then(async () => {
      try {
        await fn();
      } finally {
        release();
      }
    });
  }

  const emitPeerLeftToRoom = (roomId: string, payload: PeerLeftPayload): void => {
    io.to(roomId).emit(signaling.SERVER_EVENTS.peerLeft, payload);
  };

  const clearRoomArtifacts = (roomId: string): void => {
    passwordAuth.deleteRoomAuth(authCtx, roomId);
    const policy = graceCtx.roomPolicyById.get(roomId);
    if (policy) grace.clearRoomPolicyTimers(policy);
    graceCtx.roomPolicyById.delete(roomId);
    rateLimiting.purgeJoinAttemptsForRoom(rateLimitCtx, roomId);
    clearReconnectForRoomFn(roomId);
    roomLockChains.delete(roomId);
  };

  const destroyRoom = (roomId: string, reason: RoomDestroyedPayload["reason"]): void => {
    metrics.recordRoomDestroyed(roomId, now());

    const policy = graceCtx.roomPolicyById.get(roomId);
    if (policy) grace.clearRoomPolicyTimers(policy);

    const room = state.rooms.get(roomId);

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
      state.rooms.delete(roomId);
      clearRoomArtifacts(roomId);
      return;
    }

    emitPeerLeftToRoom(roomId, { participantId, reason: "disconnect", participantCount });
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

        const subject = rateLimiting.deriveJoinAttemptSubject(socket);
        const ip = rateLimiting.deriveIp(socket);
        const createdAt = now();

        if (rateLimiting.checkAndRecordCreateAttempt(rateLimitCtx, subject, ip, createdAt)) {
          emitRateLimited(socket);
          return;
        }

        const { room, participantId } = createRoomRecord(state, socket.id, createdAt, factories);

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

        const response: RoomCreatedPayload = {
          roomId: room.roomId,
          participantId,
          hostId: room.hostId,
          reconnectToken,
          participantNickname: normalizedNickname,
          expiresAt: policy.expiresAt,
          soloHostDeadlineAt: policy.soloHostDeadlineAt,
          participantCount: room.participants.size,
          hasPassword: !!normalizedPassword,
        };

        socket.emit(signaling.SERVER_EVENTS.roomCreated, response);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.joinRoom,
      (payload: JoinRoomPayload | undefined) => {
        const roomId = payload?.roomId;
        if (!roomId) {
          emitRoomNotFound(socket);
          return;
        }

        const room = state.rooms.get(roomId);
        if (!room) {
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
          emitInvalidSignalPayload(socket);
          return;
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
        if (policy && !policy.hasEverHadGuest) {
          policy.hasEverHadGuest = true;
          if (policy.soloHostTimeoutRef) clearTimeout(policy.soloHostTimeoutRef);
          policy.soloHostTimeoutRef = undefined;
          policy.soloHostDeadlineAt = undefined;
        }

        socket.join(roomId);
        metrics.recordRoomJoin(socket.id, roomId);

        const roomJoinedPayload: RoomJoinedPayload = {
          roomId,
          participantId: joined.participantId,
          hostId: joined.room.hostId,
          peers: joined.peers,
          reconnectToken,
          expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
          participantNickname: normalizedNickname,
          participantCount: joined.room.participants.size,
          hasPassword: !isOpenRoom,
        };

        socket.emit(signaling.SERVER_EVENTS.roomJoined, roomJoinedPayload);

        const peerJoinedPayload: PeerJoinedPayload = {
          participantId: joined.participantId,
          nickname: normalizedNickname,
          participantCount: joined.room.participants.size,
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
            .filter((peer) => peer.participantId !== reconnectRecord.participantId)
            .map((peer) => ({ participantId: peer.participantId, nickname: peer.nickname ?? null }));

          const policy = graceCtx.roomPolicyById.get(roomId);
          const roomJoinedPayload: RoomJoinedPayload = {
            roomId,
            participantId: reconnectRecord.participantId,
            hostId: room.hostId,
            peers,
            reconnectToken: freshToken,
            expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
            participantNickname: participant.nickname ?? null,
            participantCount: room.participants.size,
            hasPassword: !!auth.passwordHash,
          };

          socket.emit(signaling.SERVER_EVENTS.roomJoined, roomJoinedPayload);
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

        if (!targetSocketId.startsWith("disconnected:")) {
          const ioServer = io as unknown as {
            sockets: { sockets: Map<string, { disconnect: (close?: boolean) => void }> };
          };
          ioServer.sockets?.sockets?.get(targetSocketId)?.disconnect(true);
        }
      },
    );

    socket.on(signaling.CLIENT_EVENTS.leaveRoom, () => {
      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "leave");
      if (removed) clearReconnectForParticipantFn(removed.participantId);
      if (removed && !removed.roomStillActive) {
        metrics.recordRoomDestroyed(removed.roomId, now());
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
            const payload: HostReconnectGracePayload = { deadlineAt };
            socket.to(roomId).emit(signaling.SERVER_EVENTS.hostReconnectGrace, payload);
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
  };

  const sweepRef = setInterval(sweep, sweepIntervalMs);
  sweepRef.unref?.();
  return sweepRef;
}