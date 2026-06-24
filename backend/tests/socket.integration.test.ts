import test from "node:test";
import assert from "node:assert/strict";
import { createVaporServer } from "../src/server";
import { CLIENT_EVENTS, GUEST_DISCONNECT_GRACE_MS, HOST_DISCONNECT_GRACE_MS, JOIN_INVALID_ATTEMPT_COOLDOWN_MS, JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX, NICKNAME_CHANGE_COOLDOWN_MS, SERVER_EVENTS, SOLO_HOST_ROOM_TIMEOUT_MS } from "../src/signaling/contracts";
import { registerSocketHandlers } from "../src/signaling/registerSocketHandlers";
import { createSignalingState, getSignalingStateSnapshot } from "../src/signaling/state";
import { createMetrics } from "../src/admin/metrics";

type EventPayload = unknown;
type EventHandler = (payload: EventPayload) => void;

type FakeSocketOptions = {
  address?: string;
  fingerprint?: string;
};

class FakeIo {
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;
  private roomMembership = new Map<string, Set<FakeSocket>>();
  private socketsById = new Map<string, FakeSocket>();

  get sockets(): { sockets: Map<string, FakeSocket> } {
    return { sockets: this.socketsById };
  }

  on(event: string, handler: (socket: FakeSocket) => void): void {
    if (event === "connection") {
      this.connectionHandler = handler;
    }
  }

  connect(socketId: string, options?: FakeSocketOptions): FakeSocket {
    const socket = new FakeSocket(this, socketId, options);
    this.socketsById.set(socketId, socket);
    this.connectionHandler?.(socket);
    return socket;
  }

  joinRoom(roomId: string, socket: FakeSocket): void {
    const room = this.roomMembership.get(roomId) ?? new Set<FakeSocket>();
    room.add(socket);
    this.roomMembership.set(roomId, room);
  }

  emitToRoomExcept(roomId: string, fromSocket: FakeSocket, event: string, payload: EventPayload): void {
    const room = this.roomMembership.get(roomId);
    if (!room) {
      return;
    }

    for (const socket of room.values()) {
      if (socket.id === fromSocket.id) {
        continue;
      }
      socket.pushInbound(event, payload);
    }
  }

  to(target: string): { emit: (event: string, payload: EventPayload) => void } {
    return {
      emit: (event: string, payload: EventPayload): void => {
        const room = this.roomMembership.get(target);
        if (room) {
          for (const socket of room.values()) {
            socket.pushInbound(event, payload);
          }

          return;
        }

        const targetSocket = this.socketsById.get(target);
        if (!targetSocket) {
          return;
        }

        targetSocket.pushInbound(event, payload);
      }
    };
  }
}

class FakeSocket {
  readonly id: string;
  readonly handshake?: {
    address?: string;
    auth?: { clientFingerprint?: string };
  };

  private handlers = new Map<string, EventHandler>();
  private inboundEvents: Array<{ event: string; payload: EventPayload }> = [];
  private _disconnected = false;

  constructor(private io: FakeIo, socketId: string, options?: FakeSocketOptions) {
    this.id = socketId;
    if (options?.address !== undefined || options?.fingerprint !== undefined) {
      this.handshake = {
        address: options.address,
        auth: options.fingerprint !== undefined ? { clientFingerprint: options.fingerprint } : undefined,
      };
    }
  }

  on(event: string, handler: EventHandler): void {
    this.handlers.set(event, handler);
  }

  emit(event: string, payload: EventPayload): void {
    this.inboundEvents.push({ event, payload });
  }

  join(roomId: string): void {
    this.io.joinRoom(roomId, this);
  }

  to(roomId: string): { emit: (event: string, payload: EventPayload) => void } {
    return {
      emit: (event: string, payload: EventPayload): void => {
        this.io.emitToRoomExcept(roomId, this, event, payload);
      }
    };
  }

  trigger(event: string, payload: EventPayload): void {
    const handler = this.handlers.get(event);
    handler?.(payload);
  }

  triggerDisconnect(): void {
    const disconnectHandler = this.handlers.get("disconnect");
    disconnectHandler?.(undefined);
  }

  pushInbound(event: string, payload: EventPayload): void {
    this.inboundEvents.push({ event, payload });
  }

  popEvent(event: string): EventPayload | undefined {
    const index = this.inboundEvents.findIndex((entry) => entry.event === event);
    if (index < 0) {
      return undefined;
    }

    const [entry] = this.inboundEvents.splice(index, 1);
    return entry.payload;
  }

  disconnect(close?: boolean): void {
    this._disconnected = true;
  }

  wasDisconnected(): boolean {
    return this._disconnected;
  }
}

// Flushes the microtask queue so that async socket handlers (resumeSession,
// roomPasswordUpdate) complete before assertions run.
function flushPromises(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function setupSocketHarness(overrides?: {
  generateRoomId?: () => string;
  generateParticipantId?: () => string;
  now?: () => number;
  sweepIntervalMs?: number;
}) {
  const io = new FakeIo();
  const state = createSignalingState();

  const metrics = {
    recordConnection: () => undefined,
    recordRoomJoin: () => undefined,
    recordDisconnect: () => undefined,
    recordRoomCreated: () => undefined,
    recordRoomDestroyed: () => undefined,
  };

  registerSocketHandlers({
    io: io as unknown as Parameters<typeof registerSocketHandlers>[0]["io"],
    state,
    metrics,
    now: overrides?.now ?? (() => 123456),
    factories: {
      generateRoomId: overrides?.generateRoomId ?? (() => "AbC123"),
      generateParticipantId:
        overrides?.generateParticipantId ??
        (() => {
          let counter = 0;
          return () => {
            counter += 1;
            return `P-${counter}`;
          };
        })()
    },
    sweepIntervalMs: overrides?.sweepIntervalMs
  });

  return {
    io,
    state,
    hooks: {
      getStateSnapshot: () => getSignalingStateSnapshot(state),
      getParticipantRecord: (roomId: string, participantId: string) =>
        state.rooms.get(roomId)?.participants.get(participantId)
    }
  };
}

function setupSocketHarnessWithMetrics(overrides?: {
  generateRoomId?: () => string;
  generateParticipantId?: () => string;
  now?: () => number;
  sweepIntervalMs?: number;
}) {
  const io = new FakeIo();
  const state = createSignalingState();

  const realMetrics = createMetrics({
    getActiveRoomCount: () => state.rooms.size,
    getActiveParticipantCount: () => {
      let total = 0;
      for (const room of state.rooms.values()) total += room.participants.size;
      return total;
    },
    getActiveSocketCount: () => state.socketToParticipant.size,
    getTemporaryBlocklistSize: () => 0,
    getRateLimitWindowActiveCount: () => 0,
  });

  const metricsAdapter = {
    recordConnection: () => undefined,
    recordRoomJoin: () => undefined,
    recordDisconnect: () => undefined,
    recordRoomCreated: () => undefined,
    recordRoomDestroyed: () => undefined,
    incrementParticipantsJoined: () => realMetrics.incrementParticipantsJoined(),
    incrementRoomsCreated: () => realMetrics.incrementRoomsCreated(),
    incrementRoomDestroyed: (reason: Parameters<typeof realMetrics.incrementRoomDestroyed>[0]) =>
      realMetrics.incrementRoomDestroyed(reason),
    incrementErrorCount: (code: Parameters<typeof realMetrics.incrementErrorCount>[0]) =>
      realMetrics.incrementErrorCount(code),
    updateRoomLifetimeRolling: (ms: number) => realMetrics.updateRoomLifetimeRolling(ms),
    updatePeakMarks: () => realMetrics.updatePeakMarks(),
  };

  registerSocketHandlers({
    io: io as unknown as Parameters<typeof registerSocketHandlers>[0]["io"],
    state,
    metrics: metricsAdapter,
    now: overrides?.now ?? (() => 123456),
    factories: {
      generateRoomId: overrides?.generateRoomId ?? (() => "AbC123"),
      generateParticipantId:
        overrides?.generateParticipantId ??
        (() => {
          let counter = 0;
          return () => {
            counter += 1;
            return `P-${counter}`;
          };
        })(),
    },
    sweepIntervalMs: overrides?.sweepIntervalMs,
  });

  return {
    io,
    state,
    realMetrics,
    hooks: {
      getStateSnapshot: () => getSignalingStateSnapshot(state),
    },
  };
}

function createSequenceFactory(values: string[], fallback: string): () => string {
  let index = 0;
  return () => {
    const value = values[index] ?? fallback;
    index += 1;
    return value;
  };
}

function popSocketError(socket: FakeSocket): { code: string; message: string } | undefined {
  return socket.popEvent(SERVER_EVENTS.error) as { code: string; message: string } | undefined;
}

// ---- Contract ----
test("T0.1-04: create + join emits contract payloads and shared room context", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    hostId: string;
    participantCount: number;
  };

  assert.ok(roomCreated);
  assert.equal(roomCreated.roomId, "AbC123");
  assert.equal(roomCreated.hostId, roomCreated.participantId);
  assert.equal(roomCreated.participantCount, 1);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    participantId: string;
    hostId: string;
    peers: Array<{ participantId: string }>;
    participantCount: number;
  };
  const peerJoined = host.popEvent(SERVER_EVENTS.peerJoined) as {
    participantId: string;
    participantCount: number;
  };

  assert.ok(roomJoined);
  assert.ok(peerJoined);
  assert.equal(roomJoined.roomId, "AbC123");
  assert.equal(roomJoined.hostId, roomCreated.participantId);
  assert.equal(roomJoined.participantCount, 2);
  assert.equal(peerJoined.participantCount, 2);
  assert.equal(roomJoined.peers.length, 1);

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("T0.1-05: altered-case room id naturally fails exact-match lookup", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "abc123", password: "pw", nickname: "Guest" });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "ROOM_NOT_FOUND");
  assert.equal(errorPayload.message, "Room not found");
});

