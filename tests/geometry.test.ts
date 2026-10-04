import assert from "node:assert/strict";
import test from "node:test";
import { bishopRay, cornerNeighbors, createArena, rookRay, type SquareId } from "../src/shared/geometry.ts";

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

test("bishop rays cross one corner and leave through the opposite corner", () => {
  const arena = createArena();
  const center = arena.centerTileId;
  const corners = cornerNeighbors(arena, center, 0);
  assert.equal(corners.length, 2);
  assert.ok(corners.every((id) => sharedVertexCount(arena, center, id) === 1));

  const ray = bishopRay(arena, center, 0, corners[0]);
  assert.equal(ray[0], corners[0]);
  assert.ok(ray.length >= 2);
  assert.equal(new Set(ray).size, ray.length);
  assert.equal(sharedVertexCount(arena, ray[0], ray[1]), 1);
  assert.notDeepEqual(sharedVertexKeys(arena, center, ray[0]), sharedVertexKeys(arena, ray[0], ray[1]));
  assert.ok(arena.tiles.get(ray[0])!.neighbors.every((link) => link?.tileId !== ray[1]));
});

function sharedVertexKeys(arena: ReturnType<typeof createArena>, leftId: string, rightId: string): string[] {
  return [...arena.vertexTiles.entries()].filter(([, tiles]) => tiles.has(leftId) && tiles.has(rightId)).map(([key]) => key);
}

function sharedVertexCount(arena: ReturnType<typeof createArena>, leftId: string, rightId: string): number {
  return sharedVertexKeys(arena, leftId, rightId).length;
}

function oppositeSquare(square: SquareId): SquareId {
  const rank = 9 - Number(square[1]);
  const col = 7 - (square.charCodeAt(0) - 97);
  return `${String.fromCharCode(97 + col)}${rank}`;
}
