import { Chess, type Square } from "chess.js";
import { ARENA, squareCoordinates, squareId, type Arena, type SquareId } from "./geometry.ts";
import { capitalize } from "./labels.ts";
import { hyperbolicMoves, pawnForwardEdge } from "./curvature-moves.ts";
import { PIECE_SYMBOLS, PIECE_TYPES, PROMOTIONS, fenFromPieces, piecesFromPosition, readPosition, standardPosition } from "./standard-chess.ts";
import { RuleViolation, type GameAction, type GameState, type GeometryMode, type MoveOption, type Piece, type Promotion, type Ruleset, type Side } from "./game-types.ts";
export * from "./game-types.ts";

export function createInitialState(arena: Arena = ARENA, ruleset: Ruleset = "curvature"): GameState {
  return createStateFromFen(new Chess().fen(), arena, ruleset);
}

/** Load a complete, validated position for analysis or a fresh match. */
export function createStateFromFen(fen: string, arena: Arena = ARENA, ruleset: Ruleset = "curvature"): GameState {
  const chess = readPosition(fen);
  const state: GameState = {
    arenaVersion: arena.version, ruleset, pieces: piecesFromPosition(chess, arena),
    activePlayer: chess.turn() === "w" ? "white" : "black", mode: "flat", shiftCooldown: 0,
    status: { kind: "playing" }, history: [], repetitions: {}, fen: chess.fen(),
  };
  state.repetitions[positionKey(state)] = 1;
  return finishPosition(state, arena);
}

export function validatePosition(state: GameState, arena: Arena = ARENA): void {
  if (state.arenaVersion !== arena.version) throw new RuleViolation("invalid-position", "This position uses an incompatible arena version.");
  if (!["standard", "curvature"].includes(state.ruleset) || !["flat", "hyperbolic"].includes(state.mode) || !["white", "black"].includes(state.activePlayer)) throw new RuleViolation("invalid-position", "Unknown ruleset, geometry, or active player.");
  const ids = new Set<string>(), tiles = new Set<string>();
  for (const piece of state.pieces) {
    if (!piece.id || ids.has(piece.id) || tiles.has(piece.tileId) || !arena.tiles.has(piece.tileId) || !Object.hasOwn(PIECE_SYMBOLS, piece.type) || !["white", "black"].includes(piece.side)) throw new RuleViolation("invalid-position", "Pieces need unique IDs, distinct valid tiles, and valid sides and types.");
    if (piece.type === "pawn" && piece.forwardEdge !== undefined && (!Number.isInteger(piece.forwardEdge) || piece.forwardEdge < 0 || piece.forwardEdge > 3)) throw new RuleViolation("invalid-position", "Invalid pawn heading.");
    ids.add(piece.id); tiles.add(piece.tileId);
  }
  for (const side of ["white", "black"] as const) {
    if (state.pieces.filter((piece) => piece.side === side && piece.type === "king").length !== 1) throw new RuleViolation("invalid-position", "A position must have exactly one king per side.");
  }
  if (state.ruleset === "standard" && (state.mode !== "flat" || state.pieces.some((piece) => isShadow(piece, "flat", arena)))) throw new RuleViolation("invalid-position", "Standard chess uses only the 64 flat squares.");
  if (!Number.isInteger(state.shiftCooldown) || state.shiftCooldown < 0 || state.shiftCooldown > 2) throw new RuleViolation("invalid-position", "Invalid geometry shift cooldown.");
  if (state.mode === "flat") { readPosition(state.fen); standardPosition(state, arena); }
  else if (isInCheck(state, oppositeSide(state.activePlayer), arena)) throw new RuleViolation("invalid-position", "The side that just moved cannot leave its king in check.");
}

