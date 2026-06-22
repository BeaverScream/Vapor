/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_EVENTS, SERVER_EVENTS, SOLO_HOST_ROOM_TIMEOUT_MS } from "../src/signaling/contracts";
import { registerSocketHandlers } from "../src/signaling/registerSocketHandlers";
import { createSignalingState, getSignalingStateSnapshot } from "../src/signaling/state";

type EventPayload = unknown;
type EventHandler = (payload: EventPayload) => void;

class FakeIo {
  private connectionHandler: ((socket: FakeSocket) => void) | null = null;
  private roomMembership = new Map<string, Set<FakeSocket>>();
  private socketsById = new Map<string, FakeSocket>();

  get sockets(): { sockets: Map<string, FakeSocket> } {
    return { sockets: this.socketsById };
  }

  on(event: string, handler: (socket: FakeSocket) => void): void {
    if (event === "connection") this.connectionHandler = handler;
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
    if (!room) return;
    for (const socket of room.values()) {
      if (socket.id !== fromSocket.id) socket.pushInbound(event, payload);
    }
  }

  to(target: string): { emit: (event: string, payload: EventPayload) => void } {
    return {
      emit: (event: string, payload: EventPayload): void => {
        const room = this.roomMembership.get(target);
        if (room) {
          for (const socket of room.values()) socket.pushInbound(event, payload);
          return;
        }
        this.socketsById.get(target)?.pushInbound(event, payload);
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
    this.handlers.get(event)?.(payload);
  }

  triggerDisconnect(): void {
    this.handlers.get("disconnect")?.(undefined);
  }

  pushInbound(event: string, payload: EventPayload): void {
    this.inboundEvents.push({ event, payload });
  }

  popEvent(event: string): EventPayload | undefined {
    const index = this.inboundEvents.findIndex((e) => e.event === event);
    if (index < 0) return undefined;
    const [entry] = this.inboundEvents.splice(index, 1);
    return entry.payload;
  }

  disconnect(): void { /* no-op in test harness */ }
}

function setupHarness(overrides?: {
  generateRoomId?: () => string;
  generateParticipantId?: () => string;
  now?: () => number;
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

  let participantCounter = 0;

  registerSocketHandlers({
    io: io as unknown as Parameters<typeof registerSocketHandlers>[0]["io"],
    state,
    metrics,
    now: overrides?.now ?? (() => 123456),
    factories: {
      generateRoomId: overrides?.generateRoomId ?? (() => "AbC123"),
      generateParticipantId: overrides?.generateParticipantId ?? (() => {
        participantCounter += 1;
        return `P-${participantCounter}`;
      }),
    },
  });

  return { io, state, getSnapshot: () => getSignalingStateSnapshot(state) };
}

function popError(socket: FakeSocket): { code: string; message: string } | undefined {
  return socket.popEvent(SERVER_EVENTS.error) as { code: string; message: string } | undefined;
}

// ---- VP-8.2: Post-kick socket recovery ----

test("T8.2-02: kicked participant can immediately create a new room (no server-side block)", () => {
  let roomCounter = 0;
  const { io } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const firstRoom = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: firstRoom.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host kicks the guest
  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: firstRoom.roomId,
    targetParticipantId: guestJoined.participantId,
  });

  guest.popEvent(SERVER_EVENTS.participantKicked);

  // Kicked guest immediately creates a new room — server must not stall or error
  guest.trigger(CLIENT_EVENTS.createRoom, { password: "pw2", nickname: "NewHost" });

  const error = popError(guest);
  assert.equal(error, undefined, "kicked socket must be able to create a new room without error");

  const newRoom = guest.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(newRoom, "kicked socket must receive room_created for the new room");
  assert.notEqual(newRoom?.roomId, firstRoom.roomId, "new room must have a different ID");
});

test("T8.2-02 variant: kicked participant can immediately join a different room (no server-side block)", () => {
  let roomCounter = 0;
  const { io } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host1 = io.connect("socket-host-1");
  const host2 = io.connect("socket-host-2");
  const guest  = io.connect("socket-guest");

  // Host1 creates room A; host2 creates room B
  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host1" });
  const roomA = host1.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw2", nickname: "Host2" });
  const roomB = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  // Guest joins room A
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomA.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host1.popEvent(SERVER_EVENTS.peerJoined);

  // Host1 kicks guest
  host1.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomA.roomId,
    targetParticipantId: guestJoined.participantId,
  });
  guest.popEvent(SERVER_EVENTS.participantKicked);

