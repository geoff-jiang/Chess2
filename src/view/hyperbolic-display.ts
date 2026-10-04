import * as THREE from "three";
import type { Vector3 } from "../shared/geometry.ts";

const DISPLAY_RADIUS = 8;
const RADIAL_SOFTNESS = 2.5;
const HEIGHT_PER_SQUARED_DISPLAY_UNIT = 0.035;

/** Compress hyperboloid distance for display; the rules still use model coordinates. */
export function toDisplayPoint(point: Vector3): THREE.Vector3 {
  const modelRadius = Math.hypot(point.x, point.y);
  if (modelRadius < 1e-12) return new THREE.Vector3(0, 0, 0);
  const hyperbolicDistance = Math.asinh(modelRadius);
  const displayRadius = DISPLAY_RADIUS * Math.tanh(hyperbolicDistance / RADIAL_SOFTNESS);
  const scale = displayRadius / modelRadius;
  return new THREE.Vector3(
    point.x * scale,
    HEIGHT_PER_SQUARED_DISPLAY_UNIT * displayRadius * displayRadius,
    point.y * scale,
  );
}

export function displayNormal(point: Vector3): THREE.Vector3 {
  const display = toDisplayPoint(point);
  return new THREE.Vector3(
    -2 * HEIGHT_PER_SQUARED_DISPLAY_UNIT * display.x,
    1,
    -2 * HEIGHT_PER_SQUARED_DISPLAY_UNIT * display.z,
  ).normalize();
}
