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
    TIME + SOLO_HOST_ROOM_TIMEOUT_MS,
    "soloDeadlineAt equals now() + SOLO_HOST_ROOM_TIMEOUT_MS",
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
    TIME + SOLO_HOST_ROOM_TIMEOUT_MS,
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
