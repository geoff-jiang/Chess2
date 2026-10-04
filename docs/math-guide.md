# Curvature Chess: the mathematics behind the implementation

This guide describes the current implementation, including its deliberate game rules and its approximations. Read sections 1–9 first to understand the game; sections 10–15 explain the graphics and verification.

## 1. The four layers

1. **Geometry:** construct a regular hyperbolic square tiling using Lorentz reflections.
2. **Board graph:** record which tiles share edges and vertices.
3. **Rules:** generate moves on that graph, then reject actions that violate king safety.
4. **Graphics:** project the geometry into an ordinary 3D scene, triangulate it, and render it through a camera.

Geometry coordinates, display coordinates, and screen coordinates are different things. Camera movement and visual distortion do not change legal moves.

The flat game uses orthodox chess rules through chess.js. The curvature variant changes the board graph and adds geometry shifts as turn-consuming actions.

Code map:

| File | Responsibility |
|---|---|
| `src/shared/geometry.ts` | Hyperboloid, reflections, tiling, adjacency, anchors |
| `src/shared/curvature-moves.ts` | Curved piece movement and pawn direction |
| `src/shared/game.ts` | Actions, king safety, shifts, terminal states, repetition |
| `src/shared/standard-chess.ts` | FEN validation and orthodox chess adapter |
| `src/view/hyperbolic-display.ts` | Hyperboloid-to-display projection and normals |
| `src/view/camera-fit.ts` | Perspective camera fitting |
| `src/view/board-view.ts` | Mesh sampling, animation, piece orientation, picking |

## 2. What makes the board hyperbolic?

The tiling is written **{4,5}**: four edges per tile and five tiles meeting at each interior vertex. Ordinary square chess has the Euclidean arrangement {4,4}.

A regular {p,q} tiling is hyperbolic when

\[
\frac1p+\frac1q<\frac12.
\]

Here, 1/4 + 1/5 = 0.45. Each hyperbolic square has interior angle 2π/5 = 72°. Five such angles fill 360°. Five ordinary 90° squares would require 450°.

The model has constant Gaussian curvature **K = −1**. This is a choice of distance units. More generally, K = −κ² corresponds to scaling the unit-curvature distances by 1/κ. The program does not expose arbitrary κ or reconstruct the tiling continuously as curvature changes.

For a geodesic polygon at K = −1,

\[
\text{area}=(p-2)\pi-\sum_i\alpha_i.
\]

Each tile therefore has area 2π − 4(2π/5) = **2π/5**. This area is an intrinsic hyperbolic measurement, not its visible pixel area. Five tiles meeting without an angular gap does not imply zero curvature: negative curvature is present throughout their interiors.