test("T0.1-06: missing roomId payload returns deterministic ROOM_NOT_FOUND", () => {
  const { io, hooks } = setupSocketHarness();
  const guest = io.connect("socket-guest");

  guest.trigger(CLIENT_EVENTS.joinRoom, { password: "pw" });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "ROOM_NOT_FOUND");
  assert.equal(errorPayload.message, "Room not found");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

// ---- Auth ----
test("T1.4-01: create_room rejects empty password with INVALID_PASSWORD semantics", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "   " });

  const errorPayload = popSocketError(host);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "INVALID_PASSWORD");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("T1.4-02: join_room rejects empty password with INVALID_PASSWORD semantics", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "   " });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "INVALID_PASSWORD");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("T1.4-03: join_room rejects wrong password with INVALID_PASSWORD semantics", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest" });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "INVALID_PASSWORD");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

// SPEC-INVALID: Spec section 2 replaced the per-room wrong-password cooldown scheme with a simple
// window-based rate limit (JOIN_RATE_LIMIT_WINDOW_MS / JOIN_RATE_LIMIT_MAX). The specific
// "3 free attempts before cooldown" threshold is no longer defined in the spec.
/* test("T2.4-01: join_room attempts 1-3 with wrong password each return INVALID_PASSWORD without cooldown", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac1-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: `Guest-${attempt}` });
    const errorPayload = popSocketError(guest);
    assert.ok(errorPayload, `Attempt ${attempt}: expected error response`);
    assert.equal(errorPayload.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD with no cooldown`);
  }
}); */

// SPEC-INVALID: Spec section 2 replaced the per-room cooldown mechanism with a window-based rate
// limit. The "4th attempt triggers a timed cooldown" behavior derives from the old
// JOIN_INVALID_ATTEMPT_COOLDOWN_MAX / JOIN_INVALID_ATTEMPT_COOLDOWN_MS constants which are no
// longer part of the spec.
/* test("T2.4-02: join_room attempt 4 starts cooldown and returns RATE_LIMITED; attempt 5 during cooldown also returns RATE_LIMITED", () => {
  let time = 0;
  const { io } = setupSocketHarness({ now: () => time });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // attempts 1-3: each gets INVALID_PASSWORD, no cooldown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac2-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: `Guest-${attempt}` });
    const errorPayload = popSocketError(guest);
    assert.ok(errorPayload);
    assert.equal(errorPayload.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD before cooldown`);
  }

  // attempt 4: cooldown enforced → RATE_LIMITED
  const guest4 = io.connect("socket-guest-ac2-4");
  guest4.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-4" });
  const error4 = popSocketError(guest4);
  assert.ok(error4, "Attempt 4: expected error response");
  assert.equal(error4.code, "RATE_LIMITED", "Attempt 4: expected RATE_LIMITED as cooldown starts");

  // attempt 5 during active cooldown: still RATE_LIMITED
  const guest5 = io.connect("socket-guest-ac2-5");
  guest5.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-5" });
  const error5 = popSocketError(guest5);
  assert.ok(error5, "Attempt 5: expected error response during cooldown");
  assert.equal(error5.code, "RATE_LIMITED", "Attempt 5: expected RATE_LIMITED during active cooldown");
}); */

// SPEC-INVALID: Spec section 2 no longer defines a "strict lockout" state or the
// JOIN_INVALID_ATTEMPT_COOLDOWN_MS / COOLDOWN_MAX constants that drive this behavior.
// Rate limiting is now specified as a simple window-based counter (JOIN_RATE_LIMIT_WINDOW_MS /
// JOIN_RATE_LIMIT_MAX), making the multi-stage lockout escalation model obsolete.
/* test("T2.4-03: join_room invalid attempts exceeding 5 enforce strict lockout with RATE_LIMITED", () => {
  const JOIN_INVALID_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;
  let time = 0;
  const { io } = setupSocketHarness({ now: () => time });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // attempts 1-3: INVALID_PASSWORD, no cooldown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac3-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: `Guest-${attempt}` });
    const errorPayload = popSocketError(guest);
    assert.equal(errorPayload?.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD`);
  }

  // attempt 4: first cooldown starts
  const guest4 = io.connect("socket-guest-ac3-4");
  guest4.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-4" });
  assert.equal(popSocketError(guest4)?.code, "RATE_LIMITED", "Attempt 4: expected RATE_LIMITED");

  // advance past first cooldown; attempt 5: second cooldown starts
  time += JOIN_INVALID_ATTEMPT_COOLDOWN_MS + 1;
  const guest5 = io.connect("socket-guest-ac3-5");
  guest5.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-5" });
  assert.equal(popSocketError(guest5)?.code, "RATE_LIMITED", "Attempt 5: expected RATE_LIMITED");

  // advance past second cooldown; attempt 6: strict lockout (count > 5)
  time += JOIN_INVALID_ATTEMPT_COOLDOWN_MS + 1;
  const guest6 = io.connect("socket-guest-ac3-6");
  guest6.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-6" });
  const error6 = popSocketError(guest6);
  assert.ok(error6, "Attempt 6: expected error under strict lockout");
  assert.equal(error6.code, "RATE_LIMITED", "Attempt 6: expected RATE_LIMITED strict lockout");

  // strict lockout persists without any time advance
  const guest7 = io.connect("socket-guest-ac3-7");
  guest7.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass", nickname: "Guest-7" });
  assert.equal(popSocketError(guest7)?.code, "RATE_LIMITED", "Strict lockout: lockout persists for attempt 7+");
}); */

// SPEC-INVALID: This test validates the purge behavior of the per-room joinAttemptByRoomSubject
// map, which is an implementation detail of the old cooldown-based rate limiting scheme. The
// updated spec (section 2) replaces that scheme with a window-based limit
// (JOIN_RATE_LIMIT_WINDOW_MS / JOIN_RATE_LIMIT_MAX) that does not use per-room attempt counters.
/* test("T2.4-04: join-attempt counters are purged atomically on room destruction", () => {
  const { io, hooks } = setupSocketHarness({
    generateRoomId: createSequenceFactory(["ROOM-A", "ROOM-B"], "ROOM-X")
  });
  const host = io.connect("socket-host-purge");

  // create first room and accumulate invalid attempts up to cooldown threshold
  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(created.roomId, "ROOM-A");

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const guest = io.connect(`socket-guest-purge-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "ROOM-A", password: "wrong-pass", nickname: `Guest-${attempt}` });
  }

  // destroy room by host leave; state must be purged atomically
  host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "ROOM-A" });
  assert.equal(hooks.getStateSnapshot().roomCount, 0);

  // create second room; a fresh wrong-password attempt must not inherit prior lock state
  const host2 = io.connect("socket-host-purge-2");
  host2.trigger(CLIENT_EVENTS.createRoom, { password: "new-pass", nickname: "Host" });
  const created2 = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(created2.roomId, "ROOM-B");

  const freshGuest = io.connect("socket-fresh-guest-purge");
  freshGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "ROOM-B", password: "wrong-pass", nickname: "FreshGuest" });
  const errorPayload = popSocketError(freshGuest);
  assert.ok(errorPayload, "Expected error on fresh room join attempt");
  assert.equal(errorPayload.code, "INVALID_PASSWORD", "Counter purge: fresh room must not inherit prior RATE_LIMITED state");
}); */

test("T2.6-01: signal relay targets only intended participant for offer, answer, and ice", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guestA = io.connect("socket-guest-a");
  const guestB = io.connect("socket-guest-b");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };

  guestA.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest-A" });
  const guestAJoined = guestA.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guestB.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest-B" });
  const guestBJoined = guestB.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.signalOffer, {
    roomId: roomCreated.roomId,
    toParticipantId: guestAJoined.participantId,
    sdp: "offer-sdp"
  });

  const offerForGuestA = guestA.popEvent(SERVER_EVENTS.signalOffer) as {
    roomId: string;
    fromParticipantId: string;
    sdp: string;
  };

  assert.ok(offerForGuestA);
  assert.equal(offerForGuestA.roomId, roomCreated.roomId);
  assert.equal(offerForGuestA.fromParticipantId, roomCreated.participantId);
  assert.equal(offerForGuestA.sdp, "offer-sdp");
  assert.equal(guestB.popEvent(SERVER_EVENTS.signalOffer), undefined);

  guestA.trigger(CLIENT_EVENTS.signalAnswer, {
    roomId: roomCreated.roomId,
    toParticipantId: roomCreated.participantId,
    sdp: "answer-sdp"
  });

  const answerForHost = host.popEvent(SERVER_EVENTS.signalAnswer) as {
    roomId: string;
    fromParticipantId: string;
    sdp: string;
  };

  assert.ok(answerForHost);
  assert.equal(answerForHost.roomId, roomCreated.roomId);
  assert.equal(answerForHost.fromParticipantId, guestAJoined.participantId);
  assert.equal(answerForHost.sdp, "answer-sdp");
  assert.equal(guestB.popEvent(SERVER_EVENTS.signalAnswer), undefined);

  guestB.trigger(CLIENT_EVENTS.signalIce, {
    roomId: roomCreated.roomId,
    toParticipantId: roomCreated.participantId,
    candidate: { candidate: "ice-candidate", sdpMid: "0", sdpMLineIndex: 0 }
  });

  const iceForHost = host.popEvent(SERVER_EVENTS.signalIce) as {
    roomId: string;
    fromParticipantId: string;
    candidate: { candidate: string };
  };

  assert.ok(iceForHost);
  assert.equal(iceForHost.roomId, roomCreated.roomId);
  assert.equal(iceForHost.fromParticipantId, guestBJoined.participantId);
  assert.equal(iceForHost.candidate.candidate, "ice-candidate");
  assert.equal(guestA.popEvent(SERVER_EVENTS.signalIce), undefined);
});

test("T2.6-02: malformed signaling payloads are rejected with INVALID_SIGNAL_PAYLOAD envelope", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.signalOffer, {
    roomId: roomCreated.roomId,
    toParticipantId: guestJoined.participantId
  });
  const missingSdpError = popSocketError(host);
  assert.ok(missingSdpError);
  assert.equal(missingSdpError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(missingSdpError.message, "Invalid signaling payload");

  host.trigger(CLIENT_EVENTS.signalAnswer, {
    roomId: roomCreated.roomId,
    toParticipantId: guestJoined.participantId,
    sdp: "x".repeat((64 * 1024) + 1)
  });
  const oversizedSdpError = popSocketError(host);
  assert.ok(oversizedSdpError);
  assert.equal(oversizedSdpError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(oversizedSdpError.message, "Invalid signaling payload");

  host.trigger(CLIENT_EVENTS.signalIce, {
    roomId: roomCreated.roomId,
    toParticipantId: guestJoined.participantId,
    candidate: "x".repeat((16 * 1024) + 1)
  });
  const oversizedIceError = popSocketError(host);
  assert.ok(oversizedIceError);
  assert.equal(oversizedIceError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(oversizedIceError.message, "Invalid signaling payload");

  assert.equal(guest.popEvent(SERVER_EVENTS.signalOffer), undefined);
  assert.equal(guest.popEvent(SERVER_EVENTS.signalAnswer), undefined);
  assert.equal(guest.popEvent(SERVER_EVENTS.signalIce), undefined);
});

// ---- Lifecycle ----
test("T1.6-01: guest disconnect starts grace and removes guest only after guest-grace timeout", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };

    scheduledTimeouts.push({
      handle,
      delay: Number(delay ?? 0),
      callback: () => callback()
    });

    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const timeoutHandle = handle as unknown as { cleared?: boolean };
    if (timeoutHandle) {
      timeoutHandle.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    host.popEvent(SERVER_EVENTS.roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    guest.triggerDisconnect();

    const immediatePeerLeft = host.popEvent(SERVER_EVENTS.peerLeft);
    assert.equal(immediatePeerLeft, undefined, "Guest should remain during grace window");

    const snapshotDuringGrace = hooks.getStateSnapshot();
    assert.equal(snapshotDuringGrace.roomCount, 1);
    assert.equal(snapshotDuringGrace.rooms[0]?.participantCount, 2);

    const guestGraceTimer = scheduledTimeouts.find(
      (entry) => entry.delay === GUEST_DISCONNECT_GRACE_MS && !entry.handle.cleared
    );
    assert.ok(guestGraceTimer, "Expected guest grace timeout to be scheduled");
    guestGraceTimer?.callback();

    const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
      participantId: string;
      reason: string;
      participantCount: number;
    };

    assert.ok(peerLeft);
    assert.equal(peerLeft.reason, "disconnect");
    assert.equal(peerLeft.participantCount, 1);

    const snapshotAfterGrace = hooks.getStateSnapshot();
    assert.equal(snapshotAfterGrace.roomCount, 1);
    assert.equal(snapshotAfterGrace.rooms[0]?.participantCount, 1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T1.6-02: host disconnect enters grace flow and does not destroy room immediately", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.triggerDisconnect();

  const hostGrace = guest.popEvent("host_reconnect_grace") as { deadlineAt: number } | undefined;
  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);

  assert.ok(hostGrace);
  assert.equal(typeof hostGrace?.deadlineAt, "number");
  assert.equal(roomDestroyed, undefined);

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("T1.6-03: host resume_session before grace deadline restores host without room destruction", async () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    hostId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.triggerDisconnect();
  const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number } | undefined;
  assert.ok(hostGrace);
  assert.ok((hostGrace?.deadlineAt ?? 0) >= HOST_DISCONNECT_GRACE_MS);

  const resumedHost = io.connect("socket-host-resumed");
  resumedHost.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken
  });

  await flushPromises();

  const resumedRoomJoined = resumedHost.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    participantId: string;
    hostId: string;
    participantCount: number;
  };

  assert.ok(resumedRoomJoined, "Expected resumed host to receive room_joined");
  assert.equal(resumedRoomJoined.roomId, roomCreated.roomId);
  assert.equal(resumedRoomJoined.participantId, roomCreated.participantId);
  assert.equal(resumedRoomJoined.hostId, roomCreated.hostId);
  assert.equal(resumedRoomJoined.participantCount, 2);

  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  assert.equal(roomDestroyed, undefined, "Room must not be destroyed when host resumes before deadline");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("T1.6-04 (P3-SH-008): host grace timer expiry destroys room with host_grace_expired reason", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    host.popEvent(SERVER_EVENTS.roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    host.triggerDisconnect();
    const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number } | undefined;
    assert.ok(hostGrace, "host_reconnect_grace must be emitted to guest on host disconnect");

    const snapshotDuringGrace = hooks.getStateSnapshot();
    assert.equal(snapshotDuringGrace.roomCount, 1, "Room must remain alive during grace window");

    const graceTimer = scheduledTimeouts.find(
      (entry) => entry.delay === HOST_DISCONNECT_GRACE_MS && !entry.handle.cleared
    );
    assert.ok(graceTimer, "Host grace timer must be scheduled on host disconnect");
    graceTimer.callback();

    const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
    assert.ok(roomDestroyed, "Guest must receive room_destroyed when host grace timer fires");
    assert.equal(roomDestroyed?.reason, "host_grace_expired", "Destroy reason must be host_grace_expired");

    const snapshotAfterGrace = hooks.getStateSnapshot();
    assert.equal(snapshotAfterGrace.roomCount, 0, "Room must be removed after grace expiry");
    assert.equal(snapshotAfterGrace.participantToRoomCount, 0, "participantToRoom index must be fully cleared");
    assert.equal(snapshotAfterGrace.socketToParticipantCount, 0, "socketToParticipant index must be fully cleared");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T0.2-04: guest leave_room removes participant and emits peer_left", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "AbC123" });

  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft);
  assert.ok(peerLeft, "Expected peer_left after guest leave_room");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("T0.2-05: host leave_room destroys room immediately with host_left reason", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "AbC123" });

  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string };
  assert.ok(roomDestroyed, "Expected room_destroyed after host leave_room");
  assert.equal(roomDestroyed.reason, "host_left");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

// ---- Cleanup ----
test("P0-LV-005 edge: leave_room from socket with no room membership is a no-op", () => {
  const { io, hooks } = setupSocketHarness();
  const guest = io.connect("socket-guest");

  guest.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "MISSING" });

  const peerLeft = guest.popEvent(SERVER_EVENTS.peerLeft);
  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  const snapshot = hooks.getStateSnapshot();

  assert.equal(peerLeft, undefined);
  assert.equal(roomDestroyed, undefined);
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("P0-DC-006 edge: disconnect from socket with no room membership is a no-op", () => {
  const { io, hooks } = setupSocketHarness();
  const guest = io.connect("socket-guest");

  guest.triggerDisconnect();

  const peerLeft = guest.popEvent(SERVER_EVENTS.peerLeft);
  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  const snapshot = hooks.getStateSnapshot();

  assert.equal(peerLeft, undefined);
  assert.equal(roomDestroyed, undefined);
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("P0-RM-005 edge: second create_room resolves room-id collision via generator retry", () => {
  const roomIdFactory = createSequenceFactory(["AbC123", "AbC123", "ZxY987"], "ZxY987");
  const participantFactory = createSequenceFactory(["P-1", "P-2"], "P-X");
  const { io, hooks } = setupSocketHarness({
    generateRoomId: roomIdFactory,
    generateParticipantId: participantFactory
  });

  const hostA = io.connect("socket-host-a");
  const hostB = io.connect("socket-host-b");

  hostA.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host-A" });
  hostB.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host-B" });

  const createdA = hostA.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  const createdB = hostB.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  const snapshot = hooks.getStateSnapshot();

  assert.equal(createdA.roomId, "AbC123");
  assert.equal(createdB.roomId, "ZxY987");
  assert.equal(snapshot.roomCount, 2);
});

test("VP-1.2-AC2: repeated create/join/leave loops return room count to baseline", () => {
  let roomCounter = 0;
  let timeNow = 1000;
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const { io, hooks } = setupSocketHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
    now: () => timeNow
  });

  for (let index = 0; index < 20; index += 1) {
    // Advance clock past the create-rate-limit window so each iteration gets a fresh counter.
    timeNow += RATE_LIMIT_WINDOW_MS + 1;
    const host = io.connect(`socket-host-${index}`);
    const guest = io.connect(`socket-guest-${index}`);

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    guest.trigger(CLIENT_EVENTS.leaveRoom, { roomId: created.roomId });
    host.popEvent(SERVER_EVENTS.peerLeft);

    host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: created.roomId });
    guest.popEvent(SERVER_EVENTS.roomDestroyed);

    const snapshot = hooks.getStateSnapshot();
    assert.equal(snapshot.roomCount, 0);
    assert.equal(snapshot.participantToRoomCount, 0);
    assert.equal(snapshot.socketToParticipantCount, 0);
  }
});

