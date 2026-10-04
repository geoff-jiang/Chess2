# Fix board framing and picking; expose full hyperbolic king tactics

Fixed overview distances clipped the board in narrow viewports, and geometry shifts mutated tile positions without updating the bounds used by culling and raycasting. Routes also lay directly on tile surfaces and outer piece sizing ignored narrow tile depth.

This change fits the active arena to both viewport axes, refreshes morphed bounds, lifts routes, reduces piece footprint, bounds the preview banner, and prevents picking during transitions. Overview responds to resize while manually navigated views retain their pose.

Hyperbolic kings now use the complete edge/corner graph, making the five-squares-per-vertex structure relevant to king tactics. Either king leaving the anchors prevents a return to flat geometry, enforced by the rules engine and explained in the UI. This is a balance-affecting experimental change, not evidence that the game is already strategically compelling.

The accompanying review documents root causes, remaining implementation proposals, versioned anchor-map migration, tactical tutorial requirements, and playtest criteria. Arbitrary anchor correspondence and sparse opening positions remain unresolved design issues.

## Validation

- Automated geometry, game, display, camera-fit, and WebSocket server tests.
- TypeScript checking and Vite production build.
- Browser visual and gesture acceptance checks are listed in `docs/geometry-review.md`; they have not yet been performed.

## Risks

Full-graph king movement changes balance and can prolong curved play. Piece sizing remains a sampled heuristic. Transitions intentionally hide pieces and routes while tiles morph. Vite reports the existing large JavaScript bundle warning.
