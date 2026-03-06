import test from "node:test";
import assert from "node:assert/strict";
import { createVaporServer } from "../src/server";
import { CLIENT_EVENTS, SERVER_EVENTS } from "../src/signaling/contracts";
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
    now: () => 123456,
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
    state,
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

  const errorPayload = guest.popEvent(SERVER_EVENTS.error) as { code: string; message: string };
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "ROOM_NOT_FOUND");
  assert.equal(errorPayload.message, "Room not found");
});

test("P0-JN-002 edge: missing roomId payload returns deterministic ROOM_NOT_FOUND", () => {
  const { io, hooks } = setupSocketHarness();
  const guest = io.connect("socket-guest");

  guest.trigger(CLIENT_EVENTS.joinRoom, { password: "pw" });

  const errorPayload = guest.popEvent(SERVER_EVENTS.error) as { code: string; message: string };
  assert.ok(errorPayload);
  assert.equal(errorPayload.code, "ROOM_NOT_FOUND");
  assert.equal(errorPayload.message, "Room not found");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("P0-DC-006 / P0-DC-008: guest disconnect follows leave-equivalent cleanup and keeps room active", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest.triggerDisconnect();
  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantId: string;
    reason: string;
    participantCount: number;
  };

  assert.ok(peerLeft);
  assert.equal(peerLeft.reason, "disconnect");
  assert.equal(peerLeft.participantCount, 1);

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 1);
  assert.equal(snapshot.rooms[0]?.participantCount, 1);
});

test("P0-DC-006: host disconnect destroys room and notifies guests", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.triggerDisconnect();

  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string };
  assert.ok(roomDestroyed);
  assert.equal(roomDestroyed.reason, "host_disconnected");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
  assert.equal(snapshot.participantToRoomCount, 0);
  assert.equal(snapshot.socketToParticipantCount, 0);
});

test("P0-LV-005 / P0-LV-006: guest leave_room should remove participant and emit peer_left", () => {
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

test("P0-LV-008: host leave_room should destroy room immediately", () => {
  const { io, hooks } = setupSocketHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: "AbC123", password: "pw" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.leaveRoom, { roomId: "AbC123" });

  const roomDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed);
  assert.ok(roomDestroyed, "Expected room_destroyed after host leave_room");

  const snapshot = hooks.getStateSnapshot();
  assert.equal(snapshot.roomCount, 0);
});

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