export function getLegalMoves(state: GameState, pieceId: string, arena: Arena = ARENA): MoveOption[] {
  if (state.status.kind !== "playing") return [];
  const piece = state.pieces.find((candidate) => candidate.id === pieceId);
  if (!piece || piece.side !== state.activePlayer || isShadow(piece, state.mode, arena)) return [];
  if (state.mode === "hyperbolic") return curvedMoves(state, piece, arena).filter((move) => {
    const target = state.pieces.find((candidate) => candidate.tileId === move.toTileId);
    if (target?.type === "king") return false;
    const pieces = state.pieces.filter((candidate) => candidate.id !== target?.id).map((candidate) => candidate.id === piece.id ? movedCurvedPiece(candidate, move, arena) : candidate);
    return !isInCheck({ ...state, pieces }, piece.side, arena);
  });
  const square = arena.flatSquareByTile.get(piece.tileId)! as Square;
  return standardPosition(state, arena).moves({ square, verbose: true }).map((move) => ({
    toTileId: arena.anchors.get(move.to as SquareId)!, route: flatRoute(move.from, move.to, piece, arena),
    ...(move.promotion ? { promotion: PIECE_TYPES[move.promotion] as Promotion } : {}),
  }));
}

export function applyAction(state: GameState, action: GameAction, arena: Arena = ARENA): GameState {
  if (state.status.kind !== "playing") throw new RuleViolation("match-finished", "This match has already finished.");
  validatePosition(state, arena);
  if (action.kind === "resign") {
    if (action.side !== "white" && action.side !== "black") throw new RuleViolation("illegal-move", "Choose a valid side to resign.");
    return { ...state, status: { kind: "won", winner: oppositeSide(action.side), reason: "resignation" },
      history: [...state.history, { ply: state.history.length + 1, actor: action.side, action, notation: `${capitalize(action.side)} resigns` }] };
  }
  if (action.kind === "shift") return applyShift(state, action, arena);
  if (action.kind !== "move") throw new RuleViolation("illegal-move", "Unknown action.");
  const piece = state.pieces.find((candidate) => candidate.id === action.pieceId);
  if (!piece) throw new RuleViolation("piece-not-found", "That piece is no longer on the board.");
  if (piece.side !== state.activePlayer) throw new RuleViolation("not-your-turn", "Wait for your turn before moving that piece.");
  if (isShadow(piece, state.mode, arena)) throw new RuleViolation("shadow-piece", "That piece is inactive in flat geometry.");
  const options = getLegalMoves(state, piece.id, arena).filter((move) => move.toTileId === action.toTileId);
  if (!options.length) throw new RuleViolation("illegal-move", "That move is illegal: check the piece's movement, blockers, and king safety.");
  if (options.some((move) => move.promotion)) {
    if (!action.promotion || !PROMOTIONS.includes(action.promotion)) throw new RuleViolation("invalid-promotion", "Choose a queen, rook, bishop, or knight for promotion.");
  } else if (action.promotion !== undefined) throw new RuleViolation("invalid-promotion", "This move is not a promotion.");
  return state.mode === "flat" ? applyFlatMove(state, piece, action, arena) : applyCurvedMove(state, piece, action, arena);
}

function applyFlatMove(state: GameState, piece: Piece, action: Extract<GameAction, { kind: "move" }>, arena: Arena): GameState {
  const chess = standardPosition(state, arena);
  const from = arena.flatSquareByTile.get(piece.tileId)! as Square;
  const to = arena.flatSquareByTile.get(action.toTileId)! as Square;
  const move = chess.move({ from, to, ...(action.promotion ? { promotion: PIECE_SYMBOLS[action.promotion] } : {}) });
  const capturedSquare = move.isEnPassant() ? `${to[0]}${from[1]}` : to;
  const captured = state.pieces.find((candidate) => candidate.tileId === arena.anchors.get(capturedSquare as SquareId));
  let pieces = state.pieces.filter((candidate) => candidate.id !== captured?.id).map((candidate) => candidate.id === piece.id
    ? { ...candidate, tileId: action.toTileId, type: action.promotion ?? candidate.type, forwardEdge: undefined } : { ...candidate });
  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    const rank = from[1];
    const rookFrom = arena.anchors.get(`${move.isKingsideCastle() ? "h" : "a"}${rank}` as SquareId)!;
    const rookTo = arena.anchors.get(`${move.isKingsideCastle() ? "f" : "d"}${rank}` as SquareId)!;
    pieces = pieces.map((candidate) => candidate.tileId === rookFrom ? { ...candidate, tileId: rookTo } : candidate);
  }
  const next = recordAction(state, action, pieces, move.san, captured);
  next.fen = chess.fen();
  next.shiftCooldown = Math.max(0, state.shiftCooldown - 1);
  return finishPosition(recordRepetition(next), arena);
}

