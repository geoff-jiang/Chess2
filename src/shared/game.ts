import {
  ARENA,
  rookRay,
  squareCoordinates,
  squareId,
  type Arena,
  type SquareId,
} from "./geometry.ts";

export type Side = "white" | "black";
export type PieceType = "king" | "rook" | "knight" | "guard";
export type GeometryMode = "flat" | "hyperbolic";

export interface Piece {
  id: string;
  side: Side;
  type: PieceType;
  tileId: string;
}

export interface MoveOption {
  toTileId: string;
  /** Tile centers visited, including the selected piece and destination. */
  route: string[];
}

export type GameAction =
  | { kind: "move"; pieceId: string; toTileId: string }
  | { kind: "shift"; toMode: GeometryMode };

export type GameStatus =
  | { kind: "playing" }
  | { kind: "won"; winner: Side }
  | { kind: "draw"; reason: "repetition" };

export interface HistoryItem {
  ply: number;
  actor: Side;
  action: GameAction;
  notation: string;
  captured?: Piece;
}

export interface GameState {
  arenaVersion: number;
  pieces: Piece[];
  activePlayer: Side;
  mode: GeometryMode;
  /** Number of completed piece moves before another shift is available. */
  shiftCooldown: number;
  status: GameStatus;
  history: HistoryItem[];
  repetitions: Record<string, number>;
}

export class RuleViolation extends Error {
  readonly code: "match-finished" | "not-your-turn" | "piece-not-found" | "shadow-piece" | "illegal-move" | "shift-locked" | "invalid-shift";

  constructor(
    code: RuleViolation["code"],
    message: string,
  ) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
  }
}

export function createInitialState(arena: Arena = ARENA): GameState {
  const pieces = [
    createAnchorPiece("white-king", "white", "king", "e1", arena),
    createAnchorPiece("white-rook", "white", "rook", "a1", arena),
    createAnchorPiece("white-knight", "white", "knight", "b1", arena),
    createAnchorPiece("white-guard", "white", "guard", "d2", arena),
    createAnchorPiece("black-king", "black", "king", "d8", arena),
    createAnchorPiece("black-rook", "black", "rook", "h8", arena),
    createAnchorPiece("black-knight", "black", "knight", "g8", arena),
    createAnchorPiece("black-guard", "black", "guard", "e7", arena),
  ];
  const state: GameState = {
    arenaVersion: arena.version,
    pieces,
    activePlayer: "white",
    mode: "flat",
    shiftCooldown: 0,
    status: { kind: "playing" },
    history: [],
    repetitions: {},
  };
  state.repetitions[positionKey(state)] = 1;
  return state;
}

/** Get the current player's destinations for a piece. King safety is intentionally optional. */
export function getLegalMoves(state: GameState, pieceId: string, arena: Arena = ARENA): MoveOption[] {
  if (state.status.kind !== "playing") return [];
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || piece.side !== state.activePlayer || isShadow(piece, state.mode, arena)) return [];
  return movesForPiece(state, piece, arena);
}

export function applyAction(state: GameState, action: GameAction, arena: Arena = ARENA): GameState {
  if (state.status.kind !== "playing") {
    throw new RuleViolation("match-finished", "This match has already finished.");
  }

  const actor = state.activePlayer;
  let pieces = state.pieces.map((piece) => ({ ...piece }));
  let mode = state.mode;
  let shiftCooldown = state.shiftCooldown;
  let captured: Piece | undefined;
  let notation: string;

  if (action.kind === "shift") {
    if (action.toMode === mode) {
      throw new RuleViolation("invalid-shift", "The board is already in that geometry.");
    }
    if (shiftCooldown > 0) {
      throw new RuleViolation("shift-locked", `Make ${shiftCooldown} more piece move${shiftCooldown === 1 ? "" : "s"} before shifting again.`);
    }
    const strandedKing = pieces.find((piece) => piece.type === "king" && !arena.flatSquareByTile.has(piece.tileId));
    if (action.toMode === "flat" && strandedKing) {
      throw new RuleViolation("invalid-shift", "Kings must remain on the 8×8 anchor board.");
    }
    mode = action.toMode;
    shiftCooldown = 2;
    notation = `${capitalize(actor)} shifts to ${mode} geometry`;
  } else {
    const movingPiece = pieces.find((piece) => piece.id === action.pieceId);
    if (!movingPiece) throw new RuleViolation("piece-not-found", "That piece is no longer on the board.");
    if (movingPiece.side !== actor) throw new RuleViolation("not-your-turn", "Wait for your turn before moving that piece.");
    if (isShadow(movingPiece, mode, arena)) throw new RuleViolation("shadow-piece", "That piece is in the shadow tray and cannot move in flat mode.");

    const move = movesForPiece(state, movingPiece, arena).find((candidate) => candidate.toTileId === action.toTileId);
    if (!move) throw new RuleViolation("illegal-move", "That destination is not a legal move for this piece.");
    const target = pieces.find((piece) => piece.tileId === action.toTileId && !isShadow(piece, mode, arena));
    captured = target ? { ...target } : undefined;
    pieces = pieces.filter((piece) => piece.id !== movingPiece.id && piece.id !== target?.id);
    pieces.push({ ...movingPiece, tileId: action.toTileId });
    shiftCooldown = Math.max(0, shiftCooldown - 1);
    const from = locationName(movingPiece.tileId, arena);
    const to = locationName(action.toTileId, arena);
    notation = `${capitalize(actor)} ${capitalize(movingPiece.type)} ${from} → ${to}${captured ? ` · captures ${capitalize(captured.type)}` : ""}`;
  }

  const next: GameState = {
    ...state,
    pieces,
    activePlayer: oppositeSide(actor),
    mode,
    shiftCooldown,
    status: captured?.type === "king" ? { kind: "won", winner: actor } : { kind: "playing" },
    history: [
      ...state.history,
      { ply: state.history.length + 1, actor, action: { ...action }, notation, ...(captured ? { captured } : {}) },
    ],
    repetitions: { ...state.repetitions },
  };

  if (next.status.kind === "playing") {
    const key = positionKey(next);
    const count = (next.repetitions[key] ?? 0) + 1;
    next.repetitions[key] = count;
    if (count >= 3) next.status = { kind: "draw", reason: "repetition" };
  }
  return next;
}

