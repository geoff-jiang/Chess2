import "./styles.css";
import { applyAction, createInitialState, getLegalMoves, isInCheck, isShadow, oppositeSide, type GameAction, type GameState, type GeometryMode, type HistoryItem, type Piece, type Side } from "./shared/game.ts";
import { ARENA } from "./shared/geometry.ts";
import { capitalize, pieceLetter } from "./shared/labels.ts";
import { BoardView } from "./view/board-view.ts";

interface RoomSnapshot {
  type: "snapshot";
  code: string;
  seat: Side;
  seatToken: string;
  connections: Record<Side, boolean>;
  rematchRequestedByOther: boolean;
  rematchRequestedByYou: boolean;
  state: GameState;
}

interface ServerError {
  type: "error";
  code: string;
  message: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("The app root is missing.");

app.innerHTML = `
  <div class="app-frame">
    <header class="topbar">
      <div class="brand" aria-label="Curvature Chess">
        <span class="brand-mark" aria-hidden="true"></span>
        <span><span class="brand-name">Curvature Chess</span><span class="brand-caption">A game across geometries</span></span>
      </div>
      <div class="topbar-note"><span class="spark" aria-hidden="true">✳</span> Change the board. Find a new route.</div>
    </header>
    <main class="workbench">
      <section class="board-stage" aria-label="Three-dimensional game board">
        <div id="board-canvas" tabindex="0" role="application" aria-label="Interactive 3D chessboard. Drag to rotate, right-drag to pan, and use the wheel to zoom."></div>
        <div class="scene-meta"><span class="scene-dot"></span><span id="scene-title" class="scene-title">A preview of the arena</span><span id="scene-coordinates" class="scene-coordinates">109 tiles · five around a corner</span></div>
        <div class="stage-actions"><button id="overview-view" class="ghost-button overview-button" type="button" hidden>◎ <span>Whole arena</span></button><button id="reset-view" class="ghost-button" type="button" aria-label="Reset camera view">↺ <span>Reset view</span></button></div>
        <div id="preview-banner" class="preview-banner" hidden><strong id="preview-title">Preview only</strong><span id="preview-copy">The shared board has not changed.</span><button id="cancel-preview" class="preview-cancel" type="button">Cancel</button></div>
        <div class="camera-hint"><kbd>Drag</kbd> orbit &nbsp; <kbd>Right-drag</kbd> pan<br><kbd>Scroll / pinch</kbd> zoom</div>
        <div id="selected-readout" class="selected-readout" hidden></div>
        <div id="finish-overlay" class="finish-overlay" hidden>
          <div class="finish-card"><div class="finish-emblem" aria-hidden="true">✦</div><h2 id="finish-title" class="finish-title">Match complete</h2><p id="finish-copy" class="finish-copy"></p><button id="rematch-button" class="secondary-button" type="button">Play again</button></div>
        </div>
      </section>
      <aside class="side-panel">
        <section id="lobby-panel" class="lobby-panel">
          <div class="lobby-kicker">A two-player strategy game</div>
          <h1 class="lobby-title">Two geometries.<br>One shared board.</h1>
          <p class="lobby-copy">Pieces travel by the shape of the board. Shift the surface, and familiar routes lead somewhere new.</p>
          <button id="create-room" class="primary-button" type="button"><span aria-hidden="true">＋</span> Create a private room</button>
          <div class="join-divider">or join a player</div>
          <form id="join-form" class="join-row">
            <label class="visually-hidden" for="room-code">Six-character room code</label>
            <input id="room-code" class="room-code-input" type="text" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="Enter room code" aria-describedby="form-error" />
            <button class="secondary-button" type="submit">Join</button>
          </form>
          <p id="form-error" class="form-error" role="status"></p>
          <button id="local-game" class="local-link" type="button">Try a local match on this device</button>
          <button id="guided-opening" class="local-link guided-start" type="button">Try the guided opening · 2 minutes</button>
          <div class="lobby-note">No account needed. Share a room link with one other player to begin.</div>
        </section>

        <section id="match-panel" class="match-panel" hidden>
          <div class="match-header">
            <div class="match-status-kicker" id="match-kicker">Your move</div>
            <h1 id="match-status" class="match-status">White to move</h1>
            <div id="match-substatus" class="match-substatus"></div>
          </div>
          <div id="room-strip" class="room-strip" hidden>
            <div><div class="room-label">Private room</div><div id="room-code-display" class="room-value"></div></div>
            <button id="share-room" class="share-button" type="button">Copy invite</button>
          </div>
          <div class="players">
            <div id="white-seat" class="player-seat"><div class="player-topline"><span class="player-stone"></span> White</div><div class="player-bottomline"><span id="white-role">Player one</span><span id="white-connection" class="connection online">Here</span></div></div>
            <div id="black-seat" class="player-seat"><div class="player-topline"><span class="player-stone black"></span> Black</div><div class="player-bottomline"><span id="black-role">Player two</span><span id="black-connection" class="connection offline">Waiting</span></div></div>
          </div>

          <section class="rail-section" aria-labelledby="geometry-heading">
            <div class="section-heading"><span id="geometry-heading">Board geometry</span><span id="geometry-state-caption" class="section-caption">Shared state</span></div>
            <div class="mode-switch" role="group" aria-label="Preview board geometry">
              <button id="flat-preview" class="mode-choice" type="button" aria-pressed="true"><span class="mode-symbol" aria-hidden="true">▦</span> Flat</button>
              <button id="hyperbolic-preview" class="mode-choice" type="button" aria-pressed="false"><span class="mode-symbol" aria-hidden="true">◒</span> Curved</button>
            </div>
            <p id="mode-help" class="mode-help">Pieces use the familiar 8×8 square grid.</p>
            <p id="shift-lock" class="shift-lock ready">A geometry shift is available.</p>
            <button id="commit-shift" class="outline-button full shift-button" type="button" hidden>Spend a turn to shift</button>
          </section>

          <section id="opening-guide" class="opening-guide" aria-live="polite" hidden>
            <div id="opening-guide-step" class="opening-guide-step"></div>
            <h2 id="opening-guide-title" class="opening-guide-title"></h2>
            <p id="opening-guide-copy" class="opening-guide-copy"></p>
          </section>

          <section class="rail-section" aria-labelledby="shadow-heading">
            <div class="section-heading"><span id="shadow-heading">In the shadow</span><span class="section-caption">Extra tiles · inactive in flat mode</span></div>
            <div id="shadow-groups" class="shadow-groups"></div>
          </section>

          <section class="rail-section" aria-labelledby="history-heading">
            <div class="section-heading"><span id="history-heading">Move history</span><span id="history-count" class="section-caption">0 actions</span></div>
            <div id="history-list" class="history-list" aria-live="polite"></div>
          </section>

          <div class="panel-footer"><strong>Your camera is yours.</strong> Rotating your view never changes the other player's board.</div>
        </section>
      </aside>
    </main>
    <div id="toast" class="toast" role="status" aria-live="polite"></div>
  </div>
`;

const previewState = createInitialState();
let gameState: GameState | null = null;
let matchKind: "local" | "online" | null = null;
let seat: Side | null = null;
let roomCode: string | null = null;
let seatToken: string | null = null;
let roomConnections: Record<Side, boolean> = { white: false, black: false };
let rematchRequestedByOther = false;
let rematchRequestedByYou = false;
let previewMode: GeometryMode | null = null;
let guidedStep: "shift" | "inspect" | "route" | "done" | null = null;
let selectedPieceId: string | null = null;
let pendingAction = false;
let clientConnectionStatus: "offline" | "connecting" | "connected" = "offline";
let currentSocket: WebSocket | null = null;
let queuedMessage: Record<string, unknown> | null = null;
let reconnectAttempt = 0;
let toastTimer: number | undefined;

const boardElement = element<HTMLDivElement>("board-canvas");
const boardView = new BoardView(boardElement, onTilePicked);
boardView.setResetButton(element<HTMLButtonElement>("reset-view"));
element<HTMLButtonElement>("overview-view").addEventListener("click", () => boardView.showWholeArena());

element<HTMLButtonElement>("create-room").addEventListener("click", () => {
  element<HTMLParagraphElement>("form-error").textContent = "";
  matchKind = "online";
  sendMessage({ type: "create" });
  setLobbyPending(true);
});

element<HTMLFormElement>("join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const code = element<HTMLInputElement>("room-code").value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (code.length !== 6) {
    element<HTMLParagraphElement>("form-error").textContent = "Enter the six-character room code.";
    return;
  }
  element<HTMLParagraphElement>("form-error").textContent = "";
  matchKind = "online";
  roomCode = code;
  const savedToken = localStorage.getItem(seatStorageKey(code));
  sendMessage({ type: "join", code, ...(savedToken ? { token: savedToken } : {}) });
  setLobbyPending(true);
});