// ---- Zero-Persistence ----
test("P0-RS-004: backend restart clears RAM-only room/session state", async () => {
  const port = 3017;
  const server1 = createVaporServer({
    port,
    generateRoomId: () => "RST001",
    generateParticipantId: () => "HOST01"
  });

  await server1.start();
  const health = await fetch(`http://localhost:${port}/health`);
  assert.equal(health.status, 200);

  server1.state.rooms.set("RST001", {
    roomId: "RST001",
    hostId: "HOST01",
    createdAt: Date.now(),
    nicknameToParticipant: new Map(),
    participants: new Map([
      [
        "HOST01",
        {
          participantId: "HOST01",
          socketId: "sock-host",
          joinedAt: Date.now(),
          lastSeenAt: Date.now()
        }
      ]
    ])
  });

  assert.equal(server1.testHooks.getStateSnapshot().roomCount, 1);
  await server1.stop();

  const server2 = createVaporServer({ port });
  await server2.start();
  assert.equal(server2.testHooks.getStateSnapshot().roomCount, 0);
  await server2.stop();
});

// ---- VP-2.3 Participant Cap ----
test("VP-2.3-01: 6th join attempt is rejected with ROOM_FULL error before room mutation", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // Participants 1-4 join successfully (cap is 5, host is #1)
  for (let guestNum = 1; guestNum <= 4; guestNum += 1) {
    const guest = io.connect(`socket-guest-${guestNum}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: `Guest-${guestNum}` });
    const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantCount: number };
    assert.ok(roomJoined, `Guest ${guestNum}: expected room_joined`);
    assert.equal(roomJoined.participantCount, 1 + guestNum, `Guest ${guestNum}: participant count should be ${1 + guestNum}`);
    host.popEvent(SERVER_EVENTS.peerJoined);
  }

  const snapshotAt5 = hooks.getStateSnapshot();
  assert.equal(snapshotAt5.roomCount, 1);
  assert.equal(snapshotAt5.rooms[0]?.participantCount, 5);

  // 6th join attempt is rejected with ROOM_FULL
  const guest6 = io.connect("socket-guest-6");
  guest6.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest-6" });
  const roomFullError = popSocketError(guest6);
  assert.ok(roomFullError, "Expected error on 6th join");
  assert.equal(roomFullError.code, "ROOM_FULL");
  assert.equal(roomFullError.message, "Room is full");

  // Room state must not have mutated
  const snapshotAfterRejection = hooks.getStateSnapshot();
  assert.equal(snapshotAfterRejection.roomCount, 1);
  assert.equal(snapshotAfterRejection.rooms[0]?.participantCount, 5, "Room must remain at 5 participants");

  // No peer_joined should have been emitted to other participants
  const hostPeerJoined = host.popEvent(SERVER_EVENTS.peerJoined);
  assert.equal(hostPeerJoined, undefined, "Host must not receive peer_joined for rejected 6th join");
});

test("VP-2.3-02: deterministic ROOM_FULL semantics from backend through FE contract", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // Fill room to capacity
  for (let guestNum = 1; guestNum <= 4; guestNum += 1) {
    const guest = io.connect(`socket-guest-full-${guestNum}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: `Guest-full-${guestNum}` });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);
  }

  // Multiple 6th+ join attempts must all get ROOM_FULL (deterministic)
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const extraGuest = io.connect(`socket-guest-extra-${attempt}`);
    extraGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: `Extra-${attempt}` });
    const error = popSocketError(extraGuest);
    assert.ok(error, `Attempt ${attempt}: expected ROOM_FULL`);
    assert.equal(error.code, "ROOM_FULL", `Attempt ${attempt}: expected deterministic ROOM_FULL code`);
    assert.equal(error.message, "Room is full", `Attempt ${attempt}: expected deterministic error message`);
  }
});

// ---- VP-2.2 Host Lifecycle Hardening ----
test("VP-2.2-01: resume token race conditions are deterministic with single winning path", async () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  // Create room and join
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host disconnects, entering grace
  host.triggerDisconnect();
  const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number };
  assert.ok(hostGrace);

  // Two resume attempts race: both before deadline, but only one should win
  const hostResumed1 = io.connect("socket-host-resumed-1");
  const hostResumed2 = io.connect("socket-host-resumed-2");

  // Both race simultaneously (same time)
  hostResumed1.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken
  });

  await flushPromises();

  const resumed1 = hostResumed1.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(resumed1, "First resume should succeed");

  // Second resume with same token should fail (token already consumed)
  hostResumed2.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken
  });

  await flushPromises();

  const resumed2Error = popSocketError(hostResumed2);
  assert.ok(resumed2Error, "Second resume race should fail");
  assert.equal(resumed2Error.code, "ROOM_NOT_FOUND", "Second resume must be rejected as deterministic losing path");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Only first resume winner should restore host");
});

test("VP-2.2-02: rapid disconnect and reconnect churn recovers without ghost state", async () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  let guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string; reconnectToken: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Track the current valid token; it rotates on every successful resume
  let currentGuestToken = guestJoined.reconnectToken;

  // Simulate 3+ rapid churn cycles: disconnect → reconnect
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    // Guest disconnects
    guest.triggerDisconnect();
    const hostGracePayload = host.popEvent(SERVER_EVENTS.hostReconnectGrace);
    assert.equal(hostGracePayload, undefined, "Guest disconnect should not trigger host grace");

    // Brief time advance
    timeNow += 5000;

    // Guest resumes before grace expires using the current token
    const guestResumed = io.connect(`socket-guest-resumed-${cycle}`);
    guestResumed.trigger(CLIENT_EVENTS.resumeSession, {
      roomId: roomCreated.roomId,
      reconnectToken: currentGuestToken
    });

    await flushPromises();

    const roomJoined = guestResumed.popEvent(SERVER_EVENTS.roomJoined) as {
      participantCount?: number;
      reconnectToken: string;
    };
    assert.ok(roomJoined, `Cycle ${cycle}: guest resume should succeed`);
    assert.equal(roomJoined.participantCount, 2, `Cycle ${cycle}: participant count must remain at 2 (host + guest)`);

    // Fresh token issued on resume; use it in the next cycle
    currentGuestToken = roomJoined.reconnectToken;
    guest = guestResumed;
  }

  // After 3 rapid cycles, state must be clean: no ghosts, no leaks
  const finalSnapshot = hooks.getStateSnapshot();
  assert.equal(finalSnapshot.roomCount, 1);
  assert.equal(finalSnapshot.rooms[0]?.participantCount, 2);
  assert.equal(finalSnapshot.participantToRoomCount, 2, "No ghost participant mappings");
  assert.equal(finalSnapshot.socketToParticipantCount, 2, "No ghost socket mappings");
});

// ---- T3.1 Security & Housekeeping ----

test("T3.1-01 (P3-SH-001): heartbeat refreshes participant lastSeenAt and does not persist state", () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };
  assert.ok(roomCreated);

  // Capture lastSeenAt at creation time (should equal now() = 1000)
  const recordBefore = hooks.getParticipantRecord(roomCreated.roomId, roomCreated.participantId);
  assert.ok(recordBefore, "Participant record must exist after create_room");
  const lastSeenBefore = recordBefore?.lastSeenAt ?? -1;
  assert.equal(lastSeenBefore, 1000, "lastSeenAt must be set to now() at creation");

  // Advance clock and send heartbeat
  timeNow = 5000;
  host.trigger("heartbeat", {});

  // Verify lastSeenAt was refreshed
  const recordAfter = hooks.getParticipantRecord(roomCreated.roomId, roomCreated.participantId);
  assert.equal(recordAfter?.lastSeenAt, 5000, "heartbeat must refresh lastSeenAt to the current now()");
  assert.ok((recordAfter?.lastSeenAt ?? 0) > lastSeenBefore, "lastSeenAt must strictly advance after heartbeat");

  // State remains RAM-only and structurally unchanged
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
  assert.equal(snapshot.participantToRoomCount, 1);
  assert.equal(snapshot.socketToParticipantCount, 1);
});

test("T3.1-02 (P3-SH-002): sweeper prunes expired rooms and stale indexes on trigger", () => {
  const originalSetInterval = globalThis.setInterval;
  let capturedSweep: (() => void) | null = null;

  // Intercept setInterval to capture the sweep callback registered by registerSocketHandlers
  (globalThis as unknown as { setInterval: (cb: () => void) => NodeJS.Timeout }).setInterval =
    (callback: () => void): NodeJS.Timeout => {
      capturedSweep = callback;
      // Return a fake handle with the unref method the handler calls
      return { unref: () => undefined } as unknown as NodeJS.Timeout;
    };

  try {
    let timeNow = 1000;
    const { io, hooks } = setupSocketHarness({ now: () => timeNow });

    assert.ok(capturedSweep, "registerSocketHandlers must register a sweep via setInterval");

    const host = io.connect("socket-host");
    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; expiresAt: number };
    assert.ok(roomCreated);

    const snapshotBefore = hooks.getStateSnapshot();
    assert.equal(snapshotBefore.roomCount, 1);
    assert.equal(snapshotBefore.participantToRoomCount, 1);

    // Advance time past room TTL so the sweeper detects expiry
    timeNow = roomCreated.expiresAt + 1;

    // Manually fire the sweep
    (capturedSweep as () => void)();

    // Sweeper must have destroyed the expired room and cleared all indexes
    const snapshotAfter = hooks.getStateSnapshot();
    assert.equal(snapshotAfter.roomCount, 0, "Sweeper must remove the expired room");
    assert.equal(snapshotAfter.participantToRoomCount, 0, "Sweeper must clear participantToRoom index");
    assert.equal(snapshotAfter.socketToParticipantCount, 0, "Sweeper must clear socketToParticipant index");
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test("T3.1-03 (P3-SH-003): reconnect token is invalidated after password change", async () => {
  let timeNow = 1000;
  const { io } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "original-pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    reconnectToken: string;
  };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "original-pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host updates password — increments auth.passwordVersion to 2
  host.trigger(CLIENT_EVENTS.roomPasswordUpdate, { roomId: roomCreated.roomId, newPassword: "new-pw" });
  await flushPromises();
  const passwordUpdated = host.popEvent(SERVER_EVENTS.roomPasswordUpdated);
  assert.ok(passwordUpdated, "Password update must be acknowledged");

  // Host disconnects — reconnect record is marked with the stale passwordVersion (1)
  host.triggerDisconnect();

  // Guest receives host_reconnect_grace to confirm grace window is open
  const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number } | undefined;
  assert.ok(hostGrace, "Grace window must be opened for host reconnect");

  // Attempt to resume with the pre-update reconnect token (v1 vs auth v2)
  timeNow += 1000; // still within grace window
  const hostResumed = io.connect("socket-host-resumed");
  hostResumed.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken
  });
  await flushPromises();

  assert.equal(
    hostResumed.popEvent(SERVER_EVENTS.roomJoined),
    undefined,
    "Resume must be rejected when the reconnect token passwordVersion is stale"
  );

  const resumeError = popSocketError(hostResumed);
  assert.ok(resumeError, "Error must be emitted for a stale reconnect token");
  // Implementation emits INVALID_PASSWORD when passwordVersion in the reconnect record
  // does not match the current auth.passwordVersion.
  assert.equal(resumeError.code, "INVALID_PASSWORD");
});

test("T3.1-04 (P3-SH-004): room destruction atomically purges timers, indexes, and reconnect records", async () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
    reconnectToken: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Guest disconnects — enters grace window; reconnect record is marked as disconnected
  guest.triggerDisconnect();

  // Host leaves — triggers synchronous, atomic room destruction
  host.trigger(CLIENT_EVENTS.leaveRoom, {});
  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  assert.ok(roomDestroyed, "room_destroyed must be emitted on host leave");

  // All state indexes must be empty after destruction
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0, "Room must be removed from state map");
  assert.equal(snapshot.participantToRoomCount, 0, "participantToRoom index must be fully cleared");
  assert.equal(snapshot.socketToParticipantCount, 0, "socketToParticipant index must be fully cleared");

  // Reconnect record for the disconnected guest must have been purged atomically —
  // resume must fail with ROOM_NOT_FOUND rather than finding a stale record.
  const guestResumed = io.connect("socket-guest-after-destroy");
  guestResumed.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: guestJoined.reconnectToken
  });
  await flushPromises();

  assert.equal(
    guestResumed.popEvent(SERVER_EVENTS.roomJoined),
    undefined,
    "Resume must fail after room destruction"
  );
  const resumeError = popSocketError(guestResumed);
  assert.ok(resumeError, "Error must be emitted when resuming into a destroyed room");
  assert.equal(resumeError.code, "ROOM_NOT_FOUND", "Destroyed room must return ROOM_NOT_FOUND on resume attempt");
});