export function isShadow(piece: Piece, mode: GeometryMode, arena: Arena = ARENA): boolean {
  return mode === "flat" && !arena.flatSquareByTile.has(piece.tileId);
}

export function isInCheck(state: GameState, side: Side, arena: Arena = ARENA): boolean {
  if (state.status.kind === "won") return false;
  const king = state.pieces.find((piece) => piece.side === side && piece.type === "king");
  if (!king || isShadow(king, state.mode, arena)) return false;
  const attackers = state.pieces.filter((piece) => piece.side !== side && !isShadow(piece, state.mode, arena));
  return attackers.some((piece) => movesForPiece(state, piece, arena).some((move) => move.toTileId === king.tileId));
}

export function positionKey(state: GameState): string {
  const pieces = [...state.pieces]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((piece) => `${piece.id}:${piece.side}:${piece.type}:${piece.tileId}`)
    .join("|");
  return `${state.arenaVersion};${state.mode};${state.activePlayer};${state.shiftCooldown};${pieces}`;
}

export function oppositeSide(side: Side): Side {
  return side === "white" ? "black" : "white";
}

function createAnchorPiece(id: string, side: Side, type: PieceType, square: SquareId, arena: Arena): Piece {
  const tileId = arena.anchors.get(square);
  if (!tileId) throw new Error(`Missing anchor for starting square ${square}`);
  return { id, side, type, tileId };
}

function movesForPiece(state: GameState, piece: Piece, arena: Arena): MoveOption[] {
  const occupied = new Map<string, Piece>();
  for (const other of state.pieces) {
    if (!isShadow(other, state.mode, arena)) occupied.set(other.tileId, other);
  }
  const addIfOpen = (toTileId: string, route: string[], moves: MoveOption[]) => {
    const target = occupied.get(toTileId);
    if (target?.side === piece.side) return true;
    if (target?.type === "king" && target.side === piece.side) return false;
    moves.push({ toTileId, route });
    return target !== undefined;
  };

  return state.mode === "flat"
    ? flatMoves(piece, occupied, arena, addIfOpen)
    : hyperbolicMoves(piece, occupied, arena, addIfOpen);
}

type AddIfOpen = (toTileId: string, route: string[], moves: MoveOption[]) => boolean;

function flatMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  addIfOpen: AddIfOpen,
): MoveOption[] {
  const square = arena.flatSquareByTile.get(piece.tileId);
  if (!square) return [];
  const { row, col } = squareCoordinates(square);
  const moves: MoveOption[] = [];
  const addSquare = (nextRow: number, nextCol: number): boolean => {
    if (nextRow < 0 || nextRow > 7 || nextCol < 0 || nextCol > 7) return false;
    const nextSquare = squareId(nextRow, nextCol);
    const toTileId = arena.anchors.get(nextSquare);
    if (!toTileId) return false;
    return addIfOpen(toTileId, [piece.tileId, toTileId], moves);
  };

  if (piece.type === "rook") {
    for (const [rowStep, colStep] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let nextRow = row + rowStep;
      let nextCol = col + colStep;
      const route = [piece.tileId];
      while (nextRow >= 0 && nextRow < 8 && nextCol >= 0 && nextCol < 8) {
        const toTileId = arena.anchors.get(squareId(nextRow, nextCol));
        if (!toTileId) break;
        route.push(toTileId);
        const blocked = addIfOpen(toTileId, [...route], moves);
        if (blocked) break;
        nextRow += rowStep;
        nextCol += colStep;
      }
    }
  } else if (piece.type === "knight") {
    for (const [rowStep, colStep] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      addSquare(row + rowStep, col + colStep);
    }
  } else if (piece.type === "king") {
    for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (let colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep !== 0 || colStep !== 0) addSquare(row + rowStep, col + colStep);
      }
    }
  } else {
    for (const [rowStep, colStep] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      addSquare(row + rowStep, col + colStep);
    }
  }

  return moves;
}

function hyperbolicMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  addIfOpen: AddIfOpen,
): MoveOption[] {
  const moves: MoveOption[] = [];
  const sourceTile = arena.tiles.get(piece.tileId);
  if (!sourceTile) return moves;

  if (piece.type === "rook") {
    for (let edge = 0; edge < 4; edge += 1) {
      const ray = rookRay(arena, piece.tileId, edge);
      const route = [piece.tileId];
      for (const toTileId of ray) {
        route.push(toTileId);
        const blocked = addIfOpen(toTileId, [...route], moves);
        if (blocked) break;
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
    for (const [toTileId, route] of destinations) addIfOpen(toTileId, route, moves);
  } else if (piece.type === "king") {
    for (const toTileId of arena.touchNeighbors.get(piece.tileId) ?? []) {
      if (arena.flatSquareByTile.has(toTileId)) addIfOpen(toTileId, [piece.tileId, toTileId], moves);
    }
  } else {
    for (const link of sourceTile.neighbors) {
      if (link) addIfOpen(link.tileId, [piece.tileId, link.tileId], moves);
    }
  }

  return moves;
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function locationName(tileId: string, arena: Arena): string {
  return arena.flatSquareByTile.get(tileId)?.toUpperCase() ?? tileId;
}
