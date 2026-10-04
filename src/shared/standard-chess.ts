import { Chess, validateFen, type PieceSymbol, type Square } from "chess.js";
import { ARENA, squareCoordinates, type Arena, type SquareId } from "./geometry.ts";
import { RuleViolation, type GameState, type Piece, type PieceType, type Promotion } from "./game-types.ts";

export const PIECE_SYMBOLS: Record<PieceType, PieceSymbol> = { king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", pawn: "p" };
export const PIECE_TYPES: Record<PieceSymbol, PieceType> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
export const PROMOTIONS: Promotion[] = ["queen", "rook", "bishop", "knight"];

export function readPosition(fen: string): Chess {
  const validation = validateFen(fen);
  if (!validation.ok) throw new RuleViolation("invalid-position", validation.error ?? "Invalid chess position.");
  const chess = new Chess(fen);
  const pieces = chess.board().flat().filter((piece) => piece !== null);
  for (const color of ["w", "b"] as const) {
    if (pieces.filter((piece) => piece.color === color).length > 16 || pieces.filter((piece) => piece.color === color && piece.type === "p").length > 8) throw new RuleViolation("invalid-position", "A side cannot have more than 16 pieces or eight pawns.");
  }
  const rights = fen.split(" ")[2];
  const enPassant = fen.split(" ")[3];
  if (enPassant !== "-") {
    const file = enPassant[0], pawnRank = chess.turn() === "w" ? "5" : "4", originRank = chess.turn() === "w" ? "7" : "2";
    const pawn = chess.get(`${file}${pawnRank}` as Square);
    if (chess.get(enPassant as Square) || chess.get(`${file}${originRank}` as Square) || pawn?.type !== "p" || pawn.color === chess.turn()) throw new RuleViolation("invalid-position", "En passant requires an opponent pawn that just advanced two squares.");
  }
  for (const [flag, color, kingSquare, rookSquare] of [["K", "w", "e1", "h1"], ["Q", "w", "e1", "a1"], ["k", "b", "e8", "h8"], ["q", "b", "e8", "a8"]] as const) {
    if (rights.includes(flag) && (chess.get(kingSquare)?.type !== "k" || chess.get(kingSquare)?.color !== color || chess.get(rookSquare)?.type !== "r" || chess.get(rookSquare)?.color !== color)) throw new RuleViolation("invalid-position", "Castling rights require the original king and rook on their home squares.");
  }
  // FEN syntax validation alone does not reject adjacent kings or a checked non-moving side.
  const other = chess.turn() === "w" ? "b" : "w";
  const king = chess.findPiece({ type: "k", color: other })[0];
  if (chess.isAttacked(king, chess.turn())) throw new RuleViolation("invalid-position", "The side that just moved cannot leave its king in check.");
  return chess;
}

export function piecesFromPosition(chess: Chess, arena: Arena = ARENA): Piece[] {
  return chess.board().flatMap((rank) => rank.flatMap((entry) => {
    if (!entry) return [];
    const side = entry.color === "w" ? "white" : "black";
    const type = PIECE_TYPES[entry.type];
    return [{ id: `${side}-${type}-${entry.square}`, side, type, tileId: arena.anchors.get(entry.square as SquareId)! }];
  }));
}

export function standardPosition(state: GameState, arena: Arena): Chess {
  const chess = new Chess(state.fen);
  if (chess.turn() !== (state.activePlayer === "white" ? "w" : "b")) throw new RuleViolation("invalid-position", "The active player does not match the position.");
  const visible = state.pieces.filter((piece) => arena.flatSquareByTile.has(piece.tileId));
  const board = chess.board().flat().filter((piece) => piece !== null);
  if (visible.length !== board.length || visible.some((piece) => {
    const entry = chess.get(arena.flatSquareByTile.get(piece.tileId)! as Square);
    return !entry || entry.type !== PIECE_SYMBOLS[piece.type] || entry.color !== (piece.side === "white" ? "w" : "b");
  })) throw new RuleViolation("invalid-position", "The piece list does not match the chess position.");
  return chess;
}

/** Curved moves revoke castling and en passant before re-entering orthodox space. */
export function fenFromPieces(state: GameState, arena: Arena): string {
  const grid = Array.from({ length: 8 }, () => Array<string>(8).fill(""));
  for (const piece of state.pieces) {
    const square = arena.flatSquareByTile.get(piece.tileId);
    if (!square) continue;
    const { row, col } = squareCoordinates(square);
    const symbol = PIECE_SYMBOLS[piece.type];
    grid[row][col] = piece.side === "white" ? symbol.toUpperCase() : symbol;
  }
  const ranks = grid.map((rank) => {
    let result = "", empty = 0;
    for (const symbol of rank) {
      if (!symbol) empty++;
      else { if (empty) result += empty; empty = 0; result += symbol; }
    }
    return result + (empty || "");
  });
  return `${ranks.join("/")} ${state.activePlayer === "white" ? "w" : "b"} - - 0 ${Math.floor(state.history.length / 2) + 1}`;
}
