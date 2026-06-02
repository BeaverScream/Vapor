import test from "node:test";
import assert from "node:assert/strict";
import { createVaporServer } from "../src/server";
import { CLIENT_EVENTS, GUEST_DISCONNECT_GRACE_MS, HOST_DISCONNECT_GRACE_MS, SERVER_EVENTS } from "../src/signaling/contracts";
import { registerSocketHandlers } from "../src/signaling/registerSocketHandlers";
import { createPhase0State, getPhase0StateSnapshot } from "../src/signaling/state";

type EventPayload = unknown;
type EventHandler = (payload: EventPayload) => void;

class FakeIo {
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;
  private roomMembership = new Map<string, Set<FakeSocket>>();
  private socketsById = new Map<string, FakeSocket>();

  on(event: string, handler: (socket: FakeSocket) => void): void {
    if (event === "connection") {
      this.connectionHandler = handler;
    }
  }

  connect(socketId: string): FakeSocket {
    const socket = new FakeSocket(this, socketId);
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

  private handlers = new Map<string, EventHandler>();
  private inboundEvents: Array<{ event: string; payload: EventPayload }> = [];

  constructor(private io: FakeIo, socketId: string) {
    this.id = socketId;
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
  const state = createPhase0State();

  const metrics = {
    recordConnection: () => undefined,
    recordRoomJoin: () => undefined,
    recordDisconnect: () => undefined
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
    hooks: {
      getStateSnapshot: () => getPhase0StateSnapshot(state),
      getParticipantRecord: (roomId: string, participantId: string) =>
        state.rooms.get(roomId)?.participants.get(participantId)
    }
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
  const { io, hooks } = setupSocketHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    }
  });

  for (let index = 0; index < 20; index += 1) {
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
