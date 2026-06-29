> vapor-backend@0.1.0 test:security
> node --import tsx --test tests/security.policy.test.ts

✔ P1-ZP-012: backend source contains no obvious secret-logging statements (6.9212ms)
✔ P0-RS-004: backend source avoids persistence APIs/libraries in Phase 0 runtime paths (2.7581ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 215.7102

> vapor-backend@0.1.0 test:unit
> node --import tsx --test "tests/**/*.unit.test.ts"

✔ P0-RM-005: createRoomRecord enforces unique room id when factory collides (1.1086ms)
✔ P0-JN-002 edge: joinRoomRecord returns null when room does not exist (0.1607ms)
✔ P0-DC-006 edge: removeParticipantBySocket returns null for unknown socket (0.202ms)
✔ P0-LV-008 edge: host removal atomically purges participant/socket indexes (0.2585ms)
✔ P0-LV-005 edge: removing last guest destroys now-empty room (0.1784ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 222.6056

> vapor-backend@0.1.0 test:integration
> node --import tsx --test "tests/**/*.integration.test.ts"

✔ P0-CR-001 / P0-JN-002: create + join emits contract payloads and shared room context (1.3676ms)
✔ P0-JN-003: altered-case room id naturally fails exact-match lookup (0.1595ms)
✔ P0-JN-002 edge: missing roomId payload returns deterministic ROOM_NOT_FOUND (0.1249ms)
✔ P0-DC-006 / P0-DC-008: guest disconnect follows leave-equivalent cleanup and keeps room active (0.2833ms)
✔ P0-DC-006: host disconnect destroys room and notifies guests (0.1899ms)
✔ P0-LV-005 / P0-LV-006: guest leave_room should remove participant and emit peer_left (0.2087ms)    
✔ P0-LV-008: host leave_room should destroy room immediately (0.1596ms)
✔ P0-LV-005 edge: leave_room from socket with no room membership is a no-op (0.1179ms)
✔ P0-DC-006 edge: disconnect from socket with no room membership is a no-op (0.1299ms)
✔ P0-RM-005 edge: second create_room resolves room-id collision via generator retry (0.2381ms)       
✔ P0-RS-004: backend restart clears RAM-only room/session state (49.7255ms)
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 445.6149

> vapor-backend@0.1.0 test:policy
> node --import tsx --test "tests/**/*.policy.test.ts"

✔ P1-ZP-012: backend source contains no obvious secret-logging statements (7.6309ms)
✔ P0-RS-004: backend source avoids persistence APIs/libraries in Phase 0 runtime paths (4.5331ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 211.1026