element<HTMLButtonElement>("local-game").addEventListener("click", () => startLocalGame(false));
element<HTMLButtonElement>("guided-opening").addEventListener("click", () => startLocalGame(true));

function startLocalGame(withGuide: boolean): void {
  gameState = createInitialState();
  matchKind = "local";
  seat = null;
  roomCode = null;
  seatToken = null;
  roomConnections = { white: true, black: true };
  previewMode = null;
  guidedStep = withGuide ? "shift" : null;
  selectedPieceId = null;
  pendingAction = false;
  showMatchPanel();
  render();
}

element<HTMLButtonElement>("flat-preview").addEventListener("click", () => togglePreview("flat"));
element<HTMLButtonElement>("hyperbolic-preview").addEventListener("click", () => togglePreview("hyperbolic"));
element<HTMLButtonElement>("cancel-preview").addEventListener("click", () => {
  previewMode = null;
  render();
});

element<HTMLButtonElement>("commit-shift").addEventListener("click", () => {
  if (!gameState || !previewMode || previewMode === gameState.mode) return;
  if (gameState.shiftCooldown > 0) {
    showToast(`Shift is locked for ${gameState.shiftCooldown} more turn${gameState.shiftCooldown === 1 ? "" : "s"}.`);
    return;
  }
  if (!canSubmitAction()) return;
  const nextMode = previewMode;
  previewMode = null;
  submitAction({ kind: "shift", toMode: nextMode });
});

