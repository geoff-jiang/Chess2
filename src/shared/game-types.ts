export type Side = "white" | "black";
export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type Promotion = "queen" | "rook" | "bishop" | "knight";
export type GeometryMode = "flat" | "hyperbolic";
export type Ruleset = "standard" | "curvature";
export interface Piece {
  id: string;
  side: Side;
  type: PieceType;
  tileId: string;
  /** Transported local orientation, used only by curved pawns. */
  forwardEdge?: number;
}
export interface MoveOption {
  toTileId: string;
  /** Includes source and destination; curved diagonals include intermediate guide tiles. */
  route: string[];
  promotion?: Promotion;
  /** Heading correction after a curved pawn's diagonal capture. */
  turn?: number;
}
export type GameAction =
  | { kind: "move"; pieceId: string; toTileId: string; promotion?: Promotion }
  | { kind: "shift"; toMode: GeometryMode };
export type DrawReason = "repetition" | "stalemate" | "insufficient-material" | "fifty-move";
export type GameStatus =
  | { kind: "playing" }
  | { kind: "won"; winner: Side; reason: "checkmate" }
  | { kind: "draw"; reason: DrawReason };
export interface HistoryItem {
  ply: number;
  actor: Side;
  action: GameAction;
  notation: string;
  captured?: Piece;
}
export interface GameState {
  arenaVersion: number;
  ruleset: Ruleset;
  pieces: Piece[];
  activePlayer: Side;
  mode: GeometryMode;
  shiftCooldown: number;
  status: GameStatus;
  history: HistoryItem[];
  repetitions: Record<string, number>;
  /** Serialized chess position, including castling, en passant and move clocks. */
  fen: string;
}
export class RuleViolation extends Error {
  readonly code: "invalid-position" | "match-finished" | "not-your-turn" | "piece-not-found" | "shadow-piece" | "illegal-move" | "shift-locked" | "invalid-shift" | "invalid-promotion";
  constructor(code: RuleViolation["code"], message: string) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
  }
}
