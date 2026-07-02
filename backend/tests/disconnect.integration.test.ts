/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  IDLE_ROOM_TIMEOUT_MS,
  GUEST_DISCONNECT_GRACE_MS,
  HOST_DISCONNECT_GRACE_MS,
} from "../src/signaling/contracts";
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
    getSnapshot: () => ({
      roomCount: state.rooms.size,
    }),
  };
}

type PeerLeft = {
  participantId: string;
  reason: string;
  participantCount: number;
  soloDeadlineAt?: number | null;
};

function setupRoom(io: FakeIo, guestSocketIds: string[]) {
  const host = io.connect("socket-host");
  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as {
    roomId: string;
    participantId: string;
  };

  const guests = guestSocketIds.map((socketId, index) => {
    const guest = io.connect(socketId);
    guest.trigger(CLIENT_EVENTS.joinRoom, {
      roomId: roomCreated.roomId,
      password: "pw",
      nickname: `Guest${index + 1}`,
    });
    const joined = guest.popEvent(SERVER_EVENTS.roomJoined) as { participantId: string };
    // Drain the peer_joined broadcast from every already-present socket.
    host.popEvent(SERVER_EVENTS.peerJoined);
    return { socket: guest, participantId: joined.participantId };
  });

  return { host, hostParticipantId: roomCreated.participantId, roomId: roomCreated.roomId, guests };
}

// ---- TCP disconnect: peer_left broadcast ----

test("guest TCP drop emits peer_left (reason: disconnect) to host and other guests", () => {
  const { io } = setupHarness();
  const { host, guests } = setupRoom(io, ["socket-guest-1", "socket-guest-2"]);
  const [guest1, guest2] = guests;

  guest1.socket.triggerDisconnect();

  const hostPeerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as PeerLeft | undefined;
  const guest2PeerLeft = guest2.socket.popEvent(SERVER_EVENTS.peerLeft) as PeerLeft | undefined;

  assert.ok(hostPeerLeft, "host must receive peer_left when a guest TCP drops");
  assert.ok(guest2PeerLeft, "remaining guest must receive peer_left when another guest TCP drops");

  assert.equal(hostPeerLeft?.participantId, guest1.participantId, "peer_left carries the leaving guest's id");
  assert.equal(hostPeerLeft?.reason, "disconnect", "reason is 'disconnect' for a TCP drop");
  assert.equal(hostPeerLeft?.participantCount, 2, "live participant count drops to host + remaining guest");
  assert.equal(
    hostPeerLeft?.soloDeadlineAt,
    undefined,
    "no solo deadline while two live participants remain",
  );

  assert.equal(guest2PeerLeft?.participantId, guest1.participantId, "remaining guest sees the same leaving id");

  assert.equal(
    guest1.socket.popEvent(SERVER_EVENTS.peerLeft),
    undefined,
    "the disconnecting guest does not receive its own peer_left",
  );
});

test("guest TCP drop leaving host alone → peer_left carries soloDeadlineAt", () => {
  const TIME = 2_000_000;
  const { io } = setupHarness({ now: () => TIME });
  const { host, guests } = setupRoom(io, ["socket-guest"]);
  const [guest] = guests;

  guest.socket.triggerDisconnect();

  const peerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as PeerLeft | undefined;

  assert.ok(peerLeft, "host receives peer_left after the last guest TCP drops");
  assert.equal(peerLeft?.reason, "disconnect", "reason is 'disconnect'");
  assert.equal(peerLeft?.participantCount, 1, "only the host remains live");
  assert.equal(
    typeof peerLeft?.soloDeadlineAt,
    "number",
    "soloDeadlineAt is set because the solo timer restarted for the lone host",
  );
  assert.equal(
    peerLeft?.soloDeadlineAt,
    TIME + IDLE_ROOM_TIMEOUT_MS,
    "soloDeadlineAt equals now() + IDLE_ROOM_TIMEOUT_MS",
  );
});

