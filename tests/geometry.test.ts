import assert from "node:assert/strict";
import test from "node:test";
import { createArena, rookRay, type SquareId } from "../src/shared/geometry.ts";

test("the four-ring square-pentagonal patch contains 109 tiles", () => {
  const arena = createArena();
  assert.equal(arena.tiles.size, 109);
});

test("the anchor map covers every flat square once and pairs opposite squares", () => {
  const arena = createArena();
  assert.equal(arena.anchors.size, 64);
  assert.equal(new Set(arena.anchors.values()).size, 64);
  for (const [square, tileId] of arena.anchors) {
    const opposite = arena.anchors.get(oppositeSquare(square));
    assert.ok(opposite);
    assert.equal(arena.oppositeTile.get(tileId), opposite);
  }
});

test("every regular interior vertex is shared by five tiles", () => {
  const arena = createArena();
  const interiorVertices = [...arena.vertexTiles.values()].filter((tiles) => tiles.size === 5);
  assert.ok(interiorVertices.length > 0);
  assert.ok([...arena.vertexTiles.values()].every((tiles) => tiles.size <= 5));
});

test("each tile has four edge slots and rook rays follow edge continuation", () => {
  const arena = createArena();
  const center = arena.centerTileId;
  const tile = arena.tiles.get(center);
  assert.ok(tile);
  assert.equal(tile.neighbors.filter(Boolean).length, 4);
  const ray = rookRay(arena, center, 0);
  assert.ok(ray.length > 0);
  assert.equal(ray[0], tile.neighbors[0]?.tileId);
});

function oppositeSquare(square: SquareId): SquareId {
  const rank = 9 - Number(square[1]);
  const col = 7 - (square.charCodeAt(0) - 97);
  return `${String.fromCharCode(97 + col)}${rank}`;
}
