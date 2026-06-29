/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import {
  createGraceWindowContext,
  createRoomPolicy,
  restartSoloTimer,
} from "../src/signaling/handlers/graceWindowManager";

const SOLO_TIMEOUT_MS = 15 * 60 * 1000;
const TTL_MS = 60 * 60 * 1000;

// ---- restartSoloTimer helper correctness ----

test("restartSoloTimer sets policy.soloDeadlineAt to nowFn() + soloTimeoutMs", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const ctx = createGraceWindowContext();
  let nowTs = 1_000_000;
  const nowFn = () => nowTs;

  const policy = createRoomPolicy(
    ctx,
    "ROOM-UNIT-01",
    nowTs,
    TTL_MS,
    SOLO_TIMEOUT_MS,
    () => {},
    () => {},
  );

  assert.equal(
    policy.soloDeadlineAt,
    nowTs + SOLO_TIMEOUT_MS,
    "initial deadline set by createRoomPolicy",
  );

  // Advance logical clock and restart
  nowTs = 2_000_000;
  const onExpired = t.mock.fn();

  const returnedDeadline = restartSoloTimer(policy, SOLO_TIMEOUT_MS, nowFn, onExpired);

  assert.equal(returnedDeadline, nowTs + SOLO_TIMEOUT_MS, "return value equals nowFn() + soloTimeoutMs");
  assert.equal(policy.soloDeadlineAt, nowTs + SOLO_TIMEOUT_MS, "policy.soloDeadlineAt updated");
});

test("restartSoloTimer replaces the previous timer handle", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const ctx = createGraceWindowContext();
  let nowTs = 0;
  const nowFn = () => nowTs;

  const policy = createRoomPolicy(
    ctx,
    "ROOM-UNIT-02",
    nowTs,
    TTL_MS,
    SOLO_TIMEOUT_MS,
    () => {},
    () => {},
  );

  const initialTimerRef = policy.soloTimeoutRef;
  assert.ok(initialTimerRef, "solo timer handle set after createRoomPolicy");

  restartSoloTimer(policy, SOLO_TIMEOUT_MS, nowFn, () => {});

  assert.ok(policy.soloTimeoutRef, "new timer handle exists after restart");
  assert.notEqual(
    policy.soloTimeoutRef,
    initialTimerRef,
    "timer handle is a new reference (old timer cleared)",
  );
});

test("restartSoloTimer fires the new callback after tick; old callback is suppressed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const ctx = createGraceWindowContext();
  let nowTs = 0;
  const nowFn = () => nowTs;

  const oldCallback = t.mock.fn();
  const newCallback = t.mock.fn();

  // createRoomPolicy installs oldCallback as the solo-expired handler
  const policy = createRoomPolicy(
    ctx,
    "ROOM-UNIT-03",
    nowTs,
    TTL_MS * 2,
    SOLO_TIMEOUT_MS,
    () => {},
    oldCallback,
  );

  // Restart before oldCallback's timer fires — replaces it with newCallback's timer
  nowTs = 500;
  restartSoloTimer(policy, SOLO_TIMEOUT_MS, nowFn, newCallback);

  assert.equal(oldCallback.mock.calls.length, 0, "old callback not called before tick");
  assert.equal(newCallback.mock.calls.length, 0, "new callback not called before tick");

  t.mock.timers.tick(SOLO_TIMEOUT_MS);

  assert.equal(oldCallback.mock.calls.length, 0, "old callback must not fire after timer replaced");
  assert.equal(newCallback.mock.calls.length, 1, "new callback fires exactly once after tick");
});
