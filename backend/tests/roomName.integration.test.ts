/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../src/signaling/contracts";
import { registerSocketHandlers } from "../src/signaling/registerSocketHandlers";
import { createSignalingState } from "../src/signaling/state";

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
      },
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
      },
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

  return {
    io,
    state,
    getSnapshot: () => ({ roomCount: state.rooms.size, roomNameToId: state.roomNameToId }),
  };
}

function popError(socket: FakeSocket): { code: string; message: string } | undefined {
  return socket.popEvent(SERVER_EVENTS.error) as { code: string; message: string } | undefined;
}

// ---- Room name: creation and join ----

test("creating room with valid name returns roomName in room_created", () => {
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

test("joining by room name resolves to the correct room and returns roomName", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "vapor-test" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; roomName?: string };
  assert.equal(roomCreated.roomName, "vapor-test");

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "vapor-test", password: "pw", nickname: "Guest" });

  const roomJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as {
    roomId: string;
    roomName?: string;
  };

  assert.ok(roomJoined, "room_joined must be emitted when joining by name");
  assert.equal(roomJoined.roomId, roomCreated.roomId, "resolved roomId must match the original room");
  assert.equal(roomJoined.roomName, "vapor-test", "room_joined must carry the room name");
});

test("joining by room name is case-insensitive", () => {
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

test("room without a name does not carry roomName in room_created or room_joined", () => {
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

test("joining by generated ID works when no room name is set", () => {
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

// ---- Room name: uniqueness and reuse ----

test("duplicate room name is rejected with INVALID_SIGNAL_PAYLOAD", () => {
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

  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host2", roomName: "shared-name" });
  const error = popError(host2) as { code: string; message: string } | undefined;

  assert.ok(error, "duplicate name must return an error");
  assert.equal(error?.code, "INVALID_SIGNAL_PAYLOAD");
  assert.ok(
    error?.message.toLowerCase().includes("taken") || error?.message.toLowerCase().includes("invalid"),
    "error message must indicate the name is taken or invalid",
  );

  const secondCreated = host2.popEvent(SERVER_EVENTS.roomCreated);
  assert.equal(secondCreated, undefined, "duplicate-name attempt must not create a room");
});

test("room name is freed and reusable after the room is destroyed", () => {
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

  host1.trigger(CLIENT_EVENTS.leaveRoom, {});
  assert.equal(getSnapshot().roomCount, 0, "room must be destroyed after host leaves");

  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host2", roomName: "reuse-me" });
  const secondRoom = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; roomName?: string } | undefined;

  assert.ok(secondRoom, "second room must be created after name is freed");
  assert.equal(secondRoom?.roomName, "reuse-me", "freed name must be accepted on second creation");
  assert.notEqual(secondRoom?.roomId, firstRoom?.roomId, "new room gets a new ID");
});

// ---- Room name: validation ----

test("invalid room names are rejected at creation", () => {
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

// ---- Room name: state map consistency ----

test("roomNameToId is correctly maintained across creates and destroys", () => {
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

test("room name is removed from roomNameToId when room is destroyed (clearRoomArtifacts)", () => {
  let roomCounter = 0;
  const { io, state, getSnapshot } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host", roomName: "my-test-room" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  assert.equal(
    state.roomNameToId.has("my-test-room"),
    true,
    "roomNameToId must contain the room name after creation",
  );

  host.trigger(CLIENT_EVENTS.leaveRoom, {});

  assert.equal(getSnapshot().roomCount, 0, "room removed from state after host leaves");
  assert.equal(
    state.roomNameToId.has("my-test-room"),
    false,
    "roomNameToId must be cleared after room is destroyed",
  );
});

test("freed room name can be claimed by a new room", () => {
  let roomCounter = 0;
  const { io, getSnapshot } = setupHarness({
    generateRoomId: () => {
      roomCounter += 1;
      return `ROOM-${roomCounter}`;
    },
  });
  const host1 = io.connect("socket-host-1");
  const host2 = io.connect("socket-host-2");

  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host1", roomName: "shared-name" });
  const first = host1.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(first);

  host1.trigger(CLIENT_EVENTS.leaveRoom, {});
  assert.equal(getSnapshot().roomCount, 0, "first room destroyed");

  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host2", roomName: "shared-name" });
  const second = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string; roomName?: string } | undefined;

  assert.ok(second, "second room created after name freed");
  assert.equal(second?.roomName, "shared-name", "freed name accepted on second creation");
  assert.notEqual(second?.roomId, first?.roomId, "new room has a different ID");
  assert.equal(popError(host2), undefined, "no error on second creation with same name");
});
