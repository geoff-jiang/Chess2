import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { applyAction, createInitialState, oppositeSide, RuleViolation, type GameAction, type GameState, type Side, type Ruleset, type Promotion } from "../shared/game.ts";
import { PROMOTIONS } from "../shared/standard-chess.ts";

interface Seat {
  token: string;
  reserved: boolean;
  socket?: WebSocket;
}

interface Room {
  code: string;
  seats: Record<Side, Seat>;
  state: GameState;
  rematchVotes: Set<Side>;
}

interface Assignment {
  room: Room;
  side: Side;
}

interface ClientMessage {
  type: "create" | "join" | "action" | "rematch";
  code?: string;
  token?: string;
  action?: GameAction;
  ruleset?: Ruleset;
}

interface ServerOptions {
  staticDirectory?: string;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_MESSAGE_BYTES = 12_000;
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** Create the HTTP host and authoritative room server used by both production and tests. */
export function createGameServer(options: ServerOptions = {}) {
  const staticDirectory = resolve(options.staticDirectory ?? resolve(process.cwd(), "dist"));
  const rooms = new Map<string, Room>();
  const assignments = new WeakMap<WebSocket, Assignment>();
  const httpServer = createServer((request, response) => {
    void serveStatic(request, response, staticDirectory);
  });
  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/socket") {
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      const payload = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (isBinary || payload.byteLength > MAX_MESSAGE_BYTES) {
        sendError(socket, "invalid-message", "Messages must be small text actions.");
        return;
      }
      let message: ClientMessage;
      try {
        message = parseMessage(payload.toString("utf8"));
      } catch {
        sendError(socket, "invalid-message", "That message could not be read.");
        return;
      }
      handleMessage(socket, message, rooms, assignments);
    });

    socket.on("close", () => {
      const assignment = assignments.get(socket);
      if (!assignment) return;
      const seat = assignment.room.seats[assignment.side];
      if (seat.socket !== socket) return;
      seat.socket = undefined;
      broadcast(assignment.room);
    });
  });

  return {
    httpServer,
    async close(): Promise<void> {
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise<void>((resolveClose) => {
        webSocketServer.close(() => {
          if (httpServer.listening) httpServer.close(() => resolveClose());
          else resolveClose();
        });
      });
    },
  };
}

function handleMessage(
  socket: WebSocket,
  message: ClientMessage,
  rooms: Map<string, Room>,
  assignments: WeakMap<WebSocket, Assignment>,
): void {
  if (message.type === "create") {
    if (assignments.has(socket)) {
      sendError(socket, "already-seated", "Leave the current room before creating another.");
      return;
    }
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();
    const room: Room = {
      code,
      seats: {
        white: { token: generateSeatToken(), reserved: true },
        black: { token: generateSeatToken(), reserved: false },
      },
      state: createInitialState(undefined, message.ruleset),
      rematchVotes: new Set(),
    };
    rooms.set(code, room);
    seatSocket(room, "white", socket, assignments);
    broadcast(room);
    return;
  }

  if (message.type === "join") {
    if (assignments.has(socket)) {
      sendError(socket, "already-seated", "Leave the current room before joining another.");
      return;
    }
    const code = message.code?.toUpperCase() ?? "";
    const room = rooms.get(code);
    if (!room) {
      sendError(socket, "room-not-found", "That room code was not found. Check it and try again.");
      return;
    }

    let side: Side | undefined;
    if (message.token) {
      side = (Object.keys(room.seats) as Side[]).find((seatSide) => room.seats[seatSide].token === message.token);
      if (!side) {
        sendError(socket, "invalid-seat-token", "This browser does not hold a seat in that room.");
        return;
      }
    } else {
      side = room.seats.black.reserved ? undefined : "black";
      if (room.seats.black.reserved) {
        sendError(socket, "room-full", "Both seats are already reserved. Ask a player to share their room link.");
        return;
      }
    }

    if (!side) {
      sendError(socket, "room-full", "Both seats are already reserved. Ask a player to share their room link.");
      return;
    }
    seatSocket(room, side, socket, assignments);
    broadcast(room);
    return;
  }

  const assignment = assignments.get(socket);
  if (!assignment) {
    sendError(socket, "not-seated", "Create or join a room before sending game actions.");
    return;
  }
  const { room, side } = assignment;

  if (message.type === "action") {
    if (message.action?.kind === "resign" && message.action.side !== side) {
      sendError(socket, "not-your-seat", "You can only resign your own seat.");
      return;
    }
    if (message.action?.kind !== "resign" && room.state.activePlayer !== side) {
      sendError(socket, "not-your-turn", "Wait for the other player to finish their turn.");
      return;
    }
    try {
      room.state = applyAction(room.state, message.action!);
      room.rematchVotes.clear();
      broadcast(room);
    } catch (error) {
      if (error instanceof RuleViolation) sendError(socket, error.code, error.message);
      else sendError(socket, "action-failed", "That action could not be applied.");
    }
    return;
  }

  if (message.type === "rematch") {
    if (room.state.status.kind === "playing") {
      sendError(socket, "match-in-progress", "Finish this match before asking for a rematch.");
      return;
    }
    room.rematchVotes.add(side);
    if (room.rematchVotes.size === 2) {
      room.state = createInitialState(undefined, room.state.ruleset);
      room.rematchVotes.clear();
    }
    broadcast(room);
  }
}

