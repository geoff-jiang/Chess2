import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import { applyAction, canShift, createInitialState, createStateFromFen, getLegalMoves, isInCheck, positionKey, validatePosition, RuleViolation, type GameState, type Promotion } from "../src/shared/game.ts";
import { ARENA, type SquareId } from "../src/shared/geometry.ts";

function tile(square: string): string { return ARENA.anchors.get(square as SquareId)!; }
function move(state: GameState, from: string, to: string, promotion?: Promotion): GameState {
  const piece = state.pieces.find((candidate) => candidate.tileId === tile(from));
  assert.ok(piece, `No piece on ${from}`);
  return applyAction(state, { kind: "move", pieceId: piece.id, toTileId: tile(to), ...(promotion ? { promotion } : {}) });
}
function destinations(state: GameState, square: string): string[] {
  return getLegalMoves(state, state.pieces.find((piece) => piece.tileId === tile(square))!.id).map((option) => ARENA.flatSquareByTile.get(option.toTileId)!);
}

test("full opening has 32 pieces on orthodox squares and 20 piece moves", () => {
  const state = createInitialState();
  assert.equal(state.ruleset, "curvature");
  assert.equal(state.pieces.length, 32);
  for (const side of ["white", "black"]) {
    for (const [type, count] of [["pawn", 8], ["rook", 2], ["knight", 2], ["bishop", 2], ["queen", 1], ["king", 1]]) assert.equal(state.pieces.filter((piece) => piece.side === side && piece.type === type).length, count);
  }
  assert.equal(state.pieces.find((piece) => piece.tileId === tile("e8"))!.type, "king");
  assert.equal(state.pieces.find((piece) => piece.tileId === tile("d1"))!.type, "queen");
  assert.equal(state.pieces.reduce((count, piece) => count + getLegalMoves(state, piece.id).length, 0), 20);
  validatePosition(state);
});

test("adapter opening perft matches the known standard depth-two count", () => {
  const state = createInitialState(ARENA, "standard");
  let count = 0;
  for (const piece of state.pieces) for (const option of getLegalMoves(state, piece.id)) {
    const next = applyAction(state, { kind: "move", pieceId: piece.id, toTileId: option.toTileId });
    count += next.pieces.reduce((sum, candidate) => sum + getLegalMoves(next, candidate.id).length, 0);
  }
  assert.equal(count, 400);
});

test("pawn blockers, double steps, knight jumps, and immutable actions", () => {
  const initial = createInitialState(ARENA, "standard"), saved = JSON.stringify(initial);
  assert.deepEqual(destinations(initial, "e2").sort(), ["e3", "e4"]);
  assert.deepEqual(destinations(initial, "b1").sort(), ["a3", "c3"]);
  assert.deepEqual(destinations(initial, "a1"), []);
  const next = move(initial, "e2", "e4");
  assert.equal(JSON.stringify(initial), saved);
  assert.equal(next.pieces.find((piece) => piece.tileId === tile("e4"))!.id, "white-pawn-e2");
  assert.throws(() => move(initial, "a1", "a4"), (error) => error instanceof RuleViolation && error.code === "illegal-move");
  assert.throws(() => move(initial, "a7", "a6"), /Wait for your turn/);
});

test("pins, king adjacency, and check enforce king safety", () => {
  const pinned = createStateFromFen("k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1", ARENA, "standard");
  assert.ok(!destinations(pinned, "e2").includes("f2"));
  assert.throws(() => move(pinned, "e2", "f2"), /king safety/);
  const checked = createStateFromFen("k3r3/8/8/8/8/8/8/4K3 w - - 0 1", ARENA, "standard");
  assert.equal(isInCheck(checked, "white"), true);
  assert.ok(!destinations(checked, "e1").includes("e2"));
  assert.throws(() => createStateFromFen("8/8/8/8/8/8/4k3/4K3 w - - 0 1"), /king in check/);
});

test("castling moves both pieces, loses rights, and cannot cross attacked squares", () => {
  const start = createStateFromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", ARENA, "standard");
  assert.ok(destinations(start, "e1").includes("g1"));
  assert.ok(destinations(start, "e1").includes("c1"));
  const castle = move(start, "e1", "g1");
  assert.equal(castle.pieces.find((piece) => piece.tileId === tile("f1"))!.id, "white-rook-h1");
  assert.equal(castle.fen.split(" ")[2], "kq");
  const attacked = createStateFromFen("4kr2/8/8/8/8/8/8/4K2R w K - 0 1", ARENA, "standard");
  assert.ok(!destinations(attacked, "e1").includes("g1"));
  let returned = move(start, "h1", "h2");
  returned = move(returned, "a8", "a7");
  returned = move(returned, "h2", "h1");
  assert.ok(!returned.fen.split(" ")[2].includes("K"));
});