test("T3.1-06 (P3-SH-006): resume_session returns ROOM_NOT_FOUND when grace deadline has elapsed", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  globalThis.setTimeout = ((_callback: (...args: unknown[]) => void, _delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    let timeNow = 1000;
    const { io } = setupSocketHarness({ now: () => timeNow });
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
      roomId: string;
      reconnectToken: string;
    };
    assert.ok(roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    // Host disconnects — reconnect record is stamped with validUntil = now() + HOST_DISCONNECT_GRACE_MS
    host.triggerDisconnect();
    const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number };
    assert.ok(hostGrace, "Grace window must open on host disconnect");

    // Advance clock past the grace deadline without firing the grace timer
    timeNow = hostGrace.deadlineAt + 1;

    // Resume attempt — reconnect record exists but validUntil has elapsed
    const hostLate = io.connect("socket-host-late");
    hostLate.trigger(CLIENT_EVENTS.resumeSession, {
      roomId: roomCreated.roomId,
      reconnectToken: roomCreated.reconnectToken
    });
    await flushPromises();

    assert.equal(
      hostLate.popEvent(SERVER_EVENTS.roomJoined),
      undefined,
      "Resume must be rejected when grace deadline has elapsed"
    );

    const resumeError = popSocketError(hostLate);
    assert.ok(resumeError, "Error must be emitted when resuming after grace deadline");
    assert.equal(resumeError.code, "ROOM_NOT_FOUND", "Elapsed grace window must return ROOM_NOT_FOUND");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T3.1-07 (P3-SH-007): solo-host timer handle is cleared when first guest joins the room", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest1 = io.connect("socket-guest-1");
    const guest2 = io.connect("socket-guest-2");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
      roomId: string;
      participantId: string;
      soloDeadlineAt: number | null;
    };
    assert.ok(roomCreated, "room_created must be emitted");
    assert.ok(
      typeof roomCreated.soloDeadlineAt === "number",
      "room_created must include a numeric soloDeadlineAt for a solo-host room"
    );

    // Capture the solo-host timer handle before any guest joins
    const soloTimer = scheduledTimeouts.find(
      (entry) => entry.delay === SOLO_HOST_ROOM_TIMEOUT_MS && !entry.handle.cleared
    );
    assert.ok(soloTimer, "Solo-host timer must be scheduled at room creation");

    // First guest joins — the solo timer must be cancelled
    guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
    const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
    assert.ok(guest1Joined, "First guest must receive room_joined");
    host.popEvent(SERVER_EVENTS.peerJoined);

    assert.equal(
      soloTimer.handle.cleared,
      true,
      "Solo-host timer handle must be marked cleared when the first guest joins"
    );

    // Room must remain intact — no spurious room_destroyed emitted
    assert.equal(
      host.popEvent(SERVER_EVENTS.roomDestroyed),
      undefined,
      "Host must not receive room_destroyed after first guest joins"
    );

    const snapshotAfterFirst = hooks.getStateSnapshot();
    assert.equal(snapshotAfterFirst.roomCount, 1, "Room must still exist after first guest joins");
    assert.equal(snapshotAfterFirst.rooms[0]?.participantCount, 2, "Room must have 2 participants");

    // Second guest joins — no new solo timer is scheduled (hasEverHadGuest gate)
    const timerCountBeforeSecondGuest = scheduledTimeouts.filter(
      (entry) => entry.delay === SOLO_HOST_ROOM_TIMEOUT_MS
    ).length;

    guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
    guest2.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    const timerCountAfterSecondGuest = scheduledTimeouts.filter(
      (entry) => entry.delay === SOLO_HOST_ROOM_TIMEOUT_MS
    ).length;

    assert.equal(
      timerCountAfterSecondGuest,
      timerCountBeforeSecondGuest,
      "No additional solo-host timer must be scheduled for subsequent guests"
    );

    const snapshotAfterSecond = hooks.getStateSnapshot();
    assert.equal(snapshotAfterSecond.roomCount, 1);
    assert.equal(snapshotAfterSecond.rooms[0]?.participantCount, 3);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T3.1-08 (P3-SH-008): host grace timer fires and destroys room with host_grace_expired; post-expiry resume returns ROOM_NOT_FOUND", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
      roomId: string;
      participantId: string;
      reconnectToken: string;
    };
    assert.ok(roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    // Host disconnects — grace window opens
    host.triggerDisconnect();
    const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number } | undefined;
    assert.ok(hostGrace, "host_reconnect_grace must be emitted to guest on host disconnect");

    const snapshotDuringGrace = hooks.getStateSnapshot();
    assert.equal(snapshotDuringGrace.roomCount, 1, "Room must remain alive during grace window");

    // Locate and fire the host grace timer
    const graceTimer = scheduledTimeouts.find(
      (entry) => entry.delay === HOST_DISCONNECT_GRACE_MS && !entry.handle.cleared
    );
    assert.ok(graceTimer, "Host grace timer must be scheduled on host disconnect");
    graceTimer.callback();

    // Guest must receive room_destroyed with host_grace_expired reason
    const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
    assert.ok(roomDestroyed, "Guest must receive room_destroyed when host grace timer fires");
    assert.equal(roomDestroyed?.reason, "host_grace_expired", "Destroy reason must be host_grace_expired");

    // All state indexes must be cleared atomically after grace expiry
    const snapshotAfterGrace = hooks.getStateSnapshot();
    assert.equal(snapshotAfterGrace.roomCount, 0, "Room must be removed after grace expiry");
    assert.equal(snapshotAfterGrace.participantToRoomCount, 0, "participantToRoom index must be fully cleared");
    assert.equal(snapshotAfterGrace.socketToParticipantCount, 0, "socketToParticipant index must be fully cleared");

    // Post-expiry resume attempt must return ROOM_NOT_FOUND — reconnect record is purged with the room
    const hostLate = io.connect("socket-host-late");
    hostLate.trigger(CLIENT_EVENTS.resumeSession, {
      roomId: roomCreated.roomId,
      reconnectToken: roomCreated.reconnectToken
    });
    await flushPromises();

    assert.equal(
      hostLate.popEvent(SERVER_EVENTS.roomJoined),
      undefined,
      "Post-grace resume must be rejected"
    );

    const lateResumeError = popSocketError(hostLate);
    assert.ok(lateResumeError, "Error must be emitted for post-grace resume attempt");
    assert.equal(lateResumeError.code, "ROOM_NOT_FOUND", "Purged reconnect record must yield ROOM_NOT_FOUND on late resume");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

// ---- T3.2 User Identity & UX ----

test("T3.2-01 (P3-NK-001): create_room and join_room reject missing or blank nicknames", () => {
  const { io, hooks } = setupSocketHarness();

  // create_room: missing nickname
  const host1 = io.connect("socket-host-1");
  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  const createMissingError = popSocketError(host1);
  assert.ok(createMissingError, "create_room without nickname must emit an error");
  assert.equal(createMissingError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(createMissingError.message, "Invalid signaling payload");

  let snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0, "No room must be created for missing nickname");
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);

  // create_room: whitespace-only nickname
  const host2 = io.connect("socket-host-2");
  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "   " });
  const createBlankError = popSocketError(host2);
  assert.ok(createBlankError, "create_room with blank nickname must emit an error");
  assert.equal(createBlankError.code, "INVALID_SIGNAL_PAYLOAD");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0, "No room must be created for blank nickname");

  // setup a valid room for join tests
  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);

  // join_room: missing nickname
  const guest1 = io.connect("socket-guest-1");
  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw" });
  const joinMissingError = popSocketError(guest1);
  assert.ok(joinMissingError, "join_room without nickname must emit an error");
  assert.equal(joinMissingError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(joinMissingError.message, "Invalid signaling payload");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1, "Room must still exist after rejected join");
  assert.equal(snapshot.rooms[0]?.participantCount, 1, "Room must still have only the host");

  // join_room: whitespace-only nickname
  const guest2 = io.connect("socket-guest-2");
  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "   " });
  const joinBlankError = popSocketError(guest2);
  assert.ok(joinBlankError, "join_room with blank nickname must emit an error");
  assert.equal(joinBlankError.code, "INVALID_SIGNAL_PAYLOAD");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 1, "Room must still have only the host after blank-nickname join");
  assert.equal(snapshot.participantToRoomCount, 1, "participantToRoom index must not gain ghost entries");
  assert.equal(snapshot.socketToParticipantCount, 1, "socketToParticipant index must not gain ghost entries");

  assert.equal(host.popEvent(SERVER_EVENTS.peerJoined), undefined, "No peer_joined must reach host for rejected joins");
});

test("T3.2-02 (P3-NK-002): room-scoped nickname collisions are rejected atomically", async () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Part 1: exact-case join_room collision with the host's reserved nickname
  const intruder1 = io.connect("socket-intruder-1");
  intruder1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Alice" });
  const exactCollisionError = popSocketError(intruder1);
  assert.ok(exactCollisionError, "join_room with a taken nickname must emit an error");
  assert.equal(exactCollisionError.code, "INVALID_SIGNAL_PAYLOAD");
  assert.equal(exactCollisionError.message, "Invalid signaling payload");

  let snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Room must remain at 2 participants after exact collision");
  assert.equal(snapshot.participantToRoomCount, 2, "No ghost participantToRoom entries after exact collision");
  assert.equal(snapshot.socketToParticipantCount, 2, "No ghost socketToParticipant entries after exact collision");
  assert.equal(host.popEvent(SERVER_EVENTS.peerJoined), undefined, "No peer_joined must be emitted for rejected join");

  // Part 2: case-insensitive join_room collision ("alice" collides with reserved "Alice")
  const intruder2 = io.connect("socket-intruder-2");
  intruder2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "alice" });
  const caseCollisionError = popSocketError(intruder2);
  assert.ok(caseCollisionError, "Case-insensitive nickname collision must emit an error");
  assert.equal(caseCollisionError.code, "INVALID_SIGNAL_PAYLOAD");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Room must remain at 2 participants after case-insensitive collision");
  assert.equal(snapshot.participantToRoomCount, 2, "No ghost entries after case-insensitive collision");
  assert.equal(host.popEvent(SERVER_EVENTS.peerJoined), undefined, "No peer_joined must be emitted for case-insensitive rejected join");

  // Part 3: nicknameUpdate collision — guest tries to claim "Alice" (already held by host)
  // Advance clock past the 1-hour change cooldown so the uniqueness guard is reached
  timeNow += NICKNAME_CHANGE_COOLDOWN_MS + 1;

  guest.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "Alice" });
  await flushPromises();

  const updateCollisionError = popSocketError(guest);
  assert.ok(updateCollisionError, "nicknameUpdate to a taken nickname must emit an error");
  assert.equal(updateCollisionError.code, "INVALID_SIGNAL_PAYLOAD");

  // Guest's original nickname must be unchanged
  const guestRecord = hooks.getParticipantRecord(roomCreated.roomId, guestJoined.participantId);
  assert.equal(guestRecord?.nickname, "Bob", "Guest nickname must remain 'Bob' after failed update");

  // No nicknameUpdated event must have been broadcast to any participant
  assert.equal(host.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No nickname_updated must reach host on collision");
  assert.equal(guest.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No nickname_updated must reach requester on collision");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Room must remain unchanged after failed nicknameUpdate");
});

test("T3.2-03 (P3-NK-003): nickname cooldown rejects rapid changes and allows update after cooldown expires", async () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Rapid change (within cooldown window) — must be rejected
  host.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "AliceNew" });
  await flushPromises();

  const cooldownError = popSocketError(host);
  assert.ok(cooldownError, "Rapid nickname change must emit an error");
  assert.equal(cooldownError.code, "RATE_LIMITED", "Rapid change must return RATE_LIMITED");

  // Nickname must not have changed
  const hostRecordAfterRejection = hooks.getParticipantRecord(roomCreated.roomId, roomCreated.participantId);
  assert.equal(hostRecordAfterRejection?.nickname, "Alice", "Nickname must remain 'Alice' after rejected change");

  // No broadcast must have reached any participant
  assert.equal(guest.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No nickname_updated must be broadcast for rejected change");
  assert.equal(host.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No nickname_updated must be emitted to requester for rejected change");

  // Advance clock past cooldown
  timeNow += NICKNAME_CHANGE_COOLDOWN_MS + 1;

  // Change is now permitted
  host.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "AliceNew" });
  await flushPromises();

  assert.equal(popSocketError(host), undefined, "Nickname change after cooldown must not emit an error");

  const hostNicknameUpdated = host.popEvent(SERVER_EVENTS.nicknameUpdated) as { participantId: string; nickname: string } | undefined;
  const guestNicknameUpdated = guest.popEvent(SERVER_EVENTS.nicknameUpdated) as { participantId: string; nickname: string } | undefined;
  assert.ok(hostNicknameUpdated, "Host must receive nickname_updated after successful change");
  assert.ok(guestNicknameUpdated, "Guest must receive nickname_updated after successful change");
  assert.equal(hostNicknameUpdated.participantId, roomCreated.participantId);
  assert.equal(hostNicknameUpdated.nickname, "AliceNew");
  assert.equal(guestNicknameUpdated.participantId, roomCreated.participantId);
  assert.equal(guestNicknameUpdated.nickname, "AliceNew");

  const hostRecordAfterUpdate = hooks.getParticipantRecord(roomCreated.roomId, roomCreated.participantId);
  assert.equal(hostRecordAfterUpdate?.nickname, "AliceNew", "Participant record must reflect new nickname");

  // Cooldown resets after a successful change — immediate re-change must be rejected
  host.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "AliceFinal" });
  await flushPromises();

  const secondCooldownError = popSocketError(host);
  assert.ok(secondCooldownError, "Immediate re-change after successful update must emit an error");
  assert.equal(secondCooldownError.code, "RATE_LIMITED", "Cooldown must reset after each successful update");
  assert.equal(guest.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No broadcast for rejected re-change");

  // Guest's nickname must remain unaffected throughout
  const guestRecord = hooks.getParticipantRecord(roomCreated.roomId, guestJoined.participantId);
  assert.equal(guestRecord?.nickname, "Bob", "Guest nickname must remain unchanged");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

// ---- T3.3 Ops, Abuse Controls & Tests ----

test("T3.3-03 (P3-AB-003): create-room burst handling returns deterministic RATE_LIMITED on threshold breach", () => {
  // CREATE_ROOM_BURST_THRESHOLD = 5: 5 creates within the window are allowed; the 6th triggers a block
  const CREATE_ROOM_BURST_THRESHOLD = 5;
  const CREATE_ROOM_BLOCK_DURATION_MS = 10 * 60 * 1000;

  let roomCounter = 0;
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({
    now: () => timeNow,
    generateRoomId: () => {
      roomCounter += 1;
      return `BURST-${roomCounter}`;
    }
  });

  // Attempts 1-5 succeed — all within the same time window
  for (let attempt = 1; attempt <= CREATE_ROOM_BURST_THRESHOLD; attempt += 1) {
    const socket = io.connect(`socket-burst-${attempt}`);
    socket.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: `Host-${attempt}` });
    const created = socket.popEvent(SERVER_EVENTS.roomCreated);
    assert.ok(created, `Attempt ${attempt}: expected room_created below burst threshold`);
    assert.equal(popSocketError(socket), undefined, `Attempt ${attempt}: must not return error below threshold`);
  }

  // 6th attempt exceeds threshold → blocklist entry set, RATE_LIMITED returned, no room created
  const socket6 = io.connect("socket-burst-6");
  socket6.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host-6" });
  const burstError = popSocketError(socket6);
  assert.ok(burstError, "6th create_room within window must return an error");
  assert.equal(burstError.code, "RATE_LIMITED", "Burst threshold breach must return deterministic RATE_LIMITED");
  assert.equal(socket6.popEvent(SERVER_EVENTS.roomCreated), undefined, "No room must be created on blocked attempt");

  // Subsequent attempts while block is active also return RATE_LIMITED (blocklist is RAM-only)
  const socket7 = io.connect("socket-burst-7");
  socket7.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host-7" });
  const inBlockError = popSocketError(socket7);
  assert.ok(inBlockError, "Attempt during active block must return an error");
  assert.equal(inBlockError.code, "RATE_LIMITED", "All attempts during active block must return RATE_LIMITED");
  assert.equal(socket7.popEvent(SERVER_EVENTS.roomCreated), undefined, "No room must be created during active block");

  // After block duration expires creates succeed again
  timeNow += CREATE_ROOM_BLOCK_DURATION_MS + 1;
  const socketAfterBlock = io.connect("socket-burst-after");
  socketAfterBlock.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host-After" });
  const createdAfterBlock = socketAfterBlock.popEvent(SERVER_EVENTS.roomCreated);
  assert.ok(createdAfterBlock, "Create room must succeed after block duration expires");
  assert.equal(popSocketError(socketAfterBlock), undefined, "No error after block expires");

  // The 5 rooms created before the burst block are still present
  const snapshot = hooks.getStateSnapshot();
  assert.ok(snapshot.roomCount >= CREATE_ROOM_BURST_THRESHOLD, "Rooms created before burst block must still be present");
});

