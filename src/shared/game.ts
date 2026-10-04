import {
  ARENA,
  bishopRay,
  cornerNeighbors,
  rookRay,
  squareCoordinates,
  squareId,
  type Arena,
  type SquareId,
} from "./geometry.ts";
import { capitalize } from "./labels.ts";

export type Side = "white" | "black";
export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn" | "guard";
export type GeometryMode = "flat" | "hyperbolic";

export interface Piece {
  id: string;
  side: Side;
  type: PieceType;
  tileId: string;
  /** Set after a pawn moves, so only an unmoved pawn may step two squares. */
  moved?: boolean;
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

/** How many times each player may shift the board during one match. */
export const SHIFTS_PER_PLAYER = 3;

export interface GameState {
  arenaVersion: number;
  pieces: Piece[];
  activePlayer: Side;
  mode: GeometryMode;
  /** Number of completed piece moves before another shift is available. */
  shiftCooldown: number;
  /** Shifts still available to each player for the rest of the match. */
  shiftsRemaining: Record<Side, number>;
  status: GameStatus;
  history: HistoryItem[];
  repetitions: Record<string, number>;
}

export class RuleViolation extends Error {
  readonly code: "match-finished" | "not-your-turn" | "piece-not-found" | "shadow-piece" | "illegal-move" | "shift-locked" | "shift-spent" | "invalid-shift";

