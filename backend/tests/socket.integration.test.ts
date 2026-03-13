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

  on(event: string, handler: (socket: FakeSocket) => void): void {
    if (event === "connection") {
      this.connectionHandler = handler;
    }
  }

  connect(socketId: string): FakeSocket {
    const socket = new FakeSocket(this, socketId);
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

  to(roomId: string): { emit: (event: string, payload: EventPayload) => void } {
    return {
      emit: (event: string, payload: EventPayload): void => {
        const room = this.roomMembership.get(roomId);
        if (!room) {
          return;
        }

        for (const socket of room.values()) {
          socket.pushInbound(event, payload);
        }
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

function setupSocketHarness(overrides?: {
  generateRoomId?: () => string;
  generateParticipantId?: () => string;
  now?: () => number;
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
    }
  });

  return {
    io,
    hooks: {
      getStateSnapshot: () => getPhase0StateSnapshot(state)
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
test("P0-CR-001 / P0-JN-002: create + join emits contract payloads and shared room context", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    participantCount: number;
  };

  assert.ok(roomCreated);
  assert.equal(roomCreated.roomId, "AbC123");
  assert.equal(roomCreated.participantCount, 1);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw" });
  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    participantId: string;
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
  assert.equal(roomJoined.participantCount, 2);
  assert.equal(peerJoined.participantCount, 2);
  assert.equal(roomJoined.peers.length, 1);

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("P0-JN-003: altered-case room id naturally fails exact-match lookup", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "abc123", password: "pw" });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "ROOM_NOT_FOUND");
  assert.equal(errorPayload.message, "Room not found");
});

test("P0-JN-002 edge: missing roomId payload returns deterministic ROOM_NOT_FOUND", () => {
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
test("VP-1.4-AC1: create_room rejects empty password with INVALID_PASSWORD semantics", () => {
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

test("VP-1.4-AC2: join_room rejects empty password with INVALID_PASSWORD semantics", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "   " });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "INVALID_PASSWORD");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("VP-1.4-AC3: join_room rejects wrong password with INVALID_PASSWORD semantics", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });

  const errorPayload = popSocketError(guest);
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "INVALID_PASSWORD");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("VP-2.4-AC1: join_room attempts 1-3 with wrong password each return INVALID_PASSWORD without cooldown", () => {
  const { io } = setupSocketHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac1-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
    const errorPayload = popSocketError(guest);
    assert.ok(errorPayload, `Attempt ${attempt}: expected error response`);
    assert.equal(errorPayload.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD with no cooldown`);
  }
});

test("VP-2.4-AC2: join_room attempt 4 starts cooldown and returns RATE_LIMITED; attempt 5 during cooldown also returns RATE_LIMITED", () => {
  let time = 0;
  const { io } = setupSocketHarness({ now: () => time });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // attempts 1-3: each gets INVALID_PASSWORD, no cooldown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac2-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
    const errorPayload = popSocketError(guest);
    assert.ok(errorPayload);
    assert.equal(errorPayload.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD before cooldown`);
  }

  // attempt 4: cooldown enforced → RATE_LIMITED
  const guest4 = io.connect("socket-guest-ac2-4");
  guest4.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  const error4 = popSocketError(guest4);
  assert.ok(error4, "Attempt 4: expected error response");
  assert.equal(error4.code, "RATE_LIMITED", "Attempt 4: expected RATE_LIMITED as cooldown starts");

  // attempt 5 during active cooldown: still RATE_LIMITED
  const guest5 = io.connect("socket-guest-ac2-5");
  guest5.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  const error5 = popSocketError(guest5);
  assert.ok(error5, "Attempt 5: expected error response during cooldown");
  assert.equal(error5.code, "RATE_LIMITED", "Attempt 5: expected RATE_LIMITED during active cooldown");
});

