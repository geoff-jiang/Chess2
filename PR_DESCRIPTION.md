# Implement full chess armies and king-safe curvature tactics

The sparse prototype had eight pieces, optional king safety, no special chess moves, and an arbitrary anchor map that exposed kings when a full army shifted geometry. This update starts every match with the orthodox 32-piece setup and keeps Curvature chess as the default.

Flat movement uses a shared chess.js adapter for legal moves, castling, en passant, all four promotions, and check detection. Kings cannot be captured or left in check in either geometry. Checkmate/stalemate consider safe shifts as escape actions in Curvature games. A separate Standard ruleset disables shifts and adds orthodox dead-material and fifty-move draws; repetition is tracked with complete position rights.

Curved bishops use transported alternating-turn diagonals, queens combine those with rook rays, and pawns carry an explicit forward heading. Shifts cost a turn, retain the two-move lock, and are rejected when they expose the mover's king or produce an invalid flat position. Returning to flat revokes castling and en passant. Extra-tile pieces remain persistent shadows, while kings must stay capturable.

The version-2 anchor map keeps starting armies in opposing regions. The tested opening shift opens a previously blocked bishop route without exposing either king. Local previews report gained/lost destinations; keyboard move controls, a promotion dialog, distinct piece models, and validated local FEN analysis make the rules inspectable.

Code is separated into shared types, the standard-position adapter, curved move generation, and match transitions. Both server and browser call the same rule engine. The earlier board framing, route/picking, and clipping fixes remain included.

## Validation

- Full setup, opening move counts, depth-two perft (400), pins and king safety.
- Castling, lost rights, en passant expiry/discovered check, all four promotions.
- Mate, stalemate, repetition, standard fifty-move/dead-material draws, invalid FEN/state rejection.
- Curved rays/diagonals/queen union, pawn movement/capture/heading/promotion, safe shifts, shadows and JSON reconnects.
- WebSocket seat ownership, invalid moves/promotions, checkmate, rematch and reconnect.
- TypeScript and production build.
- Browser smoke checks: full board, new bishop route after shifting, preview comparison, illegal FEN error, promotion dialog, and knight underpromotion ending in a material draw.

## Compatibility and limitations

Restart the room server when upgrading: version-1 positions cannot be reused with version-2 anchors. Curved piece rules are an explicit variant, not orthodox chess on a curved picture. Comparative playtesting is still needed for balance. Draw claims are automated; clocks, draw offers, and tournament arbiter procedures are outside this application. The existing large Vite bundle warning remains.
