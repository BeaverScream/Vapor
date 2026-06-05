/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoomRecord,
  joinRoomRecord,
  removeParticipantBySocket,
  type RoomIdentityFactories
} from "../src/signaling/roomLifecycle";
import { createSignalingState } from "../src/signaling/state";

function createFactories(roomIds: string[]): RoomIdentityFactories {
  let roomIndex = 0;
  let participantCounter = 0;

  return {
    generateRoomId: () => {
      const fallback = roomIds[roomIds.length - 1] ?? "ROOMXX";
      const value = roomIds[roomIndex] ?? fallback;
      roomIndex += 1;
      return value;
    },
    generateParticipantId: () => {
      participantCounter += 1;
      return `P-${participantCounter}`;
    }
  };
}

test("T0.1-01: createRoomRecord enforces unique room id when factory collides", () => {
  const state = createSignalingState();
  const factories = createFactories(["ABCD12", "ABCD12", "ZXCV98"]);

  const first = createRoomRecord(state, "socket-a", 100, factories);
  const second = createRoomRecord(state, "socket-b", 101, factories);

  assert.equal(first.room.roomId, "ABCD12");
  assert.equal(second.room.roomId, "ZXCV98");
  assert.equal(state.rooms.size, 2);
});

test("T0.1-02: joinRoomRecord returns null when room does not exist", () => {
  const state = createSignalingState();

  const joined = joinRoomRecord(state, "MISSING", "socket-a", 123, () => "P-1");

  assert.equal(joined, null);
  assert.equal(state.rooms.size, 0);
  assert.equal(state.participantToRoom.size, 0);
  assert.equal(state.socketToParticipant.size, 0);
});

test("T0.2-01: removeParticipantBySocket returns null for unknown socket", () => {
  const state = createSignalingState();

  const removed = removeParticipantBySocket(state, "unknown-socket");

  assert.equal(removed, null);
});

test("T0.2-02: host removal atomically purges participant/socket indexes", () => {
  const state = createSignalingState();
  const factories = createFactories(["ROOM01"]);

  const host = createRoomRecord(state, "socket-host", 10, factories);
  const guestJoin = joinRoomRecord(state, host.room.roomId, "socket-guest", 11, factories.generateParticipantId);

  assert.ok(guestJoin);
  assert.equal(state.rooms.size, 1);

  const removed = removeParticipantBySocket(state, "socket-host");

  if (!removed) {
    throw new Error("Expected host removal result");
  }

  assert.equal(removed.isHost, true);
  assert.equal(removed.roomStillActive, false);
  assert.equal(state.rooms.size, 0);
  assert.equal(state.participantToRoom.size, 0);
  assert.equal(state.socketToParticipant.size, 0);
});

test("T0.2-03: removing last guest destroys now-empty room", () => {
  const state = createSignalingState();
  const factories = createFactories(["ROOM02"]);

  const host = createRoomRecord(state, "socket-host", 10, factories);
  const removedHost = removeParticipantBySocket(state, "socket-host");

  if (!removedHost) {
    throw new Error("Expected host removal result");
  }

  assert.equal(removedHost.roomStillActive, false);
  assert.equal(state.rooms.size, 0);
  assert.equal(state.participantToRoom.size, 0);
  assert.equal(state.socketToParticipant.size, 0);
  assert.equal(host.room.roomId, "ROOM02");
});
