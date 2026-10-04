# Implement full chess armies and readable curvature tactics

The sparse prototype had eight pieces, optional king safety, no special chess moves, and an arbitrary anchor map that exposed kings when a full army shifted geometry. This update starts every match with the orthodox 32-piece setup and keeps Curvature chess as the default.

Flat movement uses a shared chess.js adapter for legal moves, castling, en passant, all four promotions, and check detection. Kings cannot be captured or left in check in either geometry. Checkmate/stalemate consider safe shifts as escape actions in Curvature games. A separate Standard ruleset disables shifts and adds orthodox dead-material and fifty-move draws; repetition is tracked with complete position rights.

Curved bishops use transported alternating-turn diagonals, queens combine those with rook rays, and pawns carry an explicit forward heading. Shifts cost a turn, retain the two-move lock, and are rejected when they expose the mover's king or produce an invalid flat position. Returning to flat revokes castling and en passant. Extra-tile pieces remain persistent shadows, while kings must stay capturable.

The version-2 anchor map keeps starting armies in opposing regions. The tested opening shift opens a previously blocked bishop route without exposing either king. Local previews report gained/lost destinations; keyboard move controls, a promotion dialog, distinct piece models, and validated local FEN analysis make the rules inspectable.

Code is separated into shared types, the standard-position adapter, curved move generation, and match transitions. Both server and browser call the same rule engine. The earlier board framing, route/picking, and clipping fixes remain included.

The curved overview compressed edge pieces into narrow tiles, while drawing every legal route simultaneously obscured movement. Selecting a piece now recenters its neighborhood with a Lorentz boost before display projection, so every selected tile has the same usable size as the central tile. A shallow, more overhead view reduces occlusion; Whole arena restores context and Show entire route frames a selected move. The board remains visible while controls scroll independently on desktop and mobile.

Curved destinations now preview before confirmation. One route appears at a time with direction arrows, guide dots, landing rings, an arrival ghost, and a plain-language explanation. Pawns show their forward direction. Destination controls distinguish moves from captures, work by keyboard, and support cancellation. Once a destination is chosen, hovering another cannot change the visual preview without changing the chosen move. These changes affect presentation and input only; the existing movement graph and room protocol remain compatible.

## Validation

- Full setup, opening move counts, depth-two perft (400), pins and king safety.
- Castling, lost rights, en passant expiry/discovered check, all four promotions.
- Mate, stalemate, repetition, standard fifty-move/dead-material draws, invalid FEN/state rejection.
- Curved rays/diagonals/queen union, pawn movement/capture/heading/promotion, safe shifts, shadows and JSON reconnects.
- WebSocket seat ownership, invalid moves/promotions, checkmate, rematch and reconnect.
- TypeScript and production build.
- Local projection: all 109 focus tiles retain equal usable center-to-edge size, all edge distances are invariant under recentering, and focused/overview displays remain bounded and finite.
- Route explanation regressions distinguish intermediate guide tiles from true landing squares for sliding pieces and jumps.
- Browser checks for destination preview, explicit confirmation, cancellation without consuming a turn, full-route framing, and a 390×844 mobile layout with the board and move controls visible together.
- Browser smoke checks: full board, new bishop route after shifting, preview comparison, illegal FEN error, promotion dialog, and knight underpromotion ending in a material draw.

## Compatibility and limitations

Restart the room server when upgrading: version-1 positions cannot be reused with version-2 anchors. Curved piece rules are an explicit variant, not orthodox chess on a curved picture. Comparative playtesting is still needed for balance. Draw claims are automated; clocks, draw offers, and tournament arbiter procedures are outside this application. The existing large Vite bundle warning remains.
