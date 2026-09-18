import "dotenv/config";
import http from "node:http";
import { Server, Socket } from "socket.io";
import { PrismaClient } from "@prisma/client";
import log from "loglevel";

log.setLevel(process.env.NODE_ENV === "production" ? "warn" : "info");

const prisma = new PrismaClient();
const hostname = "0.0.0.0";

const port = Number(process.env.PORT || process.env.SOCKET_PORT || 3001);

export interface Participant {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  connected: boolean;
}

export interface Room {
  boardId: string;
  elements: any[];
  participants: Map<string, Participant>;
}

export const roomState = new Map<string, Room>();

export function getRoom(roomId: string, boardId: string = roomId): Room {
  if (!roomState.has(roomId)) {
    roomState.set(roomId, {
      boardId,
      elements: [],
      participants: new Map(),
    });
  }

  const room = roomState.get(roomId)!;
  if (boardId && room && !room.boardId) {
    room.boardId = boardId;
  }

  return room;
}

export function normalizeBoardElements(value: any): any[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      log.error("Failed to parse board elements from storage", error);
      return [];
    }
  }

  return [];
}

export function getPresencePayload(roomId: string) {
  const room = roomState.get(roomId);
  if (!room) {
    return [];
  }

  return Array.from(room.participants.values()).map((participant) => ({
    id: participant.id,
    name: participant.name,
    color: participant.color,
    x: participant.x,
    y: participant.y,
    connected: participant.connected,
  }));
}

export function removeParticipantFromRoom(roomId: string, socketId: string) {
  const room = roomState.get(roomId);
  if (!room) return;

  room.participants.delete(socketId);

  if (room.participants.size === 0) {
    roomState.delete(roomId);
  }
}

export function removeSocketFromAllRooms(socketId: string) {
  const roomIds = Array.from(roomState.keys());

  for (const roomId of roomIds) {
    if (!roomState.get(roomId)?.participants.has(socketId)) {
      continue;
    }

    removeParticipantFromRoom(roomId, socketId);
    const remainingRoom = roomState.get(roomId);
    if (remainingRoom && remainingRoom.participants.size > 0) {
      const io = (global as any).__boardIo as Server | undefined;
      if (io) {
        io.to(roomId).emit("presence-update", {
          boardId: remainingRoom.boardId || roomId,
          sessionId: roomId,
          participants: getPresencePayload(roomId),
        });
      }
    }
  }
}

export function isSocketMemberOfRoom(socketId: string, roomId: string) {
  return !!roomId && !!roomState.get(roomId)?.participants.has(socketId);
}

export function isBoardOwnedByUser(
  board: { userId?: string | null } | null,
  userId?: string,
) {
  const boardUserId =
    typeof board?.userId === "string" ? board.userId.trim() : "";
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";

  if (!boardUserId) {
    return true;
  }

  if (!normalizedUserId) {
    return false;
  }

  return boardUserId === normalizedUserId;
}

export function isSocketAuthorizedForBoard({
  socketId,
  boardId,
  roomId,
}: {
  socketId?: string;
  boardId?: string;
  roomId?: string;
}) {
  if (!socketId || !boardId || !roomId) {
    return false;
  }

  const room = roomState.get(roomId);
  if (!room) {
    return false;
  }

  const isParticipant = room.participants.has(socketId);
  if (!isParticipant) {
    return false;
  }

  return !room.boardId || room.boardId === boardId;
}

async function persistBoardState(boardId: string, elements: any[]) {
  if (!boardId || !Array.isArray(elements)) {
    return;
  }

  try {
    await (prisma as any).board.update({
      where: { id: boardId },
      data: { elements },
    });
  } catch (error) {
    log.error("Failed to persist board state for room", boardId, error);
  }
}

