# Geometry and interaction review

This review describes the earlier eight-piece prototype. The full-chess update supersedes its anchor mapping and king-capture rules: see the README for current rules. The update adds 32 pieces, both-geometry king safety, checkmate, a version-2 map keeping opening armies apart, transported diagonals and pawn headings, route comparisons, and keyboard piece/destination controls. Curvature remains the default; balance still requires playtesting.

## Assessment

The program has a genuine hyperbolic rules graph: five squares meet at an interior vertex, and rook continuation follows opposite edges. Bending the display surface is not the source of that geometry. The gameplay weakness is that the player cannot easily predict or exploit the graph change. A deterministic but spatially arbitrary anchor permutation can feel like teleportation rather than understandable curvature. Eight pieces across 109 tiles also leave little contested territory. These are code-based diagnoses, not conclusions from user playtests.

## Implemented corrections

| Defect | Cause | Correction |
| --- | --- | --- |
| Board cut off in narrow viewports | Fixed overview distance ignores horizontal field of view | Fit a sphere enclosing the active board plus piece clearance to the smaller viewport angle; refit on resize only while in overview |
| Tiles disappear or cannot be picked after shifts | Position buffers change without refreshing cached bounding spheres | Recompute mesh and rim bounds during morphing |
| Routes flicker or disappear into tiles | Route points sit on the tile surface | Lift routes above the display surface |
| Routes cross the wrong edge | Route rendering uses the destination tile's entry-edge index on the source tile | Find and sample the source exit edge |
| Selecting an outer tile stays too far away | Focus uses a fixed minimum distance of 16 | Fit a local neighborhood to the viewport using tile scale |
| Outer pieces overlap adjacent tiles | Average center-to-boundary distance and a large minimum size ignore narrow radial depth | Size from the nearest sampled boundary, with a smaller minimum |
| Picking during animation acts on misleading positions | Tiles interpolate while pieces and routes jump to their destination | Hide pieces/routes during transitions and block tile picking until complete; settle interrupted transitions before reversing |
| Preview banner overflows small screens | Unbounded nowrap content | Bound width and permit wrapping |
| Curvature offers kings little strategic scope | King destinations are filtered through the arbitrary anchor subset | Use the complete edge/corner graph; retain the prohibition on shifting a non-anchor king into shadow; explain and disable that shift in the UI |

Full king movement makes five-around-a-corner neighborhoods relevant to the win condition and lets an exposed king commit the match to curved play. This is an experimental rules change. It may also enable avoidance strategies and must be evaluated rather than called balanced.

## Remaining design work, in priority order

1. **Make topology legible.** Add a destination inspector that shows one chosen route rather than every overlapping route, edge continuation arrows, stable IDs for extra tiles, and a before/after list of attacks, blockers, and shadow pieces during preview. Implement the comparison using the same shared move generator used by the server, without applying a turn. Acceptance: a player can explain why a route opens before committing a shift.
2. **Replace arbitrary correspondence deliberately.** Evaluate symmetric, locality-aware anchor maps against current ID ordering. Optimize adjacent-grid pairs for hyperbolic graph proximity, retaining half-turn symmetry, and publish distortion statistics. No map can preserve all grid neighborhoods in a different tiling. Freeze the selected map, bump the arena version, reject mismatched clients, and add a golden mapping fixture. Do not silently change tile meanings in active matches.
3. **Introduce contested tactical scenarios.** Build seeded, mirrored positions demonstrating a five-tile vertex fork, a blocked ray opened by shifting, and a shadow reserve that returns under attack. Verify a concrete benefit against the same position without shifting. Replace the guided opening's generic rook move with a goal and explanation tied to a verified sequence.
4. **Measure incentives before adding rules.** Compare eight-piece starts with denser symmetric starts and a central control objective. Record first meaningful contact, shift frequency, immediate king captures, boundary trapping, and games prolonged by kings staying off anchors. Prefer adjusting placement and arena extent before introducing shift resources or scoring rules. Server and browser must share any chosen objective and include it in repetition keys.
5. **Complete navigation and accessibility.** Add an HTML tile/destination list with keyboard selection, Escape to cancel, a return-to-lobby flow that closes sockets, and explicit touch instructions. The current canvas is aria-hidden and has no keyboard equivalent. Constrain panning against active board bounds and distinguish orbit gestures from two-finger taps. Keep camera state local.

## Verification and release criteria

Automated tests cover geometry incidence and symmetry, graph ray rules, captures, repetition, shadow persistence, server seat/action validation, full hyperbolic king neighborhoods, off-anchor flat-shift rejection, and overview containment at portrait and landscape aspect ratios. TypeScript and the production build must pass.

Visual checks remain required: 320px phone, tablet split view, desktop and short landscape; all board edges visible after Reset; orbit/pan/zoom followed by resize preserves the user's view; repeated previews produce no missing tiles; select/capture on outer tiles works; route lines remain visible at shallow angles; a two-finger gesture never commits a move. Piece sizing is a sampled clearance heuristic, not a proof against every curved-surface overlap. The current transition hides pieces briefly; replacing it with continuous, clearance-aware piece interpolation is a future polish task.

Do not label this a proven compelling use of non-Euclidean geometry until the tactical scenarios and comparative playtests establish a repeatable strategic benefit.