test("en passant removes the bypassed pawn, expires, and respects discovered check", () => {
  let state = createInitialState(ARENA, "standard");
  for (const [from, to] of [["e2", "e4"], ["a7", "a6"], ["e4", "e5"], ["d7", "d5"]]) state = move(state, from, to);
  assert.ok(destinations(state, "e5").includes("d6"));
  const captured = move(state, "e5", "d6");
  assert.ok(!captured.pieces.some((piece) => piece.id === "black-pawn-d7"));
  assert.equal(captured.history.at(-1)!.captured?.id, "black-pawn-d7");
  const pinned = createStateFromFen("k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", ARENA, "standard");
  assert.ok(!destinations(pinned, "e5").includes("d6"));
  state = move(state, "g1", "f3"); state = move(state, "a6", "a5");
  assert.ok(!destinations(state, "e5").includes("d6"));
});

test("all four promotions require a choice and preserve piece identity", () => {
  const state = createStateFromFen("7k/P7/8/8/8/8/8/4K3 w - - 0 1", ARENA, "standard");
  assert.throws(() => move(state, "a7", "a8"), /Choose a queen/);
  for (const promotion of ["queen", "rook", "bishop", "knight"] as const) {
    const next = move(state, "a7", "a8", promotion);
    assert.equal(next.pieces.find((piece) => piece.id === "white-pawn-a7")!.type, promotion);
  }
  assert.throws(() => move(createInitialState(), "e2", "e4", "queen"), /not a promotion/);
});

test("standard checkmate, stalemate, insufficient material and fifty-move draws", () => {
  let state = createInitialState(ARENA, "standard");
  for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) state = move(state, from, to);
  assert.deepEqual(state.status, { kind: "won", winner: "black", reason: "checkmate" });
  assert.throws(() => move(state, "a2", "a3"), /already finished/);
  assert.deepEqual(createStateFromFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", ARENA, "standard").status, { kind: "draw", reason: "stalemate" });
  assert.deepEqual(createStateFromFen("7k/8/6K1/8/8/8/8/8 w - - 0 1", ARENA, "standard").status, { kind: "draw", reason: "insufficient-material" });
  assert.deepEqual(createStateFromFen("7k/8/6K1/8/8/8/8/R7 w - - 100 51", ARENA, "standard").status, { kind: "draw", reason: "fifty-move" });
});

test("repetition ignores piece IDs and clocks but includes castling and en passant", () => {
  let state = createInitialState(ARENA, "standard");
  const original = positionKey(state);
  for (let repeat = 0; repeat < 2; repeat++) for (const [from, to] of [["g1", "f3"], ["g8", "f6"], ["f3", "g1"], ["f6", "g8"]]) state = move(state, from, to);
  assert.equal(positionKey(state), original);
  assert.deepEqual(state.status, { kind: "draw", reason: "repetition" });
  const changed = { ...state, fen: state.fen.replace("KQkq", "-") };
  assert.notEqual(positionKey(state), positionKey(changed));
});

test("invalid positions and inconsistent serialized state are rejected without mutation", () => {
  for (const fen of ["invalid", "8/8/8/8/8/8/8/4K3 w - - 0 1", "P6k/8/8/8/8/8/8/4K3 w - - 0 1", "4k3/8/8/8/8/8/8/4K3 w K - 0 1"]) assert.throws(() => createStateFromFen(fen), RuleViolation);
  const state = createInitialState();
  for (const invalid of [
    { ...state, pieces: [...state.pieces, state.pieces[0]] },
    { ...state, pieces: state.pieces.map((piece, index) => index === 0 ? { ...piece, tileId: "unknown" } : piece) },
    { ...state, activePlayer: "black" as const },
    { ...state, arenaVersion: 999 },
  ]) assert.throws(() => validatePosition(invalid), RuleViolation);
});

test("flat adapter agrees with chess.js through captures and reconnect serialization", () => {
  let state = createInitialState(ARENA, "standard"), chess = new Chess();
  for (const san of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6", "O-O"]) {
    const reference = chess.move(san);
    state = move(state, reference.from, reference.to);
    assert.equal(state.fen, chess.fen());
    state = JSON.parse(JSON.stringify(state));
    validatePosition(state);
  }
});

test("standard rules never permit geometry shifts", () => {
  const state = createInitialState(ARENA, "standard");
  assert.equal(canShift(state, "hyperbolic"), false);
  assert.throws(() => applyAction(state, { kind: "shift", toMode: "hyperbolic" }), /only in Curvature/);
});