  // Guest immediately joins room B — must succeed
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomB.roomId, password: "pw2", nickname: "Guest" });

  const error = popError(guest);
  assert.equal(error, undefined, "kicked socket must be able to join another room without error");

  const joinedB = guest.popEvent(SERVER_EVENTS.roomJoined) as { roomId: string } | undefined;
  assert.ok(joinedB, "kicked socket must receive room_joined for room B");
  assert.equal(joinedB?.roomId, roomB.roomId);
});

// ---- VP-8.2: Solo-timer restart on kick ----

test("T8.2-03: kicking last guest emits peer_left with soloHostDeadlineAt to host", () => {
  const TIME = 1_000_000;
  const { io } = setupHarness({ now: () => TIME });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: guestJoined.participantId,
  });

  // host receives participant_kicked broadcast then peer_left
  host.popEvent(SERVER_EVENTS.participantKicked);
  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantId: string;
    reason: string;
    participantCount: number;
    soloHostDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host must receive peer_left after kicking last guest");
  assert.equal(peerLeft.participantId, guestJoined.participantId);
  assert.equal(peerLeft.participantCount, 1, "only host remains");
  assert.ok(
    typeof peerLeft.soloHostDeadlineAt === "number",
    "soloHostDeadlineAt must be a number when kick reduces room to host-only",
  );
  assert.equal(
    peerLeft.soloHostDeadlineAt,
    TIME + SOLO_HOST_ROOM_TIMEOUT_MS,
    "soloHostDeadlineAt must equal now() + SOLO_HOST_ROOM_TIMEOUT_MS",
  );
});

test("T8.2-04: voluntary guest leave emits peer_left without soloHostDeadlineAt", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest.trigger(CLIENT_EVENTS.leaveRoom, {});

  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantId: string;
    soloHostDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host must receive peer_left after guest voluntary leave");
  assert.equal(
    peerLeft.soloHostDeadlineAt,
    undefined,
    "voluntary leave must not include soloHostDeadlineAt in peer_left",
  );
});

test("T8.2-03 variant: kick of non-last guest does not set soloHostDeadlineAt", () => {
  let participantCounter = 0;
  const { io } = setupHarness({
    generateParticipantId: () => {
      participantCounter += 1;
      return `P-${participantCounter}`;
    },
  });
  const host = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; participantId: string };

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const g1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Kick guest1 — guest2 still in room, so host is not solo
  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: g1Joined.participantId,
  });

  host.popEvent(SERVER_EVENTS.participantKicked);
  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantCount: number;
    soloHostDeadlineAt?: number | null;
  };

  assert.ok(peerLeft);
  assert.equal(peerLeft.participantCount, 2, "host + guest2 remain");
  assert.equal(
    peerLeft.soloHostDeadlineAt,
    undefined,
    "soloHostDeadlineAt must not be set when guest2 is still present",
  );
});

// ---- VP-8.5: Human-Readable Room Names ----

test("T8.5-02a: creating room with valid name returns roomName in room_created", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "vapor-test" });

  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    roomName?: string;
  };

  assert.ok(roomCreated, "room_created must be emitted");
  assert.equal(roomCreated.roomName, "vapor-test", "room_created must carry the room name");
});

test("T8.5-02b: joining by room name resolves to the correct room and returns roomName", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "vapor-test" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; roomName?: string };
  assert.equal(roomCreated.roomName, "vapor-test");

  // Join using the name (case-insensitive lookup)
  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "vapor-test", password: "pw", nickname: "Guest" });

  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    roomName?: string;
  };

  assert.ok(roomJoined, "room_joined must be emitted when joining by name");
  assert.equal(roomJoined.roomId, roomCreated.roomId, "resolved roomId must match the original room");
  assert.equal(roomJoined.roomName, "vapor-test", "room_joined must carry the room name");
});

test("T8.5-02c: joining by room name is case-insensitive", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "VaporTest" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "VAPORTEST", password: "pw", nickname: "Guest" });
  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { roomName?: string } | undefined;

  assert.ok(roomJoined, "join must succeed via case-folded name lookup");
  assert.equal(roomJoined?.roomName, "vaportest", "roomName stored and returned as normalized lowercase");
});

