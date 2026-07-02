/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_EVENTS, SERVER_EVENTS, IDLE_ROOM_TIMEOUT_MS } from "../src/signaling/contracts";
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

  leaveRoom(roomId: string, socket: FakeSocket): void {
    this.roomMembership.get(roomId)?.delete(socket);
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

  leave(roomId: string): void {
    this.io.leaveRoom(roomId, this);
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

  peekAllEvents(): Array<{ event: string; payload: EventPayload }> {
    return [...this.inboundEvents];
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

  return { io, state, getSnapshot: () => ({ roomCount: state.rooms.size }) };
}

function popError(socket: FakeSocket): { code: string; message: string } | undefined {
  return socket.popEvent(SERVER_EVENTS.error) as { code: string; message: string } | undefined;
}

// ---- Kick: post-kick socket recovery ----

test("kicked participant can immediately create a new room (no server-side block)", () => {
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

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: firstRoom.roomId,
    targetParticipantId: guestJoined.participantId,
  });

  guest.popEvent(SERVER_EVENTS.participantKicked);

  guest.trigger(CLIENT_EVENTS.createRoom, { password: "pw2", nickname: "NewHost" });

  const error = popError(guest);
  assert.equal(error, undefined, "kicked socket must be able to create a new room without error");

  const newRoom = guest.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string } | undefined;
  assert.ok(newRoom, "kicked socket must receive room_created for the new room");
  assert.notEqual(newRoom?.roomId, firstRoom.roomId, "new room must have a different ID");
});

test("kicked participant can immediately join a different room (no server-side block)", () => {
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

  host1.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host1" });
  const roomA = host1.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  host2.trigger(CLIENT_EVENTS.createRoom, { password: "pw2", nickname: "Host2" });
  const roomB = host2.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomA.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host1.popEvent(SERVER_EVENTS.peerJoined);

  host1.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomA.roomId,
    targetParticipantId: guestJoined.participantId,
  });
  guest.popEvent(SERVER_EVENTS.participantKicked);

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomB.roomId, password: "pw2", nickname: "Guest" });

  const error = popError(guest);
  assert.equal(error, undefined, "kicked socket must be able to join another room without error");

  const joinedB = guest.popEvent(SERVER_EVENTS.roomJoined) as { roomId: string } | undefined;
  assert.ok(joinedB, "kicked socket must receive room_joined for room B");
  assert.equal(joinedB?.roomId, roomB.roomId);
});

// ---- Kick: solo-timer restart ----

test("kicking the last guest emits peer_left with soloDeadlineAt to the host", () => {
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

  host.popEvent(SERVER_EVENTS.participantKicked);
  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantId: string;
    reason: string;
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host must receive peer_left after kicking last guest");
  assert.equal(peerLeft.participantId, guestJoined.participantId);
  assert.equal(peerLeft.reason, "kick", "peer_left from kick path must carry reason 'kick'");
  assert.equal(peerLeft.participantCount, 1, "only host remains");
  assert.ok(
    typeof peerLeft.soloDeadlineAt === "number",
    "soloDeadlineAt must be a number when kick reduces room to host-only",
  );
  assert.equal(
    peerLeft.soloDeadlineAt,
    TIME + IDLE_ROOM_TIMEOUT_MS,
    "soloDeadlineAt must equal now() + IDLE_ROOM_TIMEOUT_MS",
  );
});

test("kicking a non-last guest does not set soloDeadlineAt (other guests remain)", () => {
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

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: g1Joined.participantId,
  });

  host.popEvent(SERVER_EVENTS.participantKicked);
  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft);
  assert.equal(peerLeft.participantCount, 2, "host + guest2 remain");
  assert.equal(
    peerLeft.soloDeadlineAt,
    undefined,
    "soloDeadlineAt must not be set when guest2 is still present",
  );
});

test("non-last guest voluntary leave does not set soloDeadlineAt", () => {
  let participantCounter = 0;
  const { io } = setupHarness({
    generateParticipantId: () => {
      participantCounter += 1;
      return `P-${participantCounter}`;
    },
  });
  const host   = io.connect("socket-host");
  const guest1 = io.connect("socket-guest-1");
  const guest2 = io.connect("socket-guest-2");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  guest1.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest1.trigger(CLIENT_EVENTS.leaveRoom, {});

  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as {
    participantId: string;
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host must receive peer_left after guest1 voluntary leave");
  assert.equal(peerLeft.participantCount, 2, "host + guest2 still in room");
  assert.equal(
    peerLeft.soloDeadlineAt,
    undefined,
    "soloDeadlineAt must not be set when other participants remain after the leave",
  );
});

// ---- Kick: event delivery and ordering (VP-11.6) ----

test("kicked socket receives participant_kicked but not peer_left about itself", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  const guestJoined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: guestJoined.participantId,
  });

  const kicked = guest.popEvent(SERVER_EVENTS.participantKicked) as { participantId: string } | undefined;
  assert.ok(kicked, "kicked socket must receive participant_kicked");
  assert.equal(kicked?.participantId, guestJoined.participantId, "participant_kicked must carry the kicked participant's id");

  const guestPeerLeft = guest.popEvent(SERVER_EVENTS.peerLeft);
  assert.equal(guestPeerLeft, undefined, "kicked socket must NOT receive peer_left about itself");

  const hostPeerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as { reason: string; participantId: string } | undefined;
  assert.ok(hostPeerLeft, "host must receive peer_left after the kick");
  assert.equal(hostPeerLeft?.reason, "kick", "peer_left to remaining participants must carry reason 'kick'");
  assert.equal(hostPeerLeft?.participantId, guestJoined.participantId);
});

test("participant_kicked arrives before peer_left in remaining participants' event queue", () => {
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
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const g1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);
  guest1.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: g1Joined.participantId,
  });

  const guest2Events = guest2.peekAllEvents();
  const kickedIdx = guest2Events.findIndex((e) => e.event === SERVER_EVENTS.participantKicked);
  const peerLeftIdx = guest2Events.findIndex((e) => e.event === SERVER_EVENTS.peerLeft);

  assert.ok(kickedIdx >= 0, "guest2 must receive participant_kicked");
  assert.ok(peerLeftIdx >= 0, "guest2 must receive peer_left");
  assert.ok(kickedIdx < peerLeftIdx, "participant_kicked must arrive before peer_left in the event queue");
});

test("peer_left emitted after kick carries reason 'kick'", () => {
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
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest1.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest1" });
  const g1Joined = guest1.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
  host.popEvent(SERVER_EVENTS.peerJoined);

  guest2.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest2" });
  guest2.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  host.trigger(CLIENT_EVENTS.kickParticipant, {
    roomId: roomCreated.roomId,
    targetParticipantId: g1Joined.participantId,
  });

  const guest2PeerLeft = guest2.popEvent(SERVER_EVENTS.peerLeft) as {
    reason: string;
    participantId: string;
  } | undefined;

  assert.ok(guest2PeerLeft, "guest2 must receive peer_left when another guest is kicked");
  assert.equal(guest2PeerLeft?.reason, "kick", "peer_left from kick path must carry reason 'kick'");
  assert.equal(guest2PeerLeft?.participantId, g1Joined.participantId, "peer_left must identify the kicked participant");
});