element<HTMLButtonElement>("share-room").addEventListener("click", () => {
  if (!roomCode) return;
  const invite = new URL(window.location.href);
  invite.searchParams.set("room", roomCode);
  void navigator.clipboard.writeText(invite.toString()).then(
    () => showToast("Invite link copied."),
    () => showToast(`Share room code ${roomCode}.`),
  );
});

element<HTMLButtonElement>("rematch-button").addEventListener("click", () => {
  if (!gameState || gameState.status.kind === "playing") return;
  if (matchKind === "local") {
    gameState = createInitialState();
    previewMode = null;
    selectedPieceId = null;
    render();
  } else {
    sendMessage({ type: "rematch" });
  }
});

const roomInput = element<HTMLInputElement>("room-code");
roomInput.addEventListener("input", () => {
  roomInput.value = roomInput.value.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 6);
});

const inviteCode = new URLSearchParams(window.location.search).get("room");
if (inviteCode) {
  roomInput.value = inviteCode.toUpperCase().slice(0, 6);
  const token = localStorage.getItem(seatStorageKey(roomInput.value));
  matchKind = "online";
  roomCode = roomInput.value;
  sendMessage({ type: "join", code: roomInput.value, ...(token ? { token } : {}) });
  setLobbyPending(true);
}

render();

function onTilePicked(tileId: string, pieceId: string | null): void {
  if (!gameState || !canSubmitAction()) return;
  const displayMode = previewMode ?? gameState.mode;
  const displayState = previewMode ? { ...gameState, mode: previewMode } : gameState;
  const selected = gameState.pieces.find((piece) => piece.id === selectedPieceId);
  if (selected && getLegalMoves(displayState, selected.id).some((move) => move.toTileId === tileId)) {
    if (previewMode) {
      showToast("Commit the shift before moving a piece.");
      return;
    }
    submitAction({ kind: "move", pieceId: selected.id, toTileId: tileId });
    return;
  }

  const piece = pieceId ? gameState.pieces.find((candidate) => candidate.id === pieceId) : undefined;
  if (selected && piece?.side !== gameState.activePlayer && tileId !== selected.tileId) {
    showToast("That tile is not a legal destination for this piece.");
    return;
  }
  if (piece && piece.side === gameState.activePlayer && !isShadow(piece, displayMode)) {
    selectedPieceId = selectedPieceId === piece.id ? null : piece.id;
  } else {
    selectedPieceId = null;
  }
  if (guidedStep === "inspect" && selectedPieceId === "black-rook" && gameState.mode === "hyperbolic") {
    guidedStep = "route";
  }
  boardView.focusTile(tileId);
  render();
}

