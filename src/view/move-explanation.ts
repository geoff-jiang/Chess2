import { ARENA, type SquareId } from "../shared/geometry.ts";
import type { GameState, HistoryItem, MoveOption, Piece } from "../shared/game-types.ts";
import { capitalize } from "../shared/labels.ts";

export function tileName(tileId: string): string {
  return ARENA.flatSquareByTile.get(tileId)?.toUpperCase() ?? `Extra ${Number(tileId.slice(2))}`;
}

export function capturedPieceForMove(state: GameState, piece: Piece, move: MoveOption): Piece | undefined {
  const occupant = state.pieces.find((candidate) => candidate.tileId === move.toTileId && candidate.side !== piece.side);
  if (occupant) return occupant;
  if (state.mode !== "flat" || piece.type !== "pawn") return undefined;
  const from = ARENA.flatSquareByTile.get(piece.tileId);
  const to = ARENA.flatSquareByTile.get(move.toTileId);
  if (!from || !to || from[0] === to[0] || state.fen.split(" ")[3] !== to) return undefined;
  return state.pieces.find((candidate) => candidate.tileId === ARENA.anchors.get(`${to[0]}${from[1]}` as SquareId) && candidate.side !== piece.side);
}

export function historyNote(item: HistoryItem): string {
  if (item.action.kind !== "move") return item.notation;
  const fromTileId = item.fromTileId ?? item.notation.match(/h-\d{3}/)?.[0];
  const pieceType = item.pieceType ?? item.notation.match(/^(King|Queen|Rook|Bishop|Knight|Pawn)\b/)?.[1]?.toLowerCase();
  if (!fromTileId || !pieceType) return item.notation.replace(/h-\d{3}/g, tileName);
  const capture = item.captured ? ` · takes ${item.captured.type}` : "";
  const promotion = item.action.promotion ? ` · promotes to ${item.action.promotion}` : "";
  return `${capitalize(pieceType)} ${tileName(fromTileId)} → ${tileName(item.action.toTileId)}${capture}${promotion}`;
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
  const target = capturedPieceForMove(state, piece, move);
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
