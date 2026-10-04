import { rookRay, squareCoordinates, squareId, type Arena } from "./geometry.ts";
import type { Piece, MoveOption } from "./game-types.ts";
type AddMoveAndReportOccupancy = (toTileId: string, route: string[], moves: MoveOption[]) => boolean;
export function hyperbolicMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  addMoveAndReportOccupancy: AddMoveAndReportOccupancy,
  attacksOnly = false,
): MoveOption[] {
  const moves: MoveOption[] = [];
  const sourceTile = arena.tiles.get(piece.tileId);
  if (!sourceTile) return moves;

  if (piece.type === "rook" || piece.type === "queen") {
    for (let edge = 0; edge < 4; edge += 1) {
      const ray = rookRay(arena, piece.tileId, edge);
      const route = [piece.tileId];
      for (const toTileId of ray) {
        route.push(toTileId);
        const blocked = addMoveAndReportOccupancy(toTileId, [...route], moves);
        if (blocked) break;
      }
    }
  }
  if (piece.type === "bishop" || piece.type === "queen") {
    for (let edge = 0; edge < 4; edge++) {
      for (const turn of [1, 3]) {
        for (const route of diagonalRay(arena, piece.tileId, edge, turn)) {
          if (addMoveAndReportOccupancy(route.at(-1)!, route, moves)) break;
        }
      }
    }
  } else if (piece.type === "knight") {
    const destinations = new Map<string, string[]>();
    for (let edge = 0; edge < 4; edge += 1) {
      const first = sourceTile.neighbors[edge];
      if (!first) continue;
      const firstTile = arena.tiles.get(first.tileId);
      if (!firstTile) continue;
      const straightEdge = (first.edgeIndex + 2) % 4;
      const second = firstTile.neighbors[straightEdge];
      if (!second) continue;
      const secondTile = arena.tiles.get(second.tileId);
      if (!secondTile) continue;
      const forwardEdge = (second.edgeIndex + 2) % 4;
      for (const sideEdge of [(forwardEdge + 1) % 4, (forwardEdge + 3) % 4]) {
        const side = secondTile.neighbors[sideEdge];
        if (!side || occupied.get(side.tileId)?.side === piece.side) continue;
        destinations.set(side.tileId, [piece.tileId, first.tileId, second.tileId, side.tileId]);
      }
    }
    for (const [toTileId, route] of destinations) addMoveAndReportOccupancy(toTileId, route, moves);
  } else if (piece.type === "king") {
    for (const toTileId of arena.touchNeighbors.get(piece.tileId) ?? []) {
      addMoveAndReportOccupancy(toTileId, [piece.tileId, toTileId], moves);
    }
  } else if (piece.type === "pawn") {
    const edge = pawnForwardEdge(piece, arena);
    const first = sourceTile.neighbors[edge];
    if (!first) return [];
    const firstTile = arena.tiles.get(first.tileId)!;
    const forward = (first.edgeIndex + 2) % 4;
    const addPawnMove = (toTileId: string, route: string[], heading: number, turn?: number) => {
      const square = arena.flatSquareByTile.get(toTileId);
      const destination = arena.tiles.get(toTileId)!;
      const enemyHalf = piece.side === "white" ? destination.center.y < 0 : destination.center.y > 0;
      const promotion = square?.[1] === (piece.side === "white" ? "8" : "1") || enemyHalf && !destination.neighbors[heading];
      for (const type of promotion ? ["queen", "rook", "bishop", "knight"] as const : [undefined]) {
        moves.push({ toTileId, route, ...(type ? { promotion: type } : {}), ...(turn !== undefined ? { turn } : {}) });
      }
    };
    if (!attacksOnly && !occupied.has(first.tileId)) addPawnMove(first.tileId, [piece.tileId, first.tileId], forward);
    for (const turn of [1, 3]) {
      const side = firstTile.neighbors[(forward + turn) % 4];
      if (!side) continue;
      const target = occupied.get(side.tileId);
      if (attacksOnly || target && target.side !== piece.side) {
        const heading = (side.edgeIndex + 2 + 4 - turn) % 4;
        addPawnMove(side.tileId, [piece.tileId, first.tileId, side.tileId], heading, (4 - turn) % 4);
      }
    }
  }

  return [...new Map(moves.map((move) => [`${move.toTileId}:${move.promotion ?? ""}`, move])).values()];
}

/** Alternating turns define a transported diagonal; sample every second edge step. */
export function diagonalRay(arena: Arena, sourceId: string, edge: number, turn: number): string[][] {
  const result: string[][] = [], route = [sourceId], visited = new Set([sourceId]);
  let tile = arena.tiles.get(sourceId)!;
  let exit = edge;
  while (true) {
    const first = tile.neighbors[exit];
    if (!first) break;
    const intermediate = arena.tiles.get(first.tileId)!;
    const second = intermediate.neighbors[(first.edgeIndex + 2 + turn) % 4];
    if (!second || visited.has(second.tileId)) break;
    route.push(first.tileId, second.tileId);
    visited.add(second.tileId);
    result.push([...route]);
    tile = arena.tiles.get(second.tileId)!;
    exit = (second.edgeIndex + 2 + 4 - turn) % 4;
  }
  return result;
}

/** Choose the edge closest in hyperbolic distance to the opposing home rank. */
export function pawnForwardEdge(piece: Piece, arena: Arena): number {
  if (piece.forwardEdge !== undefined) return piece.forwardEdge;
  const tile = arena.tiles.get(piece.tileId)!;
  const square = arena.flatSquareByTile.get(piece.tileId);
  const coordinates = square ? squareCoordinates(square) : null;
  const targetId = coordinates ? arena.anchors.get(squareId(piece.side === "white" ? 0 : 7, coordinates.col)) : undefined;
  const target = targetId ? arena.tiles.get(targetId)!.center : { x: 0, y: piece.side === "white" ? -1 : 1, z: Math.SQRT2 };
  let best = 0, score = -Infinity;
  for (let edge = 0; edge < 4; edge++) {
    const link = tile.neighbors[edge];
    if (!link) continue;
    const neighbor = arena.tiles.get(link.tileId)!.center;
    const value = neighbor.x * target.x + neighbor.y * target.y - neighbor.z * target.z;
    if (value > score) { best = edge; score = value; }
  }
  return best;
}