test("P3-LC-001 (BL-SESSION-04): solo-host room is destroyed with solo_timeout_expired when host remains alone past deadline", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host-solo");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "SoloHost" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
      roomId: string;
      soloDeadlineAt: number | null;
    };
    assert.ok(roomCreated, "room_created must be emitted");
    assert.ok(
      typeof roomCreated.soloDeadlineAt === "number",
      "room_created must include soloDeadlineAt for a solo host room"
    );

    // No guest joins — host remains the only participant
    const snapshotBefore = hooks.getStateSnapshot();
    assert.equal(snapshotBefore.roomCount, 1);
    assert.equal(snapshotBefore.rooms[0]?.participantCount, 1);

    // Find the solo-host timer and fire it — only the uncleared one with the correct delay
    const soloTimer = scheduledTimeouts.find(
      (entry) => entry.delay === SOLO_HOST_ROOM_TIMEOUT_MS && !entry.handle.cleared
    );
    assert.ok(soloTimer, "Solo-host timeout must be scheduled on room creation");
    soloTimer.callback();

    // Host must receive room_destroyed with solo_timeout_expired reason
    const roomDestroyed = host.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
    assert.ok(roomDestroyed, "Host must receive room_destroyed after solo timeout fires");
    assert.equal(roomDestroyed?.reason, "solo_timeout_expired", "Destroy reason must be solo_timeout_expired");

    // All state indexes must be fully cleared after solo timeout destruction
    const snapshotAfter = hooks.getStateSnapshot();
    assert.equal(snapshotAfter.roomCount, 0, "Room must be removed from state after solo timeout");
    assert.equal(snapshotAfter.participantToRoomCount, 0, "participantToRoom index must be cleared");
    assert.equal(snapshotAfter.socketToParticipantCount, 0, "socketToParticipant index must be cleared");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("P3-LC-002 (P3-SH-007): solo-host timer handle is cleared when first guest joins the room", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) {
      h.cleared = true;
    }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
      roomId: string;
      soloDeadlineAt: number | null;
    };
    assert.ok(roomCreated);
    assert.ok(typeof roomCreated.soloDeadlineAt === "number", "Solo host deadline must be set on creation");

    // Capture the solo timer handle before the guest joins
    const soloTimer = scheduledTimeouts.find(
      (entry) => entry.delay === SOLO_HOST_ROOM_TIMEOUT_MS && !entry.handle.cleared
    );
    assert.ok(soloTimer, "Solo-host timer must be scheduled on room creation");

    // Guest joins — solo timer must be cancelled
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    // The solo timer handle must now be marked cleared
    assert.equal(
      soloTimer.handle.cleared,
      true,
      "Solo-host timer must be cleared when a guest joins"
    );

    // Room must remain intact with both participants
    const snapshot = hooks.getStateSnapshot();
    assert.equal(snapshot.roomCount, 1);
    assert.equal(snapshot.rooms[0]?.participantCount, 2);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T3.2-04 (P3-NK-004): nickname update broadcasts to all room participants including the requester", async () => {
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };
  assert.ok(roomCreated);

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Carol" });
  const guest2Joined = guest2.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);
  guest1.popEvent(SERVER_EVENTS.peerJoined);

  // Advance past cooldown so Guest1 is allowed to change nickname
  timeNow += NICKNAME_CHANGE_COOLDOWN_MS + 1;

  guest1.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "BobNew" });
  await flushPromises();

  assert.equal(popSocketError(guest1), undefined, "No error must be emitted for a valid nickname update");

  // All three participants must receive nickname_updated
  const hostReceived = host.popEvent(SERVER_EVENTS.nicknameUpdated) as { participantId: string; nickname: string } | undefined;
  const guest1Received = guest1.popEvent(SERVER_EVENTS.nicknameUpdated) as { participantId: string; nickname: string } | undefined;
  const guest2Received = guest2.popEvent(SERVER_EVENTS.nicknameUpdated) as { participantId: string; nickname: string } | undefined;

  assert.ok(hostReceived, "Host must receive nickname_updated broadcast");
  assert.equal(hostReceived.participantId, guest1Joined.participantId, "Broadcast participantId must identify the requester");
  assert.equal(hostReceived.nickname, "BobNew");

  assert.ok(guest1Received, "Requester (Guest1) must also receive their own nickname_updated broadcast");
  assert.equal(guest1Received.participantId, guest1Joined.participantId);
  assert.equal(guest1Received.nickname, "BobNew");

  assert.ok(guest2Received, "Guest2 must receive nickname_updated broadcast");
  assert.equal(guest2Received.participantId, guest1Joined.participantId);
  assert.equal(guest2Received.nickname, "BobNew");

  // Participant record must reflect the new nickname
  const guest1Record = hooks.getParticipantRecord(roomCreated.roomId, guest1Joined.participantId);
  assert.equal(guest1Record?.nickname, "BobNew", "Participant record must be updated after broadcast");

  // No duplicate events
  assert.equal(host.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No duplicate nickname_updated for host");
  assert.equal(guest2.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No duplicate nickname_updated for Guest2");

  // Room state must be otherwise unchanged
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 3);

  // Host and Guest2 nicknames must be unaffected
  const hostRecord = hooks.getParticipantRecord(roomCreated.roomId, roomCreated.participantId);
  const guest2Record = hooks.getParticipantRecord(roomCreated.roomId, guest2Joined.participantId);
  assert.equal(hostRecord?.nickname, "Alice", "Host nickname must remain unchanged");
  assert.equal(guest2Record?.nickname, "Carol", "Guest2 nickname must remain unchanged");
});

// ---- T3.1 Security & Housekeeping (additions) ----

test("T3.1-09 (P3-SH-009): resume_session returns ROOM_NOT_FOUND when participant token is valid but participant has not disconnected", async () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    reconnectToken: string;
  };
  assert.ok(roomCreated);

  // Host is still connected — do not trigger disconnect.
  // A second socket attempts to resume using the valid, unexpired token.
  const intruder = io.connect("socket-intruder");
  intruder.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken,
  });
  await flushPromises();

  assert.equal(
    intruder.popEvent(SERVER_EVENTS.roomJoined),
    undefined,
    "Resume must be rejected when participant has not disconnected"
  );
  const resumeError = popSocketError(intruder);
  assert.ok(resumeError, "Error must be emitted for a non-disconnected token");
  assert.equal(resumeError.code, "ROOM_NOT_FOUND", "Active-session resume attempt must return ROOM_NOT_FOUND");
});

test("T3.1-10 (P3-SH-010): room_password_update by a non-host guest returns ROOM_NOT_FOUND and leaves password unchanged", async () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "original-pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "original-pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Guest attempts to change the password — must be rejected
  guest.trigger(CLIENT_EVENTS.roomPasswordUpdate, { roomId: roomCreated.roomId, newPassword: "hacked-pw" });
  await flushPromises();

  const guestError = popSocketError(guest);
  assert.ok(guestError, "Non-host must receive an error for password update attempt");
  assert.equal(guestError.code, "ROOM_NOT_FOUND", "Non-host password update must return ROOM_NOT_FOUND");

  // No broadcast must have been emitted
  assert.equal(host.popEvent(SERVER_EVENTS.roomPasswordUpdated), undefined, "No room_password_updated must be broadcast for a non-host attempt");
  assert.equal(guest.popEvent(SERVER_EVENTS.roomPasswordUpdated), undefined);

  // Password must be unchanged — a new guest should still join with the original password
  const guest2 = io.connect("socket-guest-2");
  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "original-pw", nickname: "Guest2" });
  const guest2Joined = guest2.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(guest2Joined, "Original password must still be valid after rejected non-host update");
  assert.equal(popSocketError(guest2), undefined);
});

test("T3.1-11 (P3-SH-011): resume_session with null, undefined, empty, or whitespace-only reconnectToken returns ROOM_NOT_FOUND", async () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  const malformedTokens: Array<{ label: string; value: unknown }> = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "empty string", value: "" },
    { label: "whitespace-only", value: "   " },
  ];

  for (const { label, value } of malformedTokens) {
    const resumeSocket = io.connect(`socket-resume-${label.replace(/\s/g, "-")}`);
    resumeSocket.trigger(CLIENT_EVENTS.resumeSession, {
      roomId: roomCreated.roomId,
      reconnectToken: value,
    });
    await flushPromises();

    assert.equal(
      resumeSocket.popEvent(SERVER_EVENTS.roomJoined),
      undefined,
      `Resume must be rejected for malformed token: ${label}`
    );
    const resumeError = popSocketError(resumeSocket);
    assert.ok(resumeError, `Error must be emitted for malformed token: ${label}`);
    assert.equal(resumeError.code, "ROOM_NOT_FOUND", `Malformed token (${label}) must return ROOM_NOT_FOUND`);
  }
});

