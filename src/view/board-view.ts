import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { isInCheck, isShadow, type GameState, type GeometryMode, type MoveOption, type Piece } from "../shared/game.ts";
import { ARENA, edgeMidpoint, squareCoordinates, type HyperbolicTile, type SquareId, type Vector3 } from "../shared/geometry.ts";
import { pieceLetter } from "../shared/labels.ts";
import { displayNormal, toDisplayPoint } from "./hyperbolic-display.ts";
import { overviewDistance } from "./camera-fit.ts";
import { pawnForwardEdge } from "../shared/curvature-moves.ts";
import { routeLandings } from "./move-explanation.ts";
import { BOARD_THEME } from "./board-theme.ts";

const EDGE_STEPS = 8;
const EDGE_POINTS = EDGE_STEPS * 4;
const TILE_RING_STEPS = 6;
const TILE_TOP_POINT_COUNT = 1 + EDGE_POINTS * TILE_RING_STEPS;
const TILE_VERTEX_COUNT = TILE_TOP_POINT_COUNT + EDGE_POINTS;
const TILE_DEPTH = 0.12;
const FLAT_SPACING = 1.34;
const FLAT_HALF = 0.62;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

interface TileVisual {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  rim: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  flatBoundary: THREE.Vector3[];
  hyperBoundary: THREE.Vector3[];
  flatGrid: THREE.Vector3[];
  hyperGrid: THREE.Vector3[];
  flatCenter: THREE.Vector3;
  hyperCenter: THREE.Vector3;
  flatNormal: THREE.Vector3;
  hyperNormal: THREE.Vector3;
  label: THREE.Sprite | null;
}