function seatSocket(room: Room, side: Side, socket: WebSocket, assignments: WeakMap<WebSocket, Assignment>): void {
  const oldSocket = room.seats[side].socket;
  if (oldSocket && oldSocket !== socket) oldSocket.close(4001, "This seat reconnected in another browser.");
  room.seats[side].reserved = true;
  room.seats[side].socket = socket;
  assignments.set(socket, { room, side });
}

function broadcast(room: Room): void {
  const connections = {
    white: room.seats.white.socket?.readyState === WebSocket.OPEN,
    black: room.seats.black.socket?.readyState === WebSocket.OPEN,
  };
  for (const side of ["white", "black"] as const) {
    const seat = room.seats[side];
    if (seat.socket?.readyState !== WebSocket.OPEN) continue;
    seat.socket.send(JSON.stringify({
      type: "snapshot",
      code: room.code,
      seat: side,
      seatToken: seat.token,
      connections,
      rematchRequestedByOther: room.rematchVotes.has(oppositeSide(side)),
      rematchRequestedByYou: room.rematchVotes.has(side),
      state: room.state,
    }));
  }
}

function parseMessage(raw: string): ClientMessage {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || typeof value.type !== "string") throw new Error("Invalid message");
  if (value.type === "create") {
    if (value.ruleset !== undefined && value.ruleset !== "standard" && value.ruleset !== "curvature") throw new Error("Invalid ruleset");
    return { type: "create", ruleset: value.ruleset === "standard" ? "standard" : "curvature" };
  }
  if (value.type === "join") {
    if (typeof value.code !== "string" || value.code.length > 12) throw new Error("Invalid room code");
    if (value.token !== undefined && (typeof value.token !== "string" || value.token.length > 128)) throw new Error("Invalid token");
    return { type: "join", code: value.code.trim(), ...(typeof value.token === "string" ? { token: value.token } : {}) };
  }
  if (value.type === "action") {
    if (!isRecord(value.action)) throw new Error("Invalid action");
    if (value.action.kind === "move" && typeof value.action.pieceId === "string" && typeof value.action.toTileId === "string") {
      const promotion = value.action.promotion;
      if (promotion !== undefined && !PROMOTIONS.some((type) => type === promotion)) throw new Error("Invalid promotion");
      return { type: "action", action: { kind: "move", pieceId: value.action.pieceId, toTileId: value.action.toTileId, ...(promotion ? { promotion: promotion as Promotion } : {}) } };
    }
    if (value.action.kind === "shift" && (value.action.toMode === "flat" || value.action.toMode === "hyperbolic")) {
      return { type: "action", action: { kind: "shift", toMode: value.action.toMode } };
    }
    if (value.action.kind === "resign" && (value.action.side === "white" || value.action.side === "black")) {
      return { type: "action", action: { kind: "resign", side: value.action.side } };
    }
    throw new Error("Invalid action");
  }
  if (value.type === "rematch") return { type: "rematch" };
  throw new Error("Unknown message type");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generateRoomCode(): string {
  return [...randomBytes(6)].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

function generateSeatToken(): string {
  return randomBytes(24).toString("base64url");
}

function sendError(socket: WebSocket, code: string, message: string): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", code, message }));
}

async function serveStatic(request: IncomingMessage, response: ServerResponse, directory: string): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let requestedPath: string;
  try {
    requestedPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
  } catch {
    response.writeHead(400).end("Invalid path");
    return;
  }
  const candidate = resolve(directory, `.${requestedPath}`);
  if (!candidate.startsWith(`${directory}${sep}`) && candidate !== directory) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let file = candidate;
  try {
    const fileInfo = await stat(file);
    if (fileInfo.isDirectory()) file = resolve(file, "index.html");
    await access(file);
  } catch {
    if (extname(requestedPath)) {
      response.writeHead(404).end("Not found");
      return;
    }
    file = resolve(directory, "index.html");
    try {
      await access(file);
    } catch {
      response.writeHead(503).end("Build the browser app first with npm run build.");
      return;
    }
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": extname(file) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  if (request.method === "HEAD") response.end();
  else createReadStream(file).pipe(response);
}

function startServer(): void {
  const server = createGameServer();
  const port = Number(process.env.PORT ?? 8787);
  server.httpServer.listen(port, "0.0.0.0", () => {
    process.stdout.write(`Chess Without Borders listening on http://localhost:${port}\n`);
  });
}

const currentFile = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === currentFile) startServer();
