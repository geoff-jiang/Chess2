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
- Choose **Try the guided opening** to preview a geometry shift, commit it, then inspect and play a newly opened rook route.
- Drag to orbit, right-drag to pan, and use the wheel or a pinch gesture to zoom. **Reset view** restores that browser's camera. Camera state is never sent to the server.
- Select a piece to reveal its available destinations and routes. Select a destination to move.
- Choose the other geometry to preview it locally. **Commit** spends the current turn and changes the shared board.
- A geometry shift starts a two-piece-move lock. After each player has made one piece move, another shift is available.
- Capturing the other king wins. Three visits to the same full position draw. The finish panel offers a rematch; online, both players must request one.

## Rules in this version

Each side begins with a king, rook, knight, and guard. The mirrored flat starting squares are White `e1`, `a1`, `b1`, `d2` and Black `d8`, `h8`, `g8`, `e7` respectively.

In flat mode, only the 64 anchor tiles are active. Kings move one square in any direction, rooks move orthogonally, knights use the familiar two-plus-one jump, and guards move one orthogonal square. An extra-tile piece becomes a shadow: its original tile and piece are preserved, but it is hidden from the flat board and cannot move, capture, block, or be captured there.

In hyperbolic mode, rooks follow tile-center rays and continue through the opposite edge of each square; their route stops at the first piece or arena boundary. Knights move two steps along one such ray, then one edge to either side, jumping over intervening pieces. Kings may land on any tile sharing an edge or corner. Both kings must return to anchor tiles before either player can shift to flat geometry: a king cannot escape capture by becoming a shadow. Guards move to an edge-neighbor. Captures happen only on the destination tile.

King threats are displayed, but a player may leave a king threatened; this first version has no checkmate, castling, en passant, pawns, bishops, or promotion. Capturing the king is the win condition.

## Geometry and anchors

The rules engine generates the arena by reflecting a regular hyperbolic square across its edges in the hyperboloid model. Breadth-first face traversal creates the central tile plus four rings: 109 tiles in total. Vertex coordinates build the corner-neighbor graph; rook routes use edge adjacency, not distances in the rendered scene. The 3D board compresses hyperboloid radial distance into a curved display surface so outer tiles remain readable. This visual projection does not change the rules or claim to preserve Euclidean distances.

The generated arena has 32 pairs of opposite noncentral tiles among the anchors. The 64 flat squares are paired by a half-turn and assigned to those tile pairs in deterministic ring and tile ID order. This uses the arena's stable generated IDs, avoiding floating-point angle sorting across server and browser runtimes. The map is versioned and identical for every match. It links two different game spaces; it does not preserve the square grid's distances or neighbors when the geometry changes.

## Project layout

See [the geometry and interaction review](docs/geometry-review.md) for diagnosed defects, implemented corrections, and the remaining gameplay design and visual acceptance work.

- `src/shared/geometry.ts` builds the arena, edge graph, corner graph, and anchor map.
- `src/shared/game.ts` owns the serializable match state, legal destinations, shifts, captures, threats, history, and repetition draws.
- `src/server/index.ts` validates actions, assigns room seats, broadcasts snapshots, and restores a seat with its private reconnect token.
- `src/view/board-view.ts` renders the board and pieces in Three.js, draws routes, picks tiles, and owns per-browser camera controls.
- `src/main.ts` connects the lobby, game panel, local play, and WebSocket room protocol.

Run `npm test`, `npm run typecheck`, and `npm run build` for the automated checks. Rooms survive a player's disconnect while the server process remains running; they are not stored in a database and do not survive a server restart.