test("T8.5-03: duplicate room name is rejected with INVALID_SIGNAL_PAYLOAD and specific message", () => {
  let roomCounter = 0;
  const { io } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host1 = io.connect("socket-host-1");
  const host2 = io.connect("socket-host-2");

  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host1", roomName: "shared-name" });
  const first = host1.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(first, "first room must be created");

  // Second host tries to claim the same name
  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host2", roomName: "shared-name" });
  const error = popError(host2) as { code: string; message: string } | undefined;

  assert.ok(error, "duplicate name must return an error");
  assert.equal(error?.code, "INVALID_SIGNAL_PAYLOAD");
  assert.ok(
    error?.message.toLowerCase().includes("taken") || error?.message.toLowerCase().includes("invalid"),
    "error message must indicate the name is taken or invalid",
  );

  // First room must remain unaffected
  const secondCreated = host2.popEvent(SERVER_EVENTS.roomCreated);
  assert.equal(secondCreated, undefined, "duplicate-name attempt must not create a room");
});

test("T8.5-04: room name is freed and reusable after the room is destroyed", () => {
  let roomCounter = 0;
  const { io, getSnapshot } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host1 = io.connect("socket-host-1");
  const host2 = io.connect("socket-host-2");

  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host1", roomName: "reuse-me" });
  const firstRoom = host1.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(firstRoom);

  // Destroy the first room
  host1.trigger(CLIENT_EVENTS.leaveRoom, {});
  assert.equal(getSnapshot().roomCount, 0, "room must be destroyed after host leaves");

  // Second host reuses the same name
  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host2", roomName: "reuse-me" });
  const secondRoom = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; roomName?: string } | undefined;

  assert.ok(secondRoom, "second room must be created after name is freed");
  assert.equal(secondRoom?.roomName, "reuse-me", "freed name must be accepted on second creation");
  assert.notEqual(secondRoom?.roomId, firstRoom?.roomId, "new room gets a new ID");
});

test("T8.5-05: room without a name falls back to roomId in header (no roomName field)", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    roomName?: string;
  };

  assert.ok(roomCreated);
  assert.equal(roomCreated.roomName, undefined, "room_created must not carry roomName when none was provided");

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { roomName?: string };

  assert.ok(roomJoined);
  assert.equal(roomJoined.roomName, undefined, "room_joined must not carry roomName when room has none");
});

test("T8.5-05b: joining by generated ID still works when no room name is set", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { roomId: string } | undefined;

  assert.ok(roomJoined, "join by generated ID must succeed");
  assert.equal(roomJoined?.roomId, roomCreated.roomId);
});

test("T8.5-06 format: invalid room names are rejected at creation", () => {
  let roomCounter = 0;
  const { io } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });

  const invalidNames = [
    "ab",              // too short (2 chars)
    "a".repeat(25),    // too long (25 chars)
    "room name",       // space
    "room!name",       // exclamation
    "room.name",       // dot
    "room_name",       // underscore
  ];

  for (const invalidName of invalidNames) {
    const socket = io.connect(`socket-invalid-${invalidName.length}-${Math.random()}`);
    socket.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: invalidName });

    const error = popError(socket);
    assert.ok(error, `expected error for invalid name: "${invalidName}"`);
    assert.equal(
      error?.code,
      "INVALID_SIGNAL_PAYLOAD",
      `expected INVALID_SIGNAL_PAYLOAD for name: "${invalidName}"`,
    );
    assert.equal(socket.popEvent(SERVER_EVENTS.roomCreated), undefined, `no room must be created for: "${invalidName}"`);
  }
});

test("T8.5: roomNameToId state is correctly maintained across creates and destroys", () => {
  let roomCounter = 0;
  const { io, state } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "my-room" });
  const created = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(created);

  assert.equal(state.roomNameToId.get("my-room"), created.roomId, "roomNameToId must map name to roomId after creation");

  host.trigger(CLIENT_EVENTS.leaveRoom, {});

  assert.equal(state.roomNameToId.has("my-room"), false, "roomNameToId must be cleared after room is destroyed");
});
