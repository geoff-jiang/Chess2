import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import type { GameState } from "../src/shared/game.ts";
import { ARENA } from "../src/shared/geometry.ts";
import { createGameServer } from "../src/server/index.ts";

test("rooms reserve two seats, authorize turns, broadcast state, and restore a disconnected seat", async () => {
  const game = createGameServer();
  const clients: WebSocket[] = [];
  await new Promise<void>((resolve) => game.httpServer.listen(0, "127.0.0.1", resolve));
  const address = game.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/socket`;

  try {
    const white = await openClient(url, clients);
    const whiteCreated = receive(white);
    white.send(JSON.stringify({ type: "create", ruleset: "standard" }));
    const whiteStart = snapshot(await whiteCreated);
    assert.equal(whiteStart.seat, "white");
    assert.equal(whiteStart.connections.white, true);
    assert.equal(whiteStart.connections.black, false);
    assert.equal(whiteStart.state.pieces.length, 32);
    assert.equal(whiteStart.state.ruleset, "standard");

    let black = await openClient(url, clients);
    const whiteJoined = receive(white);
    const blackJoined = receive(black);
    black.send(JSON.stringify({ type: "join", code: whiteStart.code }));
    const [whiteAfterJoinMessage, blackStartMessage] = await Promise.all([whiteJoined, blackJoined]);
    const whiteAfterJoin = snapshot(whiteAfterJoinMessage);
    const blackStart = snapshot(blackStartMessage);
    assert.equal(whiteAfterJoin.connections.black, true);
    assert.equal(blackStart.seat, "black");
    assert.equal(blackStart.state.activePlayer, "white");

    const third = await openClient(url, clients);
    const roomFull = receive(third);
    third.send(JSON.stringify({ type: "join", code: whiteStart.code }));
    assert.equal(error(await roomFull).code, "room-full");

    const outOfTurn = receive(black);
    black.send(JSON.stringify({
      type: "action",
      action: { kind: "move", pieceId: "white-pawn-d2", toTileId: "h-000" },
    }));
    assert.equal(error(await outOfTurn).code, "not-your-turn");

    const whiteMove = receive(white);
    const blackMove = receive(black);
    white.send(JSON.stringify({
      type: "action",
      action: { kind: "move", pieceId: "white-pawn-a2", toTileId: ARENA.anchors.get("a3") },
    }));
    const [whiteAfterMoveMessage, blackAfterMoveMessage] = await Promise.all([whiteMove, blackMove]);
    const whiteAfterMove = snapshot(whiteAfterMoveMessage);
    const blackAfterMove = snapshot(blackAfterMoveMessage);
    assert.equal(whiteAfterMove.state.history.length, 1);
    assert.equal(blackAfterMove.state.activePlayer, "black");
    const blackSeatToken = blackStart.seatToken;

    const disconnected = receive(white);
    black.close();
    const offlineSnapshot = snapshot(await disconnected);
    assert.equal(offlineSnapshot.connections.black, false);

    const seatHeld = receive(third);
    third.send(JSON.stringify({ type: "join", code: whiteStart.code }));
    assert.equal(error(await seatHeld).code, "room-full");

    const reconnect = await openClient(url, clients);
    const whiteReconnected = receive(white);
    const blackRestored = receive(reconnect);
    reconnect.send(JSON.stringify({ type: "join", code: whiteStart.code, token: blackSeatToken }));
    const [whiteOnlineMessage, blackResumeMessage] = await Promise.all([whiteReconnected, blackRestored]);
    const whiteOnline = snapshot(whiteOnlineMessage);
    const blackResume = snapshot(blackResumeMessage);
    black = reconnect;
    assert.equal(whiteOnline.connections.black, true);
    assert.equal(blackResume.seat, "black");
    assert.equal(blackResume.state.activePlayer, "black");
    assert.equal(blackResume.state.history.length, 1);

    const badPromotion = receive(black);
    black.send(JSON.stringify({ type: "action", action: { kind: "move", pieceId: "black-pawn-e7", toTileId: ARENA.anchors.get("e5"), promotion: "king" } }));
    assert.equal(error(await badPromotion).code, "invalid-message");
    const illegal = receive(black);
    black.send(JSON.stringify({ type: "action", action: { kind: "move", pieceId: "black-rook-a8", toTileId: ARENA.anchors.get("a5") } }));
    assert.equal(error(await illegal).code, "illegal-move");
    await playAction(black, "black-pawn-e7", ARENA.anchors.get("e5")!, white);
    await playAction(white, "white-pawn-f2", ARENA.anchors.get("f3")!, black);
    await playAction(black, "black-pawn-a7", ARENA.anchors.get("a6")!, white);
    await playAction(white, "white-pawn-g2", ARENA.anchors.get("g4")!, black);
    const [whiteFinish, blackFinish] = await playAction(black, "black-queen-d8", ARENA.anchors.get("h4")!, white);
    assert.deepEqual(whiteFinish.state.status, { kind: "won", winner: "black", reason: "checkmate" });
    assert.deepEqual(blackFinish.state.status, { kind: "won", winner: "black", reason: "checkmate" });

    const whiteAsked = receive(white);
    const blackAsked = receive(black);
    black.send(JSON.stringify({ type: "rematch" }));
    const [whiteRematchPrompt, blackRematchPrompt] = await Promise.all([whiteAsked, blackAsked]);
    assert.equal(snapshot(whiteRematchPrompt).rematchRequestedByOther, true);
    assert.equal(snapshot(blackRematchPrompt).rematchRequestedByYou, true);

    const whiteReset = receive(white);
    const blackReset = receive(black);
    white.send(JSON.stringify({ type: "rematch" }));
    const [whiteRematch, blackRematch] = await Promise.all([whiteReset, blackReset]);
    assert.equal(snapshot(whiteRematch).state.status.kind, "playing");
    assert.equal(snapshot(blackRematch).state.history.length, 0);
  } finally {
    for (const client of clients) client.terminate();
    await game.close();
  }
});

test("a player can resign outside their turn but cannot resign the other seat", async () => {
  const game = createGameServer();
  const clients: WebSocket[] = [];
  await new Promise<void>((resolve) => game.httpServer.listen(0, "127.0.0.1", resolve));
  const address = game.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const url = `ws://127.0.0.1:${address.port}/socket`;
  try {
    const white = await openClient(url, clients);
    const whiteCreated = receive(white);
    white.send(JSON.stringify({ type: "create" }));
    const room = snapshot(await whiteCreated);
    const black = await openClient(url, clients);
    const whiteJoined = receive(white), blackJoined = receive(black);
    black.send(JSON.stringify({ type: "join", code: room.code }));
    await Promise.all([whiteJoined, blackJoined]);

    const spoof = receive(black);
    black.send(JSON.stringify({ type: "action", action: { kind: "resign", side: "white" } }));
    assert.equal(error(await spoof).code, "not-your-seat");

    const whiteFinished = receive(white), blackFinished = receive(black);
    black.send(JSON.stringify({ type: "action", action: { kind: "resign", side: "black" } }));
    assert.deepEqual(snapshot(await whiteFinished).state.status, { kind: "won", winner: "white", reason: "resignation" });
    assert.deepEqual(snapshot(await blackFinished).state.status, { kind: "won", winner: "white", reason: "resignation" });
  } finally {
    for (const client of clients) client.terminate();
    await game.close();
  }
});

