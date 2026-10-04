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
  assert.ok(largestEdge / centerEdge < 3, `outer edges are ${(largestEdge / centerEdge).toFixed(1)} times the central edge`);
  assert.ok(largestOuterSpread / centerEdge > 0.75, `outer tiles are still crushed; radial depth is ${(largestOuterSpread / centerEdge).toFixed(2)} central edges`);
  assert.ok(largestOuterSpread / centerEdge < 1.6, `outer tiles are needle-shaped; radial depth is ${(largestOuterSpread / centerEdge).toFixed(2)} central edges`);

  const outerGaps: number[] = [];
  for (const tile of ARENA.tiles.values()) {
    if (tile.ring < 4) continue;
    const centerPoint = toDisplayPoint(tile.center);
    let nearest = Infinity;
    for (const link of tile.neighbors) {
      if (!link) continue;
      const neighbor = ARENA.tiles.get(link.tileId);
      if (!neighbor) continue;
      nearest = Math.min(nearest, centerPoint.distanceTo(toDisplayPoint(neighbor.center)));
    }
    outerGaps.push(nearest);
  }
  outerGaps.sort((left, right) => left - right);
  const medianGap = outerGaps[Math.floor(outerGaps.length / 2)] ?? 0;
  assert.ok(outerGaps[0]! > 0.7, `closest outer pieces are ${outerGaps[0]?.toFixed(2)} apart`);
  assert.ok(medianGap > 1.2, `typical outer spacing is ${medianGap.toFixed(2)}`);
});
