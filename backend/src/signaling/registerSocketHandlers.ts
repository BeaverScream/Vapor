import type { Server, Socket } from "socket.io";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as signaling from "./contracts";
import type {
  CreateRoomPayload,
  HostReconnectGracePayload,
  JoinRoomPayload,
  PeerJoinedPayload,
  PeerLeftPayload,
  ResumeSessionPayload,
  SignalAnswerPayload,
  SignalAnswerRelayPayload,
  SignalIcePayload,
  SignalIceRelayPayload,
  SignalingErrorCode,
  SignalOfferPayload,
  SignalOfferRelayPayload,
  RoomCreatedPayload,
  RoomDestroyedPayload,
  RoomJoinedPayload,
  RoomPasswordUpdatePayload,
  RoomPasswordUpdatedPayload,
  NicknameUpdatePayload,
  NicknameUpdatedPayload,
} from "./contracts";
import type { Phase0SignalingState } from "./state";
import {
  createRoomRecord,
  joinRoomRecord,
  removeParticipantBySocket,
  type RoomIdentityFactories,
} from "./roomLifecycle";

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
    },
  ) => string;
  verifySync: (hash: string, password: string) => boolean;
};

const require = createRequire(import.meta.url);
const { Algorithm, hashSync, verifySync } =
  require("@node-rs/argon2") as Argon2Module;

type MetricsAdapter = {
  recordConnection: (socketId: string, now?: number) => void;
  recordRoomJoin: (socketId: string, roomId: string) => void;
  recordDisconnect: (socketId: string, now?: number) => void;
  recordRoomCreated: (roomId: string, now?: number) => void;
  recordRoomDestroyed: (roomId: string, now?: number) => void;
};

const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 60 * 1000;
const CREATE_ATTEMPT_WINDOW_MS = 60 * 1000;
const CREATE_ROOM_BURST_THRESHOLD = 5;
const CREATE_ROOM_BLOCK_DURATION_MS = 10 * 60 * 1000;
const IP_ABUSE_WINDOW_MS = 60 * 1000;
const IP_CREATE_THRESHOLD = 10;
const IP_JOIN_THRESHOLD = 30;

type RegisterSocketHandlersArgs = {
  io: Server;
  state: Phase0SignalingState;
  metrics: MetricsAdapter;
  now: () => number;
  factories: RoomIdentityFactories;
  sweepIntervalMs?: number;
};

type ExitSource = "disconnect" | "leave";

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
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

type IpAbuseRecord = {
  createCount: number;
  joinCount: number;
  windowStart: number;
};

const MAX_SIGNAL_IDENTIFIER_LENGTH = 128;
const MAX_SIGNAL_SDP_BYTES = 64 * 1024;
const MAX_SIGNAL_ICE_BYTES = 16 * 1024;

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

