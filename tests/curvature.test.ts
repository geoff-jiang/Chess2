import assert from "node:assert/strict";
import test from "node:test";
import { ARENA, rookRay } from "../src/shared/geometry.ts";
import { diagonalRay, hyperbolicMoves, pawnForwardEdge } from "../src/shared/curvature-moves.ts";
import { applyAction, canShift, createInitialState, createStateFromFen, getLegalMoves, isInCheck, validatePosition, type GameState, type Piece, type MoveOption } from "../src/shared/game.ts";
import { fenFromPieces } from "../src/shared/standard-chess.ts";

function pseudo(piece: Piece, pieces: Piece[] = [], attacks = false): MoveOption[] {
  const occupied = new Map([piece, ...pieces].map((candidate) => [candidate.tileId, candidate]));
  return hyperbolicMoves(piece, occupied, ARENA, (tileId, route, moves) => {
    const target = occupied.get(tileId);
    if (target?.side === piece.side) return true;
    moves.push({ toTileId: tileId, route });
    return !!target;
  }, attacks);
}
function fixture(extra: Piece[]): GameState {
  const initial = createInitialState();
  const candidates = [...ARENA.anchors.values()].filter((id) => ARENA.tiles.get(id)!.ring === 4 && !extra.some((piece) => piece.tileId === id));
  for (const white of candidates) for (const black of candidates) {
    if (white === black) continue;
    const state: GameState = { ...initial, mode: "hyperbolic", pieces: [
      { id: "white-king", side: "white", type: "king", tileId: white },
      { id: "black-king", side: "black", type: "king", tileId: black }, ...extra,
    ] };
    if (!isInCheck(state, "white") && !isInCheck(state, "black")) { validatePosition(state); return state; }
  }
  throw new Error("No safe fixture found");
}

test("safe opening shift keeps 32 pieces and opens an otherwise blocked bishop route", () => {
  const flat = createInitialState();
  assert.equal(canShift(flat, "hyperbolic"), true);
  const curved = applyAction(flat, { kind: "shift", toMode: "hyperbolic" });
  assert.equal(curved.pieces.length, 32);
  assert.equal(curved.activePlayer, "black");
  assert.equal(curved.shiftCooldown, 2);
  assert.equal(isInCheck(curved, "white"), false);
  assert.equal(isInCheck(curved, "black"), false);
  const blackFlat = { ...flat, activePlayer: "black" as const, fen: flat.fen.replace(" w ", " b ") };
  assert.equal(getLegalMoves(blackFlat, "black-bishop-c8").length, 0);
  assert.ok(getLegalMoves(curved, "black-bishop-c8").length > 0);
  assert.ok(curved.pieces.filter((piece) => piece.type === "pawn").every((piece) => piece.forwardEdge !== undefined));
  assert.throws(() => applyAction(curved, { kind: "shift", toMode: "flat" }), /2 more piece moves/);
});

test("legal curved moves always preserve king safety and cannot capture kings", () => {
  const curved = applyAction(createInitialState(), { kind: "shift", toMode: "hyperbolic" });
  for (const piece of curved.pieces) for (const option of getLegalMoves(curved, piece.id)) {
    const next = applyAction(curved, { kind: "move", pieceId: piece.id, toTileId: option.toTileId, ...(option.promotion ? { promotion: option.promotion } : {}) });
    assert.equal(isInCheck(next, curved.activePlayer), false);
    assert.equal(next.pieces.filter((candidate) => candidate.type === "king").length, 2);
    validatePosition(next);
  }
});

test("rook blockers, transported bishop diagonals and queen union", () => {
  const rook: Piece = { id: "r", type: "rook", side: "white", tileId: ARENA.centerTileId };
  const ray = rookRay(ARENA, rook.tileId, 0);
  const blocker: Piece = { id: "b", type: "pawn", side: "black", tileId: ray[1] };
  const moves = pseudo(rook, [blocker]);
  assert.ok(moves.some((move) => move.toTileId === ray[1]));
  assert.ok(!moves.some((move) => move.toTileId === ray[2]));
  const bishop = { ...rook, type: "bishop" as const }, queen = { ...rook, type: "queen" as const };
  const union = new Set([...pseudo(rook), ...pseudo(bishop)].map((move) => move.toTileId));
  assert.deepEqual(new Set(pseudo(queen).map((move) => move.toTileId)), union);
  for (const route of diagonalRay(ARENA, bishop.tileId, 0, 1)) {
    assert.ok(route.length % 2 === 1);
    assert.ok(pseudo(bishop).some((move) => move.toTileId === route.at(-1)));
  }
  const first = diagonalRay(ARENA, bishop.tileId, 0, 1)[0];
  const intermediateBlocker = { ...blocker, tileId: first[1], side: "white" as const };
  assert.ok(pseudo(bishop, [intermediateBlocker]).some((move) => move.toTileId === first[2]), "only diagonal landing tiles block bishops");
});

