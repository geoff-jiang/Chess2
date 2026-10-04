import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, getLegalMoves, applyAction, isInCheck, isShadow, type GameState, type Piece, type Side } from "../src/shared/game.ts";
import { ARENA, rookRay } from "../src/shared/geometry.ts";

test("the opening force is mirrored, with no immediate king capture", () => {
  const state = createInitialState();
  assert.equal(state.pieces.length, 8);
  assert.equal(state.pieces.filter((piece) => piece.type === "king").length, 2);
  assert.equal(state.status.kind, "playing");
  assert.ok(state.pieces.every((piece) => ARENA.flatSquareByTile.has(piece.tileId)));

  for (const piece of state.pieces.filter((piece) => piece.side === "white")) {
    const opposite = ARENA.oppositeTile.get(piece.tileId);
    assert.ok(state.pieces.some((other) => other.side === "black" && other.type === piece.type && other.tileId === opposite));
  }
  const hyperbolic = { ...state, mode: "hyperbolic" as const };
  for (const side of ["white", "black"] as const) {
    const turn = { ...hyperbolic, activePlayer: side };
    assert.ok(turn.pieces.filter((piece) => piece.side === side).every((piece) =>
      getLegalMoves(turn, piece.id).every((move) => !turn.pieces.some((target) => target.tileId === move.toTileId && target.side !== side)),
    ));
  }
});

test("flat rooks stop before a friendly piece and can capture the first enemy", () => {
  let state = stateWith([
    piece("white-rook", "white", "rook", "a1", "flat"),
    piece("white-guard", "white", "guard", "a3", "flat"),
    piece("black-guard", "black", "guard", "a4", "flat"),
  ]);
  const destinations = destinationsFor(state, "white-rook");
  assert.ok(destinations.has(tile("a2")));
  assert.ok(!destinations.has(tile("a3")));
  assert.ok(!destinations.has(tile("a4")));

  state = stateWith([
    piece("white-rook", "white", "rook", "a1", "flat"),
    piece("black-guard", "black", "guard", "a4", "flat"),
  ]);
  assert.ok(destinationsFor(state, "white-rook").has(tile("a4")));
});

test("hyperbolic knights jump over occupied tiles and turn to either side", () => {
  const source = ARENA.centerTileId;
  const firstLink = ARENA.tiles.get(source)!.neighbors[0]!;
  const first = ARENA.tiles.get(firstLink.tileId)!;
  const straightEdge = (firstLink.edgeIndex + 2) % 4;
  const secondLink = first.neighbors[straightEdge]!;
  const second = ARENA.tiles.get(secondLink.tileId)!;
  const forwardEdge = (secondLink.edgeIndex + 2) % 4;
  const sideLinks = [(forwardEdge + 1) % 4, (forwardEdge + 3) % 4].map((edge) => second.neighbors[edge]!);
  const state = stateWith([
    piece("white-knight", "white", "knight", source, "hyperbolic"),
    piece("white-guard", "white", "guard", first.id, "hyperbolic"),
  ], "hyperbolic");
  const moves = getLegalMoves(state, "white-knight");
  assert.ok(sideLinks.every((link) => moves.some((move) => move.toTileId === link.tileId)));
  assert.equal(moves.length, 8);
  assert.ok(moves.every((move) => move.route.length === 4));
});

test("an extra-tile piece becomes a shadow, then returns to the same tile", () => {
  const extraTile = [...ARENA.tiles.keys()].find((id) => !ARENA.flatSquareByTile.has(id));
  assert.ok(extraTile);
  let state = stateWith([
    piece("white-king", "white", "king", tile("e1"), "flat"),
    piece("black-king", "black", "king", tile("d8"), "flat"),
    piece("black-guard", "black", "guard", extraTile, "flat"),
  ], "hyperbolic");
  state = applyAction(state, { kind: "shift", toMode: "flat" });
  assert.equal(state.shiftCooldown, 2);
  assert.equal(isShadow(state.pieces.find((piece) => piece.id === "black-guard")!, state.mode), true);
  assert.equal(getLegalMoves(state, "black-guard").length, 0);
  assert.throws(() => applyAction(state, { kind: "shift", toMode: "hyperbolic" }), /Make 2 more piece moves/);
  state = applyAction(state, { kind: "move", pieceId: "black-king", toTileId: tile("d7") });
  state = applyAction(state, { kind: "move", pieceId: "white-king", toTileId: tile("e2") });
  assert.equal(state.shiftCooldown, 0);
  state = applyAction(state, { kind: "shift", toMode: "hyperbolic" });
  const restored = state.pieces.find((piece) => piece.id === "black-guard")!;
  assert.equal(restored.tileId, extraTile);
  assert.equal(isShadow(restored, state.mode), false);
});

