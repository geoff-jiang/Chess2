import { ARENA } from "../shared/geometry.ts";
import type { GameState, MoveOption, Piece } from "../shared/game-types.ts";

export function tileName(tileId: string): string {
  return ARENA.flatSquareByTile.get(tileId)?.toUpperCase() ?? `Extra ${Number(tileId.slice(2))}`;
}

export function movementHelp(piece: Piece): string {
  switch (piece.type) {
    case "rook": return "Follow a straight lane through opposite edges. The first piece blocks the lane; an enemy there can be captured.";
    case "bishop": return "Follow a zigzag lane, landing every second step. Small guide dots are crossed without landing; only landing squares block the lane.";
    case "queen": return "Choose a straight rook lane or a bishop zigzag lane. Preview a destination to see which route it uses.";
    case "knight": return "Jump two steps straight, then one sideways. Pieces along the guide route do not block the jump.";
    case "king": return "Move to a tile touching an edge or corner. Only destinations safe from enemy attacks are offered.";
    case "pawn": return "The arrow shows forward. Advance one empty tile; capture one step forward then sideways. Your forward direction follows you across tiles.";
  }
}

export function explainMove(state: GameState, piece: Piece, move: MoveOption): string {
  const target = state.pieces.find((candidate) => candidate.tileId === move.toTileId);
  const route = move.route.map(tileName).join(" → ");
  const result = target ? `Capture the ${target.side} ${target.type} at` : "Move to";
  const promotion = move.promotion ? " Choose a promotion piece when you move." : "";
  const stops = routeLandings(piece, move).map((index) => tileName(move.route[index])).join(" → ");
  return `${result} ${tileName(move.toTileId)}.${promotion} Route: ${route}. Landing squares: ${stops}.`;
}

/** Route guide tiles and actual landing tiles have different blocker semantics. */
export function routeLandings(piece: Piece, move: MoveOption): number[] {
  const last = move.route.length - 1;
  if (piece.type === "knight" || piece.type === "pawn" || piece.type === "king") return [last];
  const straight = move.route.every((tileId, index, route) => {
    if (index === 0 || index === last) return true;
    const tile = ARENA.tiles.get(tileId)!;
    const entry = tile.neighbors.findIndex((link) => link?.tileId === route[index - 1]);
    return entry >= 0 && tile.neighbors[(entry + 2) % 4]?.tileId === route[index + 1];
  });
  const stride = piece.type === "bishop" || piece.type === "queen" && !straight ? 2 : 1;
  return Array.from({ length: Math.floor(last / stride) }, (_, index) => (index + 1) * stride);
}
