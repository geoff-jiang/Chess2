import * as THREE from "three";
import type { Vector3 } from "../shared/geometry.ts";

const DISPLAY_RADIUS = 8;
const RADIAL_SOFTNESS = 4;
const HEIGHT_PER_SQUARED_DISPLAY_UNIT = 0.012;
const ORIGIN: Vector3 = { x: 0, y: 0, z: 1 };

/** A Lorentz boost centers a chosen tile without changing intrinsic distances. */
export function centerOn(point: Vector3, focus: Vector3 = ORIGIN): Vector3 {
  const spatialProduct = focus.x * point.x + focus.y * point.y;
  const factor = spatialProduct / (focus.z + 1) - point.z;
  return {
    x: point.x + focus.x * factor,
    y: point.y + focus.y * factor,
    z: focus.z * point.z - spatialProduct,
  };
}

/** Compress hyperboloid distance for display; the rules still use model coordinates. */
export function toDisplayPoint(modelPoint: Vector3, focus?: Vector3): THREE.Vector3 {
  const point = centerOn(modelPoint, focus);
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

export function displayNormal(point: Vector3, focus?: Vector3): THREE.Vector3 {
  const display = toDisplayPoint(point, focus);
  return new THREE.Vector3(
    -2 * HEIGHT_PER_SQUARED_DISPLAY_UNIT * display.x,
    1,
    -2 * HEIGHT_PER_SQUARED_DISPLAY_UNIT * display.z,
  ).normalize();
}