function applyCurvedMove(state: GameState, piece: Piece, action: Extract<GameAction, { kind: "move" }>, arena: Arena): GameState {
  const captured = state.pieces.find((candidate) => candidate.tileId === action.toTileId);
  const move = getLegalMoves(state, piece.id, arena).find((candidate) => candidate.toTileId === action.toTileId && candidate.promotion === action.promotion)!;
  const pieces = state.pieces.filter((candidate) => candidate.id !== captured?.id).map((candidate) => candidate.id === piece.id ? movedCurvedPiece(candidate, move, arena) : { ...candidate });
  const next = recordAction(state, action, pieces, `${capitalize(piece.type)} ${piece.tileId} → ${action.toTileId}${action.promotion ? ` = ${capitalize(action.promotion)}` : ""}`, captured);
  next.shiftCooldown = Math.max(0, state.shiftCooldown - 1);
  return finishPosition(recordRepetition(next), arena);
}

function movedCurvedPiece(piece: Piece, move: MoveOption, arena: Arena): Piece {
  const target = arena.tiles.get(move.toTileId)!;
  const previous = move.route.at(-2);
  const entryEdge = target.neighbors.findIndex((link) => link?.tileId === previous);
  return { ...piece, tileId: move.toTileId, type: move.promotion ?? piece.type,
    ...(piece.type === "pawn" ? { forwardEdge: entryEdge >= 0 ? (entryEdge + 2 + (move.route.length === 3 ? (move.turn ?? 0) : 0)) % 4 : piece.forwardEdge } : {}),
  };
}

/** Check a shift without spending a turn; shared by UI and endgame detection. */
export function canShift(state: GameState, toMode: GeometryMode, arena: Arena = ARENA): boolean {
  if (state.ruleset !== "curvature" || state.status.kind !== "playing" || state.shiftCooldown || toMode === state.mode) return false;
  if (toMode === "flat" && state.pieces.some((piece) => piece.type === "king" && isShadow(piece, "flat", arena))) return false;
  try {
    const candidate = shiftPosition(state, toMode, arena);
    if (candidate.mode === "flat") readPosition(candidate.fen);
    return !isInCheck(candidate, state.activePlayer, arena);
  } catch { return false; }
}

function shiftPosition(state: GameState, toMode: GeometryMode, arena: Arena): GameState {
  const candidate = { ...state, mode: toMode, activePlayer: oppositeSide(state.activePlayer), pieces: state.pieces.map((piece) => ({ ...piece })) };
  if (toMode === "flat") candidate.fen = fenFromPieces(candidate, arena);
  return candidate;
}

function applyShift(state: GameState, action: Extract<GameAction, { kind: "shift" }>, arena: Arena): GameState {
  if (state.ruleset !== "curvature") throw new RuleViolation("invalid-shift", "Geometry shifts are available only in Curvature chess.");
  if (!["flat", "hyperbolic"].includes(action.toMode) || action.toMode === state.mode) throw new RuleViolation("invalid-shift", "Choose a different valid geometry.");
  if (state.shiftCooldown) throw new RuleViolation("shift-locked", `Make ${state.shiftCooldown} more piece moves before shifting again.`);
  if (!canShift(state, action.toMode, arena)) throw new RuleViolation("invalid-shift", "This shift would leave your king in check, strand a king off the anchors, or create an invalid flat position.");
  const next = recordAction(state, action, state.pieces.map((piece) => ({ ...piece })), `${capitalize(state.activePlayer)} shifts to ${action.toMode}`);
  next.mode = action.toMode;
  next.shiftCooldown = 2;
  if (next.mode === "hyperbolic") next.pieces = next.pieces.map((piece) => piece.type === "pawn" ? { ...piece, forwardEdge: pawnForwardEdge(piece, arena) } : piece);
  if (next.mode === "flat") next.fen = fenFromPieces(next, arena);
  return finishPosition(recordRepetition(next), arena);
}

