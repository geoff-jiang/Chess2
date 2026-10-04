# Curvature Chess

Curvature Chess is a two-player browser game on two linked boards: a familiar 8×8 grid and a finite patch of the regular hyperbolic `{4,5}` tiling.

## Run it

Use Node.js 24 or newer.

```sh
npm install
npm run dev
```

In a second terminal, start the room server:

```sh
npm run server
```

Open the Vite URL printed by `npm run dev`. For a production build, `npm start` builds the browser app and serves it with the room server on port `8787` (or `PORT`). The room server keeps active matches in memory, so restarting its process ends those rooms.

## Play

- Create a private room and send the six-character code or copied invite link to one other player. A room reserves exactly two seats.
- Choose **Try a local match on this device** to play both sides without a second browser.
- Choose **Explore curved routes** to preview a geometry shift, commit it, and inspect newly opened routes.
- Drag to orbit, right-drag to pan, and use the wheel or a pinch gesture to zoom. **Reset view** restores that browser's camera. Camera state is never sent to the server.
- Select a piece to reveal its available destinations and routes. Select a destination to move.
- Choose the other geometry to preview it locally. **Commit** spends the current turn and changes the shared board.
- A geometry shift starts a two-piece-move lock. After each player has made one piece move, another shift is available.
- Checkmate wins. Kings cannot be captured or left in check. A safe geometry shift counts as a possible escape in Curvature matches. Three visits to the same full position draw. The finish panel offers a rematch; online, both players must request one.
- The piece/destination buttons support keyboard play. Pawn promotion asks you to choose queen, rook, bishop, or knight before committing the move.
- **Local analysis position** accepts FEN for a local match and reports invalid positions. Leave it blank for the full opening.

## Rules in this version

Every match starts with the standard 32 pieces: eight pawns, two rooks, two knights, two bishops, a queen, and a king per side. White occupies ranks 1–2, Black ranks 7–8; queens start on d1/d8 and kings on e1/e8.

**Curvature chess is the default.** Flat mode uses standard legal chess moves, including pins and king safety, castling, en passant, pawn double steps, captures, and all four promotions. A shift spends a turn and must leave the mover's king safe. A shift can answer check if the destination geometry removes the attack. Returning to flat must also form a valid chess position with both kings on anchors. Castling and en passant are revoked on returning from curved space; shifts cannot restore those privileges.

In curved mode:

- Rooks follow opposite-edge rays, stopping at the first occupied tile or boundary.
- Bishops follow alternating left/right edge turns, landing after each pair of steps. There are eight initial diagonal routes. Only landing tiles block the bishop; intermediate tiles are route guides. These are explicit combinatorial diagonals, not a claim about straight geodesics through tile centers.
- Queens combine rook and bishop routes. Knights travel two straight edge steps and one sideways step, jumping intervening pieces.
- Kings can move to any edge/corner neighbor, provided they do not enter check.
- Pawns start facing the edge closest in hyperbolic distance to their opposing home-rank anchor. Their heading is transported across moves. They advance one empty edge tile and capture via a forward edge plus a sideways edge; intermediate pieces do not block diagonal capture. Pawns promote at an opposing home-rank anchor or at a forward boundary in the opponent's half. Double steps, castling, and en passant apply only in flat space.
- Captures occur on the destination. Every piece move is filtered for king safety. The two-piece-move shift lock prevents instant geometry reversal.

Extra-tile pieces become shadows in flat mode: they retain their positions and identities but cannot move, attack, block, or be captured until curved space returns. Kings cannot become shadows. A return that leaves an unpromoted pawn on a back rank is rejected. Repetition includes geometry, side to move, cooldown, piece placement, pawn headings, and flat special-move rights. Curvature games do not apply orthodox insufficient-material or fifty-move draws because shifts change attack topology and reset flat move clocks.

Choose **Standard chess** for an orthodox match without shifts. It also detects stalemate, insufficient material, and the fifty-move draw. Repetition and fifty-move draws are adjudicated automatically rather than requiring a claim. This application does not implement tournament clocks, draw offers, or FIDE claim/arbiter procedures.

## Geometry and anchors

The rules engine generates the arena by reflecting a regular hyperbolic square across its edges in the hyperboloid model. Breadth-first face traversal creates the central tile plus four rings: 109 tiles in total. Vertex coordinates build the corner-neighbor graph; rook routes use edge adjacency, not distances in the rendered scene. The 3D board compresses hyperboloid radial distance into a curved display surface so outer tiles remain readable. This visual projection does not change the rules or claim to preserve Euclidean distances.

The 64 anchors use 32 opposite noncentral tile pairs. Version 2 uses a deterministic greedy projection match to keep the opening armies in opposing regions while retaining exact half-turn pairing. This preserves broad rank/file locality, not grid distances or all neighbors. Regression tests freeze selected mappings and verify that the full opening can shift without exposing either king. Version-1 matches are incompatible: restart the server and begin fresh matches when upgrading.

## Project layout

See [the geometry and interaction review](docs/geometry-review.md) for diagnosed defects, implemented corrections, and the remaining gameplay design and visual acceptance work.

- `src/shared/geometry.ts` builds the arena, edge graph, corner graph, and anchor map.
- `src/shared/game.ts` owns the serializable match state, legal destinations, shifts, captures, threats, history, and repetition draws.
- `src/shared/game-types.ts` defines shared protocol and rule types.
- `src/shared/standard-chess.ts` adapts chess.js positions to stable piece identities and tile anchors, and validates imported FEN.
- `src/shared/curvature-moves.ts` defines curved piece movement and pawn heading transport.
- `src/server/index.ts` validates actions, assigns room seats, broadcasts snapshots, and restores a seat with its private reconnect token.
- `src/view/board-view.ts` renders the board and pieces in Three.js, draws routes, picks tiles, and owns per-browser camera controls.
- `src/main.ts` connects the lobby, game panel, local play, and WebSocket room protocol.

Run `npm test`, `npm run typecheck`, and `npm run build` for the automated checks. Rooms survive a player's disconnect while the server process remains running; they are not stored in a database and do not survive a server restart.