function submitAction(action: GameAction): void {
  if (!gameState || !canSubmitAction() || previewMode) return;
  selectedPieceId = null;
  if (matchKind === "local") {
    try {
      gameState = applyAction(gameState, action);
      let focusGuideRook = false;
      if (guidedStep === "shift" && action.kind === "shift" && gameState.mode === "hyperbolic") {
        guidedStep = "inspect";
        focusGuideRook = true;
      } else if ((guidedStep === "inspect" || guidedStep === "route") && action.kind === "move") {
        guidedStep = "done";
      }
      render();
      if (focusGuideRook) {
        const blackRook = gameState.pieces.find((piece) => piece.id === "black-rook");
        if (blackRook) boardView.focusTile(blackRook.tileId);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "That action could not be made.");
    }
    return;
  }
  pendingAction = true;
  sendMessage({ type: "action", action });
  render();
}

function togglePreview(mode: GeometryMode): void {
  if (!gameState) return;
  previewMode = previewMode === mode || (!previewMode && gameState.mode === mode) ? null : mode;
  render();
}

function canSubmitAction(): boolean {
  if (!gameState || gameState.status.kind !== "playing" || pendingAction) return false;
  if (matchKind === "local") return true;
  return matchKind === "online" && clientConnectionStatus === "connected" && seat === gameState.activePlayer && roomConnections[seat] === true;
}

function sendMessage(message: Record<string, unknown>): void {
  if (currentSocket?.readyState === WebSocket.OPEN) {
    currentSocket.send(JSON.stringify(message));
    return;
  }
  queuedMessage = message;
  if (currentSocket?.readyState === WebSocket.CONNECTING) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  currentSocket = new WebSocket(`${protocol}//${window.location.host}/socket`);
  setConnectionStatus("connecting");
  currentSocket.addEventListener("open", () => {
    setConnectionStatus("connected");
    reconnectAttempt = 0;
    if (queuedMessage) {
      currentSocket?.send(JSON.stringify(queuedMessage));
      queuedMessage = null;
    }
  });
  currentSocket.addEventListener("message", (event) => onServerMessage(event.data));
  currentSocket.addEventListener("error", () => {
    setConnectionStatus("offline");
    setLobbyError("The room server could not be reached. Try again in a moment.");
    if (!gameState) setLobbyPending(false);
  });
  currentSocket.addEventListener("close", () => {
    setConnectionStatus("offline");
    if (seat) roomConnections[seat] = false;
    pendingAction = false;
    if (matchKind === "online" && roomCode && seatToken) {
      reconnectAttempt += 1;
      const delay = Math.min(800 * 2 ** (reconnectAttempt - 1), 5000);
      window.setTimeout(() => {
        if (currentSocket?.readyState !== WebSocket.OPEN && roomCode && seatToken) {
          sendMessage({ type: "join", code: roomCode, token: seatToken });
        }
      }, delay);
    }
    if (!gameState) setLobbyPending(false);
    render();
  });
}

function onServerMessage(raw: unknown): void {
  let message: RoomSnapshot | ServerError;
  try {
    message = JSON.parse(String(raw)) as RoomSnapshot | ServerError;
  } catch {
    showToast("The room server sent a message this browser could not read.");
    return;
  }
  if (message.type === "error") {
    pendingAction = false;
    setLobbyPending(false);
    setLobbyError(message.message);
    showToast(message.message);
    render();
    return;
  }
  roomCode = message.code;
  seat = message.seat;
  seatToken = message.seatToken;
  localStorage.setItem(seatStorageKey(message.code), message.seatToken);
  roomConnections = message.connections;
  guidedStep = null;
  rematchRequestedByOther = message.rematchRequestedByOther;
  rematchRequestedByYou = message.rematchRequestedByYou;
  const priorState = gameState;
  gameState = message.state;
  if (!priorState || priorState.status.kind !== "playing" || gameState.status.kind === "playing") {
    if (priorState && priorState.mode !== gameState.mode) previewMode = null;
  }
  pendingAction = false;
  selectedPieceId = null;
  previewMode = null;
  matchKind = "online";
  setLobbyPending(false);
  showMatchPanel();
  const url = new URL(window.location.href);
  url.searchParams.set("room", message.code);
  window.history.replaceState({}, "", url);
  render();
}