  constructor(
    code: RuleViolation["code"],
    message: string,
  ) {
    super(message);
    this.name = "RuleViolation";
    this.code = code;
  }
}

// Half-turn symmetric. This back rank keeps a curved shift from capturing the king;
// the textbook a1-rook / e1-king order does not, because those anchors touch the far camp.
const WHITE_BACK_RANK: Array<[PieceType, SquareId, string]> = [
  ["rook", "a1", "white-rook"],
  ["bishop", "b1", "white-bishop-b"],
  ["knight", "c1", "white-knight"],
  ["bishop", "d1", "white-bishop-d"],
  ["rook", "e1", "white-rook-e"],
  ["king", "f1", "white-king"],
  ["knight", "g1", "white-knight-g"],
  ["queen", "h1", "white-queen"],
];

export function createInitialState(arena: Arena = ARENA): GameState {
  const pieces: Piece[] = [];
  for (const [type, square, id] of WHITE_BACK_RANK) {
    pieces.push(createAnchorPiece(id, "white", type, square, arena));
    const mirrored = mirroredSquare(square);
    pieces.push(createAnchorPiece(blackPieceId(type, mirrored), "black", type, mirrored, arena));
  }
  for (let col = 0; col < 8; col += 1) {
    const square = squareId(6, col);
    const mirrored = mirroredSquare(square);
    pieces.push(createAnchorPiece(`white-pawn-${square[0]}`, "white", "pawn", square, arena));
    pieces.push(createAnchorPiece(`black-pawn-${mirrored[0]}`, "black", "pawn", mirrored, arena));
  }
  const state: GameState = {
    arenaVersion: arena.version,
    pieces,
    activePlayer: "white",
    mode: "flat",
    shiftCooldown: 0,
    shiftsRemaining: { white: SHIFTS_PER_PLAYER, black: SHIFTS_PER_PLAYER },
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
  let shiftsRemaining = { ...state.shiftsRemaining };
  let captured: Piece | undefined;
  let notation: string;

  if (action.kind === "shift") {
    if (action.toMode === mode) {
      throw new RuleViolation("invalid-shift", "The board is already in that geometry.");
    }
    if ((shiftsRemaining[actor] ?? 0) <= 0) {
      throw new RuleViolation("shift-spent", `You have used all ${SHIFTS_PER_PLAYER} shifts.`);
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
    shiftsRemaining = { ...shiftsRemaining, [actor]: shiftsRemaining[actor] - 1 };
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
    const arrived: Piece = {
      ...movingPiece,
      tileId: action.toTileId,
      ...(movingPiece.type === "pawn" ? { moved: true } : {}),
    };
    const arrivalRank = arena.rankByTile.get(action.toTileId) ?? 0;
    const promoted = movingPiece.type === "pawn" && (movingPiece.side === "white" ? arrivalRank >= 8 : arrivalRank <= 1);
    if (promoted) arrived.type = "queen";
    pieces.push(arrived);
    shiftCooldown = Math.max(0, shiftCooldown - 1);
    const from = locationName(movingPiece.tileId, arena);
    const to = locationName(action.toTileId, arena);
    notation = `${capitalize(actor)} ${capitalize(movingPiece.type)} ${from} → ${to}${captured ? ` · captures ${capitalize(captured.type)}` : ""}${promoted ? " · promotes to Queen" : ""}`;
  }

  const next: GameState = {
    ...state,
    pieces,
    activePlayer: oppositeSide(actor),
    mode,
    shiftCooldown,
    shiftsRemaining,
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
    .map((piece) => `${piece.id}:${piece.side}:${piece.type}:${piece.tileId}:${piece.moved ? 1 : 0}`)
    .join("|");
  return `${state.arenaVersion};${state.mode};${state.activePlayer};${state.shiftCooldown};${state.shiftsRemaining.white},${state.shiftsRemaining.black};${pieces}`;
}

export function oppositeSide(side: Side): Side {
  return side === "white" ? "black" : "white";
}

function mirroredSquare(square: SquareId): SquareId {
  const { row, col } = squareCoordinates(square);
  return squareId(7 - row, 7 - col);
}

function blackPieceId(type: PieceType, square: SquareId): string {
  if (type === "king" || type === "queen") return `black-${type}`;
  if (type === "rook" && square === "h8") return "black-rook";
  if (type === "knight" && square === "f8") return "black-knight";
  return `black-${type}-${square[0]}`;
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
  const addMoveAndReportOccupancy = (toTileId: string, route: string[], moves: MoveOption[]) => {
    const target = occupied.get(toTileId);
    if (target?.side === piece.side) return true;
    moves.push({ toTileId, route });
    return target !== undefined;
  };

  return state.mode === "flat"
    ? flatMoves(piece, occupied, arena, addMoveAndReportOccupancy)
    : hyperbolicMoves(piece, occupied, arena, addMoveAndReportOccupancy);
}

type AddMoveAndReportOccupancy = (toTileId: string, route: string[], moves: MoveOption[]) => boolean;

function flatMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  addMoveAndReportOccupancy: AddMoveAndReportOccupancy,
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
    return addMoveAndReportOccupancy(toTileId, [piece.tileId, toTileId], moves);
  };

  if (piece.type === "rook" || piece.type === "queen") {
    for (const [rowStep, colStep] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let nextRow = row + rowStep;
      let nextCol = col + colStep;
      const route = [piece.tileId];
      while (nextRow >= 0 && nextRow < 8 && nextCol >= 0 && nextCol < 8) {
        const toTileId = arena.anchors.get(squareId(nextRow, nextCol));
        if (!toTileId) break;
        route.push(toTileId);
        const blocked = addMoveAndReportOccupancy(toTileId, [...route], moves);
        if (blocked) break;
        nextRow += rowStep;
        nextCol += colStep;
      }
    }
  }
  if (piece.type === "bishop" || piece.type === "queen") {
    for (const [rowStep, colStep] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let nextRow = row + rowStep;
      let nextCol = col + colStep;
      const route = [piece.tileId];
      while (nextRow >= 0 && nextRow < 8 && nextCol >= 0 && nextCol < 8) {
        const toTileId = arena.anchors.get(squareId(nextRow, nextCol));
        if (!toTileId) break;
        route.push(toTileId);
        const blocked = addMoveAndReportOccupancy(toTileId, [...route], moves);
        if (blocked) break;
        nextRow += rowStep;
        nextCol += colStep;
      }
    }
  }
  if (piece.type === "knight") {
    for (const [rowStep, colStep] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      addSquare(row + rowStep, col + colStep);
    }
  } else if (piece.type === "king") {
    for (let rowStep = -1; rowStep <= 1; rowStep += 1) {
      for (let colStep = -1; colStep <= 1; colStep += 1) {
        if (rowStep !== 0 || colStep !== 0) addSquare(row + rowStep, col + colStep);
      }
    }
  }
  if (piece.type === "pawn") addFlatPawnMoves(piece, occupied, arena, moves);
  if (piece.type === "guard") {
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
  addMoveAndReportOccupancy: AddMoveAndReportOccupancy,
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
  }
  if (piece.type === "king") {
    for (const toTileId of arena.touchNeighbors.get(piece.tileId) ?? []) {
      if (arena.flatSquareByTile.has(toTileId)) addMoveAndReportOccupancy(toTileId, [piece.tileId, toTileId], moves);
    }
  }
  if (piece.type === "bishop" || piece.type === "queen") {
    const routes = new Map<string, string[]>();
    for (let vertex = 0; vertex < 4; vertex += 1) {
      for (const first of cornerNeighbors(arena, piece.tileId, vertex)) {
        const ray = bishopRay(arena, piece.tileId, vertex, first);
        const route = [piece.tileId];
        for (const toTileId of ray) {
          route.push(toTileId);
          const target = occupied.get(toTileId);
          if (target?.side === piece.side) break;
          const existing = routes.get(toTileId);
          if (!existing || route.length < existing.length) routes.set(toTileId, [...route]);
          if (target) break;
        }
      }
    }
    for (const [toTileId, route] of routes) addMoveAndReportOccupancy(toTileId, route, moves);
  }
  if (piece.type === "pawn") addHyperbolicPawnMoves(piece, occupied, arena, sourceTile, moves);
  if (piece.type === "guard") {
    for (const link of sourceTile.neighbors) {
      if (link) addMoveAndReportOccupancy(link.tileId, [piece.tileId, link.tileId], moves);
    }
  }

  return piece.type === "queen" ? dedupeMoves(moves) : moves;
}

function addFlatPawnMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  moves: MoveOption[],
): void {
  const square = arena.flatSquareByTile.get(piece.tileId);
  if (!square) return;
  const { row, col } = squareCoordinates(square);
  const direction = piece.side === "white" ? -1 : 1;
  const startRow = piece.side === "white" ? 6 : 1;
  const oneRow = row + direction;
  if (oneRow < 0 || oneRow > 7) return;
  const one = arena.anchors.get(squareId(oneRow, col));
  if (one && !occupied.has(one)) {
    moves.push({ toTileId: one, route: [piece.tileId, one] });
    const twoRow = row + direction * 2;
    if (!piece.moved && row === startRow && twoRow >= 0 && twoRow < 8) {
      const two = arena.anchors.get(squareId(twoRow, col));
      if (two && !occupied.has(two)) moves.push({ toTileId: two, route: [piece.tileId, one, two] });
    }
  }
  for (const colStep of [-1, 1]) {
    const nextCol = col + colStep;
    if (nextCol < 0 || nextCol > 7) continue;
    const capture = arena.anchors.get(squareId(oneRow, nextCol));
    const target = capture ? occupied.get(capture) : undefined;
    if (capture && target && target.side !== piece.side) moves.push({ toTileId: capture, route: [piece.tileId, capture] });
  }
}

function addHyperbolicPawnMoves(
  piece: Piece,
  occupied: Map<string, Piece>,
  arena: Arena,
  sourceTile: { neighbors: ({ tileId: string } | null)[] },
  moves: MoveOption[],
): void {
  const rank = arena.rankByTile.get(piece.tileId);
  if (rank === undefined) return;
  const forward = piece.side === "white" ? 1 : -1;
  const rankOf = (tileId: string) => arena.rankByTile.get(tileId) ?? rank;
  const advances = (tileId: string) => (rankOf(tileId) - rank) * forward > 1e-9;
  let best: { tileId: string } | null = null;
  let bestDelta = 0;
  for (const link of sourceTile.neighbors) {
    if (!link || !advances(link.tileId)) continue;
    const delta = Math.abs(rankOf(link.tileId) - rank);
    if (!best || delta > bestDelta + 1e-9 || (Math.abs(delta - bestDelta) <= 1e-9 && link.tileId < best.tileId)) {
      best = link;
      bestDelta = delta;
    }
  }
  if (!best) return;
  if (!occupied.has(best.tileId)) moves.push({ toTileId: best.tileId, route: [piece.tileId, best.tileId] });
  const besideForward = new Set(
    (arena.tiles.get(best.tileId)?.neighbors ?? []).flatMap((link) => (link ? [link.tileId] : [])),
  );
  for (let vertex = 0; vertex < 4; vertex += 1) {
    for (const tileId of cornerNeighbors(arena, piece.tileId, vertex)) {
      const target = occupied.get(tileId);
      if (besideForward.has(tileId) && target && target.side !== piece.side && advances(tileId)) {
        moves.push({ toTileId: tileId, route: [piece.tileId, tileId] });
      }
    }
  }
}

function dedupeMoves(moves: MoveOption[]): MoveOption[] {
  const best = new Map<string, MoveOption>();
  for (const move of moves) {
    const existing = best.get(move.toTileId);
    if (!existing || move.route.length < existing.route.length) best.set(move.toTileId, move);
  }
  return [...best.values()];
}

function locationName(tileId: string, arena: Arena): string {
  return arena.flatSquareByTile.get(tileId)?.toUpperCase() ?? tileId;
}