function recordAction(state: GameState, action: GameAction, pieces: Piece[], notation: string, captured?: Piece): GameState {
  return { ...state, pieces, activePlayer: oppositeSide(state.activePlayer), history: [...state.history, {
    ply: state.history.length + 1, actor: state.activePlayer, action: { ...action }, notation, ...(captured ? { captured: { ...captured } } : {}),
  }], repetitions: { ...state.repetitions } };
}

function recordRepetition(state: GameState): GameState {
  if (state.status.kind !== "playing") return state;
  const key = positionKey(state), count = (state.repetitions[key] ?? 0) + 1;
  state.repetitions[key] = count;
  if (count >= 3) state.status = { kind: "draw", reason: "repetition" };
  return state;
}

function finishPosition(state: GameState, arena: Arena): GameState {
  if (state.status.kind !== "playing") return state;
  const canMove = state.pieces.some((piece) => piece.side === state.activePlayer && getLegalMoves(state, piece.id, arena).length > 0);
  const canChange = canShift(state, state.mode === "flat" ? "hyperbolic" : "flat", arena);
  if (!canMove && !canChange) state.status = isInCheck(state, state.activePlayer, arena)
    ? { kind: "won", winner: oppositeSide(state.activePlayer), reason: "checkmate" } : { kind: "draw", reason: "stalemate" };
  else if (state.mode === "flat") {
    const chess = standardPosition(state, arena);
    // Curvature changes attack topology, so orthodox dead-material tests apply only to standard games.
    if (state.ruleset === "standard" && chess.isInsufficientMaterial()) state.status = { kind: "draw", reason: "insufficient-material" };
    else if (state.ruleset === "standard" && chess.isDrawByFiftyMoves()) state.status = { kind: "draw", reason: "fifty-move" };
  }
  return state;
}

export function isShadow(piece: Piece, mode: GeometryMode, arena: Arena = ARENA): boolean { return mode === "flat" && !arena.flatSquareByTile.has(piece.tileId); }
export function oppositeSide(side: Side): Side { return side === "white" ? "black" : "white"; }

export function isInCheck(state: GameState, side: Side, arena: Arena = ARENA): boolean {
  const king = state.pieces.find((piece) => piece.type === "king" && piece.side === side);
  if (!king || isShadow(king, state.mode, arena)) return false;
  if (state.mode === "flat") {
    const chess = standardPosition(state, arena);
    return chess.isAttacked(arena.flatSquareByTile.get(king.tileId)! as Square, side === "white" ? "b" : "w");
  }
  return state.pieces.some((piece) => piece.side !== side && curvedMoves(state, piece, arena, true).some((move) => move.toTileId === king.tileId));
}

export function positionKey(state: GameState): string {
  if (state.ruleset === "standard") return state.fen.split(" ").slice(0, 4).join(" ");
  const pieces = state.pieces.map((piece) => `${piece.side}:${piece.type}:${piece.tileId}:${piece.type === "pawn" ? piece.forwardEdge ?? "initial" : ""}`).sort().join("|");
  return `${state.arenaVersion};${state.mode};${state.activePlayer};${state.shiftCooldown};${state.mode === "flat" ? state.fen.split(" ").slice(2, 4).join(" ") : ""};${pieces}`;
}

function curvedMoves(state: GameState, piece: Piece, arena: Arena, attacksOnly = false): MoveOption[] {
  const occupied = new Map(state.pieces.map((candidate) => [candidate.tileId, candidate]));
  const add = (toTileId: string, route: string[], moves: MoveOption[]) => {
    const target = occupied.get(toTileId);
    if (target?.side === piece.side) return true;
    moves.push({ toTileId, route });
    return target !== undefined;
  };
  return hyperbolicMoves(piece, occupied, arena, add, attacksOnly);
}

function flatRoute(from: string, to: string, piece: Piece, arena: Arena): string[] {
  if (piece.type === "knight") return [piece.tileId, arena.anchors.get(to as SquareId)!];
  const start = squareCoordinates(from as SquareId), end = squareCoordinates(to as SquareId);
  const count = Math.max(Math.abs(end.row - start.row), Math.abs(end.col - start.col));
  return Array.from({ length: count + 1 }, (_, index) => arena.anchors.get(squareId(start.row + Math.sign(end.row - start.row) * index, start.col + Math.sign(end.col - start.col) * index))!);
}
