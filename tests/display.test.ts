import assert from "node:assert/strict";
import test from "node:test";
import { ARENA } from "../src/shared/geometry.ts";
import { toDisplayPoint } from "../src/view/hyperbolic-display.ts";

test("the curved display fits the arena without needle-shaped outer tiles", () => {
  const center = ARENA.tiles.get(ARENA.centerTileId)!;
  const centerEdge = toDisplayPoint(center.vertices[0]).distanceTo(toDisplayPoint(center.vertices[1]));
  let largestRadius = 0;
  let largestEdge = 0;
  let largestOuterSpread = 0;
  for (const tile of ARENA.tiles.values()) {
    const vertexRadii: number[] = [];
    for (let index = 0; index < tile.vertices.length; index += 1) {
      const first = toDisplayPoint(tile.vertices[index]);
      const second = toDisplayPoint(tile.vertices[(index + 1) % tile.vertices.length]);
      largestRadius = Math.max(largestRadius, first.length());
      largestEdge = Math.max(largestEdge, first.distanceTo(second));
      vertexRadii.push(Math.hypot(first.x, first.z));
    }
    if (tile.ring === 4) largestOuterSpread = Math.max(largestOuterSpread, Math.max(...vertexRadii) - Math.min(...vertexRadii));
  }

  assert.ok(largestRadius < 16, `outer radius ${largestRadius.toFixed(1)} exceeds the readable board extent`);
  assert.ok(largestEdge / centerEdge < 8, `outer edges are ${(largestEdge / centerEdge).toFixed(1)} times the central edge`);
  assert.ok(largestOuterSpread / centerEdge < 0.7, `outer tile radial depth is ${(largestOuterSpread / centerEdge).toFixed(1)} central edges`);
});