test("curved knight jumps intervening pieces and kings use the full corner graph", () => {
  const knight: Piece = { id: "n", type: "knight", side: "white", tileId: ARENA.centerTileId };
  const moves = pseudo(knight);
  assert.equal(moves.length, 8);
  const blocker: Piece = { id: "p", side: "white", type: "pawn", tileId: moves[0].route[1] };
  assert.ok(pseudo(knight, [blocker]).some((move) => move.toTileId === moves[0].toTileId));
  const king = { ...knight, type: "king" as const };
  assert.equal(pseudo(king).length, ARENA.touchNeighbors.get(king.tileId)!.size);
});

test("curved pawns move forward, capture only diagonally, and transport heading", () => {
  const pawn: Piece = { id: "p", type: "pawn", side: "white", tileId: ARENA.centerTileId, forwardEdge: 0 };
  assert.equal(pawnForwardEdge(pawn, ARENA), 0);
  const forward = pseudo(pawn)[0];
  assert.equal(forward.route.length, 2);
  const attack = pseudo(pawn, [], true)[0];
  assert.equal(attack.route.length, 3);
  assert.ok(!pseudo(pawn).some((move) => move.toTileId === attack.toTileId));
  const enemy: Piece = { id: "enemy", type: "rook", side: "black", tileId: attack.toTileId };
  assert.ok(pseudo(pawn, [enemy]).some((move) => move.toTileId === attack.toTileId));
  assert.deepEqual(pseudo(pawn, [{ ...enemy, tileId: forward.toTileId }]), []);
  const state = fixture([pawn]);
  const option = getLegalMoves(state, pawn.id).find((move) => move.toTileId === forward.toTileId)!;
  assert.ok(option);
  const next = applyAction(state, { kind: "move", pieceId: pawn.id, toTileId: option.toTileId });
  const entryEdge = ARENA.tiles.get(option.toTileId)!.neighbors.findIndex((link) => link?.tileId === pawn.tileId);
  assert.equal(next.pieces.find((piece) => piece.id === pawn.id)!.forwardEdge, (entryEdge + 2) % 4);
});

test("curved captures and pawn heading survive a JSON reconnect", () => {
  const pawn: Piece = { id: "p", type: "pawn", side: "white", tileId: ARENA.centerTileId, forwardEdge: 0 };
  const target = pseudo(pawn, [], true)[0];
  const enemy: Piece = { id: "enemy", type: "knight", side: "black", tileId: target.toTileId };
  const state = fixture([pawn, enemy]);
  const option = getLegalMoves(state, pawn.id).find((move) => move.toTileId === enemy.tileId)!;
  const next = applyAction(state, { kind: "move", pieceId: pawn.id, toTileId: option.toTileId });
  assert.ok(!next.pieces.some((piece) => piece.id === enemy.id));
  assert.equal(next.history.at(-1)?.fromTileId, pawn.tileId);
  assert.equal(next.history.at(-1)?.pieceType, "pawn");
  const resumed = JSON.parse(JSON.stringify(next));
  validatePosition(resumed);
  assert.equal(resumed.pieces.find((piece: Piece) => piece.id === pawn.id).forwardEdge, next.pieces.find((piece) => piece.id === pawn.id)!.forwardEdge);
});

test("curved promotion offers all four pieces only at the enemy edge", () => {
  let pawn: Piece | undefined;
  let options: MoveOption[] = [];
  for (const tile of ARENA.tiles.values()) for (let edge = 0; edge < 4; edge++) {
    const candidate: Piece = { id: "promoting", type: "pawn", side: "white", tileId: tile.id, forwardEdge: edge };
    const moves = pseudo(candidate).filter((move) => move.promotion);
    if (moves.length === 4) { pawn = candidate; options = moves; break; }
  }
  assert.ok(pawn);
  assert.deepEqual(new Set(options.map((move) => move.promotion)), new Set(["queen", "rook", "bishop", "knight"]));
  const state = fixture([pawn]);
  const legal = getLegalMoves(state, pawn.id).filter((move) => move.toTileId === options[0].toTileId);
  assert.equal(legal.length, 4);
  assert.throws(() => applyAction(state, { kind: "move", pieceId: pawn!.id, toTileId: legal[0].toTileId }), /Choose a queen/);
  for (const option of legal) {
    const next = applyAction(state, { kind: "move", pieceId: pawn.id, toTileId: option.toTileId, promotion: option.promotion });
    assert.equal(next.pieces.find((piece) => piece.id === pawn!.id)!.type, option.promotion);
  }
});