export class BoardView {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly tileLayer = new THREE.Group();
  private readonly pieceLayer = new THREE.Group();
  private readonly routeLayer = new THREE.Group();
  private readonly markerLayer = new THREE.Group();
  private readonly selectionRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.065, 8, 40),
    new THREE.MeshBasicMaterial({ color: "#3c9de0", depthTest: false, transparent: true, opacity: 0.95 }),
  );
  private ground?: THREE.Mesh<THREE.CircleGeometry, THREE.MeshStandardMaterial>;
  private readonly tileVisuals = new Map<string, TileVisual>();
  private readonly pieceAssets = new Map<string, THREE.Group>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly onTilePicked: (tileId: string, pieceId: string | null) => void;
  private readonly resizeObserver: ResizeObserver;
  private state: GameState | null = null;
  private renderMode: GeometryMode = "flat";
  private selectedPieceId: string | null = null;
  private tutorialTileId: string | null = null;
  private legalMoves: MoveOption[] = [];
  private interactive = false;
  private morphFrom: GeometryMode = "flat";
  private morphStartedAt = 0;
  private isMorphing = false;
  private pressedAt: { x: number; y: number; button: number } | null = null;
  private overview = true;
  private projectionCenter: Vector3 | undefined;
  private pendingFocusId: string | null = null;
  private previewTileId: string | null = null;
  private hoveredTileId: string | null = null;
  private framedRadius: number | null = null;

  constructor(
    container: HTMLElement,
    onTilePicked: (tileId: string, pieceId: string | null) => void,
    private readonly onTileHovered: (tileId: string | null) => void = () => {},
    private readonly onFocusChanged: (tileId: string | null) => void = () => {},
  ) {
    this.onTilePicked = onTilePicked;
    this.scene.background = new THREE.Color("#d8dec4");
    this.scene.fog = new THREE.Fog("#d8dec4", 150, 650);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.08, 2000);
    this.camera.position.set(0, 12, 17);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.append(this.renderer.domElement);

    this.scene.add(this.tileLayer, this.routeLayer, this.markerLayer, this.pieceLayer, this.selectionRing);
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 10;
    this.addLighting();
    this.createTiles();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.rotateSpeed = 0.62;
    this.controls.panSpeed = 0.72;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 500;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener("start", () => { this.overview = false; this.framedRadius = null; });
    this.setOverviewPose("flat");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.attachPicking();
    this.animate();
  }

  setResetButton(button: HTMLButtonElement): void {
    button.addEventListener("click", () => {
      this.resetView();
    });
  }

  resetView(): void {
    this.pendingFocusId = null;
    this.reproject();
    this.onFocusChanged(null);
    this.setOverviewPose(this.renderMode);
  }

  setTheme(dark: boolean): void {
    const color = dark ? "#172632" : "#d8dec4";
    this.scene.background = new THREE.Color(color);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(color);
    this.ground?.material.color.set(color);
  }

  showWholeArena(): void {
    this.pendingFocusId = null;
    this.reproject();
    this.onFocusChanged(null);
    this.setOverviewPose(this.renderMode, true);
  }

  previewDestination(tileId: string | null): void {
    const next = this.legalMoves.some((move) => move.toTileId === tileId) ? tileId : null;
    if (next === this.previewTileId) return;
    this.previewTileId = next;
    this.applyTileStyles();
    this.rebuildRoutes();
  }

  showRoute(): void {
    const move = this.legalMoves.find((candidate) => candidate.toTileId === this.previewTileId);
    if (!move || this.isMorphing) return;
    const points = move.route.flatMap((tileId) => {
      const visual = this.tileVisuals.get(tileId)!;
      return this.renderMode === "flat" ? visual.flatBoundary : visual.hyperBoundary;
    });
    const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const radius = Math.max(...points.map((point) => point.distanceTo(center))) + 0.8;
    this.framedRadius = radius;
    this.overview = false;
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0, 1, 0.22).normalize().multiplyScalar(overviewDistance(radius, this.camera.fov, this.camera.aspect)));
    this.controls.update();
  }

  private reproject(focus?: Vector3): void {
    this.projectionCenter = focus;
    for (const [tileId, visual] of this.tileVisuals) {
      const hyper = hyperbolicTile(ARENA.tiles.get(tileId)!, focus);
      visual.hyperBoundary = hyper.boundary;
      visual.hyperGrid = hyper.grid;
      visual.hyperCenter = hyper.center;
      visual.hyperNormal = hyper.normal;
    }
    if (!this.isMorphing) this.updateTilePositions(1);
  }

  setTutorialTarget(tileId: string | null): void {
    this.tutorialTileId = tileId;
  }

  update(
    state: GameState,
    mode: GeometryMode,
    selectedPieceId: string | null,
    legalMoves: MoveOption[],
    interactive: boolean,
  ): void {
    if (mode !== this.renderMode) {
      if (this.isMorphing) this.updateTilePositions(1);
      this.morphFrom = this.renderMode;
      this.renderMode = mode;
      this.morphStartedAt = performance.now();
      this.isMorphing = true;
      this.pieceLayer.visible = false;
      this.routeLayer.visible = false;
      this.markerLayer.visible = false;
      this.pendingFocusId = null;
      if (mode === "hyperbolic") this.reproject();
      this.onFocusChanged(null);
      this.setOverviewPose(mode);
    }
    if (selectedPieceId !== this.selectedPieceId || state !== this.state) this.previewTileId = null;
    this.state = state;
    this.selectedPieceId = selectedPieceId;
    this.legalMoves = legalMoves;
    this.interactive = interactive;
    this.applyTileStyles();
    this.updateSelectionRing(this.isMorphing ? 0 : 1);
    this.rebuildRoutes();
    this.rebuildPieces();
  }

  focusTile(tileId: string): void {
    const visual = this.tileVisuals.get(tileId);
    if (!visual) return;
    if (this.isMorphing) { this.pendingFocusId = tileId; return; }
    this.overview = false;
    if (this.renderMode === "hyperbolic") {
      this.reproject(ARENA.tiles.get(tileId)!.center);
      this.onFocusChanged(tileId);
      this.framedRadius = 4.2;
    }
    const position = this.getTilePosition(visual);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const desiredDistance = this.renderMode === "hyperbolic"
      ? overviewDistance(4.2, this.camera.fov, this.camera.aspect)
      : offset.length();
    if (this.renderMode === "hyperbolic") offset.set(0, 1, 0.22);
    offset.setLength(desiredDistance);
    this.camera.position.copy(position).add(offset);
    this.controls.target.copy(position);
    this.controls.update();
  }

  private setOverviewPose(mode: GeometryMode, preserveDirection = false): void {
    this.overview = true;
    this.framedRadius = null;
    const priorDirection = this.camera.position.clone().sub(this.controls.target).normalize();
    const bounds = new THREE.Box3();
    const boundary: THREE.Vector3[] = [];
    for (const [tileId, visual] of this.tileVisuals) {
      if (mode === "flat" && !ARENA.flatSquareByTile.has(tileId)) continue;
      for (const point of mode === "flat" ? visual.flatBoundary : visual.hyperBoundary) { bounds.expandByPoint(point); boundary.push(point); }
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(...boundary.map((point) => point.distanceTo(sphere.center)));
    this.controls.target.copy(sphere.center);
    const direction = preserveDirection
      ? priorDirection
      : mode === "hyperbolic" ? new THREE.Vector3(0, 1, 0.22).normalize() : new THREE.Vector3(0, 12, 17).normalize();
    const distance = overviewDistance(sphere.radius + 1, this.camera.fov, this.camera.aspect);
    this.controls.maxDistance = Math.max(500, distance * 2);
    this.camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    this.controls.update();
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight("#f7faf2", "#627984", 2.25));
    const key = new THREE.DirectionalLight("#fff5e8", 2.1);
    key.position.set(-7, 17, 9);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight("#9ccac7", 0.7);
    fill.position.set(10, 6, -8);
    this.scene.add(fill);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(66, 96),
      new THREE.MeshStandardMaterial({ color: "#d8dec4", roughness: 0.98, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.56;
    ground.receiveShadow = false;
    this.scene.add(ground);
    this.ground = ground;
  }

  private createTiles(): void {
    for (const tile of ARENA.tiles.values()) {
      const square = ARENA.flatSquareByTile.get(tile.id);
      const flat = square ? flatTile(square) : flatTrayTile(tile.id);
      const hyper = hyperbolicTile(tile);
      const flatGrid = radialGrid(flat.center, flat.boundary);
      const color = baseColor(tile.id);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: "#000000",
        roughness: 0.9,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      const geometry = tileGeometry(flatGrid, flat.boundary, flat.center, flat.normal);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.tileId = tile.id;
      mesh.visible = square !== undefined;
      this.tileLayer.add(mesh);

      const rimGeometry = new THREE.BufferGeometry().setFromPoints(flat.boundary);
      const rimMaterial = new THREE.LineBasicMaterial({ color: square ? BOARD_THEME.rim : BOARD_THEME.extraRim, transparent: true, opacity: 0.65 });
      const rim = new THREE.LineLoop(rimGeometry, rimMaterial);
      rim.visible = square !== undefined;
      this.tileLayer.add(rim);

      const label = square ? this.makeTileLabel(square) : null;
      if (label) {
        placeTileLabel(label, flat.center, flat.boundary[0], flat.normal, 1);
        this.scene.add(label);
      }
      this.tileVisuals.set(tile.id, {
        mesh,
        rim,
        flatBoundary: flat.boundary,
        hyperBoundary: hyper.boundary,
        flatGrid,
        hyperGrid: hyper.grid,
        flatCenter: flat.center,
        hyperCenter: hyper.center,
        flatNormal: flat.normal,
        hyperNormal: hyper.normal,
        label,
      });
    }
  }

  private makeTileLabel(square: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas text labels are unavailable.");
    context.beginPath();
    roundedRect(context, 13, 27, 102, 74, 20);
    context.fillStyle = "rgba(18, 55, 40, 0.94)";
    context.fill();
    context.strokeStyle = "rgba(239, 242, 229, .3)";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = BOARD_THEME.light;
    context.font = "600 34px Avenir Next, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(square.toUpperCase(), 64, 65);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true }));
    sprite.scale.set(0.49, 0.49, 1);
    sprite.userData.square = square;
    return sprite;
  }

  private applyTileStyles(): void {
    if (!this.state) return;
    const selected = this.state.pieces.find((piece) => piece.id === this.selectedPieceId);
    const activeKing = this.state.pieces.find((piece) => piece.type === "king" && piece.side === this.state!.activePlayer);
    const destinations = new Set(this.legalMoves.map((move) => move.toTileId));
    const activeRoute = this.legalMoves.find((move) => move.toTileId === this.previewTileId);
    const routeTiles = new Set(activeRoute?.route ?? []);
    const kingThreatened = activeKing ? isInCheck(this.state, activeKing.side) : false;
    for (const [tileId, visual] of this.tileVisuals) {
      const isSelected = selected?.tileId === tileId;
      const isDestination = destinations.has(tileId);
      const isRoute = routeTiles.has(tileId) && !isSelected && !isDestination;
      const isThreatenedKing = activeKing?.tileId === tileId && kingThreatened;
      const isTutorialTarget = tileId === this.tutorialTileId;
      const extra = !ARENA.flatSquareByTile.has(tileId);
      const color = isThreatenedKing ? BOARD_THEME.capture : isSelected ? BOARD_THEME.selected
        : isDestination ? extra ? BOARD_THEME.extraDestination : BOARD_THEME.destination
        : isRoute ? extra ? BOARD_THEME.extraRoute : BOARD_THEME.route : isTutorialTarget ? BOARD_THEME.route : null;
      visual.mesh.material.color.set(color ?? baseColor(tileId));
      visual.mesh.material.emissive.set(color ?? "#000000");
      visual.mesh.material.emissiveIntensity = isSelected ? 0.28 : isDestination ? 0.17 : isRoute ? 0.08 : isThreatenedKing || isTutorialTarget ? 0.18 : 0;
      visual.rim.material.color.set(isSelected ? BOARD_THEME.selectedRim : isDestination ? extra ? BOARD_THEME.extraDestinationRim : BOARD_THEME.destinationRim : extra ? BOARD_THEME.extraRim : BOARD_THEME.rim);
      visual.rim.material.opacity = isSelected || isDestination ? 0.96 : isRoute || isTutorialTarget ? 0.8 : 0.43;
    }
  }

  private rebuildRoutes(): void {
    clearGroup(this.routeLayer);
    clearGroup(this.markerLayer);
    const selected = this.state?.pieces.find((piece) => piece.id === this.selectedPieceId);
    if (!selected) return;
    const moves = [...new Map(this.legalMoves.map((move) => [move.toTileId, move])).values()];
    for (const move of moves) {
      const active = move.toTileId === this.previewTileId;
      this.addDestinationMarker(move, active);
      if (active) {
        this.addRouteGuide(selected, move);
        this.addArrivalGhost(selected, move.toTileId);
      }
    }
    if (selected.type === "pawn" && this.renderMode === "hyperbolic") {
      const tile = ARENA.tiles.get(selected.tileId)!;
      const from = toDisplayPoint(tile.center, this.projectionCenter).add(new THREE.Vector3(0, 0.2, 0));
      const to = toDisplayPoint(edgeMidpoint(tile.vertices, pawnForwardEdge(selected, ARENA)), this.projectionCenter).add(new THREE.Vector3(0, 0.2, 0));
      const direction = to.clone().sub(from);
      this.routeLayer.add(new THREE.ArrowHelper(direction.clone().normalize(), from, direction.length(), "#096759", 0.22, 0.18));
    }
  }

  private addDestinationMarker(move: MoveOption, active: boolean): void {
    const destination = this.tileVisuals.get(move.toTileId)!;
    const capture = this.state!.pieces.some((piece) => piece.tileId === move.toTileId);
    const extra = !ARENA.flatSquareByTile.has(move.toTileId);
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(active ? 0.37 : 0.29, 0.055, 6, 24),
      new THREE.MeshBasicMaterial({ color: capture ? BOARD_THEME.capture : extra ? BOARD_THEME.extraDestinationRim : BOARD_THEME.moveMarker, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    marker.position.copy(this.getTilePosition(destination)).addScaledVector(this.getTileNormal(destination), 0.1);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.getTileNormal(destination));
    marker.scale.setScalar(localScale(destination, this.renderMode));
    marker.userData.tileId = move.toTileId;
    this.markerLayer.add(marker);
    if (extra) {
      // A second ring identifies a curved-only destination even without color.
      const outer = new THREE.Mesh(new THREE.TorusGeometry(active ? 0.47 : 0.39, 0.025, 6, 24),
        new THREE.MeshBasicMaterial({ color: BOARD_THEME.extraDestinationRim, depthTest: false }));
      outer.position.copy(marker.position);
      outer.quaternion.copy(marker.quaternion);
      outer.scale.copy(marker.scale);
      outer.userData.tileId = move.toTileId;
      this.markerLayer.add(outer);
    }
  }

  private addRouteGuide(piece: Piece, move: MoveOption): void {
    const points = routeDisplayPoints(move.route, this.renderMode, this.projectionCenter);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = this.renderMode === "hyperbolic"
      ? new THREE.LineDashedMaterial({ color: "#9a3d19", dashSize: 0.18, gapSize: 0.06, depthTest: false })
      : new THREE.LineBasicMaterial({ color: "#9a3d19", depthTest: false });
    const line = new THREE.Line(geometry, material);
    if (material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
    this.routeLayer.add(line);
    const landings = new Set(this.renderMode === "hyperbolic" ? routeLandings(piece, move) : move.route.map((_, index) => index));
    for (let index = 1; index < move.route.length - 1; index++) {
      const landing = landings.has(index);
      const guide = new THREE.Mesh(
        landing ? new THREE.TorusGeometry(0.17, 0.035, 6, 16) : new THREE.SphereGeometry(0.07, 8, 6),
        new THREE.MeshBasicMaterial({ color: "#9a3d19", depthTest: false }),
      );
      guide.position.copy(tileCenter(move.route[index], this.renderMode, this.projectionCenter)!).add(new THREE.Vector3(0, 0.15, 0));
      if (landing) guide.rotation.x = -Math.PI / 2;
      this.routeLayer.add(guide);
    }
    for (let index = 1; index < move.route.length; index++) {
      const from = tileCenter(move.route[index - 1], this.renderMode, this.projectionCenter)!;
      const to = tileCenter(move.route[index], this.renderMode, this.projectionCenter)!;
      const direction = to.clone().sub(from);
      const arrow = new THREE.ArrowHelper(
        direction.clone().normalize(), from.clone().lerp(to, 0.55).add(new THREE.Vector3(0, 0.15, 0)),
        Math.min(0.38, direction.length() * 0.3), "#9a3d19", 0.16, 0.12,
      );
      this.routeLayer.add(arrow);
    }
  }

  private addArrivalGhost(piece: Piece, tileId: string): void {
    const destination = this.tileVisuals.get(tileId)!;
    const ghost = this.makePiece(piece);
    ghost.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = 0.38;
        material.depthWrite = false;
      }
    });
    ghost.position.copy(this.getTilePosition(destination)).addScaledVector(this.getTileNormal(destination), 0.1);
    ghost.scale.setScalar(localScale(destination, this.renderMode));
    ghost.quaternion.setFromUnitVectors(WORLD_UP, this.getTileNormal(destination));
    this.routeLayer.add(ghost);
  }

  private rebuildPieces(): void {
    if (!this.state) return;
    const visiblePieces = new Set(this.state.pieces.filter((piece) => !isShadow(piece, this.renderMode)).map((piece) => piece.id));
    for (const [pieceId, group] of this.pieceAssets) {
      if (visiblePieces.has(pieceId)) continue;
      this.pieceLayer.remove(group);
      this.pieceAssets.delete(pieceId);
      disposeObject(group);
    }
    for (const piece of this.state.pieces) {
      if (isShadow(piece, this.renderMode)) continue;
      const visual = this.tileVisuals.get(piece.tileId);
      if (!visual) continue;
      const normal = this.getTileNormal(visual);
      const scale = localScale(visual, this.renderMode);
      let group = this.pieceAssets.get(piece.id);
      if (group && group.userData.pieceType !== piece.type) {
        this.pieceLayer.remove(group);
        disposeObject(group);
        group = undefined;
      }
      if (!group) {
        group = this.makePiece(piece);
        group.userData.pieceType = piece.type;
        this.pieceAssets.set(piece.id, group);
      }
      group.scale.setScalar(scale);
      group.position.copy(this.getTilePosition(visual)).addScaledVector(normal, 0.085 * scale);
      group.quaternion.setFromUnitVectors(WORLD_UP, normal);
      group.userData.pieceId = piece.id;
      group.userData.tileId = piece.tileId;
      this.pieceLayer.add(group);
    }
  }

  private makePiece(piece: Piece): THREE.Group {
    const group = new THREE.Group();
    const isWhite = piece.side === "white";
    const mainColor = isWhite ? "#e8e2d5" : "#263f51";
    const edgeColor = isWhite ? "#81979a" : "#8cc4bb";
    const material = new THREE.MeshStandardMaterial({ color: mainColor, roughness: 0.39, metalness: 0.22, flatShading: true });
    const trim = new THREE.MeshStandardMaterial({ color: edgeColor, roughness: 0.36, metalness: 0.42 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.12, 10), trim);
    base.position.y = 0.07;
    group.add(base);

    let body: THREE.Mesh;
    if (piece.type === "king") {
      body = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), material);
      body.position.y = 0.38;
      const cross = new THREE.Group();
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.28, 0.055), trim);
      upright.position.y = 0.65;
      const arms = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.055), trim);
      arms.position.y = 0.69;
      cross.add(upright, arms);
      group.add(body, cross);
    } else if (piece.type === "rook") {
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.36, 4), material);
      body.rotation.y = Math.PI / 4;
      body.position.y = 0.33;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.25, 0.11, 4), trim);
      crown.rotation.y = Math.PI / 4;
      crown.position.y = 0.56;
      group.add(body, crown);
    } else if (piece.type === "knight") {
      body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.29, 0), material);
      body.rotation.z = -0.24;
      body.scale.y = 1.27;
      body.position.y = 0.39;
      group.add(body);
    } else if (piece.type === "pawn") {
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.23, 0.3, 12), material);
      body.position.y = 0.28;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), material);
      head.position.y = 0.51;
      group.add(body, head);
    } else if (piece.type === "queen") {
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.28, 0.43, 12), material);
      body.position.y = 0.34;
      const crown = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 12), trim);
      crown.rotation.x = Math.PI / 2;
      crown.position.y = 0.61;
      group.add(body, crown);
      for (let index = 0; index < 5; index++) {
        const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), trim);
        jewel.position.set(Math.cos(index * Math.PI * 2 / 5) * 0.22, 0.68, Math.sin(index * Math.PI * 2 / 5) * 0.22);
        group.add(jewel);
      }
    } else {
      body = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.49, 4, 1), material);
      body.rotation.y = Math.PI / 4;
      body.position.y = 0.37;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 5, 12), trim);
      band.rotation.x = Math.PI / 2;
      band.position.y = 0.25;
      group.add(body, band);
    }
    const tag = this.makePieceLabel(piece.type, isWhite);
    tag.position.y = piece.type === "king" ? 0.91 : 0.8;
    group.add(tag);
    return group;
  }

  private makePieceLabel(type: Piece["type"], isWhite: boolean): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas piece labels are unavailable.");
    context.beginPath();
    context.arc(48, 48, 39, 0, Math.PI * 2);
    context.fillStyle = isWhite ? "#273f4b" : "#e3e8de";
    context.fill();
    context.strokeStyle = isWhite ? "#e3e8de" : "#425867";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = isWhite ? "#f2eee3" : "#203b4b";
    context.font = "700 48px Avenir Next, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(pieceLetter(type), 48, 51);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.32, 0.32, 1);
    return sprite;
  }

  private getTilePosition(visual: TileVisual): THREE.Vector3 {
    return this.renderMode === "flat" ? visual.flatCenter : visual.hyperCenter;
  }

  private getTileNormal(visual: TileVisual): THREE.Vector3 {
    return this.renderMode === "flat" ? visual.flatNormal : visual.hyperNormal;
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    if (this.isMorphing) {
      const progress = THREE.MathUtils.clamp((performance.now() - this.morphStartedAt) / 760, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      this.updateTilePositions(eased);
      if (progress >= 1) {
        this.isMorphing = false;
        this.pieceLayer.visible = true;
        this.routeLayer.visible = true;
        this.markerLayer.visible = true;
        if (this.pendingFocusId) {
          const tileId = this.pendingFocusId;
          this.pendingFocusId = null;
          this.focusTile(tileId);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateTilePositions(progress = 1): void {
    for (const [tileId, visual] of this.tileVisuals) {
      const isAnchor = ARENA.flatSquareByTile.has(tileId);
      const fromFlat = this.morphFrom === "flat";
      const fromGrid = fromFlat ? visual.flatGrid : visual.hyperGrid;
      const toGrid = this.renderMode === "flat" ? visual.flatGrid : visual.hyperGrid;
      const fromCenter = fromFlat ? visual.flatCenter : visual.hyperCenter;
      const toCenter = this.renderMode === "flat" ? visual.flatCenter : visual.hyperCenter;
      const fromNormal = fromFlat ? visual.flatNormal : visual.hyperNormal;
      const toNormal = this.renderMode === "flat" ? visual.flatNormal : visual.hyperNormal;
      const center = fromCenter.clone().lerp(toCenter, progress);
      const normal = fromNormal.clone().lerp(toNormal, progress).normalize();
      const positions = new Float32Array(TILE_VERTEX_COUNT * 3);
      writeVector(positions, 0, center);
      const boundary: THREE.Vector3[] = new Array(EDGE_POINTS);
      for (let index = 0; index < fromGrid.length; index += 1) {
        const point = fromGrid[index].clone().lerp(toGrid[index], progress);
        writeVector(positions, 1 + index, point);
        if (index >= fromGrid.length - EDGE_POINTS) boundary[index - (fromGrid.length - EDGE_POINTS)] = point;
      }
      for (let index = 0; index < EDGE_POINTS; index += 1) {
        writeVector(positions, TILE_TOP_POINT_COUNT + index, boundary[index].clone().addScaledVector(normal, -TILE_DEPTH));
      }
      const positionAttribute = visual.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      positionAttribute.array.set(positions);
      positionAttribute.needsUpdate = true;
      visual.mesh.geometry.computeVertexNormals();
      visual.mesh.geometry.computeBoundingSphere();
      const rimAttribute = visual.rim.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < EDGE_POINTS; index += 1) {
        const lifted = boundary[index].clone().addScaledVector(normal, 0.012);
        rimAttribute.setXYZ(index, lifted.x, lifted.y, lifted.z);
      }
      rimAttribute.needsUpdate = true;
      visual.rim.geometry.computeBoundingSphere();
      visual.mesh.visible = this.renderMode === "hyperbolic" || isAnchor;
      visual.rim.visible = visual.mesh.visible;
      if (visual.label) {
        visual.label.visible = this.renderMode === "hyperbolic" || isAnchor;
        placeTileLabel(visual.label, center, boundary[0], normal, localScale(visual, this.renderMode));
      }
    }
    this.rebuildPieces();
    if (this.legalMoves.length) this.rebuildRoutes();
    this.updateSelectionRing(progress);
  }

  private updateSelectionRing(progress: number): void {
    const piece = this.state?.pieces.find((candidate) => candidate.id === this.selectedPieceId);
    const tileId = piece && !isShadow(piece, this.renderMode) ? piece.tileId : null;
    const visual = tileId ? this.tileVisuals.get(tileId) : undefined;
    this.selectionRing.visible = !!visual;
    if (!visual) return;
    const fromCenter = this.morphFrom === "flat" ? visual.flatCenter : visual.hyperCenter;
    const toCenter = this.renderMode === "flat" ? visual.flatCenter : visual.hyperCenter;
    const fromNormal = this.morphFrom === "flat" ? visual.flatNormal : visual.hyperNormal;
    const toNormal = this.renderMode === "flat" ? visual.flatNormal : visual.hyperNormal;
    const amount = this.isMorphing ? progress : 1;
    const normal = fromNormal.clone().lerp(toNormal, amount).normalize();
    const scale = THREE.MathUtils.lerp(localScale(visual, this.morphFrom), localScale(visual, this.renderMode), amount);
    this.selectionRing.position.copy(fromCenter).lerp(toCenter, amount).addScaledVector(normal, 0.16 * scale);
    this.selectionRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    this.selectionRing.scale.setScalar(scale);
  }

  private attachPicking(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.pressedAt = { x: event.clientX, y: event.clientY, button: event.button };
    });
    canvas.addEventListener("pointerup", (event) => {
      if (!this.pressedAt || this.pressedAt.button !== 0 || !this.interactive || this.isMorphing) {
        this.pressedAt = null;
        return;
      }
      const moved = Math.hypot(event.clientX - this.pressedAt.x, event.clientY - this.pressedAt.y);
      this.pressedAt = null;
      if (moved > 5) return;
      const hit = this.pick(event);
      if (hit) this.onTilePicked(hit.tileId, hit.pieceId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.pressedAt || !this.interactive || this.isMorphing) return;
      const tileId = this.pick(event)?.tileId ?? null;
      if (tileId === this.hoveredTileId) return;
      this.hoveredTileId = tileId;
      canvas.style.cursor = tileId ? "pointer" : "grab";
      this.onTileHovered(tileId);
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerleave", () => { this.pressedAt = null; this.hoveredTileId = null; this.onTileHovered(null); });
    canvas.addEventListener("pointercancel", () => { this.pressedAt = null; });
  }

  private pick(event: PointerEvent): { tileId: string; pieceId: string | null } | null {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, 1 - ((event.clientY - bounds.top) / bounds.height) * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([this.pieceLayer, this.markerLayer, this.tileLayer], true);
    const hit = hits.find((item) => {
      for (let object: THREE.Object3D | null = item.object; object; object = object.parent) if (!object.visible) return false;
      return !!findData(item.object, "tileId");
    });
    if (!hit) return null;
    const tileId = findData(hit.object, "tileId"), pieceId = findData(hit.object, "pieceId");
    return typeof tileId === "string" ? { tileId, pieceId: typeof pieceId === "string" ? pieceId : null } : null;
  }

  private resize(): void {
    const rect = this.renderer.domElement.parentElement?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    if (this.overview) this.setOverviewPose(this.renderMode);
    else if (this.framedRadius) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      offset.setLength(overviewDistance(this.framedRadius, this.camera.fov, this.camera.aspect));
      this.camera.position.copy(this.controls.target).add(offset);
      this.controls.update();
    }
  }
}

function flatTile(square: SquareId): { boundary: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 } {
  const { row, col } = squareCoordinates(square);
  const center = new THREE.Vector3((col - 3.5) * FLAT_SPACING, 0.13, (row - 3.5) * FLAT_SPACING);
  const x = center.x;
  const z = center.z;
  const corners = [
    new THREE.Vector3(x - FLAT_HALF, 0.13, z - FLAT_HALF),
    new THREE.Vector3(x - FLAT_HALF, 0.13, z + FLAT_HALF),
    new THREE.Vector3(x + FLAT_HALF, 0.13, z + FLAT_HALF),
    new THREE.Vector3(x + FLAT_HALF, 0.13, z - FLAT_HALF),
  ];
  return { boundary: interpolateCorners(corners), center, normal: WORLD_UP.clone() };
}

function flatTrayTile(tileId: string): { boundary: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 } {
  const index = Number(tileId.slice(2));
  const center = new THREE.Vector3(8 + (index % 6) * 1.2, -0.3, -8 + Math.floor(index / 6) * 1.2);
  const corners = [
    new THREE.Vector3(center.x - 0.48, center.y, center.z - 0.48),
    new THREE.Vector3(center.x - 0.48, center.y, center.z + 0.48),
    new THREE.Vector3(center.x + 0.48, center.y, center.z + 0.48),
    new THREE.Vector3(center.x + 0.48, center.y, center.z - 0.48),
  ];
  return { boundary: interpolateCorners(corners), center, normal: WORLD_UP.clone() };
}

function interpolateCorners(corners: THREE.Vector3[]): THREE.Vector3[] {
  const boundary: THREE.Vector3[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const first = corners[edge];
    const second = corners[(edge + 1) % 4];
    for (let step = 0; step < EDGE_STEPS; step += 1) boundary.push(first.clone().lerp(second, step / EDGE_STEPS));
  }
  return boundary;
}

function hyperbolicTile(tile: HyperbolicTile, focus?: Vector3): { boundary: THREE.Vector3[]; grid: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 } {
  const boundary: THREE.Vector3[] = [];
  const modelBoundary: Vector3[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const first = tile.vertices[edge];
    const second = tile.vertices[(edge + 1) % 4];
    for (let step = 0; step < EDGE_STEPS; step += 1) {
      const point = geodesicPoint(first, second, step / EDGE_STEPS);
      modelBoundary.push(point);
      boundary.push(toDisplayPoint(point, focus));
    }
  }
  const center = toDisplayPoint(tile.center, focus);
  const normal = displayNormal(tile.center, focus);
  const grid: THREE.Vector3[] = [];
  for (let ring = 1; ring <= TILE_RING_STEPS; ring += 1) {
    const progress = ring / TILE_RING_STEPS;
    for (const point of modelBoundary) grid.push(toDisplayPoint(geodesicPoint(tile.center, point, progress), focus));
  }
  return { boundary, grid, center, normal };
}

function radialGrid(center: THREE.Vector3, boundary: THREE.Vector3[]): THREE.Vector3[] {
  const grid: THREE.Vector3[] = [];
  for (let ring = 1; ring <= TILE_RING_STEPS; ring += 1) {
    const progress = ring / TILE_RING_STEPS;
    for (const point of boundary) grid.push(center.clone().lerp(point, progress));
  }
  return grid;
}

function tileGeometry(grid: THREE.Vector3[], boundary: THREE.Vector3[], center: THREE.Vector3, normal: THREE.Vector3): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(TILE_VERTEX_COUNT * 3);
  writeVector(positions, 0, center);
  for (let index = 0; index < grid.length; index += 1) writeVector(positions, 1 + index, grid[index]);
  for (let index = 0; index < EDGE_POINTS; index += 1) {
    writeVector(positions, TILE_TOP_POINT_COUNT + index, boundary[index].clone().addScaledVector(normal, -TILE_DEPTH));
  }
  const indices: number[] = [];
  for (let ring = 0; ring < TILE_RING_STEPS; ring += 1) {
    const currentBase = ring === 0 ? 0 : 1 + (ring - 1) * EDGE_POINTS;
    const nextBase = 1 + ring * EDGE_POINTS;
    for (let index = 0; index < EDGE_POINTS; index += 1) {
      const next = (index + 1) % EDGE_POINTS;
      if (ring === 0) {
        indices.push(0, nextBase + index, nextBase + next);
      } else {
        const current = currentBase + index;
        const currentNext = currentBase + next;
        const outer = nextBase + index;
        const outerNext = nextBase + next;
        indices.push(current, outer, outerNext, current, outerNext, currentNext);
      }
    }
  }
  const boundaryBase = 1 + (TILE_RING_STEPS - 1) * EDGE_POINTS;
  const bottomBase = TILE_TOP_POINT_COUNT;
  for (let index = 0; index < EDGE_POINTS; index += 1) {
    const next = (index + 1) % EDGE_POINTS;
    const topA = boundaryBase + index;
    const topB = boundaryBase + next;
    const bottomA = bottomBase + index;
    const bottomB = bottomBase + next;
    indices.push(topA, bottomA, topB, topB, bottomA, bottomB);
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function routeDisplayPoints(route: string[], mode: GeometryMode, focus?: Vector3): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let index = 0; index < route.length; index += 1) {
    const currentId = route[index];
    const current = ARENA.tiles.get(currentId);
    const visualCenter = currentId ? tileCenter(currentId, mode, focus) : null;
    if (!visualCenter) continue;
    if (index === 0) result.push(visualCenter);
    const nextId = route[index + 1];
    if (!nextId) continue;
    if (mode === "hyperbolic" && current) {
      const exitEdge = current.neighbors.findIndex((candidate) => candidate?.tileId === nextId);
      const nextTile = ARENA.tiles.get(nextId);
      if (exitEdge >= 0 && nextTile) {
        const midpoint = edgeMidpoint(current.vertices, exitEdge);
        result.push(toDisplayPoint(midpoint, focus));
      }
    }
    result.push(tileCenter(nextId, mode, focus) ?? visualCenter);
  }
  return result.map((point) => point.clone().add(new THREE.Vector3(0, 0.06, 0)));
}

function tileCenter(tileId: string, mode: GeometryMode, focus?: Vector3): THREE.Vector3 | null {
  const tile = ARENA.tiles.get(tileId);
  if (!tile) return null;
  if (mode === "hyperbolic") return toDisplayPoint(tile.center, focus);
  const square = ARENA.flatSquareByTile.get(tileId);
  if (!square) return null;
  const { row, col } = squareCoordinates(square);
  return new THREE.Vector3((col - 3.5) * FLAT_SPACING, 0.14, (row - 3.5) * FLAT_SPACING);
}

function geodesicPoint(first: Vector3, second: Vector3, progress: number): Vector3 {
  const product = first.x * second.x + first.y * second.y - first.z * second.z;
  const distance = Math.acosh(Math.max(1, -product));
  if (distance < 1e-6) return first;
  const divisor = Math.sinh(distance);
  const firstScale = Math.sinh((1 - progress) * distance) / divisor;
  const secondScale = Math.sinh(progress * distance) / divisor;
  return {
    x: firstScale * first.x + secondScale * second.x,
    y: firstScale * first.y + secondScale * second.y,
    z: firstScale * first.z + secondScale * second.z,
  };
}

function localScale(visual: TileVisual, mode: GeometryMode): number {
  if (mode === "flat") return 1;
  const radius = Math.min(...visual.hyperBoundary.map((point) => point.distanceTo(visual.hyperCenter)));
  return THREE.MathUtils.clamp(radius / 0.5, 0.12, 2);
}

function baseColor(tileId: string): string {
  const square = ARENA.flatSquareByTile.get(tileId);
  return square ? anchorColor(square) : BOARD_THEME.extra;
}

function anchorColor(square: SquareId): string {
  const { row, col } = squareCoordinates(square);
  return (row + col) % 2 === 0 ? BOARD_THEME.light : BOARD_THEME.dark;
}

function placeTileLabel(label: THREE.Sprite, center: THREE.Vector3, corner: THREE.Vector3, normal: THREE.Vector3, scale: number): void {
  label.position.copy(center).lerp(corner, 0.55).addScaledVector(normal, 0.18 * scale);
  label.scale.set(0.49 * scale, 0.49 * scale, 1);
}

function writeVector(target: Float32Array, index: number, vector: THREE.Vector3): void {
  const offset = index * 3;
  target[offset] = vector.x;
  target[offset + 1] = vector.y;
  target[offset + 2] = vector.z;
}

function findData(object: THREE.Object3D, key: string): unknown {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData[key] !== undefined) return current.userData[key];
    current = current.parent;
  }
  return undefined;
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
      if (!(object instanceof THREE.Sprite)) object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose();
        material.dispose();
      }
    }
  });
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