test("all guests TCP drop → peer_left emitted per guest; final drop leaves host solo with a running timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const TIME = 3_000_000;
  const { io, getSnapshot } = setupHarness({ now: () => TIME });
  const { host, guests } = setupRoom(io, ["socket-guest-1", "socket-guest-2"]);
  const [guest1, guest2] = guests;

  // First guest drops — host + guest2 still live (count 2, no solo deadline).
  guest1.socket.triggerDisconnect();
  const firstPeerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as PeerLeft | undefined;
  assert.ok(firstPeerLeft, "peer_left emitted for the first guest drop");
  assert.equal(firstPeerLeft?.participantId, guest1.participantId);
  assert.equal(firstPeerLeft?.participantCount, 2, "host + second guest remain live");
  assert.equal(firstPeerLeft?.soloDeadlineAt, undefined, "no solo deadline while a guest remains");

  // Second guest drops — host alone (count 1), solo timer restarts.
  guest2.socket.triggerDisconnect();
  const secondPeerLeft = host.popEvent(SERVER_EVENTS.peerLeft) as PeerLeft | undefined;
  assert.ok(secondPeerLeft, "peer_left emitted for the second guest drop");
  assert.equal(secondPeerLeft?.participantId, guest2.participantId);
  assert.equal(secondPeerLeft?.participantCount, 1, "only the host remains live");
  assert.equal(
    secondPeerLeft?.soloDeadlineAt,
    TIME + IDLE_ROOM_TIMEOUT_MS,
    "final guest drop restarts the solo timer for the lone host",
  );

  assert.equal(getSnapshot().roomCount, 1, "room survives while the host remains connected");
});

// ---- TCP disconnect: signal relay after host disconnect ----

test("after host disconnects, remaining guests can relay signal_offer/signal_answer/signal_ice to each other", () => {
  const { io } = setupHarness();
  const { host, guests, roomId } = setupRoom(io, ["socket-guest-1", "socket-guest-2"]);
  const [guest1, guest2] = guests;

  // Host TCP drops; remaining guests receive peer_left + host_reconnect_grace.
  host.triggerDisconnect();
  // Drain broadcast events so they don't pollute signal assertions.
  guest1.socket.popEvent(SERVER_EVENTS.peerLeft);
  guest1.socket.popEvent(SERVER_EVENTS.hostReconnectGrace);
  guest2.socket.popEvent(SERVER_EVENTS.peerLeft);
  guest2.socket.popEvent(SERVER_EVENTS.hostReconnectGrace);

  // Guest1 → Guest2: signal_offer
  const SDP_OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
  guest1.socket.trigger(CLIENT_EVENTS.signalOffer, {
    roomId,
    toParticipantId: guest2.participantId,
    sdp: SDP_OFFER,
  });

  const receivedOffer = guest2.socket.popEvent(SERVER_EVENTS.signalOffer) as {
    roomId: string;
    fromParticipantId: string;
    sdp: string;
  } | undefined;

  assert.ok(receivedOffer, "Guest2 must receive signal_offer from Guest1 after host disconnects");
  assert.equal(receivedOffer?.fromParticipantId, guest1.participantId, "offer fromParticipantId is Guest1's id");
  assert.equal(receivedOffer?.sdp, SDP_OFFER, "offer SDP is relayed unchanged");
  assert.equal(receivedOffer?.roomId, roomId, "offer carries the correct roomId");

  // Guest2 → Guest1: signal_answer
  const SDP_ANSWER = "v=0\r\no=- 2 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
  guest2.socket.trigger(CLIENT_EVENTS.signalAnswer, {
    roomId,
    toParticipantId: guest1.participantId,
    sdp: SDP_ANSWER,
  });

  const receivedAnswer = guest1.socket.popEvent(SERVER_EVENTS.signalAnswer) as {
    roomId: string;
    fromParticipantId: string;
    sdp: string;
  } | undefined;

  assert.ok(receivedAnswer, "Guest1 must receive signal_answer from Guest2 after host disconnects");
  assert.equal(receivedAnswer?.fromParticipantId, guest2.participantId, "answer fromParticipantId is Guest2's id");
  assert.equal(receivedAnswer?.sdp, SDP_ANSWER, "answer SDP is relayed unchanged");

  // Guest1 → Guest2: signal_ice
  const ICE_CANDIDATE = { candidate: "candidate:1 1 UDP 2130706431 127.0.0.1 54321 typ host", sdpMid: "0", sdpMLineIndex: 0 };
  guest1.socket.trigger(CLIENT_EVENTS.signalIce, {
    roomId,
    toParticipantId: guest2.participantId,
    candidate: ICE_CANDIDATE,
  });

  const receivedIce = guest2.socket.popEvent(SERVER_EVENTS.signalIce) as {
    fromParticipantId: string;
    candidate: unknown;
  } | undefined;

  assert.ok(receivedIce, "Guest2 must receive signal_ice from Guest1 after host disconnects");
  assert.equal(receivedIce?.fromParticipantId, guest1.participantId, "ICE fromParticipantId is Guest1's id");

  // The host (disconnected, in grace window) must not receive any relayed signals.
  assert.equal(host.popEvent(SERVER_EVENTS.signalOffer), undefined, "disconnected host must not receive relayed signal_offer");
  assert.equal(host.popEvent(SERVER_EVENTS.signalAnswer), undefined, "disconnected host must not receive relayed signal_answer");
  assert.equal(host.popEvent(SERVER_EVENTS.signalIce), undefined, "disconnected host must not receive relayed signal_ice");
});