test("T3.1-12 (P3-SH-012): sweeper prunes orphaned participantToRoom and socketToParticipant entries with no matching room or participant", () => {
  const originalSetInterval = globalThis.setInterval;
  let capturedSweep: (() => void) | null = null;

  (globalThis as unknown as { setInterval: (cb: () => void) => NodeJS.Timeout }).setInterval =
    (callback: () => void): NodeJS.Timeout => {
      capturedSweep = callback;
      return { unref: () => undefined } as unknown as NodeJS.Timeout;
    };

  try {
    const { state, hooks } = setupSocketHarness();
    assert.ok(capturedSweep, "Sweeper must be registered via setInterval");

    // Inject a stale participantToRoom entry pointing to a non-existent room
    state.participantToRoom.set("orphan-participant-1", "ghost-room");
    // Inject a stale socketToParticipant entry whose participant has no participantToRoom entry
    state.socketToParticipant.set("orphan-socket-1", "orphan-participant-2");

    const snapshotBefore = hooks.getStateSnapshot();
    assert.equal(snapshotBefore.participantToRoomCount, 1, "Stale participantToRoom entry must be visible before sweep");
    assert.equal(snapshotBefore.socketToParticipantCount, 1, "Stale socketToParticipant entry must be visible before sweep");

    (capturedSweep as () => void)();

    const snapshotAfter = hooks.getStateSnapshot();
    assert.equal(snapshotAfter.participantToRoomCount, 0, "Sweeper must prune the orphaned participantToRoom entry");
    assert.equal(snapshotAfter.socketToParticipantCount, 0, "Sweeper must prune the orphaned socketToParticipant entry");
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

// ---- T3.2 User Identity & UX (additions) ----

test("T3.2-06 (P3-NK-006): nicknameUpdate rejects missing and blank nicknames with INVALID_SIGNAL_PAYLOAD", async () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Missing nickname field — validation fires before cooldown is checked
  guest.trigger(CLIENT_EVENTS.nicknameUpdate, {});
  await flushPromises();

  const missingError = popSocketError(guest);
  assert.ok(missingError, "nicknameUpdate with missing nickname must emit an error");
  assert.equal(missingError.code, "INVALID_SIGNAL_PAYLOAD");

  const recordAfterMissing = hooks.getParticipantRecord(roomCreated.roomId, guestJoined.participantId);
  assert.equal(recordAfterMissing?.nickname, "Bob", "Nickname must remain 'Bob' after missing-nickname update");
  assert.equal(host.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No broadcast for missing-nickname update");

  // Whitespace-only nickname — also fails normalizeNickname (length < 3 after trim)
  guest.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "   " });
  await flushPromises();

  const blankError = popSocketError(guest);
  assert.ok(blankError, "nicknameUpdate with blank nickname must emit an error");
  assert.equal(blankError.code, "INVALID_SIGNAL_PAYLOAD");

  const recordAfterBlank = hooks.getParticipantRecord(roomCreated.roomId, guestJoined.participantId);
  assert.equal(recordAfterBlank?.nickname, "Bob", "Nickname must remain 'Bob' after blank-nickname update");
  assert.equal(host.popEvent(SERVER_EVENTS.nicknameUpdated), undefined, "No broadcast for blank-nickname update");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("T3.2-07 (P3-NK-007): guest nickname is freed from nicknameToParticipant when grace timer fires, allowing a new participant to join with the same nickname", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const scheduledTimeouts: Array<{
    handle: { cleared: boolean; unref?: () => void };
    delay: number;
    callback: () => void;
  }> = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = {
      cleared: false,
      unref: () => undefined
    };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) { h.cleared = true; }
  }) as typeof clearTimeout;

  try {
    const { io, hooks } = setupSocketHarness();
    const host = io.connect("socket-host");
    const guest = io.connect("socket-guest");

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
    assert.ok(roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Alice" });
    guest.popEvent(SERVER_EVENTS.roomJoined);
    host.popEvent(SERVER_EVENTS.peerJoined);

    // Guest disconnects — grace timer is scheduled
    guest.triggerDisconnect();

    const graceTimer = scheduledTimeouts.find(
      (entry) => entry.delay === GUEST_DISCONNECT_GRACE_MS && !entry.handle.cleared
    );
    assert.ok(graceTimer, "Guest grace timer must be scheduled on guest disconnect");

    // Fire the grace timer — participant is removed, nickname must be freed
    graceTimer.callback();

    const snapshotAfterGrace = hooks.getStateSnapshot();
    assert.equal(snapshotAfterGrace.rooms[0]?.participantCount, 1, "Room must have only the host after grace expiry");

    // A new participant with the same nickname 'Alice' must now be allowed to join
    const newGuest = io.connect("socket-new-guest");
    newGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Alice" });
    const newGuestJoined = newGuest.popEvent(SERVER_EVENTS.roomJoined);
    assert.ok(newGuestJoined, "A new participant must be allowed to join with the nickname freed by grace expiry");
    assert.equal(popSocketError(newGuest), undefined, "No error must be emitted for a nickname that was freed on grace expiry");

    const finalSnapshot = hooks.getStateSnapshot();
    assert.equal(finalSnapshot.rooms[0]?.participantCount, 2, "Room must have host and new guest after successful rejoin");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("T3.2-08 (P3-NK-008): nickname length boundaries — 2-char rejected, 3-char accepted, 24-char accepted, 25-char rejected", () => {
  let roomCounter = 0;
  const { io, hooks } = setupSocketHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-LEN-${roomCounter}`;
    }
  });

  // 2-char nickname: must be rejected (below minimum of 3)
  const socket2 = io.connect("socket-2char");
  socket2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Ab" });
  const twoCharError = popSocketError(socket2);
  assert.ok(twoCharError, "2-char nickname must be rejected");
  assert.equal(twoCharError.code, "INVALID_SIGNAL_PAYLOAD", "2-char nickname must return INVALID_SIGNAL_PAYLOAD");
  assert.equal(socket2.popEvent(SERVER_EVENTS.roomCreated), undefined, "No room must be created for 2-char nickname");

  let snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);

  // 3-char nickname: must be accepted (at minimum boundary)
  const socket3 = io.connect("socket-3char");
  socket3.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Abc" });
  const threeCharCreated = socket3.popEvent(SERVER_EVENTS.roomCreated);
  assert.ok(threeCharCreated, "3-char nickname must be accepted (at minimum boundary)");
  assert.equal(popSocketError(socket3), undefined);

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);

  // 24-char nickname: must be accepted (at maximum boundary)
  const socket24 = io.connect("socket-24char");
  socket24.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "A".repeat(24) });
  const twentyFourCharCreated = socket24.popEvent(SERVER_EVENTS.roomCreated);
  assert.ok(twentyFourCharCreated, "24-char nickname must be accepted (at maximum boundary)");
  assert.equal(popSocketError(socket24), undefined);

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 2);

  // 25-char nickname: must be rejected (above maximum of 24)
  const socket25 = io.connect("socket-25char");
  socket25.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "A".repeat(25) });
  const twentyFiveCharError = popSocketError(socket25);
  assert.ok(twentyFiveCharError, "25-char nickname must be rejected");
  assert.equal(twentyFiveCharError.code, "INVALID_SIGNAL_PAYLOAD", "25-char nickname must return INVALID_SIGNAL_PAYLOAD");
  assert.equal(socket25.popEvent(SERVER_EVENTS.roomCreated), undefined, "No room must be created for 25-char nickname");

  snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 2, "Room count must remain at 2 after rejected 25-char nickname");
});

test("T3.2-09 (P3-NK-009): nicknames with disallowed characters are rejected with INVALID_SIGNAL_PAYLOAD", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host-char");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "ValidHost" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  const disallowedNicknames: Array<{ nickname: string; label: string }> = [
    { nickname: "Host@123", label: "@ character" },
    { nickname: "Bob#Tag",  label: "# character" },
    { nickname: "Alice!",   label: "! character" },
    { nickname: "Name X", label: "null control character (\\u0000)" },
    { nickname: "A​Name", label: "zero-width space (\\u200B, category Cf)" },
    { nickname: "Cool😀", label: "emoji (not in [\\p{L}\\p{N} _-])" },
  ];

  for (let i = 0; i < disallowedNicknames.length; i += 1) {
    const { nickname, label } = disallowedNicknames[i]!;
    const socket = io.connect(`socket-disallowed-${i}`);
    socket.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname });
    const errorPayload = popSocketError(socket);
    assert.ok(errorPayload, `Nickname with ${label} must be rejected`);
    assert.equal(
      errorPayload.code,
      "INVALID_SIGNAL_PAYLOAD",
      `Nickname with ${label} must return INVALID_SIGNAL_PAYLOAD`
    );
    assert.equal(
      host.popEvent(SERVER_EVENTS.peerJoined),
      undefined,
      `No peer_joined must be emitted for disallowed nickname (${label})`
    );
  }

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 1, "Room must still have only the host after all rejected joins");
});

// ---- T3.3 Ops, Abuse Controls & Tests (additions) ----

test("T3.3-06 (P3-AB-006): IP-level create rate limit blocks requests after IP_CREATE_THRESHOLD within the abuse window", () => {
  // IP_CREATE_THRESHOLD = 10: 10 creates from the same IP are allowed; the 11th is blocked.
  // Each socket uses a unique fingerprint so the per-subject burst window (threshold 5) never fires.
  const IP_CREATE_THRESHOLD = 10;
  let roomCounter = 0;
  const { io, hooks } = setupSocketHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `IP-ROOM-${roomCounter}`;
    }
  });

  for (let attempt = 1; attempt <= IP_CREATE_THRESHOLD; attempt += 1) {
    const socket = io.connect(`socket-ip-create-${attempt}`, {
      address: "192.0.2.1",
      fingerprint: `fp-${attempt}`
    });
    socket.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: `Host-${attempt}` });
    const created = socket.popEvent(SERVER_EVENTS.roomCreated);
    assert.ok(created, `Attempt ${attempt}: must succeed before IP threshold`);
    assert.equal(popSocketError(socket), undefined, `Attempt ${attempt}: must not return error below threshold`);
  }

  // 11th attempt from the same IP exceeds IP_CREATE_THRESHOLD → RATE_LIMITED
  const blockedSocket = io.connect("socket-ip-create-blocked", {
    address: "192.0.2.1",
    fingerprint: "fp-blocked"
  });
  blockedSocket.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Blocked" });
  const blockedError = popSocketError(blockedSocket);
  assert.ok(blockedError, "11th create from same IP must be blocked");
  assert.equal(blockedError.code, "RATE_LIMITED", "IP threshold breach must return RATE_LIMITED");
  assert.equal(blockedSocket.popEvent(SERVER_EVENTS.roomCreated), undefined, "No room must be created on IP-blocked attempt");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, IP_CREATE_THRESHOLD, "Only the first 10 rooms must have been created");
});

test("T3.3-07 (P3-AB-007): join-attempt cooldown state is purged when a room is destroyed so a recycled room ID does not inherit a stale cooldown", () => {
  // Both creations use the same room ID so the stale joinAttemptByRoomSubject key is observable.
  const roomIdFactory = createSequenceFactory(["LOCK-RECYCLE", "LOCK-RECYCLE"], "LOCK-X");
  let timeNow = 1000;
  const { io, hooks } = setupSocketHarness({
    generateRoomId: roomIdFactory,
    now: () => timeNow
  });

  // Create the first room and accumulate invalid join attempts to set an active cooldown.
  const hostA = io.connect("socket-host-a");
  hostA.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pw", nickname: "HostA" });
  const createdA = hostA.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(createdA.roomId, "LOCK-RECYCLE");

  // Attempts 1 – NO_COOLDOWN_MAX: each gets INVALID_PASSWORD
  for (let attempt = 1; attempt <= JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX; attempt += 1) {
    const g = io.connect(`socket-wrong-${attempt}`);
    g.trigger(CLIENT_EVENTS.joinRoom, { roomId: "LOCK-RECYCLE", password: "wrong-pw", nickname: `Wrong-${attempt}` });
    assert.equal(popSocketError(g)?.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD`);
  }

  // Next attempt: cooldown is set → RATE_LIMITED
  const gCooldown = io.connect("socket-wrong-cooldown");
  gCooldown.trigger(CLIENT_EVENTS.joinRoom, { roomId: "LOCK-RECYCLE", password: "wrong-pw", nickname: "WrongC" });
  assert.equal(popSocketError(gCooldown)?.code, "RATE_LIMITED", "Expected RATE_LIMITED once cooldown kicks in");

  // Verify cooldown is active — correct password is still blocked within the cooldown window
  const gBlocked = io.connect("socket-blocked-correct");
  gBlocked.trigger(CLIENT_EVENTS.joinRoom, { roomId: "LOCK-RECYCLE", password: "correct-pw", nickname: "BlockedCorrect" });
  assert.equal(popSocketError(gBlocked)?.code, "RATE_LIMITED", "Correct-password join during active cooldown must still be blocked");

  // Destroy the first room — purgeJoinAttemptsForRoom must clear the stale lock
  hostA.trigger(CLIENT_EVENTS.leaveRoom, {});
  assert.equal(hooks.getStateSnapshot().roomCount, 0, "First room must be destroyed");

  // Create a second room with the same ID
  const hostB = io.connect("socket-host-b");
  hostB.trigger(CLIENT_EVENTS.createRoom, { password: "new-pw", nickname: "HostB" });
  const createdB = hostB.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(createdB.roomId, "LOCK-RECYCLE", "Second room must reuse the same room ID");

  // The same subject (all fake sockets share one subject) must be able to join with the correct password
  const freshGuest = io.connect("socket-fresh-guest");
  freshGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "LOCK-RECYCLE", password: "new-pw", nickname: "FreshGuest" });
  const freshJoined = freshGuest.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(freshJoined, "Guest must be able to join the recycled room — stale cooldown state must have been purged");
  assert.equal(popSocketError(freshGuest), undefined, "No error must be emitted after cooldown state is purged");
});

// ---- T4.1 Identity & UX Refinement ----

test("T4.1-01: room_joined peers list includes nickname for every peer with values matching join/create submissions", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };
  assert.ok(roomCreated);

  // guest1 joins — peers list must contain the host with nickname "Alice"
  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
    peers: Array<{ participantId: string; nickname?: string | null }>;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  assert.ok(guest1Joined, "guest1 must receive room_joined");
  assert.equal(guest1Joined.peers.length, 1, "guest1 peers list must contain one peer (the host)");
  assert.equal(guest1Joined.peers[0]?.participantId, roomCreated.participantId, "Peer must be the host");
  assert.equal(guest1Joined.peers[0]?.nickname, "Alice", "Host nickname in guest1 peers list must be 'Alice'");

  // guest2 joins — peers list must contain host ("Alice") and guest1 ("Bob"), both with nicknames
  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Carol" });
  const guest2Joined = guest2.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
    peers: Array<{ participantId: string; nickname?: string | null }>;
  };

  assert.ok(guest2Joined, "guest2 must receive room_joined");
  assert.equal(guest2Joined.peers.length, 2, "guest2 peers list must contain two peers (host and guest1)");

  const hostPeer = guest2Joined.peers.find((p) => p.participantId === roomCreated.participantId);
  const guest1Peer = guest2Joined.peers.find((p) => p.participantId === guest1Joined.participantId);
  assert.ok(hostPeer, "Host must appear in guest2 peers list");
  assert.equal(hostPeer.nickname, "Alice", "Host nickname must be 'Alice' in guest2 peers list");
  assert.ok(guest1Peer, "Guest1 must appear in guest2 peers list");
  assert.equal(guest1Peer.nickname, "Bob", "Guest1 nickname must be 'Bob' in guest2 peers list");
});

test("T4.1-02: peer_joined includes the joining peer's nickname field with the correct value", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  // guest1 joins with nickname "Bob" — host must receive peer_joined with nickname "Bob"
  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Bob" });
  guest1.popEvent(SERVER_EVENTS.roomJoined);

  const hostPeerJoined1 = host.popEvent(SERVER_EVENTS.peerJoined) as {
    participantId: string;
    nickname?: string | null;
    participantCount: number;
  };

  assert.ok(hostPeerJoined1, "Host must receive peer_joined when guest1 joins");
  assert.equal(hostPeerJoined1.nickname, "Bob", "peer_joined to host must include guest1's nickname 'Bob'");

  // guest2 joins with nickname "Carol" — both host and guest1 receive peer_joined with "Carol"
  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Carol" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);

  const hostPeerJoined2 = host.popEvent(SERVER_EVENTS.peerJoined) as {
    participantId: string;
    nickname?: string | null;
    participantCount: number;
  };
  const guest1PeerJoined2 = guest1.popEvent(SERVER_EVENTS.peerJoined) as {
    participantId: string;
    nickname?: string | null;
    participantCount: number;
  };

  assert.ok(hostPeerJoined2, "Host must receive peer_joined when guest2 joins");
  assert.equal(hostPeerJoined2.nickname, "Carol", "peer_joined to host must include guest2's nickname 'Carol'");
  assert.ok(guest1PeerJoined2, "Guest1 must receive peer_joined when guest2 joins");
  assert.equal(guest1PeerJoined2.nickname, "Carol", "peer_joined to guest1 must include guest2's nickname 'Carol'");
});

test("T4.1-04: room_created includes participantNickname matching the nickname submitted at creation", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    participantNickname?: string | null;
  };

  assert.ok(roomCreated, "room_created must be emitted");
  assert.equal(
    roomCreated.participantNickname,
    "Alice",
    "room_created must include participantNickname matching the nickname submitted at creation"
  );
});

test("T4.1-05: resume_session response includes participantNickname for the resuming participant and peers list entries each carrying a nickname", async () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Alice" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    reconnectToken: string;
  };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Bob" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host disconnects — opens grace window
  host.triggerDisconnect();
  const hostGrace = guest.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number };
  assert.ok(hostGrace, "host_reconnect_grace must be emitted on host disconnect");

  // Host resumes on a new socket
  const resumedHost = io.connect("socket-host-resumed");
  resumedHost.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken,
  });
  await flushPromises();

  const resumeRoomJoined = resumedHost.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    participantId: string;
    participantNickname?: string | null;
    peers: Array<{ participantId: string; nickname?: string | null }>;
  };

  assert.ok(resumeRoomJoined, "Resumed host must receive room_joined");
  assert.equal(
    resumeRoomJoined.participantNickname,
    "Alice",
    "resume_session room_joined must include participantNickname for the resuming participant"
  );
  assert.equal(resumeRoomJoined.peers.length, 1, "Peers list must contain one peer (the guest)");
  assert.equal(
    resumeRoomJoined.peers[0]?.nickname,
    "Bob",
    "Each peer in the resume_session peers list must carry a nickname"
  );
});

