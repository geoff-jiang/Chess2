import assert from "node:assert/strict";
import test from "node:test";
import { ARENA, edgeMidpoint, type Vector3 } from "../src/shared/geometry.ts";
import { centerOn, displayNormal, toDisplayPoint } from "../src/view/hyperbolic-display.ts";

const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y - a.z * b.z;

test("local viewing preserves hyperbolic distances and centers every tile, including the boundary", () => {
  for (const focus of ARENA.tiles.values()) {
    assert.ok(toDisplayPoint(focus.center, focus.center).length() < 1e-9);
    for (const tile of ARENA.tiles.values()) {
      const a = centerOn(tile.center, focus.center);
      assert.ok(Math.abs(dot(a, a) + 1) < 1e-7);
      for (const link of tile.neighbors) {
        if (!link) continue;
        const b = ARENA.tiles.get(link.tileId)!.center;
        assert.ok(Math.abs(dot(a, centerOn(b, focus.center)) - dot(tile.center, b)) < 1e-7);
      }
    }
  }
});

test("every focused tile has the same usable center-to-edge size as the original center tile", () => {
  const root = ARENA.tiles.get(ARENA.centerTileId)!;
  const baseline = toDisplayPoint(edgeMidpoint(root.vertices, 0)).length();
  assert.ok(baseline > 1, "focused tile must leave room for a readable piece");
  for (const tile of ARENA.tiles.values()) {
    for (let edge = 0; edge < 4; edge++) {
      const radius = toDisplayPoint(edgeMidpoint(tile.vertices, edge), tile.center).length();
      assert.ok(Math.abs(radius - baseline) < 1e-8, `${tile.id} edge ${edge} shrinks when focused`);
    }
    assert.ok(Math.abs(displayNormal(tile.center, tile.center).y - 1) < 1e-9);
  }
});

test("overview and focused projections stay finite and bounded", () => {
  for (const focus of [undefined, ...[...ARENA.tiles.values()].map((tile) => tile.center)]) {
    for (const tile of ARENA.tiles.values()) for (const vertex of tile.vertices) {
      const point = toDisplayPoint(vertex, focus);
      assert.ok(Number.isFinite(point.x + point.y + point.z));
      assert.ok(Math.hypot(point.x, point.z) < 8);
      assert.ok(point.y < 0.77);
      assert.ok(Math.abs(displayNormal(vertex, focus).length() - 1) < 1e-10);
    }
  }
});