// ---- VP-11.4 Fix: guest grace expiry uses getLiveParticipantCount, not .size ----

// Replicates getLiveParticipantCount logic from registerSocketHandlers for assertion purposes.
function countLiveParticipants(room: { participants: Map<string, { socketId: string }> }): number {
  let count = 0;
  for (const p of room.participants.values()) {
    if (!p.socketId.startsWith("disconnected:")) count++;
  }
  return count;
}

type TimerEntry = { handle: { cleared: boolean; unref?: () => void }; delay: number; callback: () => void };

function interceptTimers(): { scheduledTimeouts: TimerEntry[]; restore: () => void } {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduledTimeouts: TimerEntry[] = [];

  globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number) => {
    const handle: { cleared: boolean; unref?: () => void } = { cleared: false, unref: () => undefined };
    scheduledTimeouts.push({ handle, delay: Number(delay ?? 0), callback: () => callback() });
    return handle as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const h = handle as unknown as { cleared?: boolean };
    if (h) h.cleared = true;
  }) as typeof clearTimeout;

  return {
    scheduledTimeouts,
    restore: () => {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("T11.4-01: guest grace expiry with another guest still in grace — room not destroyed, live count correct", () => {
  const { scheduledTimeouts, restore } = interceptTimers();

  try {
    const { io, state } = setupHarness();
    const { host, guests, roomId } = setupRoom(io, ["socket-g1", "socket-g2"]);
    const [g1, g2] = guests;

    // setupRoom drains peerJoined from host only; drain the one G1 received when G2 joined
    g1.socket.popEvent(SERVER_EVENTS.peerJoined);

    // G1 disconnects — guest grace timer scheduled (GUEST_DISCONNECT_GRACE_MS)
    g1.socket.triggerDisconnect();
    host.popEvent(SERVER_EVENTS.peerLeft);
    g2.socket.popEvent(SERVER_EVENTS.peerLeft);

    // G2 disconnects — guest grace timer scheduled; host becomes solo (solo timer also scheduled)
    g2.socket.triggerDisconnect();
    host.popEvent(SERVER_EVENTS.peerLeft);

    // G1's grace timer is the first GUEST_DISCONNECT_GRACE_MS entry (registered before G2's)
    const g1GraceTimer = scheduledTimeouts.find(
      (e) => e.delay === GUEST_DISCONNECT_GRACE_MS && !e.handle.cleared,
    );
    assert.ok(g1GraceTimer, "G1 guest grace timer must be scheduled on disconnect");
    g1GraceTimer.handle.cleared = true;
    g1GraceTimer.callback();

    // Room must still exist: host is live, G2 sentinel is still in grace
    assert.equal(state.rooms.has(roomId), true, "room must not be destroyed while G2 is still in grace and host is live");

    const room = state.rooms.get(roomId);
    assert.ok(room, "room state must be accessible");

    // handleGuestGraceExpired deleted G1 from participants; host (live) + G2 (sentinel) remain
    assert.equal(room.participants.size, 2, "participants.size must be 2 (host + G2 sentinel)");
    assert.equal(countLiveParticipants(room), 1, "getLiveParticipantCount must be 1 (host only; G2 sentinel excluded)");
    assert.equal(room.participants.has(g1.participantId), false, "G1 must be removed from participants map by grace expiry");

    assert.equal(host.popEvent(SERVER_EVENTS.roomDestroyed), undefined, "host must not receive room_destroyed");
    assert.equal(g2.socket.popEvent(SERVER_EVENTS.roomDestroyed), undefined, "G2 must not receive room_destroyed");
  } finally {
    restore();
  }
});

test("T11.4-02: guest grace expiry with only host sentinel remaining — solo timer destroys room", () => {
  const { scheduledTimeouts, restore } = interceptTimers();

  try {
    const { io, state } = setupHarness();
    const { host, guests, roomId } = setupRoom(io, ["socket-g1"]);
    const [g1] = guests;

    // Host disconnects — enters host grace (sentinel); liveCount=1 (G1 still live) → solo timer starts
    host.triggerDisconnect();
    g1.socket.popEvent(SERVER_EVENTS.peerLeft);
    g1.socket.popEvent(SERVER_EVENTS.hostReconnectGrace);

    // G1 disconnects — guest grace timer scheduled (GUEST_DISCONNECT_GRACE_MS); liveCount=0
    g1.socket.triggerDisconnect();
    host.popEvent(SERVER_EVENTS.peerLeft); // drain: host socket is still in FakeIo room membership

    // Pre-expiry: both participants are sentinels, getLiveParticipantCount = 0
    const roomBeforeExpiry = state.rooms.get(roomId);
    assert.ok(roomBeforeExpiry, "room must exist before G1 grace expires");
    assert.equal(roomBeforeExpiry.participants.size, 2, "participants must hold both sentinels (host + G1) before expiry");
    assert.equal(countLiveParticipants(roomBeforeExpiry), 0, "no live participants: both host and G1 are sentinels");

    // Fire G1 guest-grace — sentinel cleanup only; does NOT destroy the room
    const g1GraceTimer = scheduledTimeouts.find(
      (e) => e.delay === GUEST_DISCONNECT_GRACE_MS && !e.handle.cleared,
    );
    assert.ok(g1GraceTimer, "G1 guest grace timer must be scheduled on disconnect");
    g1GraceTimer.handle.cleared = true;
    g1GraceTimer.callback();

    // Room survives guest-grace expiry — G1 sentinel cleaned up, host sentinel + room persist
    assert.equal(state.rooms.has(roomId), true, "room must survive guest-grace expiry; solo timer owns empty-room destruction");
    const roomAfterGuestGrace = state.rooms.get(roomId);
    assert.ok(roomAfterGuestGrace, "room state must be accessible after G1 grace");
    assert.equal(roomAfterGuestGrace.participants.size, 1, "only host sentinel remains after G1 grace cleanup");

    // Solo timer fires (armed when host disconnected with liveCount=1) → destroys room
    const soloTimer = scheduledTimeouts.find(
      (e) => e.delay === IDLE_ROOM_TIMEOUT_MS && !e.handle.cleared,
    );
    assert.ok(soloTimer, "solo/empty-room timer must be scheduled (armed when host disconnected with liveCount=1)");
    soloTimer.handle.cleared = true;
    soloTimer.callback();

    assert.equal(state.rooms.has(roomId), false, "room must be destroyed when solo timer fires");
    assert.equal(state.rooms.size, 0, "no rooms must remain in state after destruction");
  } finally {
    restore();
  }
});

test("T11.4-03: guest grace expiry with host still live — room survives, live count correct", () => {
  const { scheduledTimeouts, restore } = interceptTimers();

  try {
    const { io, state } = setupHarness();
    const { host, guests, roomId } = setupRoom(io, ["socket-g1"]);
    const [g1] = guests;

    // G1 disconnects — guest grace timer scheduled; host becomes solo (solo timer restarted)
    g1.socket.triggerDisconnect();
    host.popEvent(SERVER_EVENTS.peerLeft);

    const g1GraceTimer = scheduledTimeouts.find(
      (e) => e.delay === GUEST_DISCONNECT_GRACE_MS && !e.handle.cleared,
    );
    assert.ok(g1GraceTimer, "G1 guest grace timer must be scheduled on disconnect");
    g1GraceTimer.handle.cleared = true;
    g1GraceTimer.callback();

    // Room must still exist: host is live (getLiveParticipantCount = 1)
    assert.equal(state.rooms.has(roomId), true, "room must survive when the host is still live");

    const room = state.rooms.get(roomId);
    assert.ok(room, "room state must be accessible");

    // handleGuestGraceExpired deleted G1; only host remains
    assert.equal(room.participants.size, 1, "participants.size must be 1 (only host remains after G1 removal)");
    assert.equal(countLiveParticipants(room), 1, "getLiveParticipantCount must be 1 (host is live)");
    assert.equal(room.participants.has(g1.participantId), false, "G1 must be removed from participants map by grace expiry");

    assert.equal(host.popEvent(SERVER_EVENTS.roomDestroyed), undefined, "host must not receive room_destroyed");
  } finally {
    restore();
  }
});

// ---- CR15-02: second disconnect at liveCount → 0 restarts idle timer fresh ----

test("T-CR15-02: second disconnect at liveCount → 0 restarts idle timer fresh from guest-disconnect moment", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const FIRST_TICK = 1_000; // advance clock between host and guest drops

  const { io, getSnapshot } = setupHarness();
  const host = io.connect("socket-host");
  const guest = io.connect("socket-guest");

  host.trigger(CLIENT_EVENTS.createRoom, { password: "pw", nickname: "Host" });
  const roomCreated = host.popEvent(SERVER_EVENTS.roomCreated) as { roomId: string };

  guest.trigger(CLIENT_EVENTS.joinRoom, { roomId: roomCreated.roomId, password: "pw", nickname: "Guest" });
  guest.popEvent(SERVER_EVENTS.roomJoined);
  host.popEvent(SERVER_EVENTS.peerJoined);

  // Host drops → liveCount → 1 → idle timer armed (fires at mock-time IDLE_ROOM_TIMEOUT_MS)
  host.triggerDisconnect();
  guest.popEvent(SERVER_EVENTS.peerLeft);
  guest.popEvent(SERVER_EVENTS.hostReconnectGrace);

  // Advance clock partially — before the original deadline
  t.mock.timers.tick(FIRST_TICK);
  assert.equal(getSnapshot().roomCount, 1, "room alive after FIRST_TICK");

  // Guest drops → liveCount → 0 → reconcileIdleTimer clears old timer and restarts fresh
  // New timer fires at mock-time (FIRST_TICK + IDLE_ROOM_TIMEOUT_MS)
  guest.triggerDisconnect();

  // Tick to the original deadline — old timer is gone; new timer hasn't fired yet
  t.mock.timers.tick(IDLE_ROOM_TIMEOUT_MS - FIRST_TICK);
  assert.equal(
    getSnapshot().roomCount,
    1,
    "room must survive past original host-disconnect deadline — idle timer was restarted from guest-disconnect moment",
  );

  // Tick the remaining FIRST_TICK to hit the fresh deadline
  t.mock.timers.tick(FIRST_TICK);
  assert.equal(getSnapshot().roomCount, 0, "room destroyed at fresh idle timer deadline from guest-disconnect moment");

  const destroyed = guest.popEvent(SERVER_EVENTS.roomDestroyed) as { reason: string } | undefined;
  assert.ok(destroyed, "socket receives room_destroyed after fresh idle timer fires");
  assert.equal(destroyed?.reason, "solo_timeout_expired", "destroy reason is solo_timeout_expired");
});