// ---- T4.3 Open Rooms (Password-less) ----

test("T4.3-01: room creation without a password succeeds and creates an open room", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { nickname: "Host" });

  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  } | undefined;

  assert.ok(roomCreated, "room_created must be emitted for a passwordless create_room");
  assert.equal(popSocketError(host), undefined, "No error must be emitted for a valid open room creation");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1, "Open room must be created in state");
  assert.equal(snapshot.rooms[0]?.participantCount, 1, "Host must be the sole participant");
});

test("T4.3-02: joining an open room without a password succeeds", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, nickname: "Guest" });

  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(roomJoined, "Guest must receive room_joined when joining an open room without a password");
  assert.equal(popSocketError(guest), undefined, "No error must be emitted for a passwordless join on an open room");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Both host and guest must be present after passwordless join");
});

test("T4.3-03: room_created carries hasPassword: false for open rooms and hasPassword: true for password-protected rooms; room_joined reflects the same", () => {
  const roomIdFactory = createSequenceFactory(["OPEN-1", "PROT-1"], "FALLBACK");
  const { io } = setupSocketHarness({ generateRoomId: roomIdFactory });

  const hostOpen = io.connect("socket-host-open");
  const hostProt = io.connect("socket-host-prot");

  // Create an open room (no password)
  hostOpen.trigger(CLIENT_EVENTS.createRoom, { nickname: "HostOpen" });
  const openCreated = hostOpen.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    hasPassword?: boolean;
  };
  assert.ok(openCreated, "room_created must be emitted for an open room");
  assert.equal(openCreated.hasPassword, false, "room_created must carry hasPassword: false for an open room");

  // Create a password-protected room
  hostProt.trigger(CLIENT_EVENTS.createRoom, { password: "secret", nickname: "HostProt" });
  const protCreated = hostProt.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    hasPassword?: boolean;
  };
  assert.ok(protCreated, "room_created must be emitted for a password-protected room");
  assert.equal(protCreated.hasPassword, true, "room_created must carry hasPassword: true for a password-protected room");

  // Guest joins open room — room_joined must carry hasPassword: false
  const guestOpen = io.connect("socket-guest-open");
  guestOpen.trigger(CLIENT_EVENTS.joinRoom, { roomId: openCreated.roomId, nickname: "GuestOpen" });
  const openJoined = guestOpen.popEvent(SERVER_EVENTS.roomJoined) as {
    hasPassword?: boolean;
  };
  assert.ok(openJoined, "Guest must receive room_joined for open room");
  assert.equal(openJoined.hasPassword, false, "room_joined must carry hasPassword: false when joining an open room");

  // Guest joins password-protected room — room_joined must carry hasPassword: true
  const guestProt = io.connect("socket-guest-prot");
  guestProt.trigger(CLIENT_EVENTS.joinRoom, { roomId: protCreated.roomId, password: "secret", nickname: "GuestProt" });
  const protJoined = guestProt.popEvent(SERVER_EVENTS.roomJoined) as {
    hasPassword?: boolean;
  };
  assert.ok(protJoined, "Guest must receive room_joined for password-protected room");
  assert.equal(protJoined.hasPassword, true, "room_joined must carry hasPassword: true when joining a password-protected room");
});

test("T4.3-04: resume_session response includes the correct hasPassword value reflecting the room's protection state at resume time", async () => {
  const roomIdFactory = createSequenceFactory(["OPEN-R", "PROT-R"], "FALLBACK");
  const { io } = setupSocketHarness({ generateRoomId: roomIdFactory });

  // --- Open room: host disconnects and resumes ---
  const hostOpen = io.connect("socket-host-open");
  const guestOpen = io.connect("socket-guest-open");

  hostOpen.trigger(CLIENT_EVENTS.createRoom, { nickname: "HostOpen" });
  const openCreated = hostOpen.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    reconnectToken: string;
  };
  assert.ok(openCreated);

  guestOpen.trigger(CLIENT_EVENTS.joinRoom, { roomId: openCreated.roomId, nickname: "GuestOpen" });
  guestOpen.popEvent(SERVER_EVENTS.roomJoined);
  hostOpen.popEvent(SERVER_EVENTS.peerJoined);

  hostOpen.triggerDisconnect();
  const openGrace = guestOpen.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number };
  assert.ok(openGrace, "host_reconnect_grace must be emitted to guest in open room on host disconnect");

  const resumedHostOpen = io.connect("socket-host-open-resumed");
  resumedHostOpen.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: openCreated.roomId,
    reconnectToken: openCreated.reconnectToken,
  });
  await flushPromises();

  const openResumeJoined = resumedHostOpen.popEvent(SERVER_EVENTS.roomJoined) as {
    hasPassword?: boolean;
  };
  assert.ok(openResumeJoined, "Resumed host must receive room_joined for open room");
  assert.equal(openResumeJoined.hasPassword, false, "resume_session room_joined must carry hasPassword: false for an open room");

  // --- Password-protected room: host disconnects and resumes ---
  const hostProt = io.connect("socket-host-prot");
  const guestProt = io.connect("socket-guest-prot");

  hostProt.trigger(CLIENT_EVENTS.createRoom, { password: "secret", nickname: "HostProt" });
  const protCreated = hostProt.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    reconnectToken: string;
  };
  assert.ok(protCreated);

  guestProt.trigger(CLIENT_EVENTS.joinRoom, { roomId: protCreated.roomId, password: "secret", nickname: "GuestProt" });
  guestProt.popEvent(SERVER_EVENTS.roomJoined);
  hostProt.popEvent(SERVER_EVENTS.peerJoined);

  hostProt.triggerDisconnect();
  const protGrace = guestProt.popEvent(SERVER_EVENTS.hostReconnectGrace) as { deadlineAt: number };
  assert.ok(protGrace, "host_reconnect_grace must be emitted to guest in password-protected room on host disconnect");

  const resumedHostProt = io.connect("socket-host-prot-resumed");
  resumedHostProt.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: protCreated.roomId,
    reconnectToken: protCreated.reconnectToken,
  });
  await flushPromises();

  const protResumeJoined = resumedHostProt.popEvent(SERVER_EVENTS.roomJoined) as {
    hasPassword?: boolean;
  };
  assert.ok(protResumeJoined, "Resumed host must receive room_joined for password-protected room");
  assert.equal(protResumeJoined.hasPassword, true, "resume_session room_joined must carry hasPassword: true for a password-protected room");
});

test("T4.3-05: joining an open room with a non-empty password supplied still succeeds (open rooms ignore the password field)", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  // Join with a non-empty password — open room must accept it
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "anypassword", nickname: "Guest" });

  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(roomJoined, "Guest must be allowed to join an open room even when supplying a non-empty password");
  assert.equal(popSocketError(guest), undefined, "No error must be emitted when joining an open room with an extraneous password");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Both participants must be present after password-supplied join of an open room");
});

test("T4.3-06: room_password_update on an open room returns NOT_AUTHORIZED and no state mutation occurs", async () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host attempts to set a password on an open room — must be rejected with NOT_AUTHORIZED
  host.trigger(CLIENT_EVENTS.roomPasswordUpdate, { roomId: roomCreated.roomId, newPassword: "newpassword" });
  await flushPromises();

  const authError = popSocketError(host);
  assert.ok(authError, "Host must receive an error when calling room_password_update on an open room");
  assert.equal(authError.code, "NOT_AUTHORIZED", "room_password_update on an open room must return NOT_AUTHORIZED");

  // No broadcast must have been emitted
  assert.equal(host.popEvent(SERVER_EVENTS.roomPasswordUpdated), undefined, "No room_password_updated must be emitted to host for open-room update attempt");
  assert.equal(guest.popEvent(SERVER_EVENTS.roomPasswordUpdated), undefined, "No room_password_updated must be emitted to guest for open-room update attempt");

  // Verify no state mutation — a new guest can still join without a password
  const newGuest = io.connect("socket-new-guest");
  newGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, nickname: "NewGuest" });
  const newGuestJoined = newGuest.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(newGuestJoined, "Room must remain open (no password) after the rejected password update");
  assert.equal(popSocketError(newGuest), undefined, "Passwordless join must still succeed after rejected open-room password update");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 3, "Room must have 3 participants: host, original guest, new guest");
});