test("VP-2.4-AC3: join_room invalid attempts exceeding 5 enforce strict lockout with RATE_LIMITED", () => {
  const JOIN_INVALID_ATTEMPT_COOLDOWN_MS = 10 * 60 * 1000;
  let time = 0;
  const { io } = setupSocketHarness({ now: () => time });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // attempts 1-3: INVALID_PASSWORD, no cooldown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const guest = io.connect(`socket-guest-ac3-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
    const errorPayload = popSocketError(guest);
    assert.equal(errorPayload?.code, "INVALID_PASSWORD", `Attempt ${attempt}: expected INVALID_PASSWORD`);
  }

  // attempt 4: first cooldown starts
  const guest4 = io.connect("socket-guest-ac3-4");
  guest4.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  assert.equal(popSocketError(guest4)?.code, "RATE_LIMITED", "Attempt 4: expected RATE_LIMITED");

  // advance past first cooldown; attempt 5: second cooldown starts
  time += JOIN_INVALID_ATTEMPT_COOLDOWN_MS + 1;
  const guest5 = io.connect("socket-guest-ac3-5");
  guest5.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  assert.equal(popSocketError(guest5)?.code, "RATE_LIMITED", "Attempt 5: expected RATE_LIMITED");

  // advance past second cooldown; attempt 6: strict lockout (count > 5)
  time += JOIN_INVALID_ATTEMPT_COOLDOWN_MS + 1;
  const guest6 = io.connect("socket-guest-ac3-6");
  guest6.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  const error6 = popSocketError(guest6);
  assert.ok(error6, "Attempt 6: expected error under strict lockout");
  assert.equal(error6.code, "RATE_LIMITED", "Attempt 6: expected RATE_LIMITED strict lockout");

  // strict lockout persists without any time advance
  const guest7 = io.connect("socket-guest-ac3-7");
  guest7.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "wrong-pass" });
  assert.equal(popSocketError(guest7)?.code, "RATE_LIMITED", "Strict lockout: lockout persists for attempt 7+");
});

test("VP-2.4-AC4: join-attempt counters are purged atomically on room destruction", () => {
  const { io, hooks } = setupSocketHarness({
    generateRoomId: createSequenceFactory(["ROOM-A", "ROOM-B"], "ROOM-X")
  });
  const host = io.connect("socket-host-purge");

  // create first room and accumulate invalid attempts up to cooldown threshold
  host.trigger(CLIENT_EVENTS.createRoom, { password: "correct-pass" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(created.roomId, "ROOM-A");

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const guest = io.connect(`socket-guest-purge-${attempt}`);
    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "ROOM-A", password: "wrong-pass" });
  }

  // destroy room by host leave; state must be purged atomically
  host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "ROOM-A" });
  assert.equal(hooks.getStateSnapshot().roomCount, 0);

  // create second room; a fresh wrong-password attempt must not inherit prior lock state
  const host2 = io.connect("socket-host-purge-2");
  host2.trigger(CLIENT_EVENTS.createRoom, { password: "new-pass" });
  const created2 = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };
  assert.equal(created2.roomId, "ROOM-B");

  const freshGuest = io.connect("socket-fresh-guest-purge");
  freshGuest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "ROOM-B", password: "wrong-pass" });
  const errorPayload = popSocketError(freshGuest);
  assert.ok(errorPayload, "Expected error on fresh room join attempt");
  assert.equal(errorPayload.code, "INVALID_PASSWORD", "Counter purge: fresh room must not inherit prior RATE_LIMITED state");
});

// ---- Lifecycle ----
test("VP-1.6-AC4: guest disconnect starts grace and removes guest only after guest-grace timeout", () => {
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

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
    host.popEvent(SERVER_EVENTS.roomCreated);

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
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

test("VP-1.6-AC2: host disconnect enters grace flow and does not destroy room immediately", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
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

test("VP-1.6-AC3: host resume_session before grace deadline restores host without room destruction", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw" });
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

  const resumedRoomJoined = resumedHost.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    participantId: string;
    participantCount: number;
  };

  assert.ok(resumedRoomJoined, "Expected resumed host to receive room_joined");
  assert.equal(resumedRoomJoined.roomId, roomCreated.roomId);
  assert.equal(resumedRoomJoined.participantId, roomCreated.participantId);
  assert.equal(resumedRoomJoined.participantCount, 2);

  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  assert.equal(roomDestroyed, undefined, "Room must not be destroyed when host resumes before deadline");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 2);
});

test("P0-LV-005 / P0-LV-006: guest leave_room removes participant and emits peer_left", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "AbC123" });

  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft);
  assert.ok(peerLeft, "Expected peer_left after guest leave_room");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("VP-1.6-AC1: host leave_room destroys room immediately with host_left reason", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
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

  hostA.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  hostB.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });

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

    host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
    const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

    guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: created.roomId, password: "pw" });
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
    participants: new Map([
      [
        "HOST01",
        {
          participantId: "HOST01",
          socketId: "sock-host",
          joinedAt: Date.now()
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