function deriveIp(socket: Socket): string {
  const socketLike = socket as Socket & { handshake?: { address?: string } };
  return socketLike.handshake?.address ?? "unknown-ip";
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

function normalizeNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  v = v.replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 24) return null;

  // disallow control/formatting characters
  if (/\p{C}/u.test(v)) return null;

  // allow letters, numbers, spaces, underscore, hyphen
  if (!/^[\p{L}\p{N} _-]+$/u.test(v)) return null;

  return v;
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
    salt: Buffer.from(salt, "hex"),
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
  source: ExitSource,
): void {
  if (!removed) {
    return;
  }

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
    const payload: RoomDestroyedPayload = {
      reason: "host_left",
    };
    socket.to(removed.roomId).emit(signaling.SERVER_EVENTS.roomDestroyed, payload);
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
  const roomAuthById = new Map<string, RoomAuthRecord>();
  const roomPolicyById = new Map<string, RoomPolicyRecord>();
  const joinAttemptByRoomSubject = new Map<string, JoinAttemptRecord>();
  const reconnectByHash = new Map<string, ParticipantReconnectRecord>();
  const reconnectTokenByParticipant = new Map<string, string>();
  const guestGraceByParticipant = new Map<string, GuestGraceRecord>();
  const disconnectedParticipants = new Set<string>();
  const createAttemptsBySubject = new Map<string, { count: number; firstAt: number }>();
  const temporaryBlocklistBySubject = new Map<string, number>();
  const roomLockChains = new Map<string, Promise<void>>();
  const ipAbuseByIp = new Map<string, IpAbuseRecord>();

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
      reconnectByHash.delete(reconnectToken);
      reconnectTokenByParticipant.delete(participantId);
    }

    clearGuestGrace(participantId);
    disconnectedParticipants.delete(participantId);
  };

  const clearReconnectForRoom = (roomId: string): void => {
    for (const [reconnectHash, reconnectRecord] of Array.from(
      reconnectByHash.entries(),
    )) {
      if (reconnectRecord.roomId !== roomId) {
        continue;
      }

      reconnectByHash.delete(reconnectHash);
      reconnectTokenByParticipant.delete(reconnectRecord.participantId);
      clearGuestGrace(reconnectRecord.participantId);
      disconnectedParticipants.delete(reconnectRecord.participantId);
    }
  };

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

  function getReconnectTokenPepper(): string {
    return process.env.RECONNECT_TOKEN_PEPPER ?? "vapor-dev-reconnect-pepper";
  }

  function hashReconnectToken(token: string): string {
    return createHash("sha256").update(token + getReconnectTokenPepper()).digest("hex");
  }

  const upsertReconnectToken = (
    roomId: string,
    participantId: string,
    passwordVersion: number,
  ): string => {
    const oldHash = reconnectTokenByParticipant.get(participantId);
    if (oldHash) {
      reconnectByHash.delete(oldHash);
    }

    const reconnectToken = randomBytes(24).toString("hex");
    const tokenHash = hashReconnectToken(reconnectToken);

    reconnectTokenByParticipant.set(participantId, tokenHash);
    reconnectByHash.set(tokenHash, {
      roomId,
      participantId,
      passwordVersion,
      disconnected: false,
      validUntil: 0,
    });

    return reconnectToken;
  };

  const markReconnectDisconnected = (
    participantId: string,
    validUntil: number,
  ): void => {
    const reconnectTokenHash = reconnectTokenByParticipant.get(participantId);
    if (!reconnectTokenHash) {
      return;
    }

    const reconnectRecord = reconnectByHash.get(reconnectTokenHash);
    if (!reconnectRecord) {
      return;
    }

    reconnectRecord.disconnected = true;
    reconnectRecord.validUntil = validUntil;
  };

  const emitPeerLeftToRoom = (
    roomId: string,
    payload: PeerLeftPayload,
  ): void => {
    if (
      typeof (
        io as unknown as {
          to?: (target: string) => {
            emit: (event: string, payload: unknown) => void;
          };
        }
      ).to !== "function"
    ) {
      return;
    }

    (
      io as unknown as {
        to: (target: string) => {
          emit: (event: string, payload: unknown) => void;
        };
      }
    )
      .to(roomId)
      .emit(signaling.SERVER_EVENTS.peerLeft, payload);
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
    reason: RoomDestroyedPayload["reason"],
  ): void => {
    metrics.recordRoomDestroyed(roomId, now());

    // Step 1: Clear host timers (TTL, solo, host grace) before any state mutation
    const policy = roomPolicyById.get(roomId);
    if (policy) {
      clearRoomPolicyTimers(policy);
    }

    const room = state.rooms.get(roomId);

    // Step 2: Clear all guest grace timers and disconnected markers for room participants
    if (room) {
      for (const participant of room.participants.values()) {
        clearGuestGrace(participant.participantId);
        disconnectedParticipants.delete(participant.participantId);
      }
    }

    // Step 3: Remove participantToRoom, socketToParticipant, nicknameToParticipant entries
    if (room) {
      for (const participant of room.participants.values()) {
        state.participantToRoom.delete(participant.participantId);
        state.socketToParticipant.delete(participant.socketId);
      }
      room.nicknameToParticipant.clear();
      room.participants.clear();
    }

    // Step 4: Clear reconnect index entries
    clearReconnectForRoom(roomId);

    // Step 5: Purge password fields
    roomAuthById.delete(roomId);

    // Step 6: Remove policy, join attempts, and lock chain
    roomPolicyById.delete(roomId);
    purgeJoinAttemptsForRoom(roomId);
    roomLockChains.delete(roomId);

    // Step 7: Remove room from state
    state.rooms.delete(roomId);

    // Step 8: Emit one canonical destroy reason (only when room was present)
    if (room) {
      const ioWithTo = io as unknown as {
        to?: (target: string) => { emit: (event: string, payload: unknown) => void };
      };
      if (typeof ioWithTo.to === "function") {
        ioWithTo.to(roomId).emit(
          signaling.SERVER_EVENTS.roomDestroyed,
          { reason } as RoomDestroyedPayload,
        );
      }
    }
  };

  const createRoomPolicy = (
    roomId: string,
    createdAt: number,
  ): RoomPolicyRecord => {
    const policy: RoomPolicyRecord = {
      expiresAt: createdAt + signaling.ROOM_MAX_DURATION_MS,
      hasEverHadGuest: false,
      soloHostDeadlineAt: createdAt + signaling.SOLO_HOST_ROOM_TIMEOUT_MS,
    };

    policy.roomTtlTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "room_ttl_expired");
    }, signaling.ROOM_MAX_DURATION_MS);
    policy.roomTtlTimeoutRef.unref?.();

    policy.soloHostTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "solo_timeout_expired");
    }, signaling.SOLO_HOST_ROOM_TIMEOUT_MS);
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
    roomLockChains.delete(roomId);
  };

  const beginHostGrace = (roomId: string): number | null => {
    const room = state.rooms.get(roomId);
    const policy = roomPolicyById.get(roomId);
    if (!room || !policy) {
      return null;
    }

    clearHostGrace(policy);

    const deadlineAt = now() + signaling.HOST_DISCONNECT_GRACE_MS;
    policy.hostGraceDeadlineAt = deadlineAt;
    policy.hostGraceTimeoutRef = setTimeout(() => {
      destroyRoom(roomId, "host_grace_expired");
    }, signaling.HOST_DISCONNECT_GRACE_MS);
    policy.hostGraceTimeoutRef.unref?.();

    return deadlineAt;
  };

  const beginGuestGrace = (
    roomId: string,
    participantId: string,
  ): number | null => {
    const room = state.rooms.get(roomId);
    if (!room || room.hostId === participantId) {
      return null;
    }

    clearGuestGrace(participantId);

    const deadlineAt = now() + signaling.GUEST_DISCONNECT_GRACE_MS;
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

      const leavingRecord = activeRoom.participants.get(participantId);
      if (leavingRecord?.nickname && activeRoom.nicknameToParticipant) {
        const key = leavingRecord.nickname.toLowerCase();
        if (activeRoom.nicknameToParticipant.get(key) === participantId) {
          activeRoom.nicknameToParticipant.delete(key);
        }
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
        participantCount,
      };

      emitPeerLeftToRoom(roomId, payload);
      }, signaling.GUEST_DISCONNECT_GRACE_MS);

    timeoutRef.unref?.();

    guestGraceByParticipant.set(participantId, {
      roomId,
      participantId,
      deadlineAt,
      timeoutRef,
    });

    return deadlineAt;
  };

  const resolveSignalRoute = (
    socket: Socket,
    payload: any,
  ): { roomId: string; fromParticipantId: string; toSocketId: string } | null => {
    const roomId = payload?.roomId;
    const toParticipantId = payload?.toParticipantId;

    if (!roomId || !toParticipantId) {
      emitRoomNotFound(socket);
      return null;
    }

    const fromParticipantId = state.socketToParticipant.get(socket.id);
    if (!fromParticipantId) {
      emitRoomNotFound(socket);
      return null;
    }

    const room = state.rooms.get(roomId);
    if (!room || !room.participants.has(fromParticipantId)) {
      emitRoomNotFound(socket);
      return null;
    }

    const toParticipant = room.participants.get(toParticipantId);
    if (!toParticipant || toParticipant.socketId.startsWith("disconnected:")) {
      emitRoomNotFound(socket);
      return null;
    }

    return {
      roomId,
      fromParticipantId,
      toSocketId: toParticipant.socketId,
    };
  };

  const emitSignalOffer = (
    toSocketId: string,
    payload: SignalOfferRelayPayload,
  ): void => {
    io.to(toSocketId).emit(signaling.SERVER_EVENTS.signalOffer, payload);
  };

  const emitSignalAnswer = (
    toSocketId: string,
    payload: SignalAnswerRelayPayload,
  ): void => {
    io.to(toSocketId).emit(signaling.SERVER_EVENTS.signalAnswer, payload);
  };

  const emitSignalIce = (
    toSocketId: string,
    payload: SignalIceRelayPayload,
  ): void => {
    io.to(toSocketId).emit(signaling.SERVER_EVENTS.signalIce, payload);
  };

  io.on("connection", (socket) => {
    metrics.recordConnection(socket.id);
    socket.on("heartbeat", () => {
      const participantId = state.socketToParticipant.get(socket.id);
      if (!participantId) {
        return;
      }

      const roomId = state.participantToRoom.get(participantId);
      if (!roomId) {
        return;
      }

      const room = state.rooms.get(roomId);
      if (!room) {
        return;
      }

      const participant = room.participants.get(participantId);
      if (!participant) {
        return;
      }

      participant.lastSeenAt = now();
    });

    socket.on(
      signaling.CLIENT_EVENTS.createRoom,
      (payload: CreateRoomPayload | undefined) => {
        const normalizedPassword = normalizePassword(payload?.password);
        const normalizedNickname = normalizeNickname(payload?.nickname);
        const subject = deriveJoinAttemptSubject(socket);

        // check temporary blocklist first
        const blockedUntil = temporaryBlocklistBySubject.get(subject);
        if (blockedUntil && now() < blockedUntil) {
          emitRateLimited(socket);
          return;
        }
        if (!normalizedPassword) {
          emitInvalidPassword(socket);
          return;
        }

        if (!normalizedNickname) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const createIp = deriveIp(socket);
        const createIpTs = now();
        let ipCreateRecord = ipAbuseByIp.get(createIp);
        if (!ipCreateRecord || createIpTs - ipCreateRecord.windowStart > IP_ABUSE_WINDOW_MS) {
          ipCreateRecord = { createCount: 0, joinCount: 0, windowStart: createIpTs };
          ipAbuseByIp.set(createIp, ipCreateRecord);
        }
        ipCreateRecord.createCount += 1;
        if (ipCreateRecord.createCount > IP_CREATE_THRESHOLD) {
          emitRateLimited(socket);
          return;
        }

        const createdAt = now();
        const prev = createAttemptsBySubject.get(subject);
        if (!prev || createdAt - prev.firstAt > CREATE_ATTEMPT_WINDOW_MS) {
          createAttemptsBySubject.set(subject, { count: 1, firstAt: createdAt });
        } else {
          prev.count += 1;
          createAttemptsBySubject.set(subject, prev);
          if (prev.count > CREATE_ROOM_BURST_THRESHOLD) {
            temporaryBlocklistBySubject.set(subject, createdAt + CREATE_ROOM_BLOCK_DURATION_MS);
            createAttemptsBySubject.delete(subject);
            emitRateLimited(socket);
            return;
          }
        }
        const { room, participantId } = createRoomRecord(
          state,
          socket.id,
          createdAt,
          factories,
        );

        // set nickname mapping for host
        const participant = room.participants.get(participantId);
        if (participant) {
          participant.nickname = normalizedNickname;
          participant.nicknameUpdatedAt = createdAt;
          room.nicknameToParticipant.set(normalizedNickname.toLowerCase(), participantId);
        }

        const salt = randomBytes(16).toString("hex");
        roomAuthById.set(room.roomId, {
          salt,
          passwordHash: hashPassword(normalizedPassword, salt),
          passwordVersion: 1,
        });

        const reconnectToken = upsertReconnectToken(
          room.roomId,
          participantId,
          1,
        );

        const policy = createRoomPolicy(room.roomId, createdAt);
        roomPolicyById.set(room.roomId, policy);

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

        if (
          joinAttempt?.cooldownUntil &&
          attemptTimestamp < joinAttempt.cooldownUntil
        ) {
          emitRateLimited(socket);
          return;
        }

        if (
          joinAttempt?.cooldownUntil &&
          attemptTimestamp >= joinAttempt.cooldownUntil
        ) {
          joinAttempt.cooldownUntil = undefined;
          joinAttemptByRoomSubject.set(joinAttemptKey, joinAttempt);
        }

        const joinIp = deriveIp(socket);
        let ipJoinRecord = ipAbuseByIp.get(joinIp);
        if (!ipJoinRecord || attemptTimestamp - ipJoinRecord.windowStart > IP_ABUSE_WINDOW_MS) {
          ipJoinRecord = { createCount: 0, joinCount: 0, windowStart: attemptTimestamp };
          ipAbuseByIp.set(joinIp, ipJoinRecord);
        }
        ipJoinRecord.joinCount += 1;
        if (ipJoinRecord.joinCount > IP_JOIN_THRESHOLD) {
          emitRateLimited(socket);
          return;
        }

        const normalizedNickname = normalizeNickname(payload?.nickname);
        if (!normalizedNickname) {
          emitInvalidSignalPayload(socket);
          return;
        }

        // enforce room-scoped nickname uniqueness (case-insensitive)
        const existing = room.nicknameToParticipant.get(normalizedNickname.toLowerCase());
        if (existing) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const auth = roomAuthById.get(roomId);
        if (!auth || !verifyPassword(normalizedPassword, auth)) {
          const nextInvalidCount = (joinAttempt?.invalidCount ?? 0) + 1;
          const nextJoinAttempt: JoinAttemptRecord = {
            invalidCount: nextInvalidCount,
            strictLocked: false,
            lastAttemptAt: attemptTimestamp,
          };

          joinAttemptByRoomSubject.set(joinAttemptKey, nextJoinAttempt);

          if (nextInvalidCount <= signaling.JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX) {
            emitInvalidPassword(socket);
            return;
          }

          if (nextInvalidCount <= signaling.JOIN_INVALID_ATTEMPT_COOLDOWN_MAX) {
            nextJoinAttempt.cooldownUntil =
              attemptTimestamp + signaling.JOIN_INVALID_ATTEMPT_COOLDOWN_MS;
            emitRateLimited(socket);
            return;
          }

          nextJoinAttempt.strictLocked = true;
          nextJoinAttempt.cooldownUntil = undefined;
          emitRateLimited(socket);
          return;
        }

        joinAttemptByRoomSubject.delete(joinAttemptKey);

        // VP-2.3-01: Enforce participant cap of 5 users per room
        if (room.participants.size >= signaling.MAX_PARTICIPANTS_PER_ROOM) {
          emitRoomFull(socket);
          return;
        }

        const joined = joinRoomRecord(
          state,
          roomId,
          socket.id,
          now(),
          factories.generateParticipantId,
        );
        if (!joined) {
          emitRoomNotFound(socket);
          return;
        }

        const reconnectToken = upsertReconnectToken(
          roomId,
          joined.participantId,
          auth.passwordVersion,
        );

        // set nickname for joined participant
        const joinedParticipant = joined.room.participants.get(joined.participantId);
        if (joinedParticipant) {
          joinedParticipant.nickname = normalizedNickname;
          joinedParticipant.nicknameUpdatedAt = now();
          joined.room.nicknameToParticipant.set(normalizedNickname.toLowerCase(), joined.participantId);
        }

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
          hostId: joined.room.hostId,
          peers: joined.peers,
          reconnectToken,
          expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
          participantNickname: normalizedNickname,
          participantCount: joined.room.participants.size,
        };

        socket.emit(signaling.SERVER_EVENTS.roomJoined, roomJoinedPayload);

        const peerJoinedPayload: PeerJoinedPayload = {
          participantId: joined.participantId,
          participantCount: joined.room.participants.size,
        };

        socket.to(roomId).emit(signaling.SERVER_EVENTS.peerJoined, peerJoinedPayload);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalOffer,
      (payload: SignalOfferPayload | undefined) => {
        const route = resolveSignalRoute(socket, payload);
        if (!route) {
          return;
        }

        const sdp = normalizeSignalSdp(payload?.sdp);
        if (!sdp) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const relayPayload: SignalOfferRelayPayload = {
          roomId: route.roomId,
          fromParticipantId: route.fromParticipantId,
          sdp,
        };

        emitSignalOffer(route.toSocketId, relayPayload);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalAnswer,
      (payload: SignalAnswerPayload | undefined) => {
        const route = resolveSignalRoute(socket, payload);
        if (!route) {
          return;
        }

        const sdp = normalizeSignalSdp(payload?.sdp);
        if (!sdp) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const relayPayload: SignalAnswerRelayPayload = {
          roomId: route.roomId,
          fromParticipantId: route.fromParticipantId,
          sdp,
        };

        emitSignalAnswer(route.toSocketId, relayPayload);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.signalIce,
      (payload: SignalIcePayload | undefined) => {
        const route = resolveSignalRoute(socket, payload);
        if (!route) {
          return;
        }

        const candidate = normalizeSignalCandidate(payload?.candidate);
        if (!candidate) {
          emitInvalidSignalPayload(socket);
          return;
        }

        const relayPayload: SignalIceRelayPayload = {
          roomId: route.roomId,
          fromParticipantId: route.fromParticipantId,
          candidate,
        };

        emitSignalIce(route.toSocketId, relayPayload);
      },
    );

    socket.on(
      signaling.CLIENT_EVENTS.resumeSession,
      async (payload: ResumeSessionPayload | undefined) => {
        const roomId = payload?.roomId;
        const reconnectToken = payload?.reconnectToken;

        if (
          !roomId ||
          typeof reconnectToken !== "string" ||
          reconnectToken.trim().length === 0
        ) {
          emitRoomNotFound(socket);
          return;
        }

        await withRoomLock(roomId, () => {
          const reconnectHash = hashReconnectToken(reconnectToken);
          const reconnectRecord = reconnectByHash.get(reconnectHash);
          if (!reconnectRecord || reconnectRecord.roomId !== roomId) {
            emitRoomNotFound(socket);
            return;
          }

          if (
            !reconnectRecord.disconnected ||
            now() > reconnectRecord.validUntil
          ) {
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

          const participant = room.participants.get(
            reconnectRecord.participantId,
          );
          if (!participant) {
            emitRoomNotFound(socket);
            return;
          }

          disconnectedParticipants.delete(reconnectRecord.participantId);
          clearGuestGrace(reconnectRecord.participantId);

          if (room.hostId === reconnectRecord.participantId) {
            const policy = roomPolicyById.get(roomId);
            if (policy) {
              clearHostGrace(policy);
            }
          }

          participant.socketId = socket.id;
          state.socketToParticipant.set(socket.id, reconnectRecord.participantId);
          state.participantToRoom.set(reconnectRecord.participantId, roomId);

          const freshToken = upsertReconnectToken(
            roomId,
            reconnectRecord.participantId,
            auth.passwordVersion,
          );

          socket.join(roomId);
          metrics.recordRoomJoin(socket.id, roomId);

          const peers = Array.from(room.participants.values())
            .filter(
              (peer) => peer.participantId !== reconnectRecord.participantId,
            )
            .map((peer) => ({ participantId: peer.participantId }));

          const policy = roomPolicyById.get(roomId);
          const roomJoinedPayload: RoomJoinedPayload = {
            roomId,
            participantId: reconnectRecord.participantId,
            hostId: room.hostId,
            peers,
            reconnectToken: freshToken,
            expiresAt: policy?.expiresAt ?? room.createdAt + signaling.ROOM_MAX_DURATION_MS,
            participantNickname: participant.nickname ?? null,
            participantCount: room.participants.size,
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

        const normalizedPassword = normalizePassword(payload?.newPassword);
        if (!normalizedPassword) {
          emitInvalidPassword(socket);
          return;
        }

        const participantId = state.socketToParticipant.get(socket.id);
        const participantRoomId = participantId
          ? state.participantToRoom.get(participantId)
          : undefined;
        const room = state.rooms.get(roomId);
        if (
          !participantId ||
          participantRoomId !== roomId ||
          !room ||
          room.hostId !== participantId
        ) {
          emitRoomNotFound(socket);
          return;
        }

        await withRoomLock(roomId, () => {
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
            changedAt,
          };

          socket.emit(signaling.SERVER_EVENTS.roomPasswordUpdated, updatePayload);
          socket
            .to(roomId)
            .emit(signaling.SERVER_EVENTS.roomPasswordUpdated, updatePayload);
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
          const existing = room.nicknameToParticipant.get(key);
          if (existing && existing !== participantId) {
            emitInvalidSignalPayload(socket);
            return;
          }

          if (participant.nickname) {
            room.nicknameToParticipant.delete(participant.nickname.toLowerCase());
          }
          participant.nickname = normalizedNickname;
          participant.nicknameUpdatedAt = nowTs;
          room.nicknameToParticipant.set(key, participantId);

          const updatePayload = {
            participantId,
            nickname: normalizedNickname,
          } as NicknameUpdatedPayload;

          io.to(roomId).emit(signaling.SERVER_EVENTS.nicknameUpdated, updatePayload);
        });
      },
    );

    socket.on(signaling.CLIENT_EVENTS.leaveRoom, () => {
      const removed = removeParticipantBySocket(state, socket.id);
      emitParticipantExit(socket, removed, "leave");
      if (removed) {
        clearReconnectForParticipant(removed.participantId);
      }

      if (removed && !removed.roomStillActive) {
        metrics.recordRoomDestroyed(removed.roomId, now());
        clearRoomArtifacts(removed.roomId);
      }
      metrics.recordDisconnect(socket.id);
    });

    socket.on("disconnect", () => {
      const participantId = state.socketToParticipant.get(socket.id);
      const roomId = participantId
        ? state.participantToRoom.get(participantId)
        : undefined;
      const room = roomId ? state.rooms.get(roomId) : undefined;
      const isHostDisconnect = Boolean(
        participantId && roomId && room && room.hostId === participantId,
      );

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
            socket.to(roomId).emit(signaling.SERVER_EVENTS.hostReconnectGrace, payload);
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
        metrics.recordRoomDestroyed(removed.roomId, now());
        clearRoomArtifacts(removed.roomId);
      }

      metrics.recordDisconnect(socket.id);
    });
  });

  const sweep = (): void => {
    const nowTs = now();

    for (const [roomId, policy] of Array.from(roomPolicyById.entries())) {
      if (policy.expiresAt <= nowTs) {
        destroyRoom(roomId, "room_ttl_expired");
      }
    }

    for (const [hash, record] of Array.from(reconnectByHash.entries())) {
      if (record.disconnected && record.validUntil > 0 && record.validUntil <= nowTs) {
        reconnectByHash.delete(hash);
        reconnectTokenByParticipant.delete(record.participantId);
        disconnectedParticipants.delete(record.participantId);
      }
    }

    for (const [subject, expiry] of Array.from(temporaryBlocklistBySubject.entries())) {
      if (expiry <= nowTs) {
        temporaryBlocklistBySubject.delete(subject);
      }
    }

    for (const [subject, attempt] of Array.from(createAttemptsBySubject.entries())) {
      if (nowTs - attempt.firstAt > CREATE_ATTEMPT_WINDOW_MS) {
        createAttemptsBySubject.delete(subject);
      }
    }

    for (const [ip, record] of Array.from(ipAbuseByIp.entries())) {
      if (nowTs - record.windowStart > IP_ABUSE_WINDOW_MS) {
        ipAbuseByIp.delete(ip);
      }
    }

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

function normalizeSignalIdentifier(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SIGNAL_IDENTIFIER_LENGTH) {
    return null;
  }

  return trimmed;
}

function normalizeSignalSdp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const serializedLength = Buffer.byteLength(value, "utf8");
  if (serializedLength === 0 || serializedLength > MAX_SIGNAL_SDP_BYTES) {
    return null;
  }

  return value;
}

function normalizeSignalCandidate(
  value: unknown,
): string | Record<string, unknown> | null {
  if (typeof value === "string") {
    const serializedLength = Buffer.byteLength(value, "utf8");
    if (serializedLength === 0 || serializedLength > MAX_SIGNAL_ICE_BYTES) {
      return null;
    }

    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  let serializedCandidate: string;
  try {
    serializedCandidate = JSON.stringify(value);
  } catch {
    return null;
  }

  const serializedLength = Buffer.byteLength(serializedCandidate, "utf8");
  if (serializedLength <= 2 || serializedLength > MAX_SIGNAL_ICE_BYTES) {
    return null;
  }

  return value as Record<string, unknown>;
}
