import type { Server, Socket } from "socket.io";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { CLIENT_EVENTS, ERROR_CODES, GUEST_DISCONNECT_GRACE_MS, HOST_DISCONNECT_GRACE_MS, JOIN_INVALID_ATTEMPT_COOLDOWN_MAX, JOIN_INVALID_ATTEMPT_COOLDOWN_MS, JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX, ROOM_MAX_DURATION_MS, SERVER_EVENTS, SOLO_HOST_ROOM_TIMEOUT_MS, type CreateRoomPayload, type HostReconnectGracePayload, type JoinRoomPayload, type PeerJoinedPayload, type PeerLeftPayload, type ResumeSessionPayload, type RoomCreatedPayload, type RoomDestroyedPayload, type RoomJoinedPayload, type RoomPasswordUpdatePayload, type RoomPasswordUpdatedPayload, type SocketErrorPayload } from "./contracts";
import type { Phase0SignalingState } from "./state";
import { createRoomRecord, joinRoomRecord, removeParticipantBySocket, type RoomIdentityFactories } from "./roomLifecycle";

type Argon2Module = {
  Algorithm: {
    Argon2id: number;
  };
  hashSync: (
    password: string,
    options: {
      algorithm: number;
      memoryCost: number;
      timeCost: number;
      parallelism: number;
      hashLength: number;
      salt: Buffer;
    }
  ) => string;
  verifySync: (hash: string, password: string) => boolean;
};

const require = createRequire(import.meta.url);
const { Algorithm, hashSync, verifySync } = require("@node-rs/argon2") as Argon2Module;

type MetricsAdapter = {
  recordConnection: (socketId: string, now?: number) => void;
  recordRoomJoin: (socketId: string, roomId: string) => void;
  recordDisconnect: (socketId: string, now?: number) => void;
};

type RegisterSocketHandlersArgs = {
  io: Server;
  state: Phase0SignalingState;
  metrics: MetricsAdapter;
  now: () => number;
  factories: RoomIdentityFactories;
};

type ExitSource = "disconnect" | "leave";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32
} as const;

type RoomAuthRecord = {
  salt: string;
  passwordHash: string;
  passwordVersion: number;
};

type RoomPolicyRecord = {
  expiresAt: number;
  hasEverHadGuest: boolean;
  roomTtlTimeoutRef?: NodeJS.Timeout;
  soloHostDeadlineAt?: number;
  soloHostTimeoutRef?: NodeJS.Timeout;
  hostGraceDeadlineAt?: number;
  hostGraceTimeoutRef?: NodeJS.Timeout;
};

type JoinAttemptRecord = {
  invalidCount: number;
  cooldownUntil?: number;
  strictLocked: boolean;
  lastAttemptAt: number;
};

type ParticipantReconnectRecord = {
  roomId: string;
  participantId: string;
  passwordVersion: number;
  disconnected: boolean;
  validUntil: number;
};

type GuestGraceRecord = {
  roomId: string;
  participantId: string;
  deadlineAt: number;
  timeoutRef?: NodeJS.Timeout;
};

function emitRoomNotFound(socket: Socket): void {
  const errorPayload: SocketErrorPayload = {
    code: ERROR_CODES.roomNotFound,
    message: "Room not found"
  };
  socket.emit(SERVER_EVENTS.error, errorPayload);
}

function emitInvalidPassword(socket: Socket): void {
  const errorPayload: SocketErrorPayload = {
    code: ERROR_CODES.invalidPassword,
    message: "Invalid password"
  };
  socket.emit(SERVER_EVENTS.error, errorPayload);
}

function emitRateLimited(socket: Socket): void {
  const errorPayload: SocketErrorPayload = {
    code: ERROR_CODES.rateLimited,
    message: "Rate limited"
  };
  socket.emit(SERVER_EVENTS.error, errorPayload);
}

