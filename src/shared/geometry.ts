export type Vector3 = { x: number; y: number; z: number };
export type SquareId = `${string}${number}`;
export type EdgeLink = { tileId: string; edgeIndex: number };

export interface HyperbolicTile {
  id: string;
  ring: number;
  center: Vector3;
  vertices: Vector3[];
  neighbors: (EdgeLink | null)[];
}

export interface Arena {
  version: 1;
  tiles: Map<string, HyperbolicTile>;
  anchors: Map<SquareId, string>;
  flatSquareByTile: Map<string, SquareId>;
  oppositeTile: Map<string, string>;
  vertexTiles: Map<string, Set<string>>;
  touchNeighbors: Map<string, Set<string>>;
  centerTileId: string;
}

interface TileFrame {
  center: Vector3;
  axisX: Vector3;
  axisY: Vector3;
  vertices: Vector3[];
}

interface PendingTile extends TileFrame {
  id: string;
  ring: number;
}

const MAX_RING = 4;
const VERTEX_RADIUS = Math.acosh(1 / Math.tan(Math.PI / 4) / Math.tan(Math.PI / 5));
const KEY_SCALE = 100_000;
const EPSILON = 1e-7;

/** Build a deterministic radius-four patch of the regular {4,5} tiling. */
export function createArena(): Arena {
  const root = createFrame({ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const pending: PendingTile[] = [{ ...root, id: "h-000", ring: 0 }];
  const tileByCenter = new Map<string, PendingTile>([[pointKey(root.center), pending[0]]]);
  const tiles = new Map<string, HyperbolicTile>();

  for (let queueIndex = 0; queueIndex < pending.length; queueIndex += 1) {
    const current = pending[queueIndex];
    const tile = ensureTile(tiles, current);

    for (let edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {
      const nextFrame = reflectFrameAcrossEdge(current, edgeIndex);
      const key = pointKey(nextFrame.center);
      let next = tileByCenter.get(key);

      if (!next && current.ring < MAX_RING) {
        next = {
          ...nextFrame,
          id: `h-${String(pending.length).padStart(3, "0")}`,
          ring: current.ring + 1,
        };
        tileByCenter.set(key, next);
        pending.push(next);
      }

      if (!next) continue;
      const nextTile = ensureTile(tiles, next);
      const sharedMidpoint = edgeMidpoint(current.vertices, edgeIndex);
      const nextEdgeIndex = closestEdge(next.vertices, sharedMidpoint);
      tile.neighbors[edgeIndex] = { tileId: next.id, edgeIndex: nextEdgeIndex };
      nextTile.neighbors[nextEdgeIndex] = { tileId: current.id, edgeIndex };
    }
  }

  const vertexTiles = buildVertexIncidence(tiles);
  const touchNeighbors = buildTouchNeighbors(tiles, vertexTiles);
  const oppositeTile = buildOppositeMap(tiles);
  const { anchors, flatSquareByTile } = buildAnchors(tiles, oppositeTile);

  return {
    version: 1,
    tiles,
    anchors,
    flatSquareByTile,
    oppositeTile,
    vertexTiles,
    touchNeighbors,
    centerTileId: "h-000",
  };
}

export const ARENA = createArena();

/** Return the tiles visited by a straight, center-crossing hyperbolic ray. */
export function rookRay(arena: Arena, startTileId: string, exitEdge: number): string[] {
  const route: string[] = [];
  let tile = arena.tiles.get(startTileId);
  let edge = normalizeEdge(exitEdge);
  const visited = new Set([startTileId]);

  while (tile) {
    const link = tile.neighbors[edge];
    if (!link || visited.has(link.tileId)) break;
    route.push(link.tileId);
    visited.add(link.tileId);
    tile = arena.tiles.get(link.tileId);
    edge = normalizeEdge(link.edgeIndex + 2);
  }

  return route;
}

export function squareId(row: number, col: number): SquareId {
  return `${String.fromCharCode(97 + col)}${8 - row}`;
}

export function squareCoordinates(square: SquareId): { row: number; col: number } {
  return { row: 8 - Number(square[1]), col: square.charCodeAt(0) - 97 };
}

function createFrame(center: Vector3, axisX: Vector3, axisY: Vector3): TileFrame {
  const vertices = Array.from({ length: 4 }, (_, index) => {
    const angle = Math.PI / 4 + (index * Math.PI) / 2;
    const direction = add(scale(axisX, Math.cos(angle)), scale(axisY, Math.sin(angle)));
    return add(scale(center, Math.cosh(VERTEX_RADIUS)), scale(direction, Math.sinh(VERTEX_RADIUS)));
  });
  return { center, axisX, axisY, vertices };
}

function ensureTile(tiles: Map<string, HyperbolicTile>, frame: PendingTile): HyperbolicTile {
  let tile = tiles.get(frame.id);
  if (!tile) {
    tile = {
      id: frame.id,
      ring: frame.ring,
      center: frame.center,
      vertices: frame.vertices,
      neighbors: [null, null, null, null],
    };
    tiles.set(frame.id, tile);
  }
  return tile;
}

function reflectFrameAcrossEdge(frame: TileFrame, edgeIndex: number): TileFrame {
  const first = frame.vertices[edgeIndex];
  const second = frame.vertices[(edgeIndex + 1) % 4];
  const normal = lorentzNormal(first, second);
  const reflectedCenter = reflect(frame.center, normal);
  const reflectedAxisX = reflect(frame.axisX, normal);
  const reflectedAxisY = reflect(frame.axisY, normal);
  return createFrame(reflectedCenter, reflectedAxisX, reflectedAxisY);
}

function lorentzNormal(a: Vector3, b: Vector3): Vector3 {
  const cross = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
  const normal = { x: cross.x, y: cross.y, z: -cross.z };
  const magnitude = Math.sqrt(lorentzDot(normal, normal));
  return scale(normal, 1 / magnitude);
}

function reflect(point: Vector3, normal: Vector3): Vector3 {
  return subtract(point, scale(normal, 2 * lorentzDot(point, normal)));
}

export function edgeMidpoint(vertices: Vector3[], edgeIndex: number): Vector3 {
  const first = vertices[edgeIndex];
  const second = vertices[(edgeIndex + 1) % vertices.length];
  const sum = add(first, second);
  const length = Math.sqrt(-lorentzDot(sum, sum));
  return scale(sum, 1 / length);
}

function closestEdge(vertices: Vector3[], targetMidpoint: Vector3): number {
  let closest = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
    const midpoint = edgeMidpoint(vertices, edgeIndex);
    const distance = squaredDistance(midpoint, targetMidpoint);
    if (distance < closestDistance) {
      closest = edgeIndex;
      closestDistance = distance;
    }
  }
  if (closestDistance > 1e-8) throw new Error("Could not match a shared edge in the {4,5} tiling");
  return closest;
}

function buildVertexIncidence(tiles: Map<string, HyperbolicTile>): Map<string, Set<string>> {
  const incidence = new Map<string, Set<string>>();
  for (const tile of tiles.values()) {
    for (const vertex of tile.vertices) {
      const key = pointKey(vertex);
      let sharingTiles = incidence.get(key);
      if (!sharingTiles) {
        sharingTiles = new Set();
        incidence.set(key, sharingTiles);
      }
      sharingTiles.add(tile.id);
    }
  }
  return incidence;
}

function buildTouchNeighbors(
  tiles: Map<string, HyperbolicTile>,
  vertexTiles: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const neighbors = new Map([...tiles.keys()].map((id) => [id, new Set<string>()]));
  for (const sharingTiles of vertexTiles.values()) {
    for (const tileId of sharingTiles) {
      const touched = neighbors.get(tileId);
      if (!touched) continue;
      for (const neighborId of sharingTiles) {
        if (neighborId !== tileId) touched.add(neighborId);
      }
    }
  }
  return neighbors;
}

function buildOppositeMap(tiles: Map<string, HyperbolicTile>): Map<string, string> {
  const byCenter = new Map([...tiles.values()].map((tile) => [pointKey(tile.center), tile.id]));
  const opposite = new Map<string, string>();
  for (const tile of tiles.values()) {
    const id = byCenter.get(pointKey({ x: -tile.center.x, y: -tile.center.y, z: tile.center.z }));
    if (id) opposite.set(tile.id, id);
  }
  return opposite;
}

function buildAnchors(
  tiles: Map<string, HyperbolicTile>,
  oppositeTile: Map<string, string>,
): { anchors: Map<SquareId, string>; flatSquareByTile: Map<string, SquareId> } {
  const tilePairs: [string, string][] = [];
  for (const [tileId, oppositeId] of oppositeTile) {
    if (tileId < oppositeId) tilePairs.push([tileId, oppositeId]);
  }

  tilePairs.sort((left, right) => {
    const ringDifference = Math.min(tiles.get(left[0])!.ring, tiles.get(left[1])!.ring)
      - Math.min(tiles.get(right[0])!.ring, tiles.get(right[1])!.ring);
    if (ringDifference !== 0) return ringDifference;
    if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1;
    return left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0;
  });

  const squarePairs: [SquareId, SquareId][] = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = squareId(row, col);
      const opposite = squareId(7 - row, 7 - col);
      if (square < opposite) squarePairs.push([square, opposite]);
    }
  }
  squarePairs.sort((left, right) => {
    const radius = (square: SquareId) => {
      const { row, col } = squareCoordinates(square);
      return Math.max(Math.abs(row - 3.5), Math.abs(col - 3.5));
    };
    const radiusDifference = radius(left[0]) - radius(right[0]);
    if (radiusDifference !== 0) return radiusDifference;
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
  });

  const anchors = new Map<SquareId, string>();
  const flatSquareByTile = new Map<string, SquareId>();
  for (let index = 0; index < squarePairs.length; index += 1) {
    const [square, oppositeSquare] = squarePairs[index];
    const pair = tilePairs[index];
    if (!pair) throw new Error("The four-ring patch has too few rotationally paired tiles");
    const [firstTile, secondTile] = pair;
    anchors.set(square, firstTile);
    anchors.set(oppositeSquare, secondTile);
    flatSquareByTile.set(firstTile, square);
    flatSquareByTile.set(secondTile, oppositeSquare);
  }
  return { anchors, flatSquareByTile };
}

function pointKey(point: Vector3): string {
  return `${Math.round(point.x * KEY_SCALE)},${Math.round(point.y * KEY_SCALE)},${Math.round(point.z * KEY_SCALE)}`;
}

function normalizeEdge(edge: number): number {
  return ((edge % 4) + 4) % 4;
}

function lorentzDot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y - a.z * b.z;
}

function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector: Vector3, factor: number): Vector3 {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor };
}

function squaredDistance(a: Vector3, b: Vector3): number {
  const x = a.x - b.x;
  const y = a.y - b.y;
  const z = a.z - b.z;
  return x * x + y * y + z * z;
}