test("capturing a king ends the match immediately", () => {
  const state = stateWith([
    piece("white-rook", "white", "rook", tile("a1"), "flat"),
    piece("black-king", "black", "king", tile("a4"), "flat"),
  ]);
  const finished = applyAction(state, { kind: "move", pieceId: "white-rook", toTileId: tile("a4") });
  assert.deepEqual(finished.status, { kind: "won", winner: "white" });
  assert.equal(finished.pieces.some((piece) => piece.id === "black-king"), false);
  assert.match(finished.history.at(-1)!.notation, /A1 → A4 · captures King/);
});

test("the third occurrence of a full position is a draw", () => {
  let state = createInitialState();
  const cycle = [
    { kind: "move" as const, pieceId: "white-knight", toTileId: tile("c3") },
    { kind: "move" as const, pieceId: "black-knight", toTileId: tile("f6") },
    { kind: "move" as const, pieceId: "white-knight", toTileId: tile("b1") },
    { kind: "move" as const, pieceId: "black-knight", toTileId: tile("g8") },
  ];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    for (const action of cycle) state = applyAction(state, action);
  }
  assert.deepEqual(state.status, { kind: "draw", reason: "repetition" });
});

test("check reporting sees a rook ray without forbidding an escape move", () => {
  const state = { ...stateWith([
    piece("white-rook", "white", "rook", "e1", "flat"),
    piece("black-king", "black", "king", "e8", "flat"),
  ]), activePlayer: "black" as const };
  assert.equal(stateInCheck(state, "black"), true);
  assert.ok(destinationsFor(state, "black-king").size > 0);
});

test("hyperbolic rook routes use graph rays rather than screen distance", () => {
  const source = ARENA.centerTileId;
  const route = rookRay(ARENA, source, 1);
  const state = stateWith([piece("white-rook", "white", "rook", source, "hyperbolic")], "hyperbolic");
  const moves = getLegalMoves(state, "white-rook");
  assert.ok(route.length > 2);
  assert.deepEqual(
    moves.filter((move) => move.route[0] === source && move.route.at(-1) === route[2])[0]?.route,
    [source, ...route.slice(0, 3)],
  );
});

test("hyperbolic kings may touch corners but may only land on anchors", () => {
  const source = [...ARENA.anchors.values()].find((tileId) =>
    [...(ARENA.touchNeighbors.get(tileId) ?? [])].some((neighbor) => !ARENA.flatSquareByTile.has(neighbor)),
  );
  assert.ok(source);
  const state = stateWith([piece("white-king", "white", "king", source, "hyperbolic")], "hyperbolic");
  const moves = getLegalMoves(state, "white-king");
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => ARENA.flatSquareByTile.has(move.toTileId)));
});

function tile(square: string): string {
  const id = ARENA.anchors.get(square as `${string}${number}`);
  assert.ok(id, `Expected ${square} to map to an anchor`);
  return id;
}

function piece(id: string, side: Side, type: Piece["type"], squareOrTile: string, mode: GameState["mode"]): Piece {
  return {
    id,
    side,
    type,
    tileId: ARENA.tiles.has(squareOrTile) ? squareOrTile : tile(squareOrTile),
  };
}

function stateWith(pieces: Piece[], mode: GameState["mode"] = "flat"): GameState {
  return { ...createInitialState(), pieces, mode, activePlayer: "white", shiftCooldown: 0, status: { kind: "playing" }, history: [], repetitions: {} };
}

function destinationsFor(state: GameState, pieceId: string): Set<string> {
  return new Set(getLegalMoves(state, pieceId).map((move) => move.toTileId));
}

function stateInCheck(state: GameState, side: Side): boolean {
  return isInCheck(state, side);
}