function deriveJoinAttemptSubject(socket: Socket): string {
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
    : userAgentHeader ?? "unknown-ua";
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

function makeJoinAttemptKey(roomId: string, subject: string): string {
  return `${roomId}::${subject}`;
}

function normalizePassword(password: string | undefined): string | null {
  if (typeof password !== "string") {
    return null;
  }

  const trimmed = password.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

function getPasswordPepper(): string {
  return process.env.SIGNALING_PASSWORD_PEPPER ?? "vapor-dev-pepper";
}

function buildPepperedPassword(password: string): string {
  return `${password}\u0000${getPasswordPepper()}`;
}

function hashPassword(password: string, salt: string): string {
  return hashSync(buildPepperedPassword(password), {
    ...ARGON2_OPTIONS,
    salt: Buffer.from(salt, "hex")
  });
}

function verifyPassword(password: string, auth: RoomAuthRecord): boolean {
  if (!auth.passwordHash) {
    return false;
  }

  try {
    return verifySync(auth.passwordHash, buildPepperedPassword(password));
  } catch {
    return false;
  }
}

function clearRoomPolicyTimers(policy: RoomPolicyRecord): void {
  if (policy.roomTtlTimeoutRef) {
    clearTimeout(policy.roomTtlTimeoutRef);
  }

  if (policy.soloHostTimeoutRef) {
    clearTimeout(policy.soloHostTimeoutRef);
  }

  if (policy.hostGraceTimeoutRef) {
    clearTimeout(policy.hostGraceTimeoutRef);
  }
}

function clearHostGrace(policy: RoomPolicyRecord): void {
  if (policy.hostGraceTimeoutRef) {
    clearTimeout(policy.hostGraceTimeoutRef);
  }
  policy.hostGraceTimeoutRef = undefined;
  policy.hostGraceDeadlineAt = undefined;
}

function emitParticipantExit(
  socket: Socket,
  removed: ReturnType<typeof removeParticipantBySocket>,
  source: ExitSource
): void {
  if (!removed) {
    return;
  }

  if (removed.roomStillActive) {
    const payload: PeerLeftPayload = {
      participantId: removed.participantId,
      reason: source,
      participantCount: removed.participantCount
    };
    socket.to(removed.roomId).emit(SERVER_EVENTS.peerLeft, payload);
    return;
  }

  if (removed.isHost) {
    const payload: RoomDestroyedPayload = {
      reason: "host_left"
    };
    socket.to(removed.roomId).emit(SERVER_EVENTS.roomDestroyed, payload);
  }
}

export function registerSocketHandlers({
  io,
  state,
  metrics,
  now,
  factories
}: RegisterSocketHandlersArgs): void {
  const roomAuthById = new Map<string, RoomAuthRecord>();
  const roomPolicyById = new Map<string, RoomPolicyRecord>();
  const joinAttemptByRoomSubject = new Map<string, JoinAttemptRecord>();
  const reconnectByToken = new Map<string, ParticipantReconnectRecord>();
  const reconnectTokenByParticipant = new Map<string, string>();
  const guestGraceByParticipant = new Map<string, GuestGraceRecord>();
  const disconnectedParticipants = new Set<string>();

  const clearGuestGrace = (participantId: string): void => {
    const grace = guestGraceByParticipant.get(participantId);
    if (grace?.timeoutRef) {
      clearTimeout(grace.timeoutRef);
    }
    guestGraceByParticipant.delete(participantId);
  };

  const clearReconnectForParticipant = (participantId: string): void => {
    const reconnectToken = reconnectTokenByParticipant.get(participantId);
    if (reconnectToken) {
      reconnectByToken.delete(reconnectToken);
      reconnectTokenByParticipant.delete(participantId);
    }

    clearGuestGrace(participantId);
    disconnectedParticipants.delete(participantId);
  };

  const clearReconnectForRoom = (roomId: string): void => {
    for (const [reconnectToken, reconnectRecord] of Array.from(reconnectByToken.entries())) {
      if (reconnectRecord.roomId !== roomId) {
        continue;
      }

      reconnectByToken.delete(reconnectToken);
      reconnectTokenByParticipant.delete(reconnectRecord.participantId);
      clearGuestGrace(reconnectRecord.participantId);
      disconnectedParticipants.delete(reconnectRecord.participantId);
    }
  };

  const upsertReconnectToken = (
    roomId: string,
    participantId: string,
    passwordVersion: number
  ): string => {
    const reconnectToken = reconnectTokenByParticipant.get(participantId) ?? randomBytes(24).toString("hex");

    reconnectTokenByParticipant.set(participantId, reconnectToken);
    reconnectByToken.set(reconnectToken, {
      roomId,
      participantId,
      passwordVersion,
      disconnected: false,
      validUntil: 0
    });

    return reconnectToken;
  };

  const markReconnectDisconnected = (participantId: string, validUntil: number): void => {
    const reconnectToken = reconnectTokenByParticipant.get(participantId);
    if (!reconnectToken) {
      return;
    }

    const reconnectRecord = reconnectByToken.get(reconnectToken);
    if (!reconnectRecord) {
      return;
    }

    reconnectRecord.disconnected = true;
    reconnectRecord.validUntil = validUntil;
  };

  const markReconnectConnected = (participantId: string): void => {
    const reconnectToken = reconnectTokenByParticipant.get(participantId);
    if (!reconnectToken) {
      return;
    }

    const reconnectRecord = reconnectByToken.get(reconnectToken);
    if (!reconnectRecord) {
      return;
    }

    reconnectRecord.disconnected = false;
    reconnectRecord.validUntil = 0;
  };

  const emitPeerLeftToRoom = (roomId: string, payload: PeerLeftPayload): void => {
    if (typeof (io as unknown as { to?: (target: string) => { emit: (event: string, payload: unknown) => void } }).to !== "function") {
      return;
    }

    (io as unknown as { to: (target: string) => { emit: (event: string, payload: unknown) => void } })
      .to(roomId)
      .emit(SERVER_EVENTS.peerLeft, payload);
  };

  const purgeJoinAttemptsForRoom = (roomId: string): void => {
    const roomPrefix = `${roomId}::`;
    for (const key of Array.from(joinAttemptByRoomSubject.keys())) {
      if (key.startsWith(roomPrefix)) {
        joinAttemptByRoomSubject.delete(key);
      }
    }
  };

  const destroyRoom = (
    roomId: string,
    reason: RoomDestroyedPayload["reason"]
  ): void => {
    const room = state.rooms.get(roomId);
    if (!room) {
      roomAuthById.delete(roomId);
      const stalePolicy = roomPolicyById.get(roomId);
      if (stalePolicy) {
        clearRoomPolicyTimers(stalePolicy);
      }
      roomPolicyById.delete(roomId);
      purgeJoinAttemptsForRoom(roomId);
      clearReconnectForRoom(roomId);
      return;
    }

    for (const participant of room.participants.values()) {
      state.participantToRoom.delete(participant.participantId);
      state.socketToParticipant.delete(participant.socketId);
    }

    state.rooms.delete(roomId);
    roomAuthById.delete(roomId);

    const policy = roomPolicyById.get(roomId);
    if (policy) {
      clearRoomPolicyTimers(policy);
    }
    roomPolicyById.delete(roomId);
    purgeJoinAttemptsForRoom(roomId);
    clearReconnectForRoom(roomId);

    if (typeof (io as unknown as { to?: (target: string) => { emit: (event: string, payload: unknown) => void } }).to === "function") {
      (io as unknown as { to: (target: string) => { emit: (event: string, payload: unknown) => void } })
        .to(roomId)
        .emit(SERVER_EVENTS.roomDestroyed, { reason } as RoomDestroyedPayload);
    }
  };

  const createRoomPolicy = (roomId: string, createdAt: number): RoomPolicyRecord => {
    const policy: RoomPolicyRecord = {
      expiresAt: createdAt + ROOM_MAX_DURATION_MS,
      hasEverHadGuest: false,
      soloHostDeadlineAt: createdAt + SOLO_HOST_ROOM_TIMEOUT_MS
    };

    policy.roomTtlTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "room_ttl_expired");
    }, ROOM_MAX_DURATION_MS);
    policy.roomTtlTimeoutRef.unref?.();

    policy.soloHostTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "solo_timeout_expired");
    }, SOLO_HOST_ROOM_TIMEOUT_MS);
    policy.soloHostTimeoutRef.unref?.();

    return policy;
  };

  const clearRoomArtifacts = (roomId: string): void => {
    roomAuthById.delete(roomId);
    const policy = roomPolicyById.get(roomId);
    if (policy) {
      clearRoomPolicyTimers(policy);
    }
    roomPolicyById.delete(roomId);
    purgeJoinAttemptsForRoom(roomId);
    clearReconnectForRoom(roomId);
  };

  const beginHostGrace = (roomId: string): number | null => {
    const room = state.rooms.get(roomId);
    const policy = roomPolicyById.get(roomId);
    if (!room || !policy) {
      return null;
    }

    clearHostGrace(policy);

    const deadlineAt = now() + HOST_DISCONNECT_GRACE_MS;
    policy.hostGraceDeadlineAt = deadlineAt;
    policy.hostGraceTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "host_grace_expired");
    }, HOST_DISCONNECT_GRACE_MS);
    policy.hostGraceTimeoutRef.unref?.();

    return deadlineAt;
  };

  const beginGuestGrace = (roomId: string, participantId: string): number | null => {
    const room = state.rooms.get(roomId);
    if (!room || room.hostId === participantId) {
      return null;
    }

    clearGuestGrace(participantId);

    const deadlineAt = now() + GUEST_DISCONNECT_GRACE_MS;
    const timeoutRef = setTimeout(() => {
      guestGraceByParticipant.delete(participantId);

      if (!disconnectedParticipants.has(participantId)) {
        return;
      }

      disconnectedParticipants.delete(participantId);

      const activeRoom = state.rooms.get(roomId);
      if (!activeRoom) {
        clearReconnectForParticipant(participantId);
        return;
      }

      if (!activeRoom.participants.has(participantId)) {
        clearReconnectForParticipant(participantId);
        return;
      }

      activeRoom.participants.delete(participantId);
      state.participantToRoom.delete(participantId);
      clearReconnectForParticipant(participantId);

      const participantCount = activeRoom.participants.size;
      if (participantCount === 0) {
        state.rooms.delete(roomId);
        clearRoomArtifacts(roomId);
        return;
      }

      const payload: PeerLeftPayload = {
        participantId,
        reason: "disconnect",
        participantCount
      };

      emitPeerLeftToRoom(roomId, payload);
    }, GUEST_DISCONNECT_GRACE_MS);
    timeoutRef.unref?.();

    guestGraceByParticipant.set(participantId, {
      roomId,
      participantId,
      deadlineAt,
      timeoutRef
    });

    return deadlineAt;
  };

  io.on("connection", (socket) => {
    metrics.recordConnection(socket.id);

    socket.on(CLIENT_EVENTS.createRoom, (payload: CreateRoomPayload | undefined) => {
      const normalizedPassword = normalizePassword(payload?.password);
      if (!normalizedPassword) {
        emitInvalidPassword(socket);
        return;
      }

      const createdAt = now();
      const { room, participantId } = createRoomRecord(state, socket.id, createdAt, factories);

      const salt = randomBytes(16).toString("hex");
      roomAuthById.set(room.roomId, {
        salt,
        passwordHash: hashPassword(normalizedPassword, salt),
        passwordVersion: 1
      });

      const reconnectToken = upsertReconnectToken(room.roomId, participantId, 1);

      const policy = createRoomPolicy(room.roomId, createdAt);
      roomPolicyById.set(room.roomId, policy);

      socket.join(room.roomId);
      metrics.recordRoomJoin(socket.id, room.roomId);

      const response: RoomCreatedPayload = {
        roomId: room.roomId,
        participantId,
        reconnectToken,
        expiresAt: policy.expiresAt,
        participantCount: room.participants.size
      };

      socket.emit(SERVER_EVENTS.roomCreated, response);
    });

    socket.on(CLIENT_EVENTS.joinRoom, (payload: JoinRoomPayload | undefined) => {
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

      const normalizedPassword = normalizePassword(payload?.password);
      if (!normalizedPassword) {
        emitInvalidPassword(socket);
        return;
      }

      const subject = deriveJoinAttemptSubject(socket);
      const joinAttemptKey = makeJoinAttemptKey(roomId, subject);
      const joinAttempt = joinAttemptByRoomSubject.get(joinAttemptKey);
      const attemptTimestamp = now();

      if (joinAttempt?.strictLocked) {
        emitRateLimited(socket);
        return;
      }

      if (joinAttempt?.cooldownUntil && attemptTimestamp < joinAttempt.cooldownUntil) {
        emitRateLimited(socket);
        return;
      }

      if (joinAttempt?.cooldownUntil && attemptTimestamp >= joinAttempt.cooldownUntil) {
        joinAttempt.cooldownUntil = undefined;
        joinAttemptByRoomSubject.set(joinAttemptKey, joinAttempt);
      }

      const auth = roomAuthById.get(roomId);
      if (!auth || !verifyPassword(normalizedPassword, auth)) {
        const nextInvalidCount = (joinAttempt?.invalidCount ?? 0) + 1;
        const nextJoinAttempt: JoinAttemptRecord = {
          invalidCount: nextInvalidCount,
          strictLocked: false,
          lastAttemptAt: attemptTimestamp
        };

        joinAttemptByRoomSubject.set(joinAttemptKey, nextJoinAttempt);

        if (nextInvalidCount <= JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX) {
          emitInvalidPassword(socket);
          return;
        }

        if (nextInvalidCount <= JOIN_INVALID_ATTEMPT_COOLDOWN_MAX) {
          nextJoinAttempt.cooldownUntil = attemptTimestamp + JOIN_INVALID_ATTEMPT_COOLDOWN_MS;
          emitRateLimited(socket);
          return;
        }

        nextJoinAttempt.strictLocked = true;
        nextJoinAttempt.cooldownUntil = undefined;
        emitRateLimited(socket);
        return;
      }

      joinAttemptByRoomSubject.delete(joinAttemptKey);

      const joined = joinRoomRecord(state, roomId, socket.id, now(), factories.generateParticipantId);
      if (!joined) {
        emitRoomNotFound(socket);
        return;
      }

      const reconnectToken = upsertReconnectToken(roomId, joined.participantId, auth.passwordVersion);

      const policy = roomPolicyById.get(roomId);
      if (policy && !policy.hasEverHadGuest) {
        policy.hasEverHadGuest = true;
        if (policy.soloHostTimeoutRef) {
          clearTimeout(policy.soloHostTimeoutRef);
        }
        policy.soloHostTimeoutRef = undefined;
        policy.soloHostDeadlineAt = undefined;
      }

      socket.join(roomId);
      metrics.recordRoomJoin(socket.id, roomId);

      const roomJoinedPayload: RoomJoinedPayload = {
        roomId,
        participantId: joined.participantId,
        peers: joined.peers,
        reconnectToken,
        expiresAt: policy?.expiresAt ?? room.createdAt + ROOM_MAX_DURATION_MS,
        participantCount: joined.room.participants.size
      };

      socket.emit(SERVER_EVENTS.roomJoined, roomJoinedPayload);

      const peerJoinedPayload: PeerJoinedPayload = {
        participantId: joined.participantId,
        participantCount: joined.room.participants.size
      };

      socket.to(roomId).emit(SERVER_EVENTS.peerJoined, peerJoinedPayload);
    });

    socket.on(CLIENT_EVENTS.resumeSession, (payload: ResumeSessionPayload | undefined) => {
      const roomId = payload?.roomId;
      const reconnectToken = payload?.reconnectToken;

      if (!roomId || typeof reconnectToken !== "string" || reconnectToken.trim().length === 0) {
        emitRoomNotFound(socket);
        return;
      }

      const reconnectRecord = reconnectByToken.get(reconnectToken);
      if (!reconnectRecord || reconnectRecord.roomId !== roomId) {
        emitRoomNotFound(socket);
        return;
      }

      if (!reconnectRecord.disconnected || now() > reconnectRecord.validUntil) {
        emitRoomNotFound(socket);
        return;
      }

      const room = state.rooms.get(roomId);
      const auth = roomAuthById.get(roomId);
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

      disconnectedParticipants.delete(reconnectRecord.participantId);
      clearGuestGrace(reconnectRecord.participantId);
      markReconnectConnected(reconnectRecord.participantId);

      if (room.hostId === reconnectRecord.participantId) {
        const policy = roomPolicyById.get(roomId);
        if (policy) {
          clearHostGrace(policy);
        }
      }

      participant.socketId = socket.id;
      state.socketToParticipant.set(socket.id, reconnectRecord.participantId);
      state.participantToRoom.set(reconnectRecord.participantId, roomId);

      socket.join(roomId);
      metrics.recordRoomJoin(socket.id, roomId);

      const peers = Array.from(room.participants.values())
        .filter((peer) => peer.participantId !== reconnectRecord.participantId)
        .map((peer) => ({ participantId: peer.participantId }));

      const policy = roomPolicyById.get(roomId);
      const roomJoinedPayload: RoomJoinedPayload = {
        roomId,
        participantId: reconnectRecord.participantId,
        peers,
        reconnectToken,
        expiresAt: policy?.expiresAt ?? room.createdAt + ROOM_MAX_DURATION_MS,
        participantCount: room.participants.size
      };

      socket.emit(SERVER_EVENTS.roomJoined, roomJoinedPayload);
    });

    socket.on(CLIENT_EVENTS.roomPasswordUpdate, (payload: RoomPasswordUpdatePayload | undefined) => {
      const roomId = payload?.roomId;
      if (!roomId) {
        emitRoomNotFound(socket);
        return;
      }

      const normalizedPassword = normalizePassword(payload?.newPassword);
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

      const auth = roomAuthById.get(roomId);
      if (!auth) {
        emitRoomNotFound(socket);
        return;
      }

      auth.passwordVersion += 1;
      auth.salt = randomBytes(16).toString("hex");
      auth.passwordHash = hashPassword(normalizedPassword, auth.salt);

      const changedAt = now();
      const updatePayload: RoomPasswordUpdatedPayload = {
        passwordVersion: auth.passwordVersion,
        changedAt
      };

      socket.emit(SERVER_EVENTS.roomPasswordUpdated, updatePayload);
      socket.to(roomId).emit(SERVER_EVENTS.roomPasswordUpdated, updatePayload);
    });

    socket.on(CLIENT_EVENTS.leaveRoom, () => {
      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "leave");
      if (removed) {
        clearReconnectForParticipant(removed.participantId);
      }

      if (removed && !removed.roomStillActive) {
        clearRoomArtifacts(removed.roomId);
      }
      metrics.recordDisconnect(socket.id);
    });

    socket.on("disconnect", () => {
      const participantId = state.socketToParticipant.get(socket.id);
      const roomId = participantId ? state.participantToRoom.get(participantId) : undefined;
      const room = roomId ? state.rooms.get(roomId) : undefined;
      const isHostDisconnect = Boolean(participantId && roomId && room && room.hostId === participantId);

      if (participantId && roomId && room) {
        state.socketToParticipant.delete(socket.id);
        disconnectedParticipants.add(participantId);

        const participant = room.participants.get(participantId);
        if (participant) {
          participant.socketId = `disconnected:${participantId}`;
        }

        if (isHostDisconnect) {
          const deadlineAt = beginHostGrace(roomId);
          if (deadlineAt !== null) {
            markReconnectDisconnected(participantId, deadlineAt);

            const payload: HostReconnectGracePayload = { deadlineAt };
            socket.to(roomId).emit(SERVER_EVENTS.hostReconnectGrace, payload);
          }

          metrics.recordDisconnect(socket.id);
          return;
        }

        const deadlineAt = beginGuestGrace(roomId, participantId);
        if (deadlineAt !== null) {
          markReconnectDisconnected(participantId, deadlineAt);
        }

        metrics.recordDisconnect(socket.id);
        return;
      }

      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "disconnect");
      if (removed && !removed.roomStillActive) {
        clearRoomArtifacts(removed.roomId);
      }

      metrics.recordDisconnect(socket.id);
    });
  });
}