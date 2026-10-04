import assert from "node:assert/strict";
import test from "node:test";
import { overviewDistance } from "../src/view/camera-fit.ts";

test("overview contains the full arena in portrait, landscape, and narrow split views", () => {
  for (const aspect of [0.4, 0.75, 1, 1.8, 3]) {
    const radius = 9;
    const distance = overviewDistance(radius, 38, aspect);
    const angularRadius = Math.asin(radius / distance);
    const vertical = 38 * Math.PI / 360;
    assert.ok(angularRadius < vertical);
    assert.ok(angularRadius < Math.atan(Math.tan(vertical) * aspect));
  }
});