interface SnapshotMessage {
  type: "snapshot";
  code: string;
  seat: "white" | "black";
  seatToken: string;
  connections: { white: boolean; black: boolean };
  rematchRequestedByOther: boolean;
  rematchRequestedByYou: boolean;
  state: GameState;
}

interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
}

type ServerMessage = SnapshotMessage | ErrorMessage;

async function openClient(url: string, clients: WebSocket[]): Promise<WebSocket> {
  const client = new WebSocket(url);
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      client.off("open", onOpen);
      reject(error);
    };
    const onOpen = () => {
      client.off("error", onError);
      resolve();
    };
    client.once("open", onOpen);
    client.once("error", onError);
  });
  return client;
}

function receive(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (data: WebSocket.RawData) => {
      socket.off("error", onError);
      try {
        resolve(JSON.parse(data.toString()) as ServerMessage);
      } catch (error) {
        reject(error);
      }
    };
    socket.once("error", onError);
    socket.once("message", onMessage);
  });
}

async function playAction(
  actor: WebSocket,
  pieceId: string,
  toTileId: string,
  other: WebSocket,
): Promise<[SnapshotMessage, SnapshotMessage]> {
  const actorSnapshot = receive(actor);
  const otherSnapshot = receive(other);
  actor.send(JSON.stringify({ type: "action", action: { kind: "move", pieceId, toTileId } }));
  const [actorMessage, otherMessage] = await Promise.all([actorSnapshot, otherSnapshot]);
  return [snapshot(actorMessage), snapshot(otherMessage)];
}

function snapshot(message: ServerMessage): SnapshotMessage {
  assert.ok(message.type === "snapshot", "Expected the server to send the current match state");
  return message;
}

function error(message: ServerMessage): ErrorMessage {
  assert.ok(message.type === "error", "Expected the server to reject the action");
  return message;
}