Background: [Hitchman, Area and Triangle Trigonometry](https://mphitchman.com/geometry/section5-4.html).

## 3. Why a two-dimensional board uses three coordinates

The hyperboloid model stores points p = (x,y,z) satisfying

\[
x^2+y^2-z^2=-1,\qquad z>0.
\]

The constraint removes one degree of freedom, leaving a two-dimensional space.

Its fundamental operation is the **Lorentz inner product**:

\[
L(a,b)=a_xb_x+a_yb_y-a_zb_z.
\]

The minus sign is essential. Ordinary Euclidean dot products would describe a different geometry. Points satisfy L(p,p) = −1. Tangent vectors u at p satisfy L(p,u) = 0, and their Lorentz squared lengths are positive.

The hyperbolic distance is

\[
d(a,b)=\operatorname{acosh}[-L(a,b)].
\]

From the origin c = (0,0,1), a point at distance s and angle θ is

\[
p=(\sinh s\cos\theta,\sinh s\sin\theta,\cosh s).
\]

This satisfies the constraint because cosh²s − sinh²s = 1. Consequently,

\[
d(c,p)=\operatorname{acosh}(z)
=\operatorname{asinh}\sqrt{x^2+y^2}.
\]

The code uses the last expression for radial display compression.

Recall sinh s = (eˢ − e⁻ˢ)/2, cosh s = (eˢ + e⁻ˢ)/2, and tanh s = sinh s/cosh s. Their inverse functions recover distances from coordinates.

**Important:** drawing this hyperboloid in ordinary Euclidean 3D does not reproduce its hyperbolic metric. The Lorentz metric is part of the model.

Background: [Caroline Series, Hyperbolic Geometry notes](https://warwick.ac.uk/fac/sci/maths/people/staff/caroline_series/hyperbolic_geometry_ma448_lecture_notes.pdf), introduction §0.3 and §2.1.

## 4. Deriving the square and generating its neighbors

Split a regular tile into right triangles using its center, an edge midpoint, and a vertex. Their angles are A = π/4, B = π/5, and π/2. Hyperbolic trigonometry gives

\[
\cosh R=\cot A\cot B,
\qquad \cosh r=\frac{\cos B}{\sin A},
\qquad \cosh(\ell/2)=\frac{\cos A}{\sin B}.
\]

R is center-to-vertex distance, r is center-to-edge distance, and ℓ is edge length. Numerically:

| Quantity | Value in model units |
|---|---:|
| R | 0.842482 |
| r | 0.530638 |
| ℓ | 1.253739 |
| Adjacent center separation, 2r | 1.061275 |

`VERTEX_RADIUS` implements the first formula. Each tile carries a frame (c,u,v), where L(c,c) = −1, L(u,u) = L(v,v) = 1, and all cross-products under L vanish.

For θᵢ = π/4 + iπ/2, its vertices are

\[
w_i=\cosh R\,c+\sinh R(\cos\theta_i\,u+\sin\theta_i\,v).
\]

Substituting the orthogonality conditions gives L(wᵢ,wᵢ) = −cosh²R + sinh²R = −1. This is why the construction stays on the model surface.

The first tile is centered at (0,0,1), with axes (1,0,0) and (0,1,0). Its vertices have spatial coordinates approximately (±0.668740, ±0.668740), with z ≈ 1.376382.

To create a neighbor, reflect the entire frame across one edge. A geodesic edge lies in a plane through the origin of the ambient coordinate space. For its endpoints a,b, take their ordinary cross product and flip its z component:

\[
n_0=(a\times b)_x,(a\times b)_y,-(a\times b)_z,
\qquad n=\frac{n_0}{\sqrt{L(n_0,n_0)}}.
\]

The parentheses above mean a three-component vector. The sign flip converts the Euclidean plane normal into a Lorentz normal; L(a,n) = L(b,n) = 0.

Reflection is

\[
\mathcal R_n(p)=p-2L(p,n)n.
\]

It fixes the edge, preserves Lorentz inner products, and therefore preserves hyperbolic distances. Reflecting twice returns the original point. In matrix notation, with J = diag(1,1,−1), the matrix is I − 2n(nᵀJ).

`reflectFrameAcrossEdge` reflects the center and both axes, then regenerates the vertices. Reflections reverse frame handedness; edge numbers are local coordinates, not universal screen directions.

Background: [Series notes](https://warwick.ac.uk/fac/sci/maths/people/staff/caroline_series/hyperbolic_geometry_ma448_lecture_notes.pdf), §2.2.13 and §3.2.5; [Hitchman §5.4](https://mphitchman.com/geometry/section5-4.html).

## 5. Turning geometry into a finite board graph

`createArena` uses breadth-first search. Begin with the central tile; reflect its four edges; add unseen centers to a queue; repeat until graph distance four. Known neighbor links are still recorded at the boundary.

The current ring counts are **1, 4, 12, 28, 64**, totaling **109 tiles**. A ring measures the minimum number of edge crossings from the center. It does not mean all centers have hyperbolic distance equal to the ring number.

The hyperbolic polar metric is

\[
ds^2+\sinh^2s\,d\theta^2.
\]

Thus a radius-s circle has circumference 2π sinh s and a disk has area 2π(cosh s − 1), both growing roughly exponentially. This explains the large amount of space near the outside; the actual ring counts are produced by the graph traversal, not by substituting into the disk-area formula.

Each edge link stores both the neighboring tile ID and the entry-edge index in that neighbor. Recording the entry index makes continued directions possible despite changing frames.

Vertex incidence records all tiles sharing a vertex. An interior square has four edge neighbors and eight additional corner-only neighbors, giving **12 touch neighbors**. Boundary tiles can have fewer.

The patch is bounded. Missing neighbors stop movement; there is no wraparound, portal, or identification of opposite edges.

With a hash map, ordinary BFS takes O(V + E) time and O(V) storage. Here each tile has at most four edge links. Reference: [MIT 6.006 lecture notes, BFS lecture 13](https://courses.csail.mit.edu/6.006/fall11/notes.shtml).

## 6. Mapping the 64 flat squares onto curved tiles

Flat coordinates use row 0 for rank 8 and column 0 for file a:

\[
\text{file}=\operatorname{char}(97+\text{col}),\qquad
\text{rank}=8-\text{row}.
\]

Exactly 64 hyperbolic tiles are assigned flat-square identities, called anchors. The other 45 tiles exist only as active squares in curved mode.

The half-turn map is

\[
H(x,y,z)=(-x,-y,z),\qquad H(H(p))=p.
\]

It pairs curved tiles. Flat squares are paired using (row,col) ↔ (7−row,7−col). This enforces exact half-turn symmetry between the armies.

For matching, the code converts centers to Poincaré disk coordinates:

\[
q=\left(\frac{x}{z+1},\frac{y}{z+1}\right).
\]

Their disk radius is tanh(s/2). A flat square's matching target is

\[
t=\left(\frac{\text{col}-3.5}{4.5},\frac{\text{row}-3.5}{4.5}\right).
\]

The algorithm sorts tile pairs by ring and ID, takes the first 32 pair candidates, and processes flat pairs from the center outward. It selects the unused candidate with the smallest Euclidean squared disk error ‖q−t‖², orienting it into the correct army half, then assigns the opposite square to the opposite tile.

This is a **greedy assignment heuristic**. It is not a globally optimal matching, and it preserves neither all distances nor all neighbors. The constants 3.5 and 4.5 are grid centering and target scaling choices, not hyperbolic constants.

During a shift, piece tile IDs remain unchanged. Their coordinates and legal-move interpretation change with the mode. Non-anchor pieces become inactive shadows in flat mode and remain stored for the next curved phase. Both kings must be on anchors to return to flat mode.

This mapping contributes to strategy: a flat rank/file relationship can become a different curved route. Do not attribute every newly available move solely to continuous geodesic divergence; the anchor assignment and variant movement rules also contribute.

## 7. Piece movement: geometry plus explicit game conventions

Edge arithmetic uses modulo four. The edge opposite entry edge j is (j+2) mod 4; the two side edges are offsets 1 and 3. These numbers refer to each tile's local frame.

| Piece | Curved movement |
|---|---|
| Rook | Cross an edge; in the next tile leave through the edge opposite the entry edge; repeat. |
| Bishop | Follow a two-edge alternating-turn rule and land after each pair of crossings. |
| Queen | Union of rook and bishop destinations. |
| Knight | Two straight edge crossings followed by one side crossing; intermediate tiles do not block. |
| King | Any edge- or corner-touching neighbor, subject to king safety. |
| Pawn | One forward edge into an empty tile, or a two-edge forward-and-side capture; carry a local heading. |

**Rooks:** reflection symmetry and opposite-edge continuation make the center-to-center route a hyperbolic geodesic. Friendly occupancy stops the ray without allowing a landing. Enemy occupancy allows capture and stops the ray. Boundary or repeated tile ends traversal.

**Bishops:** choose an initial exit e and turn t ∈ {1,3}. If the first crossing enters an intermediate tile through j₁, take exit j₁+2+t. If the second crossing enters the landing tile through j₂, the next pair starts through j₂+2−t, all modulo four. Land after every two crossings. Only landing tiles block the bishop; intermediate tiles are route guides. There are up to eight initial routes before duplicates and blocking.

This is a discrete definition of a transported diagonal, not a theorem that every bishop route is a continuous hyperbolic geodesic. There is no universally prescribed orthodox chess rule on {4,5}.

**Pawns:** when first entering curved mode, choose a neighboring center q closest to the same-file enemy home-rank anchor t. Since acosh is increasing,

\[
\arg\min_q d(q,t)=\arg\max_q L(q,t).
\]

The code compares Lorentz products and avoids computing acosh for every candidate. After a straight move, new forward edge = entry edge + 2. After a diagonal capture with turn t, it is entry edge + 2 − t. This is a discrete heading update, not a full implementation of Levi-Civita parallel transport.

Curved pawns have no double advance or en passant; curved mode has no castling. Promotion occurs on an enemy-back-rank anchor or at a forward boundary in the enemy half. Each promotion produces four choices: queen, rook, bishop, knight.

**A concrete strategic example:** after an opening shift, the initially blocked black bishop on c8 (tile h-082) gains a route h-082 → h-032 → h-011, where h-011 is the e6 anchor. The route's intermediate tile is not a bishop landing. This is an implemented example, not evidence that the variant is competitively balanced.

## 8. Legal moves, validation, and game state

A generated move satisfies its movement pattern; a legal move also preserves the moving side's king safety:

\[
\mathcal L(S)=\{m\in\mathcal P(S):
\text{own king is not attacked in }T(S,m)\}.
\]

S is the complete state, P is the pseudo-legal move set, and T applies the move to a temporary state. The implementation removes a captured piece, moves/promotes the actor, updates pawn direction, and checks enemy attacks. Capturing a king is never an action.

Attack maps are not generated by recursively asking for the enemy's legal moves. Pawns attack their diagonal destinations even when empty; their empty forward advances are not attacks. This avoids recursion and correctly distinguishes control of a square from permission to move there.

Flat movement comes from chess.js. Standard chess includes castling's king/rook relocation and en passant's capture of a pawn behind the destination. The halfmove clock counts plies since the last pawn move or capture; 100 plies correspond to fifty moves by each side.

FEN records six fields: placement, active side, castling rights, en-passant target, halfmove clock, and fullmove number. Flat validation checks syntax and consistency, kings, piece counts, pawn placement, rights, and the previous actor's king safety. Curved validation also checks unique tile occupancy and valid headings. These checks do not establish that every accepted position is historically reachable from the standard opening.

For library behavior and APIs: [chess.js documentation](https://jhlywa.github.io/chess.js/).

## 9. Geometry shifts and terminal states

A legal shift requires the curvature ruleset, an unfinished game, a different destination mode, cooldown zero, and the actor's king safe in the destination geometry. Returning flat also requires anchored kings and a valid reconstructed flat position.

A shift changes the mode, switches the active player, and sets cooldown c = 2. Every subsequent piece move updates c ← max(0,c−1). Thus two piece moves across the game are required before another shift. This cost and cooldown are design choices.

Returning flat reconstructs FEN and clears castling and en-passant rights. Curved moves do not preserve the orthodox historical conditions needed for those rights.

Let M be available legal piece moves and G available legal shifts. Then:

| Condition | Result |
|---|---|
| M = ∅, G = ∅, king attacked | Checkmate |
| M = ∅, G = ∅, king not attacked | Stalemate |
| G ≠ ∅ | A shift remains a possible escape/action |

Repetition needs more than identical piece locations. The curvature position key includes arena version, geometry mode, active player, cooldown, piece sides/types/tiles, pawn headings, and flat castling/en-passant rights when relevant. These variables affect future actions. Sorting the piece descriptions removes incidental array order.

The standard position key uses the first four FEN fields. A third occurrence ends the implemented game in a repetition draw. Fifty-move and orthodox insufficient-material draws apply only in Standard mode. This is a simplified automated draw policy, not every FIDE claim or tournament procedure.

## 10. The visible bowl is a custom projection

The local view first applies a Lorentz boost to bring the selected tile center f to (0,0,1). Write the spatial dot product as b = f_x p_x + f_y p_y. Then

\[
p'_x=p_x+f_x\left(\frac{b}{f_z+1}-p_z\right),\quad
p'_y=p_y+f_y\left(\frac{b}{f_z+1}-p_z\right),\quad
p'_z=f_zp_z-b.
\]

This is an isometry: L(p',q') = L(p,q). It enlarges a selected outer tile through a change of viewpoint, without changing distances, tile IDs, adjacency, or moves. The whole-arena view uses f = (0,0,1). The camera frames a local neighborhood or the selected route; distant tiles remain compressed. Tests check all 109 possible focus tiles and verify identical focused center-to-edge size.

Given the recentered model point p = (x,y,z), the display code computes

\[
\rho=\sqrt{x^2+y^2},\quad s=\operatorname{asinh}\rho,
\quad r_d=8\tanh(s/4),
\]

then

\[
(X,Y,Z)=\left(x\frac{r_d}{\rho},\;0.012r_d^2,\;y\frac{r_d}{\rho}\right).
\]

The origin is handled separately to avoid division by zero. Model z is the Lorentz coordinate; display Y is ordinary scene height. Model x,y become display X,Z.

Angles around the center are preserved. Radius is compressed: r_d < 8, so Y < 0.768. Its derivative is

\[
\frac{dr_d}{ds}=2\operatorname{sech}^2(s/4).
\]

Farther radial distances occupy progressively less visible space. That contributes to small distant tiles; the local-view boost moves the active neighborhood out of that compressed region. The 8, 4, and 0.012 constants are presentation choices.

This differs from the standard Poincaré projection used for anchors, whose radius is tanh(s/2). The display is neither asserted to preserve all distances nor to be conformal.

The displayed surface satisfies Y = a(X²+Z²), a = 0.012. Its Euclidean Gaussian curvature is

\[
K_{\mathrm{display}}=
\frac{4a^2}{[1+4a^2(X^2+Z^2)]^2}>0.
\]

Derivation: for a graph Y = f(X,Z), Gaussian curvature is det(Hessian f)/(1+‖∇f‖²)². Here Hessian f = diag(2a,2a) and ∇f = (2aX,2aZ).

Therefore, **the bowl is not an isometric physical embedding of the negatively curved game board**. Genuine hyperbolic construction drives the graph; a distorted bowl visualizes it.

## 11. Geodesic interpolation and mesh construction

For model endpoints a,b at distance D, the exact constant-speed geodesic interpolation is

\[
g(t)=\frac{\sinh((1-t)D)}{\sinh D}a
+\frac{\sinh(tD)}{\sinh D}b,\quad 0\le t\le1.
\]

It lies on the hyperboloid in the plane spanned by a,b. At t = 1/2, the midpoint can equivalently be written

\[
m=\frac{a+b}{\sqrt{-L(a+b,a+b)}}.
\]

The code clamps the acosh argument to at least one to prevent small rounding errors from producing NaN. For D < 10⁻⁶, the rendering helper returns a to avoid unstable division by a tiny sinh D.

Ordinary model-coordinate averaging is generally not on the hyperboloid. The implementation samples the geodesic in model space first and then applies the display projection. Interpolating already-projected endpoints would produce a different curve.

Each tile has 8 samples per edge, 32 perimeter samples, and 6 radial rings. Its mesh contains 193 top vertices and 32 bottom perimeter vertices: 225 total. It has 352 top triangles and 64 side triangles: 416 total, without a bottom cap. Across 109 tiles that is 45,344 tile triangles, excluding other scene objects.

These triangles approximate the continuous projected surface. More samples improve shape accuracy but increase processing and rendering costs. Route indicators are projected sample polylines, not exact continuous geodesic drawings. Only the inspected route is shown, with arrows, intermediate landing rings, guide dots, and a translucent arrival piece. Curved moves require explicit confirmation after inspection.

## 12. Normals, piece orientation, and scale

For the display surface, take F(X,Y,Z) = Y − a(X²+Z²). Its gradient gives the upward normal:

\[
\hat n=\frac{(-2aX,1,-2aZ)}{\sqrt{1+4a^2(X^2+Z^2)}}.
\]

The code uses this normal for tile thickness, border offsets, and piece placement. A quaternion rotates the piece's original up direction (0,1,0) onto this normal. This is an ordinary 3D orientation operation, separate from Lorentz geometry.

For unit vectors u,v, an aligning quaternion can be formed from vector part u×v and scalar part 1+u·v, then normalized; antiparallel vectors need a special case. Three.js handles these details through `setFromUnitVectors`. Reference: [Three.js Quaternion](https://threejs.org/docs/pages/Quaternion.html).

Piece sizing measures the minimum Euclidean display distance from the tile center to its sampled boundary points, divides by 0.5, then clamps the scale to [0.12,2]. This is a fitting heuristic. Sampled-vertex distance is not an exact inradius or a proof that every piece mesh fits without collision.

Flat display centers are ((col−3.5)·1.34, 0.13, (row−3.5)·1.34). Flat tile width is 1.24, giving a 0.10 gap. Color alternates by (row+col) mod 2.

The view offsets tile undersides by −0.12 along the normal, borders by +0.012, and piece bases by +0.085 times piece scale. Route samples receive a +0.06 world-height lift to reduce overlap with tiles. These are presentation tolerances, not changes to legal positions.

Lighting uses Three.js materials rather than a custom geometry engine. The basic reason normals matter is that diffuse brightness depends on max(0, n̂·ℓ̂), where ℓ̂ points toward a light. Standard materials also apply their library's roughness, metalness, shadow, and tone-mapping calculations. None of these affects the movement graph.

## 13. Morph animation

The 760 ms transition computes

\[
u=\operatorname{clamp}((t-t_0)/760,0,1),
\quad e=3u^2-2u^3,
\quad P=(1-e)P_{\mathrm{flat}}+eP_{\mathrm{curved}}.
\]

The easing derivative 6u(1−u) is zero at both ends, so the animation starts and stops smoothly. Flat and curved meshes share a vertex layout, making vertex-by-vertex interpolation possible. Normals and bounding spheres are refreshed after geometry changes.

Intermediate shapes are display states, not additional playable geometries or computed intermediate curvature values. Picking is disabled during the morph, and pieces/routes are hidden while it runs. There is no physical dynamics or differential-equation simulation here.

## 14. Camera fitting and mouse picking

For viewport aspect A = width/height and vertical field of view f, define half-angles

\[
\alpha_v=f\pi/360,
\quad\alpha_h=\arctan(A\tan\alpha_v),
\quad\alpha=\min(\alpha_v,\alpha_h).
\]

A bounding sphere of radius R at center-distance D has angular radius asin(R/D). To fit it inside both axes, require D ≥ R/sin α. The code adds a margin:

\[
D=1.15R/\sin\alpha.
\]

The board bounds also receive a piece-height allowance. Using only the vertical field of view would clip the board on narrow windows. The camera uses 38° vertical FOV and near/far planes 0.08 and 2000. These clipping planes belong to rendering, not game boundaries. Reference: [Three.js PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html).

Rendering transforms a vertex through model, view, and projection matrices:

\[
p_{\mathrm{clip}}=PVM(x,y,z,1)^T,
\qquad p_{\mathrm{NDC}}=p_{\mathrm{clip}}/w.
\]

The perspective divide creates foreshortening. Mouse pixels are converted back to normalized device coordinates:

\[
x_n=2(x-\mathrm{left})/\mathrm{width}-1,
\quad y_n=1-2(y-\mathrm{top})/\mathrm{height}.
\]

Three.js constructs a ray O+λd through that screen location, intersects scene triangles, and reports hits ordered by distance. The hit object identifies the logical tile. Refreshed mesh bounding spheres matter because raycasting uses bounds before testing triangles. A pointer movement of at most five pixels is treated as a click rather than camera dragging. Reference: [Three.js Raycaster](https://threejs.org/docs/pages/Raycaster.html).

## 15. Numerical precision and verification

JavaScript arithmetic uses 64-bit floating-point numbers; rendering vertex buffers use 32-bit floats. Mathematical identities therefore hold approximately after computation.

`pointKey` rounds each coordinate after multiplying by 100,000, producing bins of width 10⁻⁵ for deduplication. Two computed copies of a tile usually receive the same key. This is not exact symbolic equality: close values can straddle a bin boundary, and bins can merge sufficiently close distinct values.

Shared-edge matching uses Euclidean squared coordinate error ≤ 10⁻⁸. This identifies the same computed midpoint; it is not the game's hyperbolic distance measure. A measured run had maximum hyperboloid constraint residual |L(p,p)+1| around 1.82×10⁻¹² across its generated centers and vertices. That is an observation for this patch, not a universal error guarantee.

Useful invariants include:

- Points have Lorentz norm −1, frames remain orthogonal, and reflected edge endpoints agree.
- Neighbor links are reciprocal; tile IDs and occupied positions are unique.
- There are 109 tiles and 64 unique anchors; anchor pairs respect half-turn symmetry.
- Interior vertices have five incident tiles; boundary vertices can have fewer.
- No accepted action leaves the actor's king attacked.
- Geometry shifts preserve piece identities and enforce cooldown and king safety.

Standard move generation can be checked with **perft**, counting leaves in the legal-move tree:

\[
P(S,0)=1,\qquad P(S,d)=\sum_{m\in\mathcal L(S)}P(T(S,m),d-1).
\]

The current adapter test checks 20 opening moves and 400 depth-two leaves. The current suite has 33 tests, including special rules and curvature behavior. Tests provide evidence for covered cases, not a proof of every possible position or of strategic balance.

## 16. Judge questions and accurate answers

**“Is this merely a curved-looking ordinary chessboard?”**
No. The rules use a {4,5} tiling built from Lorentz reflections, with different adjacency and movement routes. Its bowl presentation is a separate distorted visualization.

**“Is the visible bowl itself negatively curved?”**
No. Its ordinary Euclidean Gaussian curvature is positive. The game geometry is negative under the Lorentz metric; the bowl does not preserve that metric.

**“What does curvature change for the player?”**
It changes legal routes and attacks, activates additional tiles, changes king neighborhood and pawn direction, and introduces a turn-cost decision about when to shift. The anchor assignment also affects the before/after relationships.

**“Can the player continuously tune curvature?”**
Currently there are two modes: flat and fixed K = −1 hyperbolic. The smooth transition is animation. Arbitrary continuous curvature is not implemented.

**“Are all piece paths mathematically straight?”**
Rook center rays are hyperbolic geodesics. Bishop, knight, and pawn rules are discrete game conventions. The drawn route lines are sampled visual guides.

**“Does your mapping preserve the original chessboard?”**
It preserves identities and exact half-turn pairing, and heuristically preserves broad placement. It does not preserve every distance or adjacency relation.

**“Why 109 tiles?”**
That is the result of a four-edge-ring finite patch. It is an implementation scale choice, not a uniquely correct board size.

**“What proves that this is a good strategy game?”**
The implementation demonstrates new legal options and meaningful costs. Competitive balance and depth still require playtesting; geometric correctness alone cannot establish them.

**“Is it complete official tournament chess?”**
Standard movement and special moves are implemented. The application uses automated draw policies and omits some tournament procedures. Curvature mode intentionally changes the rules.

## 17. A focused reading order

1. Refresh vectors, dot/cross products, matrices, radians, derivatives, and hyperbolic functions while working through sections 3–4 above.
2. Read [Hitchman's free Geometry with an Introduction to Cosmic Topology](https://mphitchman.com/geometry/frontmatter.html), especially hyperbolic geometry and §5.4. This is the approachable geometry foundation.
3. Read [Series's university notes](https://warwick.ac.uk/fac/sci/maths/people/staff/caroline_series/hyperbolic_geometry_ma448_lecture_notes.pdf), §0.3, §2.1, §2.2.13, and §3.2.5, for deeper proofs of the model, trigonometry, and reflections.
4. Read [MIT's BFS material](https://courses.csail.mit.edu/6.006/fall11/notes.shtml), lecture 13, then trace `createArena` with a small queue on paper.
5. Read the official [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html), [Raycaster](https://threejs.org/docs/pages/Raycaster.html), and [Quaternion](https://threejs.org/docs/pages/Quaternion.html) documentation beside the view code.
6. Read [chess.js](https://jhlywa.github.io/chess.js/) beside the standard adapter, particularly FEN, move generation, attacks, and draw methods.

You do not need general relativity, arbitrary manifold solvers, or a full differential-geometric transport engine to explain this implementation. Understanding Lorentz geometry, the discrete board graph, the explicit rules, and the display pipeline covers its mathematical foundation.
