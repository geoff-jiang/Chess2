import assert from "node:assert/strict";
import test from "node:test";
import { ARENA, rookRay } from "../src/shared/geometry.ts";
import { diagonalRay } from "../src/shared/curvature-moves.ts";
import { applyAction, createInitialState, getLegalMoves, type Piece } from "../src/shared/game.ts";
import { explainMove, routeLandings } from "../src/view/move-explanation.ts";

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
