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
  /** Chess rank for anchors, and the average rank of the nearest anchors elsewhere. */
  rankByTile: Map<string, number>;
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
    rankByTile: buildRankField(tiles, flatSquareByTile),
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

/** Tiles that meet `tileId` at one corner and do not share an edge with it. */
export function cornerNeighbors(arena: Arena, tileId: string, vertexIndex: number): string[] {
  const tile = arena.tiles.get(tileId);
  if (!tile) return [];
  const vertex = normalizeEdge(vertexIndex);
  const incident = arena.vertexTiles.get(pointKey(tile.vertices[vertex]));
  if (!incident) return [];
  const alongside = new Set(edgesAtVertex(tile, vertex).flatMap((link) => (link ? [link.tileId] : [])));
  return [...incident].filter((id) => id !== tileId && !alongside.has(id)).sort();
}

/**
 * Diagonal through opposite corners. The first step is a corner-only neighbor.
 * Each later step leaves through the opposite corner, on the same side of the
 * square as the step that entered.
 */
export function bishopRay(arena: Arena, startTileId: string, vertexIndex: number, firstTileId: string): string[] {
  const start = arena.tiles.get(startTileId);
  if (!start) return [];
  const route: string[] = [];
  const visited = new Set([startTileId]);
  let previous = start;
  let vertex = normalizeEdge(vertexIndex);
  let nextId: string | null = firstTileId;

  while (nextId && !visited.has(nextId) && route.length < arena.tiles.size) {
    const current = arena.tiles.get(nextId);
    if (!current) break;
    const arrival = vertexIndexOf(current, previous.vertices[vertex]);
    const shoulderEdge = shoulderEdgeIndex(previous, vertex, current);
    if (arrival < 0 || shoulderEdge < 0) break;
    route.push(nextId);
    visited.add(nextId);
    const sign = shoulderEdge === vertex ? 1 : -1;
    const exitVertex = (arrival + 2) % 4;
    const exitEdge = sign === 1 ? exitVertex : (exitVertex + 3) % 4;
    const exitShoulder = current.neighbors[exitEdge];
    previous = current;
    vertex = exitVertex;
    nextId = exitShoulder ? cornerPastShoulder(arena, current, exitVertex, exitShoulder.tileId) : null;
  }

  return route;
}

/** The vertex two tiles share, when they touch at a corner or an edge. */
export function sharedVertex(left: HyperbolicTile, right: HyperbolicTile): Vector3 | null {
  for (const vertex of left.vertices) {
    const key = pointKey(vertex);
    if (right.vertices.some((candidate) => pointKey(candidate) === key)) return vertex;
  }
  return null;
}

function edgesAtVertex(tile: HyperbolicTile, vertexIndex: number): (EdgeLink | null)[] {
  return [vertexIndex, (vertexIndex + 3) % 4].map((edgeIndex) => tile.neighbors[edgeIndex]);
}

function vertexIndexOf(tile: HyperbolicTile, vertex: Vector3): number {
  const key = pointKey(vertex);
  return tile.vertices.findIndex((candidate) => pointKey(candidate) === key);
}

function shoulderEdgeIndex(tile: HyperbolicTile, vertexIndex: number, corner: HyperbolicTile): number {
  const cornerNeighborsByEdge = new Set(corner.neighbors.flatMap((link) => (link ? [link.tileId] : [])));
  for (const edgeIndex of [vertexIndex, (vertexIndex + 3) % 4]) {
    const link = tile.neighbors[edgeIndex];
    if (link && cornerNeighborsByEdge.has(link.tileId)) return edgeIndex;
  }
  return -1;
}

function cornerPastShoulder(arena: Arena, tile: HyperbolicTile, vertexIndex: number, shoulderTileId: string): string | null {
  const shoulder = arena.tiles.get(shoulderTileId);
  if (!shoulder) return null;
  const besideShoulder = new Set(shoulder.neighbors.flatMap((link) => (link ? [link.tileId] : [])));
  return cornerNeighbors(arena, tile.id, vertexIndex).find((id) => besideShoulder.has(id)) ?? null;
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

function buildRankField(
  tiles: Map<string, HyperbolicTile>,
  flatSquareByTile: Map<string, SquareId>,
): Map<string, number> {
  const rankByTile = new Map<string, number>();
  for (const [tileId, square] of flatSquareByTile) rankByTile.set(tileId, Number(square[1]));
  for (const tileId of tiles.keys()) {
    if (!rankByTile.has(tileId)) rankByTile.set(tileId, nearestAnchorRank(tiles, flatSquareByTile, tileId));
  }
  return rankByTile;
}

function nearestAnchorRank(
  tiles: Map<string, HyperbolicTile>,
  flatSquareByTile: Map<string, SquareId>,
  startTileId: string,
): number {
  const seen = new Set([startTileId]);
  let layer = [startTileId];
  let distance = 0;
  while (layer.length) {
    const next: string[] = [];
    const ranks: number[] = [];
    for (const tileId of layer) {
      if (distance > 0) {
        const square = flatSquareByTile.get(tileId);
        if (square) ranks.push(Number(square[1]));
      }
      for (const link of tiles.get(tileId)?.neighbors ?? []) {
        if (!link || seen.has(link.tileId)) continue;
        seen.add(link.tileId);
        next.push(link.tileId);
      }
    }
    if (ranks.length) return ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length;
    layer = next;
    distance += 1;
  }
  return 4.5;
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