test("T3.3-08 (P3-AB-008): join-attempt cooldown resets after expiry and the next correct-password attempt succeeds", () => {
  let timeNow = 1000;
  const { io } = setupSocketHarness({ now: () => timeNow });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  // Attempts 1 – NO_COOLDOWN_MAX: each gets INVALID_PASSWORD (no cooldown yet)
  for (let attempt = 1; attempt <= JOIN_INVALID_ATTEMPT_NO_COOLDOWN_MAX; attempt += 1) {
    const socket = io.connect(`socket-wrong-${attempt}`);
    socket.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "wrong-pw", nickname: `Guest-${attempt}` });
    const err = popSocketError(socket);
    assert.ok(err, `Attempt ${attempt}: expected error`);
    assert.equal(err.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD before cooldown`);
  }

  // Next wrong-password attempt: cooldown is set → RATE_LIMITED
  const socketCooldown = io.connect("socket-wrong-cooldown");
  socketCooldown.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "wrong-pw", nickname: "GuestC" });
  const cooldownError = popSocketError(socketCooldown);
  assert.ok(cooldownError, "Expected RATE_LIMITED once cooldown is set");
  assert.equal(cooldownError.code, "RATE_LIMITED", "Cooldown must be set after exceeding NO_COOLDOWN_MAX invalid attempts");

  // Correct-password attempt during active cooldown must still be blocked
  const socketDuringCooldown = io.connect("socket-during-cooldown");
  socketDuringCooldown.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "correct-pw", nickname: "GuestDuring" });
  const duringCooldownError = popSocketError(socketDuringCooldown);
  assert.ok(duringCooldownError, "Attempt during active cooldown must be RATE_LIMITED");
  assert.equal(duringCooldownError.code, "RATE_LIMITED", "Active cooldown must block even a correct-password attempt");
  assert.equal(socketDuringCooldown.popEvent(SERVER_EVENTS.roomJoined), undefined, "No room_joined during active cooldown");

  // Advance clock past the cooldown deadline
  timeNow += JOIN_INVALID_ATTEMPT_COOLDOWN_MS + 1;

  // Correct-password attempt after cooldown expiry — the cooldown-reset path must clear cooldownUntil
  const socketAfterCooldown = io.connect("socket-after-cooldown");
  socketAfterCooldown.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "correct-pw", nickname: "GuestAfter" });
  const roomJoined = socketAfterCooldown.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(roomJoined, "Join with correct password after cooldown expiry must succeed");
  assert.equal(popSocketError(socketAfterCooldown), undefined, "No error must be emitted after cooldown resets");

  host.popEvent(SERVER_EVENTS.peerJoined);
});

// ---- T4.4 Advanced Peer Interaction ----

test("T4.4-01: non-host kick attempt returns NOT_AUTHORIZED and no state change occurs", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  const guest2Joined = guest2.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);
  guest1.popEvent(SERVER_EVENTS.peerJoined);

  // Guest1 (non-host) attempts to kick Guest2
  guest1.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guest2Joined.participantId });

  const kickError = popSocketError(guest1);
  assert.ok(kickError, "Non-host must receive an error when attempting to kick");
  assert.equal(kickError.code, "NOT_AUTHORIZED", "Non-host kick attempt must return NOT_AUTHORIZED");

  // No participant_kicked must be emitted to any participant
  assert.equal(host.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must reach host on unauthorized kick");
  assert.equal(guest1.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must reach kicker on unauthorized kick");
  assert.equal(guest2.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must reach target on unauthorized kick");

  // State must be unchanged
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 3, "Participant count must remain 3 after unauthorized kick attempt");
  assert.equal(snapshot.participantToRoomCount, 3, "participantToRoom index must be unchanged after unauthorized kick");
  assert.equal(snapshot.socketToParticipantCount, 3, "socketToParticipant index must be unchanged after unauthorized kick");
});

test("T4.4-02: successful kick broadcasts participant_kicked to all room members including the kicked participant", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);
  guest1.popEvent(SERVER_EVENTS.peerJoined);

  // Host kicks guest1
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guest1Joined.participantId });

  // All three participants must receive participant_kicked with the correct participantId
  const hostKicked = host.popEvent(SERVER_EVENTS.participantKicked) as { participantId: string } | undefined;
  const guest1Kicked = guest1.popEvent(SERVER_EVENTS.participantKicked) as { participantId: string } | undefined;
  const guest2Kicked = guest2.popEvent(SERVER_EVENTS.participantKicked) as { participantId: string } | undefined;

  assert.ok(hostKicked, "Host must receive participant_kicked after a successful kick");
  assert.equal(hostKicked.participantId, guest1Joined.participantId, "participant_kicked to host must carry the kicked participant's id");

  assert.ok(guest1Kicked, "Kicked participant must receive participant_kicked");
  assert.equal(guest1Kicked.participantId, guest1Joined.participantId, "participant_kicked to the kicked participant must carry their own id");

  assert.ok(guest2Kicked, "Remaining guest must receive participant_kicked");
  assert.equal(guest2Kicked.participantId, guest1Joined.participantId, "participant_kicked to guest2 must carry the kicked participant's id");

  // No error must be emitted to the host
  assert.equal(popSocketError(host), undefined, "No error must be emitted to host on a successful kick");
});

test("T4.4-03: state cleanup after a successful kick removes participant from all indexes and disconnects the kicked socket", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  const snapshotBefore = hooks.getStateSnapshot();
  assert.equal(snapshotBefore.rooms[0]?.participantCount, 2, "Room must have 2 participants before kick");
  assert.equal(snapshotBefore.participantToRoomCount, 2);
  assert.equal(snapshotBefore.socketToParticipantCount, 2);

  // Host kicks guest
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guestJoined.participantId });
  host.popEvent(SERVER_EVENTS.participantKicked);
  guest.popEvent(SERVER_EVENTS.participantKicked);

  // All three indexes must reflect the kicked participant's removal
  const snapshotAfter = hooks.getStateSnapshot();
  assert.equal(snapshotAfter.roomCount, 1, "Room must remain after kicking a guest");
  assert.equal(snapshotAfter.rooms[0]?.participantCount, 1, "Kicked participant must be removed from room.participants");
  assert.equal(snapshotAfter.participantToRoomCount, 1, "participantToRoom must drop to 1 after kick");
  assert.equal(snapshotAfter.socketToParticipantCount, 1, "socketToParticipant must drop to 1 after kick");

  // Kicked socket must have been explicitly disconnected
  assert.equal(guest.wasDisconnected(), true, "Kicked socket must be explicitly disconnected via io.sockets.sockets");
});

test("T4.4-04: resume_session with the kicked participant's reconnect token returns ROOM_NOT_FOUND after kick", async () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
    reconnectToken: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host kicks guest — this purges the reconnect token
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guestJoined.participantId });
  host.popEvent(SERVER_EVENTS.participantKicked);
  guest.popEvent(SERVER_EVENTS.participantKicked);

  // Attempt to resume with the now-purged token — must fail with ROOM_NOT_FOUND
  const kickedResumed = io.connect("socket-kicked-resumed");
  kickedResumed.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: guestJoined.reconnectToken,
  });
  await flushPromises();

  assert.equal(
    kickedResumed.popEvent(SERVER_EVENTS.roomJoined),
    undefined,
    "Resume must be rejected for a kicked participant"
  );
  const resumeError = popSocketError(kickedResumed);
  assert.ok(resumeError, "Error must be emitted for a kicked participant's resume attempt");
  assert.equal(resumeError.code, "ROOM_NOT_FOUND", "Kicked participant's reconnect token must be purged, returning ROOM_NOT_FOUND on resume");
});

test("T4.4-05: room participant count decreases by one after a successful kick; no room_destroyed emitted to remaining participants", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const guest1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);
  guest1.popEvent(SERVER_EVENTS.peerJoined);

  const snapshotBefore = hooks.getStateSnapshot();
  assert.equal(snapshotBefore.rooms[0]?.participantCount, 3, "Room must have 3 participants before kick");

  // Host kicks guest1
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guest1Joined.participantId });
  host.popEvent(SERVER_EVENTS.participantKicked);
  guest1.popEvent(SERVER_EVENTS.participantKicked);
  guest2.popEvent(SERVER_EVENTS.participantKicked);

  // Participant count must decrease by exactly one; room must remain active
  const snapshotAfter = hooks.getStateSnapshot();
  assert.equal(snapshotAfter.roomCount, 1, "Room must remain active after kicking a participant");
  assert.equal(snapshotAfter.rooms[0]?.participantCount, 2, "Participant count must decrease by one after a successful kick");

  // No room_destroyed must be emitted to remaining participants
  assert.equal(host.popEvent(SERVER_EVENTS.roomDestroyed), undefined, "No room_destroyed must be emitted to host after kick");
  assert.equal(guest2.popEvent(SERVER_EVENTS.roomDestroyed), undefined, "No room_destroyed must be emitted to remaining guest after kick");
});

test("T4.4-06: host attempting to kick themselves returns INVALID_SIGNAL_PAYLOAD and no state change occurs", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host attempts to kick themselves
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: roomCreated.participantId });

  const selfKickError = popSocketError(host);
  assert.ok(selfKickError, "Host must receive an error when attempting to kick themselves");
  assert.equal(selfKickError.code, "INVALID_SIGNAL_PAYLOAD", "Self-kick must return INVALID_SIGNAL_PAYLOAD");

  // No participant_kicked must be emitted to any participant
  assert.equal(host.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must be emitted to host on self-kick");
  assert.equal(guest.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must be emitted to guest on self-kick");

  // State must be unchanged
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Participant count must remain 2 after self-kick attempt");
  assert.equal(snapshot.participantToRoomCount, 2);
  assert.equal(snapshot.socketToParticipantCount, 2);
});

test("T4.4-07: kick_participant with missing roomId or empty targetParticipantId returns INVALID_SIGNAL_PAYLOAD", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Missing roomId: should return INVALID_SIGNAL_PAYLOAD
  host.trigger(CLIENT_EVENTS.kickParticipant, { targetParticipantId: guestJoined.participantId });
  const missingRoomIdError = popSocketError(host);
  assert.ok(missingRoomIdError, "Host must receive an error when roomId is missing");
  assert.equal(missingRoomIdError.code, "INVALID_SIGNAL_PAYLOAD", "Missing roomId must return INVALID_SIGNAL_PAYLOAD");

  // Empty/whitespace-only targetParticipantId: should return INVALID_SIGNAL_PAYLOAD
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: "   " });
  const emptyTargetError = popSocketError(host);
  assert.ok(emptyTargetError, "Host must receive an error when targetParticipantId is empty/whitespace");
  assert.equal(emptyTargetError.code, "INVALID_SIGNAL_PAYLOAD", "Empty targetParticipantId must return INVALID_SIGNAL_PAYLOAD");

  // State must be unchanged after both invalid payloads
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2, "Participant count must remain 2 after invalid kick payloads");
  assert.equal(snapshot.participantToRoomCount, 2);
  assert.equal(snapshot.socketToParticipantCount, 2);
});

test("T4.4-08: kick_participant with a targetParticipantId that does not exist in the room returns ROOM_NOT_FOUND", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  // Host attempts to kick a participant that does not exist in the room
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: "nonexistent-participant" });

  const unknownTargetError = popSocketError(host);
  assert.ok(unknownTargetError, "Host must receive an error when the target participant does not exist");
  assert.equal(unknownTargetError.code, "ROOM_NOT_FOUND", "Unknown target participant must return ROOM_NOT_FOUND");

  // No participant_kicked must be emitted
  assert.equal(host.popEvent(SERVER_EVENTS.participantKicked), undefined, "No participant_kicked must be emitted for unknown target");

  // State must be unchanged
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1, "Participant count must remain 1 after unknown target kick attempt");
  assert.equal(snapshot.participantToRoomCount, 1);
  assert.equal(snapshot.socketToParticipantCount, 1);
});

test("T4.4-09: kick_participant from a socket not associated with any room returns ROOM_NOT_FOUND", () => {
  const { io, hooks } = setupSocketHarness();
  const outsider = io.connect("socket-outsider");

  // Outsider has no room association — kick must fail with ROOM_NOT_FOUND
  outsider.trigger(CLIENT_EVENTS.kickParticipant, { roomId: "some-room-id", targetParticipantId: "some-participant-id" });

  const noRoomError = popSocketError(outsider);
  assert.ok(noRoomError, "Socket with no room association must receive an error when attempting to kick");
  assert.equal(noRoomError.code, "ROOM_NOT_FOUND", "Socket with no room association must return ROOM_NOT_FOUND");

  // State must remain empty
  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("T4.4-10: kicking a guest in the grace window removes their entry from state and purges the reconnect token", async () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.ok(roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    participantId: string;
    reconnectToken: string;
  };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Guest disconnects — enters grace window; socketId is prefixed with disconnected:
  guest.triggerDisconnect();

  // During grace window: room still has 2 participants but socketToParticipant only has host
  const snapshotDuringGrace = hooks.getStateSnapshot();
  assert.equal(snapshotDuringGrace.rooms[0]?.participantCount, 2, "Guest must remain in room during grace window");
  assert.equal(snapshotDuringGrace.socketToParticipantCount, 1, "Guest's socket must be removed from index on disconnect");

  // Host kicks the grace-window guest
  host.trigger(CLIENT_EVENTS.kickParticipant, { roomId: roomCreated.roomId, targetParticipantId: guestJoined.participantId });

  // participant_kicked must be broadcast to the room (host and any connected sockets)
  const hostKicked = host.popEvent(SERVER_EVENTS.participantKicked) as { participantId: string } | undefined;
  assert.ok(hostKicked, "Host must receive participant_kicked when kicking a grace-window guest");
  assert.equal(hostKicked.participantId, guestJoined.participantId, "participant_kicked must carry the kicked participant's id");

  // No error must be emitted to the host
  assert.equal(popSocketError(host), undefined, "No error must be emitted to host on a successful grace-window kick");

  // State must reflect removal of the kicked participant
  const snapshotAfterKick = hooks.getStateSnapshot();
  assert.equal(snapshotAfterKick.roomCount, 1, "Room must remain active after kicking a grace-window guest");
  assert.equal(snapshotAfterKick.rooms[0]?.participantCount, 1, "Kicked grace-window guest must be removed from room.participants");
  assert.equal(snapshotAfterKick.participantToRoomCount, 1, "participantToRoom must drop to 1 after grace-window kick");
  assert.equal(snapshotAfterKick.socketToParticipantCount, 1, "socketToParticipant must remain at 1 (guest socket was already removed on disconnect)");

  // Reconnect token must be purged — resume must fail with ROOM_NOT_FOUND
  const kickedResumed = io.connect("socket-kicked-grace-resumed");
  kickedResumed.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: guestJoined.reconnectToken,
  });
  await flushPromises();

  assert.equal(
    kickedResumed.popEvent(SERVER_EVENTS.roomJoined),
    undefined,
    "Resume must be rejected after kicking a grace-window participant"
  );
  const resumeError = popSocketError(kickedResumed);
  assert.ok(resumeError, "Error must be emitted when kicked grace-window participant attempts to resume");
  assert.equal(resumeError.code, "ROOM_NOT_FOUND", "Kicked grace-window participant's reconnect token must be purged");
});

// ---- T6.1 Metrics counter wiring (signaling hooks) ----

test("T6.1-04: roomsCreatedTotal increases by 1 after a successful create_room event", () => {
  const { io, realMetrics } = setupSocketHarnessWithMetrics();

  const before = realMetrics.getRawCounters().roomsCreatedTotal;

  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });

  const created = host.popEvent(SERVER_EVENTS.roomCreated);
  assert.ok(created, "room_created must be emitted");

  assert.equal(
    realMetrics.getRawCounters().roomsCreatedTotal,
    before + 1,
    "roomsCreatedTotal must increase by 1 after create_room",
  );
});

test("T6.1-05: roomsDestroyedByReason.host_left increases by 1 after host calls leave_room", () => {
  const { io, realMetrics } = setupSocketHarnessWithMetrics();

  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  const before = realMetrics.getRawCounters().roomsDestroyedByReason.host_left;

  host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: created.roomId });

  assert.equal(
    realMetrics.getRawCounters().roomsDestroyedByReason.host_left,
    before + 1,
    "host_left counter must increase by 1 after host calls leave_room",
  );
});

test("T6.1-06: errorCounts.RATE_LIMITED increases by 1 when a rate-limited error is emitted", async () => {
  // With a fixed clock (now = 123456), a nicknameUpdate immediately after createRoom
  // is within the cooldown window (nicknameUpdatedAt == nowTs < nowTs + COOLDOWN),
  // which triggers RATE_LIMITED via the locally-shadowed emitRateLimited.
  const { io, realMetrics } = setupSocketHarnessWithMetrics();

  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  const before = realMetrics.getRawCounters().errorCounts.RATE_LIMITED;

  host.trigger(CLIENT_EVENTS.nicknameUpdate, { nickname: "NewNick" });
  await flushPromises();

  const error = host.popEvent(SERVER_EVENTS.error) as { code: string } | undefined;
  assert.ok(error, "Expected a RATE_LIMITED error from nicknameUpdate within the cooldown window");
  assert.equal(error?.code, "RATE_LIMITED");

  assert.equal(
    realMetrics.getRawCounters().errorCounts.RATE_LIMITED,
    before + 1,
    "RATE_LIMITED error counter must increase by 1",
  );
});

test("T6.1-13: participantsJoinedTotal does NOT increment on create_room — only increments on join_room by a guest", () => {
  const { io, realMetrics } = setupSocketHarnessWithMetrics();

  const baseline = realMetrics.getRawCounters().participantsJoinedTotal;

  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  assert.equal(
    realMetrics.getRawCounters().participantsJoinedTotal,
    baseline,
    "participantsJoinedTotal must NOT increment when host creates a room",
  );

  const guest = io.connect("socket-guest");
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);

  assert.equal(
    realMetrics.getRawCounters().participantsJoinedTotal,
    baseline + 1,
    "participantsJoinedTotal must increment by 1 when a guest joins via join_room",
  );
});

test("T6.1-14: updatePeakMarks() is called during each sweep and reflects the highest concurrent room/participant count", () => {
  const originalSetInterval = globalThis.setInterval;
  let capturedSweep: (() => void) | null = null;

  (globalThis as unknown as { setInterval: (cb: () => void) => NodeJS.Timeout }).setInterval =
    (callback: () => void): NodeJS.Timeout => {
      capturedSweep = callback;
      return { unref: () => undefined } as unknown as NodeJS.Timeout;
    };

  try {
    const { io, realMetrics } = setupSocketHarnessWithMetrics();

    assert.ok(capturedSweep, "registerSocketHandlers must register a sweep via setInterval");

    const initial = realMetrics.getRawCounters();
    assert.equal(initial.peakConcurrentRooms, 0, "peak rooms must start at 0");
    assert.equal(initial.peakConcurrentParticipants, 0, "peak participants must start at 0");

    // Create one room with host + guest — live counts reach 1 room, 2 participants
    const host = io.connect("socket-host-peak");
    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
    host.popEvent(SERVER_EVENTS.roomCreated);

    const guest = io.connect("socket-guest-peak");
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw", nickname: "Guest" });
    guest.popEvent(SERVER_EVENTS.roomJoined);

    // Fire the sweep — must call updatePeakMarks() and capture the high-water marks
    (capturedSweep as () => void)();

    const afterHigh = realMetrics.getRawCounters();
    assert.equal(afterHigh.peakConcurrentRooms, 1, "peakConcurrentRooms must be 1 after sweep with 1 active room");
    assert.equal(afterHigh.peakConcurrentParticipants, 2, "peakConcurrentParticipants must be 2 after sweep with 2 active participants");

    // Host leaves, destroying the room — live counts drop to 0
    host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "AbC123" });

    // Fire the sweep again — peaks must remain at the established high-water marks
    (capturedSweep as () => void)();

    const afterLow = realMetrics.getRawCounters();
    assert.equal(afterLow.peakConcurrentRooms, 1, "peakConcurrentRooms must not decrease when active count drops below peak");
    assert.equal(afterLow.peakConcurrentParticipants, 2, "peakConcurrentParticipants must not decrease when active count drops below peak");
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});
