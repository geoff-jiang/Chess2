import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, getLegalMoves, applyAction, isInCheck, isShadow, type GameState, type Piece, type Side } from "../src/shared/game.ts";
import { ARENA, bishopRay, cornerNeighbors, rookRay } from "../src/shared/geometry.ts";

test("the opening is mirrored, the flat side has no capture, and a shift does not hang the king", () => {
  const state = createInitialState();
  assert.equal(state.pieces.length, 32);
  assert.equal(state.pieces.filter((piece) => piece.type === "king").length, 2);
  assert.equal(state.status.kind, "playing");
  assert.ok(state.pieces.every((piece) => ARENA.flatSquareByTile.has(piece.tileId)));
  assert.equal(isInCheck(state, "white"), false);
  assert.equal(isInCheck(state, "black"), false);
  assert.equal(isInCheck({ ...state, mode: "hyperbolic" }, "white"), false);
  assert.equal(isInCheck({ ...state, mode: "hyperbolic" }, "black"), false);

  for (const piece of state.pieces.filter((piece) => piece.side === "white")) {
    const opposite = ARENA.oppositeTile.get(piece.tileId);
    assert.ok(state.pieces.some((other) => other.side === "black" && other.type === piece.type && other.tileId === opposite));
  }
  for (const side of ["white", "black"] as const) {
    const turn = { ...state, activePlayer: side };
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

test("each player can shift only three times", () => {
  let state = stateWith([
    piece("white-king", "white", "king", "a1", "flat"),
    piece("black-king", "black", "king", "h8", "flat"),
  ]);
  assert.deepEqual(state.shiftsRemaining, { white: 3, black: 3 });

  const step = (current: GameState): GameState => {
    const king = current.pieces.find((item) => item.side === current.activePlayer && item.type === "king");
    assert.ok(king);
    const move = getLegalMoves(current, king.id).find((option) => !current.pieces.some((item) => item.tileId === option.toTileId));
    assert.ok(move);
    return applyAction(current, { kind: "move", pieceId: king.id, toTileId: move.toTileId });
  };

  for (let count = 0; count < 3; count += 1) {
    const toMode = state.mode === "flat" ? "hyperbolic" : "flat";
    state = applyAction(state, { kind: "shift", toMode });
    assert.equal(state.shiftsRemaining.white, 2 - count);
    state = step(state);
    state = step(state);
    state = step(state);
    assert.equal(state.activePlayer, "white");
    assert.equal(state.shiftCooldown, 0);
  }

  assert.equal(state.shiftsRemaining.white, 0);
  assert.equal(state.shiftsRemaining.black, 3);
  const blocked = state.mode === "flat" ? "hyperbolic" : "flat";
  assert.throws(() => applyAction(state, { kind: "shift", toMode: blocked }), /used all 3 shifts/);
  state = step(state);
  state = applyAction(state, { kind: "shift", toMode: state.mode === "flat" ? "hyperbolic" : "flat" });
  assert.equal(state.shiftsRemaining.black, 2);
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
    { kind: "move" as const, pieceId: "white-knight", toTileId: tile("d3") },
    { kind: "move" as const, pieceId: "black-knight", toTileId: tile("e6") },
    { kind: "move" as const, pieceId: "white-knight", toTileId: tile("c1") },
    { kind: "move" as const, pieceId: "black-knight", toTileId: tile("f8") },
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

test("flat bishops slide on diagonals and stop at the first piece", () => {
  let state = stateWith([
    piece("white-bishop", "white", "bishop", "c1", "flat"),
    piece("white-guard", "white", "guard", "e3", "flat"),
    piece("black-guard", "black", "guard", "a3", "flat"),
  ]);
  const destinations = destinationsFor(state, "white-bishop");
  assert.ok(destinations.has(tile("d2")));
  assert.ok(destinations.has(tile("b2")));
  assert.ok(destinations.has(tile("a3")));
  assert.ok(!destinations.has(tile("e3")));
  assert.ok(!destinations.has(tile("f4")));
  assert.ok(!destinations.has(tile("d1")));

  state = stateWith([
    piece("white-bishop", "white", "bishop", "c1", "flat"),
    piece("black-king", "black", "king", "f4", "flat"),
  ]);
  const finished = applyAction(state, { kind: "move", pieceId: "white-bishop", toTileId: tile("f4") });
  assert.deepEqual(finished.status, { kind: "won", winner: "white" });
});

test("hyperbolic bishops cross a corner and stop at the first piece on that diagonal", () => {
  const source = ARENA.centerTileId;
  const first = cornerNeighbors(ARENA, source, 0)[0];
  const ray = bishopRay(ARENA, source, 0, first);
  assert.ok(ray.length >= 2);
  const blocked = stateWith([
    piece("white-bishop", "white", "bishop", source, "hyperbolic"),
    piece("white-guard", "white", "guard", ray[0], "hyperbolic"),
  ], "hyperbolic");
  assert.ok(getLegalMoves(blocked, "white-bishop").every((move) => move.route[1] !== ray[0]));

  const open = stateWith([
    piece("white-bishop", "white", "bishop", source, "hyperbolic"),
    piece("black-guard", "black", "guard", ray[1], "hyperbolic"),
    piece("white-knight", "white", "knight", ARENA.tiles.get(source)!.neighbors[0]!.tileId, "hyperbolic"),
  ], "hyperbolic");
  const moves = getLegalMoves(open, "white-bishop");
  const capture = moves.find((move) => move.toTileId === ray[1] && move.route[1] === ray[0]);
  assert.deepEqual(capture?.route, [source, ray[0], ray[1]]);
  assert.ok(moves.every((move) => move.route[1] !== ray[0] || move.route[2] !== ray[1] || move.route.length === 3));
});

test("a flat queen slides on ranks, files, and diagonals", () => {
  const state = stateWith([
    piece("white-queen", "white", "queen", "d1", "flat"),
    piece("white-pawn-d", "white", "pawn", "d2", "flat"),
    piece("black-pawn-b", "black", "pawn", "b3", "flat"),
  ]);
  const destinations = destinationsFor(state, "white-queen");
  assert.ok(destinations.has(tile("a1")));
  assert.ok(destinations.has(tile("h5")));
  assert.ok(destinations.has(tile("b3")));
  assert.ok(!destinations.has(tile("d2")));
  assert.ok(!destinations.has(tile("d3")));
});

test("flat pawns step forward, capture diagonally, and promote to a queen", () => {
  let state = stateWith([
    piece("white-pawn-e", "white", "pawn", "e2", "flat"),
    piece("black-pawn-d", "black", "pawn", "d3", "flat"),
  ]);
  const destinations = destinationsFor(state, "white-pawn-e");
  assert.ok(destinations.has(tile("e3")));
  assert.ok(destinations.has(tile("e4")));
  assert.ok(destinations.has(tile("d3")));
  assert.ok(!destinations.has(tile("f3")));

  state = applyAction(state, { kind: "move", pieceId: "white-pawn-e", toTileId: tile("e4") });
  const moved = state.pieces.find((candidate) => candidate.id === "white-pawn-e");
  assert.equal(moved?.moved, true);
  assert.ok(!destinationsFor(state, "white-pawn-e").has(tile("e6")));

  state = stateWith([
    piece("white-pawn-a", "white", "pawn", "a7", "flat"),
    piece("black-king", "black", "king", "h8", "flat"),
  ]);
  const promoted = applyAction(state, { kind: "move", pieceId: "white-pawn-a", toTileId: tile("a8") });
  assert.equal(promoted.pieces.find((candidate) => candidate.id === "white-pawn-a")?.type, "queen");
  assert.match(promoted.history.at(-1)!.notation, /promotes to Queen/);
});

test("hyperbolic pawns advance only toward the far rank", () => {
  const state = stateWith([piece("white-pawn-e", "white", "pawn", "e4", "hyperbolic")], "hyperbolic");
  const origin = ARENA.rankByTile.get(tile("e4"))!;
  const moves = getLegalMoves(state, "white-pawn-e");
  assert.ok(moves.length > 0);
  assert.ok(moves.every((move) => (ARENA.rankByTile.get(move.toTileId) ?? 0) > origin));
  assert.ok(getLegalMoves(
    stateWith([piece("black-pawn-d", "black", "pawn", "e4", "hyperbolic")], "hyperbolic"),
    "black-pawn-d",
  ).every((move) => (ARENA.rankByTile.get(move.toTileId) ?? 0) < origin));
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
