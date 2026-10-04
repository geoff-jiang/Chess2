import assert from "node:assert/strict";
import test from "node:test";
import { ARENA, rookRay } from "../src/shared/geometry.ts";
import { diagonalRay } from "../src/shared/curvature-moves.ts";
import { applyAction, createInitialState, createStateFromFen, getLegalMoves, type Piece } from "../src/shared/game.ts";
import { capturedPieceForMove, explainMove, historyNote, routeLandings } from "../src/view/move-explanation.ts";

test("route hints distinguish bishop guide tiles, sliding landings, and knight jumps", () => {
  const tileId = ARENA.centerTileId;
  const queen: Piece = { id: "queen", side: "white", type: "queen", tileId };
  const straight = [tileId, ...rookRay(ARENA, tileId, 0).slice(0, 3)];
  const diagonal = diagonalRay(ARENA, tileId, 0, 1).find((route) => route.length >= 5)!;
  assert.ok(diagonal);
  const move = (route: string[]) => ({ route, toTileId: route.at(-1)! });
  assert.deepEqual(routeLandings(queen, move(straight)), [1, 2, 3]);
  assert.deepEqual(routeLandings(queen, move(diagonal)), [2, 4]);
  assert.deepEqual(routeLandings({ ...queen, type: "bishop" }, move(diagonal)), [2, 4]);
  assert.deepEqual(routeLandings({ ...queen, type: "knight" }, move(straight)), [3]);
});

test("opening bishop explanation names the occupied guide separately from its legal landing", () => {
  const state = applyAction(createInitialState(), { kind: "shift", toMode: "hyperbolic" });
  const bishop = state.pieces.find((piece) => piece.tileId === ARENA.anchors.get("c8"))!;
  const move = getLegalMoves(state, bishop.id).find((candidate) => candidate.toTileId === ARENA.anchors.get("e6"))!;
  const text = explainMove(state, bishop, move);
  assert.match(text, /Route: C8 → D7 → E6/);
  assert.match(text, /Landing squares: E6/);
  assert.deepEqual(routeLandings(bishop, move), [2]);
});

test("history shows source and destination squares in flat and curved play", () => {
  const state = createInitialState(ARENA, "standard");
  const pawn = state.pieces.find((piece) => piece.tileId === ARENA.anchors.get("e2"))!;
  const next = applyAction(state, { kind: "move", pieceId: pawn.id, toTileId: ARENA.anchors.get("e4")! });
  assert.equal(historyNote(next.history.at(-1)!), "Pawn E2 → E4");
  assert.equal(historyNote({
    ply: 1, actor: "black", action: { kind: "move", pieceId: "black-knight-b8", toTileId: "h-031" },
    notation: "Knight h-080 → h-031",
  }), "Knight B8 → C7");
});

test("en passant appears as a capture even though its destination starts empty", () => {
  const state = createStateFromFen("k7/8/8/3pP3/8/8/8/7K w - d6 0 1", ARENA, "standard");
  const pawn = state.pieces.find((piece) => piece.tileId === ARENA.anchors.get("e5"))!;
  const move = getLegalMoves(state, pawn.id).find((option) => option.toTileId === ARENA.anchors.get("d6"))!;
  assert.equal(capturedPieceForMove(state, pawn, move)?.tileId, ARENA.anchors.get("d5"));
  assert.match(explainMove(state, pawn, move), /^Capture the black pawn at D6\./);
  const next = applyAction(state, { kind: "move", pieceId: pawn.id, toTileId: move.toTileId });
  assert.equal(historyNote(next.history.at(-1)!), "Pawn E5 → D6 · takes pawn");
});