function render(): void {
  const state = gameState ?? previewState;
  const displayMode = previewMode ?? state.mode;
  const displayState = gameState ? { ...gameState, mode: displayMode } : previewState;
  const selectedPiece = gameState?.pieces.find((piece) => piece.id === selectedPieceId) ?? null;
  const selectedMoves = gameState && selectedPiece ? getLegalMoves(displayState, selectedPiece.id) : [];
  const isPlayable = canSubmitAction();

  const guidePiece = guidedStep === "inspect" ? gameState?.pieces.find((piece) => piece.id === "black-rook") : undefined;
  boardView.setTutorialTarget(guidePiece?.tileId ?? null);
  boardView.update(displayState, displayMode, selectedPieceId, selectedMoves, isPlayable);
  element<HTMLButtonElement>("overview-view").hidden = displayMode !== "hyperbolic";
  element<HTMLElement>("scene-title").textContent = gameState ? `${displayMode === "hyperbolic" ? "Curved" : "Flat"} geometry` : "A preview of the arena";
  element<HTMLElement>("scene-coordinates").textContent = displayMode === "flat" ? "8 × 8 anchors · familiar routes" : "109 tiles · five around a corner";

  if (previewMode) {
    element<HTMLElement>("preview-title").textContent = `${capitalize(previewMode)} preview`;
    element<HTMLElement>("preview-copy").textContent = "The shared board has not changed.";
    element<HTMLElement>("preview-banner").hidden = false;
  } else {
    element<HTMLElement>("preview-banner").hidden = true;
  }

  if (!gameState) return;
  renderMatchStatus(gameState);
  renderSeats();
  renderGeometryControls(gameState);
  renderOpeningGuide();
  renderShadows(gameState, displayMode);
  renderHistory(gameState.history);
  renderFinish(gameState);
  const selectedReadout = element<HTMLDivElement>("selected-readout");
  if (selectedPiece) {
    const square = ARENA.flatSquareByTile.get(selectedPiece.tileId);
    selectedReadout.replaceChildren();
    const label = document.createElement("strong");
    label.textContent = capitalize(selectedPiece.type);
    selectedReadout.append(label, document.createTextNode(`${square ? ` · ${square.toUpperCase()}` : " · outer tile"}\n${selectedMoves.length} available route${selectedMoves.length === 1 ? "" : "s"}`));
    selectedReadout.hidden = false;
  } else {
    selectedReadout.hidden = true;
  }
}

function renderMatchStatus(state: GameState): void {
  const status = element<HTMLHeadingElement>("match-status");
  const kicker = element<HTMLElement>("match-kicker");
  const substatus = element<HTMLDivElement>("match-substatus");
  substatus.className = "match-substatus";
  if (state.status.kind === "won") {
    status.textContent = `${capitalize(state.status.winner)} wins`;
    kicker.textContent = "King captured";
    substatus.textContent = "The match is complete.";
    return;
  }
  if (state.status.kind === "draw") {
    status.textContent = "Draw by repetition";
    kicker.textContent = "Same position, three times";
    substatus.textContent = "Neither player has the advantage.";
    return;
  }

  const yourTurn = matchKind === "local" || seat === state.activePlayer;
  status.textContent = yourTurn ? "Your turn" : `${capitalize(state.activePlayer)} to move`;
  kicker.textContent = matchKind === "local" ? "Pass the table" : yourTurn ? `You are ${seat}` : "Waiting for the other player";
  if (matchKind === "online" && !roomConnections[oppositeSide(state.activePlayer)]) {
    substatus.textContent = "The other player is disconnected. Their seat is held for them.";
    substatus.classList.add("alert");
  } else if (clientConnectionStatus === "connecting" || clientConnectionStatus === "offline" && matchKind === "online") {
    substatus.textContent = clientConnectionStatus === "connecting" ? "Connecting to the match server…" : "Reconnecting to the match server…";
    substatus.classList.add("alert");
  } else if (isInCheck(state, state.activePlayer)) {
    substatus.textContent = `${capitalize(state.activePlayer)}'s king is threatened. King capture still decides the match.`;
    substatus.classList.add("check");
  } else if (pendingAction) {
    substatus.textContent = "Sending your action to the other board…";
  } else if (matchKind === "online" && seat !== state.activePlayer) {
    substatus.textContent = "Your view stays local while your opponent moves.";
  } else {
    substatus.textContent = "Capture the opposing king to win.";
  }
}

