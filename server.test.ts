import test from "node:test";
import assert from "node:assert/strict";

import {
  roomState,
  getRoom,
  removeParticipantFromRoom,
  removeSocketFromAllRooms,
  resolveRoomId,
  isSocketAuthorizedForBoard,
  isSocketMemberOfRoom,
  isBoardOwnedByUser,
  normalizeBoardElements,
  getPresencePayload,
} from "./server.js";

test("resolveRoomId prefers a session ID when present", () => {
  assert.equal(resolveRoomId("board-123", "session-abc"), "session-abc");
  assert.equal(resolveRoomId("board-123", ""), "board-123");
});

test("leave-board does not wipe the room when other users remain", () => {
  roomState.clear();
  const room = getRoom("room-1", "board-1");
  room.participants.set("socket-a", {
    id: "socket-a",
    name: "A",
    color: "red",
    x: 0,
    y: 0,
    connected: true,
  });
  room.participants.set("socket-b", {
    id: "socket-b",
    name: "B",
    color: "blue",
    x: 0,
    y: 0,
    connected: true,
  });

  removeParticipantFromRoom("room-1", "socket-a");

  assert.equal(roomState.has("room-1"), true);
  assert.equal(room.participants.has("socket-b"), true);
  assert.equal(room.participants.has("socket-a"), false);
});

test("disconnect cleanup removes a socket from every joined room without breaking after the first match", () => {
  roomState.clear();
  getRoom("room-1", "board-1").participants.set("socket-c", {
    id: "socket-c",
    name: "C",
    color: "",
    x: 0,
    y: 0,
    connected: true,
  });
  getRoom("room-2", "board-2").participants.set("socket-c", {
    id: "socket-c",
    name: "C",
    color: "",
    x: 0,
    y: 0,
    connected: true,
  });
  getRoom("room-2", "board-2").participants.set("socket-d", {
    id: "socket-d",
    name: "D",
    color: "",
    x: 0,
    y: 0,
    connected: true,
  });

  removeSocketFromAllRooms("socket-c");

  assert.equal(roomState.has("room-1"), false);
  assert.equal(roomState.has("room-2"), true);
  assert.equal(roomState.get("room-2")!.participants.has("socket-d"), true);
});

test("socket mutations require active room membership and board ownership", () => {
  roomState.clear();
  const room = getRoom("room-1", "board-1");
  room.participants.set("authorized-socket", {
    id: "authorized-socket",
    name: "Alice",
    color: "",
    x: 0,
    y: 0,
    connected: true,
  });

  assert.equal(isSocketMemberOfRoom("authorized-socket", "room-1"), true);
  assert.equal(isSocketMemberOfRoom("unknown-socket", "room-1"), false);
  assert.equal(
    isSocketAuthorizedForBoard({
      socketId: "authorized-socket",
      boardId: "board-1",
      roomId: "room-1",
    }),
    true,
  );
  assert.equal(
    isSocketAuthorizedForBoard({
      socketId: "unknown-socket",
      boardId: "board-1",
      roomId: "room-1",
    }),
    false,
  );
  assert.equal(
    isSocketAuthorizedForBoard({
      socketId: "authorized-socket",
      boardId: "board-2",
      roomId: "room-1",
    }),
    false,
  );
});

test("board ownership validation rejects mismatched authenticated user IDs", () => {
  const board = { id: "board-1", userId: "user-123" };
  assert.equal(isBoardOwnedByUser(board, "user-123"), true);
  assert.equal(isBoardOwnedByUser(board, "user-456"), false);
  assert.equal(isBoardOwnedByUser({ id: "board-2" } as any, "user-456"), true);
});

test("normalizeBoardElements handles different input types", () => {
  // Array
  assert.deepEqual(normalizeBoardElements([{ id: "1" }]), [{ id: "1" }]);

  // Valid JSON string
  assert.deepEqual(normalizeBoardElements('[{"id":"2"}]'), [{ id: "2" }]);

  // Invalid JSON string
  assert.deepEqual(normalizeBoardElements("invalid json"), []);

  // Non-array JSON string
  assert.deepEqual(normalizeBoardElements('{"id":"2"}'), []);

  // Null/undefined
  assert.deepEqual(normalizeBoardElements(null), []);
  assert.deepEqual(normalizeBoardElements(undefined), []);
});

test("getPresencePayload returns formatted participant list", () => {
  roomState.clear();
  const room = getRoom("room-presence", "board-presence");
  room.participants.set("socket-1", {
    id: "socket-1",
    name: "User 1",
    color: "hsl(100, 75%, 60%)",
    x: 10,
    y: 20,
    connected: true,
  });

  const payload = getPresencePayload("room-presence");
  assert.equal(payload.length, 1);
  assert.equal(payload[0].id, "socket-1");
  assert.equal(payload[0].name, "User 1");
  assert.equal(payload[0].x, 10);

  // Empty room
  assert.deepEqual(getPresencePayload("non-existent-room"), []);
});