const allowedOrigins = (
  process.env.SOCKET_ALLOWED_ORIGINS ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

const httpServer = http.createServer();
const io = new Server(httpServer, {
  transports: ["websocket", "polling"],
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by Socket.IO CORS`));
    },
    credentials: true,
    methods: ["GET", "POST"],
  },
});

(global as any).__boardIo = io;

export function resolveRoomId(boardId: string, sessionId?: string) {
  if (typeof sessionId === "string" && sessionId.trim()) {
    return sessionId.trim();
  }

  return boardId;
}

io.on("connection", (socket: Socket) => {
  log.info("socket connected:", {
    id: socket.id,
    transport: socket.conn.transport.name,
  });

  socket.on(
    "join-board",
    async ({ boardId, userName, sessionId, userId }: any) => {
      log.info("join-board received:", {
        socketId: socket.id,
        boardId,
        userName,
        sessionId,
        userId,
      });
      if (!boardId) {
        log.warn("join-board rejected: missing boardId", {
          socketId: socket.id,
        });
        return;
      }

      const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
      const board = boardId
        ? await (prisma as any).board
          .findUnique({ where: { id: boardId } })
          .catch(() => null)
        : null;
      if (board && !isBoardOwnedByUser(board, normalizedUserId)) {
        log.warn("join-board rejected: board ownership mismatch", {
          socketId: socket.id,
          boardId,
          userId: normalizedUserId,
        });
        return;
      }

      const roomId =
        typeof sessionId === "string" && sessionId.trim()
          ? sessionId.trim()
          : boardId;
      const room = getRoom(roomId, boardId);
      if (!room) {
        log.warn("join-board rejected: room not available", {
          socketId: socket.id,
          roomId,
        });
        return;
      }
      socket.join(roomId);

      const displayName =
        typeof userName === "string" && userName.trim().length > 0
          ? userName.trim()
          : "Guest";
      const participant: Participant = {
        id: socket.id,
        name: displayName,
        color: `hsl(${Math.abs(displayName.split("").reduce((sum: number, char: string) => sum + char.charCodeAt(0), 0)) % 360}, 75%, 60%)`,
        x: 0,
        y: 0,
        connected: true,
      };

      room.participants.set(socket.id, participant);

      try {
        const dbBoard = await (prisma as any).board.findUnique({
          where: { id: boardId },
        });
        const elements = normalizeBoardElements(dbBoard?.elements);
        if (elements.length > 0) {
          room.elements = elements;
        }
      } catch (error) {
        log.error("Failed to hydrate board from database on join", error);
      }

      socket.emit("board-state", {
        boardId,
        sessionId: roomId,
        elements: room.elements,
      });

      io.to(roomId).emit("presence-update", {
        boardId,
        sessionId: roomId,
        participants: getPresencePayload(roomId),
      });

      if (typeof sessionId === "string" && sessionId.trim()) {
        socket.emit("session-joined", { boardId, sessionId });
      }
    },
  );

  socket.on(
    "board-state-change",
    async ({ boardId, elements, sessionId, userId }: any) => {
      log.info("board-state-change received:", {
        socketId: socket.id,
        boardId,
        sessionId,
        userId,
        elementCount: Array.isArray(elements) ? elements.length : "invalid",
      });
      if (!boardId) {
        log.warn("board-state-change rejected: missing boardId", {
          socketId: socket.id,
        });
        return;
      }

      const roomId =
        typeof sessionId === "string" && sessionId.trim()
          ? sessionId.trim()
          : boardId;

      if (
        !isSocketAuthorizedForBoard({ socketId: socket.id, boardId, roomId })
      ) {
        log.warn("board-state-change rejected: unauthorized socket", {
          socketId: socket.id,
          boardId,
          roomId,
        });
        return;
      }

      const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
      const board = await (prisma as any).board
        .findUnique({ where: { id: boardId } })
        .catch(() => null);
      if (!isBoardOwnedByUser(board, normalizedUserId)) {
        log.warn("board-state-change rejected: board ownership mismatch", {
          socketId: socket.id,
          boardId,
          roomId,
          userId: normalizedUserId,
        });
        return;
      }

      if (board && !(board as any).userId && normalizedUserId) {
        await (prisma as any).board.update({
          where: { id: boardId },
          data: { userId: normalizedUserId } as any,
        });
      }

      const room = roomState.get(roomId);
      if (!room) {
        void persistBoardState(
          boardId,
          Array.isArray(elements) ? elements : [],
        );
        return;
      }

      room.elements = Array.isArray(elements) ? elements : room.elements;
      void persistBoardState(boardId, room.elements);
      io.to(roomId).emit("board-update", {
        boardId,
        sessionId: roomId,
        elements: room.elements,
      });
    },
  );

  socket.on("cursor-move", ({ boardId, sessionId, x, y, userName }: any) => {
    log.info("cursor-move received:", {
      socketId: socket.id,
      boardId,
      sessionId,
      x,
      y,
      userName,
    });
    if (!boardId) {
      log.warn("cursor-move rejected: missing boardId", {
        socketId: socket.id,
      });
      return;
    }

    const roomId =
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : boardId;

    if (!isSocketAuthorizedForBoard({ socketId: socket.id, boardId, roomId })) {
      log.warn("cursor-move rejected: unauthorized socket", {
        socketId: socket.id,
        boardId,
        roomId,
      });
      return;
    }

    const room = roomState.get(roomId);
    if (!room) {
      return;
    }

    const participant = room.participants.get(socket.id);
    if (!participant) {
      return;
    }

    participant.x = Number.isFinite(x) ? x : participant.x;
    participant.y = Number.isFinite(y) ? y : participant.y;
    if (typeof userName === "string" && userName.trim()) {
      participant.name = userName.trim();
    }

    socket.to(roomId).emit("cursor-update", {
      userId: socket.id,
      name: participant.name,
      color: participant.color,
      x: participant.x,
      y: participant.y,
    });
  });

  socket.on("leave-board", ({ boardId, sessionId }: any) => {
    log.info("leave-board received:", {
      socketId: socket.id,
      boardId,
      sessionId,
    });
    if (!boardId && !sessionId) {
      log.warn("leave-board rejected: missing boardId or sessionId", {
        socketId: socket.id,
      });
      return;
    }

    const roomId =
      typeof sessionId === "string" && sessionId.trim()
        ? sessionId.trim()
        : boardId;

    if (!roomId || !isSocketMemberOfRoom(socket.id, roomId)) {
      return;
    }

    socket.leave(roomId);
    removeParticipantFromRoom(roomId, socket.id);

    const remainingRoom = roomState.get(roomId);
    if (remainingRoom && remainingRoom.participants.size > 0) {
      io.to(roomId).emit("presence-update", {
        boardId: remainingRoom.boardId || roomId,
        sessionId: roomId,
        participants: getPresencePayload(roomId),
      });
    }
  });

  socket.on("disconnect", (reason: string) => {
    log.info("socket disconnected:", { socketId: socket.id, reason });
    removeSocketFromAllRooms(socket.id);
  });
});


import process from "process";


httpServer.listen(port, hostname, () => {
  log.info(`Socket server ready at http://${hostname}:${port}`);
});