function renderSeats(): void {
  if (!gameState) return;
  element<HTMLDivElement>("room-strip").hidden = matchKind !== "online";
  element<HTMLElement>("room-code-display").textContent = roomCode ?? "------";
  const ownSeat = matchKind === "online" ? seat : null;
  for (const side of ["white", "black"] as const) {
    const active = gameState.activePlayer === side && gameState.status.kind === "playing";
    element<HTMLDivElement>(`${side}-seat`).classList.toggle("active", active);
    element<HTMLElement>(`${side}-role`).textContent = matchKind === "local" ? "Local player" : ownSeat === side ? "You" : "Opponent";
    const connection = element<HTMLSpanElement>(`${side}-connection`);
    const connected = matchKind === "local" || roomConnections[side];
    connection.textContent = connected ? "Here" : roomCode && matchKind === "online" && side === "black" ? "Waiting" : "Away";
    connection.className = `connection ${connected ? "online" : "offline"}`;
  }
}

function renderGeometryControls(state: GameState): void {
  const displayMode = previewMode ?? state.mode;
  const flat = element<HTMLButtonElement>("flat-preview");
  const curved = element<HTMLButtonElement>("hyperbolic-preview");
  flat.setAttribute("aria-pressed", String(displayMode === "flat"));
  curved.setAttribute("aria-pressed", String(displayMode === "hyperbolic"));
  element<HTMLElement>("geometry-state-caption").textContent = previewMode ? "Local preview" : "Shared state";
  element<HTMLParagraphElement>("mode-help").textContent = state.history.length === 0
    ? "Try a curved preview. A shift spends your turn and opens extra rook routes."
    : displayMode === "flat"
      ? "King, rook, and knight use familiar square-grid moves; guards step one tile."
      : "Rooks follow center-crossing routes through the five-around-a-corner tiling.";

  const lock = element<HTMLParagraphElement>("shift-lock");
  const kingOutside = state.pieces.some((piece) => piece.type === "king" && !ARENA.flatSquareByTile.has(piece.tileId));
  lock.className = `shift-lock ${state.shiftCooldown === 0 ? "ready" : ""}`;
  lock.textContent = kingOutside
    ? "Return both kings to anchor tiles before shifting to flat geometry."
    : state.shiftCooldown === 0
    ? "A geometry shift is available. It uses your turn."
    : `Shift locked · ${state.shiftCooldown} piece move${state.shiftCooldown === 1 ? "" : "s"} remaining`;
  const shift = element<HTMLButtonElement>("commit-shift");
  const showingUncommittedMode = previewMode !== null && previewMode !== state.mode;
  shift.hidden = !showingUncommittedMode;
  shift.disabled = !canSubmitAction() || state.shiftCooldown > 0 || (previewMode === "flat" && kingOutside);
  shift.textContent = `Commit ${capitalize(previewMode ?? state.mode)} shift · spend this turn`;
}

