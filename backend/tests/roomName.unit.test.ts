/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import { validateRoomName } from "../src/signaling/backendUtils";

// ---- VP-8.5: validateRoomName ----

test("T8.5-06a: accepts a minimal 3-character name", () => {
  assert.equal(validateRoomName("abc"), "abc");
});

test("T8.5-06b: accepts a 24-character name (maximum)", () => {
  const name = "a".repeat(24);
  assert.equal(validateRoomName(name), name);
});

test("T8.5-06c: accepts alphanumeric and hyphens", () => {
  assert.equal(validateRoomName("my-room-1"), "my-room-1");
  assert.equal(validateRoomName("vapor-chat-2025"), "vapor-chat-2025");
  assert.equal(validateRoomName("abc123"), "abc123");
});

test("T8.5-06d: normalizes uppercase input to lowercase", () => {
  assert.equal(validateRoomName("MyRoom"), "myroom");
  assert.equal(validateRoomName("A1B"), "a1b");
  assert.equal(validateRoomName("VAPOR"), "vapor");
});

test("T8.5-06e: rejects a 2-character name (too short)", () => {
  assert.equal(validateRoomName("ab"), null);
});

test("T8.5-06f: rejects empty string", () => {
  assert.equal(validateRoomName(""), null);
});

test("T8.5-06g: rejects a 25-character name (too long)", () => {
  assert.equal(validateRoomName("a".repeat(25)), null);
});

test("T8.5-06h: rejects names with spaces", () => {
  assert.equal(validateRoomName("hello world"), null);
  assert.equal(validateRoomName("room name"), null);
  assert.equal(validateRoomName("   "), null);
});

test("T8.5-06i: rejects names with special characters", () => {
  assert.equal(validateRoomName("hi!"), null);
  assert.equal(validateRoomName("room@2025"), null);
  assert.equal(validateRoomName("room.chat"), null);
  assert.equal(validateRoomName("room_chat"), null);
  assert.equal(validateRoomName("room#1"), null);
});

test("T8.5-06j: rejects non-string inputs", () => {
  assert.equal(validateRoomName(42), null);
  assert.equal(validateRoomName(null), null);
  assert.equal(validateRoomName(undefined), null);
  assert.equal(validateRoomName({}), null);
  assert.equal(validateRoomName([]), null);
});

test("T8.5-06k: accepts exactly 3 characters with hyphen", () => {
  assert.equal(validateRoomName("a-b"), "a-b");
});

test("T8.5-06l: hyphens are accepted in any position (pattern allows [a-z0-9-])", () => {
  assert.equal(validateRoomName("-abc"), "-abc");
  assert.equal(validateRoomName("abc-"), "abc-");
  assert.equal(validateRoomName("-a-b-"), "-a-b-");
});
