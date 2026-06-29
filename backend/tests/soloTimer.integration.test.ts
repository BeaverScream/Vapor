/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  SOLO_HOST_ROOM_TIMEOUT_MS,
} from "../src/signaling/contracts";
import { registerSocketHandlers } from "../src/signaling/registerSocketHandlers";
import { createSignalingState } from "../src/signaling/state";
import type { SignalingState } from "../src/signaling/state";

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
    getSnapshot: () => ({
      roomCount: state.rooms.size,
      roomNameToId: state.roomNameToId,
    }),
  };
}

function popError(socket: FakeSocket): { code: string; message: string } | undefined {
  return socket.popEvent(SERVER_EVENTS.error) as { code: string; message: string } | undefined;
}

// ---- Solo timer: leaveRoom triggers soloDeadlineAt ----

test("last guest voluntarily leaves → peer_left carries soloDeadlineAt for the host", () => {
  const TIME = 1_000_000;
  const { io } = setupHarness({ now: () => TIME });
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
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host must receive peer_left after guest voluntarily leaves");
  assert.equal(peerLeft.participantCount, 1, "only host remains in the room");
  assert.ok(
    typeof peerLeft.soloDeadlineAt === "number",
    "soloDeadlineAt must be a number when the last guest voluntarily leaves",
  );
  assert.equal(
    peerLeft.soloDeadlineAt,
    TIME + SOLO_HOST_ROOM_TIMEOUT_MS,
    "soloDeadlineAt must equal now() + SOLO_HOST_ROOM_TIMEOUT_MS",
  );
});

test("non-last guest leaving does not set soloDeadlineAt", () => {
  const { io } = setupHarness();
  const host = io.connect("socket-host");
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
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host receives peer_left");
  assert.equal(peerLeft.participantCount, 2, "host + guest2 remain");
  assert.equal(
    peerLeft.soloDeadlineAt,
    undefined,
    "soloDeadlineAt must not be set when other participants remain",
  );
});

// ---- Solo timer: kick regression guard ----

test("kick of last guest still emits soloDeadlineAt in peer_left after restartSoloTimer refactor", () => {
  const TIME = 5_000_000;
  const { io } = setupHarness({ now: () => TIME });
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };

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
    participantCount: number;
    soloDeadlineAt?: number | null;
  };

  assert.ok(peerLeft, "host receives peer_left after kicking last guest");
  assert.equal(peerLeft.participantCount, 1, "only host remains after kick");
  assert.ok(
    typeof peerLeft.soloDeadlineAt === "number",
    "kick handler still emits soloDeadlineAt after restartSoloTimer refactor",
  );
  assert.equal(
    peerLeft.soloDeadlineAt,
    TIME + SOLO_HOST_ROOM_TIMEOUT_MS,
    "soloDeadlineAt equals now() + SOLO_HOST_ROOM_TIMEOUT_MS",
  );
});

// ---- Solo timer: TCP drop → timer fires → room destroyed ----

test("all participants TCP drop → solo timer fires → room destroyed with solo_timeout_expired", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Guest drops first → liveCount becomes 1 (host still live) → solo timer restarts
  guest.triggerDisconnect();
  host.popEvent(SERVER_EVENTS.peerLeft); // consume the peerLeft broadcast

  // Host drops → liveCount becomes 0 → solo timer from guest drop continues running
  host.triggerDisconnect();

  assert.equal(getSnapshot().roomCount, 1, "room still exists after both TCP drops");

  t.mock.timers.tick(SOLO_HOST_ROOM_TIMEOUT_MS);

  assert.equal(getSnapshot().roomCount, 0, "room destroyed after solo timer fires");

  const hostDestroyed = host.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
  assert.ok(hostDestroyed, "host socket receives room_destroyed");
  assert.equal(hostDestroyed?.reason, "solo_timeout_expired", "destroy reason is solo_timeout_expired");
});

test("host drops first then guest → solo timer from host disconnect fires → room destroyed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host drops first → liveCount becomes 1 (guest still live) → solo timer restarts
  host.triggerDisconnect();
  // Guest drops → liveCount becomes 0 → solo timer from host drop continues running
  guest.triggerDisconnect();

  assert.equal(getSnapshot().roomCount, 1, "room still exists after both drops");

  t.mock.timers.tick(SOLO_HOST_ROOM_TIMEOUT_MS);

  assert.equal(getSnapshot().roomCount, 0, "room destroyed after solo timer fires");

  const guestDestroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
  assert.ok(guestDestroyed, "guest socket receives room_destroyed");
  assert.equal(guestDestroyed?.reason, "solo_timeout_expired");
});

// ---- Solo timer: reconnect before timer fires ----

test("participant reconnects before solo timer fires → room_joined emitted → room survives", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Both TCP drop (solo timer starts when guest drops: liveCount → 1)
  guest.triggerDisconnect();
  host.popEvent(SERVER_EVENTS.peerLeft); // consume
  host.triggerDisconnect();

  assert.equal(getSnapshot().roomCount, 1, "room still alive before any timer fires");

  // Host reconnects before the solo timer fires (timers not ticked yet)
  const reconnectSocket = io.connect("socket-reconnect");
  reconnectSocket.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken,
  });

  const resumed = reconnectSocket.popEvent(SERVER_EVENTS.roomJoined) as
    | { roomId: string; participantId: string }
    | undefined;

  assert.ok(resumed, "room_joined received — reconnect succeeded before solo timer fired");
  assert.equal(resumed?.roomId, roomCreated.roomId, "reconnected to the same room");
  assert.equal(getSnapshot().roomCount, 1, "room still alive after successful reconnect");
  assert.equal(popError(reconnectSocket), undefined, "no error on successful reconnect");
});

test("reconnect with solo host resets the timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    reconnectToken: string;
  };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Both TCP drop
  guest.triggerDisconnect();
  host.popEvent(SERVER_EVENTS.peerLeft);
  host.triggerDisconnect();

  // Host reconnects
  const reconnectSocket = io.connect("socket-reconnect");
  reconnectSocket.trigger(CLIENT_EVENTS.resumeSession, {
    roomId: roomCreated.roomId,
    reconnectToken: roomCreated.reconnectToken,
  });

  const resumed = reconnectSocket.popEvent(SERVER_EVENTS.roomJoined);
  assert.ok(resumed, "host reconnect succeeds");
  assert.equal(getSnapshot().roomCount, 1, "room alive after reconnect");

  // After reconnect with solo host (liveCount===1), solo timer is restarted.
  t.mock.timers.tick(SOLO_HOST_ROOM_TIMEOUT_MS);
  assert.equal(getSnapshot().roomCount, 0, "room destroyed after reconnected solo-host timer fires");
});

// ---- Solo timer: host-alone TCP drop ----

test("host TCP drops when alone → solo timer from creation fires → room destroyed with solo_timeout_expired", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  host.popEvent(SERVER_EVENTS.roomCreated);

  assert.equal(getSnapshot().roomCount, 1, "room exists after creation");

  host.triggerDisconnect();

  assert.equal(getSnapshot().roomCount, 1, "room still alive after host TCP drop (grace windows active)");

  t.mock.timers.tick(SOLO_HOST_ROOM_TIMEOUT_MS);

  assert.equal(getSnapshot().roomCount, 0, "room destroyed by solo timer (not by the longer host grace)");

  const destroyed = host.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
  assert.ok(destroyed, "host socket receives room_destroyed event");
  assert.equal(destroyed?.reason, "solo_timeout_expired", "destroy reason is solo_timeout_expired, not host_grace_expired");
});