test("two moves unlock a safe return, preserving shadows and revoking special rights", () => {
  const curved = applyAction(createInitialState(), { kind: "shift", toMode: "hyperbolic" });
  const rookMove = getLegalMoves(curved, "black-rook-a8")[0];
  assert.ok(!ARENA.flatSquareByTile.has(rookMove.toTileId));
  const afterBlack = applyAction(curved, { kind: "move", pieceId: "black-rook-a8", toTileId: rookMove.toTileId });
  let ready: GameState | undefined;
  for (const piece of afterBlack.pieces) for (const option of getLegalMoves(afterBlack, piece.id)) {
    const next = applyAction(afterBlack, { kind: "move", pieceId: piece.id, toTileId: option.toTileId, ...(option.promotion ? { promotion: option.promotion } : {}) });
    if (canShift(next, "flat")) { ready = next; break; }
  }
  assert.ok(ready);
  const flat = applyAction(ready, { kind: "shift", toMode: "flat" });
  assert.equal(flat.fen.split(" ")[2], "-");
  assert.equal(flat.fen.split(" ")[3], "-");
  assert.equal(flat.pieces.find((piece) => piece.id === "black-rook-a8")!.tileId, rookMove.toTileId);
  assert.deepEqual(getLegalMoves({ ...flat, activePlayer: "black" }, "black-rook-a8"), []);
  validatePosition(flat);
});

test("unsafe shifts and off-anchor king escape are rejected", () => {
  const curved = applyAction(createInitialState(), { kind: "shift", toMode: "hyperbolic" });
  const extra = [...ARENA.tiles.keys()].find((id) => !ARENA.flatSquareByTile.has(id))!;
  const offAnchor = { ...curved, shiftCooldown: 0, pieces: curved.pieces.map((piece) => piece.type === "king" && piece.side === "black" ? { ...piece, tileId: extra } : piece) };
  assert.equal(canShift(offAnchor, "flat"), false);
  const standard = createInitialState(ARENA, "standard");
  assert.equal(canShift(standard, "hyperbolic"), false);
  let unsafe: GameState | undefined;
  for (const tileId of ARENA.anchors.values()) {
    if ([ARENA.anchors.get("e1"), ARENA.anchors.get("e8")].includes(tileId)) continue;
    const candidate = { ...createInitialState(), pieces: [
      { id: "wk", type: "king" as const, side: "white" as const, tileId: ARENA.anchors.get("e1")! },
      { id: "bk", type: "king" as const, side: "black" as const, tileId: ARENA.anchors.get("e8")! },
      { id: "br", type: "rook" as const, side: "black" as const, tileId },
    ] };
    const position = createStateFromFen(fenFromPieces(candidate, ARENA));
    if (!isInCheck(position, "white") && isInCheck({ ...position, mode: "hyperbolic" }, "white")) { unsafe = position; break; }
  }
  assert.ok(unsafe, "fixture must expose a new curved rook attack");
  assert.equal(canShift(unsafe, "hyperbolic"), false);
  assert.throws(() => applyAction(unsafe, { kind: "shift", toMode: "hyperbolic" }), /leave your king in check/);
});

test("version-two anchors keep home armies in opposing regions and freeze key mappings", () => {
  assert.equal(ARENA.version, 2);
  assert.equal(ARENA.anchors.get("a1"), "h-048");
  assert.equal(ARENA.anchors.get("e1"), "h-054");
  assert.equal(ARENA.anchors.get("e8"), "h-084");
  const state = createInitialState();
  assert.ok(state.pieces.filter((piece) => piece.side === "white").every((piece) => ARENA.tiles.get(piece.tileId)!.center.y > -1e-7));
  assert.ok(state.pieces.filter((piece) => piece.side === "black").every((piece) => ARENA.tiles.get(piece.tileId)!.center.y < 1e-7));
});