function renderOpeningGuide(): void {
  const guide = element<HTMLElement>("opening-guide");
  if (matchKind !== "local" || !guidedStep || guidedStep === "done") {
    guide.hidden = true;
    return;
  }

  guide.hidden = false;
  const step = element<HTMLElement>("opening-guide-step");
  const title = element<HTMLHeadingElement>("opening-guide-title");
  const copy = element<HTMLParagraphElement>("opening-guide-copy");
  if (guidedStep === "shift") {
    step.textContent = "Guided opening · 1 of 3";
    title.textContent = "Shift the board";
    copy.textContent = "Preview Curved, then commit the shift. White spends this turn; Black moves next.";
  } else if (guidedStep === "inspect") {
    step.textContent = "Guided opening · 2 of 3";
    title.textContent = "Find a new route";
    copy.textContent = "Select Black's rook. On the curved board, its straight route crosses tiles in a new direction.";
  } else {
    step.textContent = "Guided opening · 3 of 3";
    title.textContent = "Follow the route";
    copy.textContent = "Choose one of the highlighted tiles to move the rook along its new route.";
  }
}

function renderShadows(state: GameState, displayMode: GeometryMode): void {
  const container = element<HTMLDivElement>("shadow-groups");
  const hidden = state.pieces.filter((piece) => isShadow(piece, displayMode));
  container.innerHTML = (["white", "black"] as const).map((side) => {
    const pieces = hidden.filter((piece) => piece.side === side);
    const chips = pieces.length
      ? pieces.map((piece) => `<span class="shadow-chip" title="${side} ${piece.type} in the shadow">${pieceLetter(piece.type)}</span>`).join("")
      : "<span class=\"shadow-empty\">None</span>";
    return `<div class="shadow-column"><div class="shadow-label">${capitalize(side)}</div><div class="shadow-pieces">${chips}</div></div>`;
  }).join("");
}

function renderHistory(history: HistoryItem[]): void {
  const container = element<HTMLDivElement>("history-list");
  element<HTMLElement>("history-count").textContent = `${history.length} action${history.length === 1 ? "" : "s"}`;
  if (history.length === 0) {
    container.innerHTML = "<div class=\"history-empty\">Moves and geometry shifts will appear here.</div>";
    return;
  }
  container.innerHTML = history.slice().reverse().map((item) => `
    <div class="history-row"><span class="history-index">${String(item.ply).padStart(2, "0")}</span><span class="history-side ${item.actor}">${item.actor === "white" ? "W" : "B"}</span><span class="history-note">${escapeHtml(item.notation)}</span></div>
  `).join("");
}

function renderFinish(state: GameState): void {
  const overlay = element<HTMLDivElement>("finish-overlay");
  const button = element<HTMLButtonElement>("rematch-button");
  if (state.status.kind === "playing") {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = false;
  if (state.status.kind === "won") {
    element<HTMLElement>("finish-title").textContent = `${capitalize(state.status.winner)} wins`;
    element<HTMLElement>("finish-copy").textContent = "The opposing king has been captured.";
  } else {
    element<HTMLElement>("finish-title").textContent = "Draw by repetition";
    element<HTMLElement>("finish-copy").textContent = "The same full position appeared three times.";
  }
  if (matchKind === "local") {
    button.textContent = "Start a rematch";
    button.disabled = false;
  } else if (rematchRequestedByYou) {
    button.textContent = "Waiting for your opponent";
    button.disabled = true;
  } else {
    button.textContent = rematchRequestedByOther ? "Accept rematch" : "Request a rematch";
    button.disabled = false;
  }
}

function setLobbyPending(isPending: boolean): void {
  element<HTMLButtonElement>("create-room").disabled = isPending;
  element<HTMLInputElement>("room-code").disabled = isPending;
  element<HTMLButtonElement>("local-game").disabled = isPending;
  const join = document.querySelector<HTMLFormElement>("#join-form button[type=submit]");
  if (join) join.disabled = isPending;
}

function setLobbyError(message: string): void {
  const error = element<HTMLParagraphElement>("form-error");
  if (!gameState) error.textContent = message;
}

function setConnectionStatus(status: "connecting" | "connected" | "offline"): void {
  clientConnectionStatus = status;
}

function showMatchPanel(): void {
  element<HTMLElement>("lobby-panel").hidden = true;
  element<HTMLElement>("match-panel").hidden = false;
}

function showToast(message: string): void {
  const toast = element<HTMLDivElement>("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Required app element #${id} is missing.`);
  return node as T;
}

function seatStorageKey(code: string): string {
  return `curvature-chess:seat:${code.toUpperCase()}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
