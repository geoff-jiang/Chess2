import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { isInCheck, isShadow, type GameState, type GeometryMode, type MoveOption, type Piece } from "../shared/game.ts";
import { ARENA, edgeMidpoint, squareCoordinates, type HyperbolicTile, type SquareId, type Vector3 } from "../shared/geometry.ts";
import { pieceLetter } from "../shared/labels.ts";
import { displayNormal, toDisplayPoint } from "./hyperbolic-display.ts";
import { overviewDistance } from "./camera-fit.ts";

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
  private readonly tileVisuals = new Map<string, TileVisual>();
  private readonly pieceMeshes = new Map<string, THREE.Group>();
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
  private focusedTileId: string | null = null;
  private pressedAt: { x: number; y: number; button: number } | null = null;
  private resetButton: HTMLButtonElement | null = null;
  private overview = true;
  private wholeArena = false;

  constructor(container: HTMLElement, onTilePicked: (tileId: string, pieceId: string | null) => void) {
    this.onTilePicked = onTilePicked;
    this.scene.background = new THREE.Color("#dce4e4");
    this.scene.fog = new THREE.Fog("#dce4e4", 150, 650);
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

    this.scene.add(this.tileLayer, this.routeLayer, this.markerLayer, this.pieceLayer);
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
    this.controls.addEventListener("start", () => { this.overview = false; });
    this.setOverviewPose("flat");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.attachPicking();
    this.animate();
  }

  setResetButton(button: HTMLButtonElement): void {
    this.resetButton = button;
    button.addEventListener("click", () => {
      this.focusedTileId = null;
      this.setOverviewPose(this.renderMode);
    });
  }

  showWholeArena(): void {
    this.focusedTileId = null;
    this.setOverviewPose("hyperbolic", true);
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
      this.focusedTileId = null;
      this.setOverviewPose(mode);
    }
    this.state = state;
    this.selectedPieceId = selectedPieceId;
    this.legalMoves = legalMoves;
    this.interactive = interactive;
    this.applyTileStyles();
    this.rebuildRoutes();
    this.rebuildPieces();
  }

  focusTile(tileId: string): void {
    const visual = this.tileVisuals.get(tileId);
    if (!visual) return;
    this.overview = false;
    this.focusedTileId = tileId;
    const position = this.getTilePosition(visual);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const desiredDistance = this.renderMode === "hyperbolic"
      ? overviewDistance(Math.max(1, localScale(visual, this.renderMode) * 2), this.camera.fov, this.camera.aspect)
      : offset.length();
    offset.setLength(desiredDistance);
    this.camera.position.copy(position).add(offset);
    this.controls.target.copy(position);
    this.controls.update();
  }

  private setOverviewPose(mode: GeometryMode, wholeArena = false): void {
    this.overview = true;
    this.wholeArena = wholeArena;
    const bounds = new THREE.Box3();
    for (const [tileId, visual] of this.tileVisuals) {
      if (mode === "flat" && !ARENA.flatSquareByTile.has(tileId)) continue;
      for (const point of mode === "flat" ? visual.flatBoundary : visual.hyperBoundary) bounds.expandByPoint(point);
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    this.controls.target.copy(sphere.center);
    const direction = mode === "hyperbolic"
      ? wholeArena ? new THREE.Vector3(0, 0.97, 0.25).normalize() : new THREE.Vector3(0, 0.72, 0.69).normalize()
      : new THREE.Vector3(0, 12, 17).normalize();
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
      new THREE.MeshStandardMaterial({ color: "#dce4e4", roughness: 0.98, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.56;
    ground.receiveShadow = false;
    this.scene.add(ground);
  }

  private createTiles(): void {
    for (const tile of ARENA.tiles.values()) {
      const square = ARENA.flatSquareByTile.get(tile.id);
      const flat = square ? flatTile(square) : flatTrayTile(tile.id);
      const hyper = hyperbolicTile(tile);
      const flatGrid = radialGrid(flat.center, flat.boundary);
      const color = square ? anchorColor(square) : "#70858a";
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: "#000000",
        roughness: 0.77,
        metalness: 0.06,
        side: THREE.DoubleSide,
      });
      const geometry = tileGeometry(flatGrid, flat.boundary, flat.center, flat.normal);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.tileId = tile.id;
      mesh.visible = square !== undefined;
      this.tileLayer.add(mesh);

      const rimGeometry = new THREE.BufferGeometry().setFromPoints(flat.boundary);
      const rimMaterial = new THREE.LineBasicMaterial({ color: square ? "#526f76" : "#3a5864", transparent: true, opacity: square ? 0.43 : 0.56 });
      const rim = new THREE.LineLoop(rimGeometry, rimMaterial);
      rim.visible = square !== undefined;
      this.tileLayer.add(rim);

      const label = square ? this.makeTileLabel(square) : null;
      if (label) this.scene.add(label);
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

  private makeTileLabel(square: SquareId): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas text labels are unavailable.");
    context.beginPath();
    roundedRect(context, 13, 27, 102, 74, 20);
    context.fillStyle = "rgba(28, 52, 64, 0.82)";
    context.fill();
    context.strokeStyle = "rgba(239, 242, 229, .3)";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = "#f2f1e7";
    context.font = "600 34px Avenir Next, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(square.toUpperCase(), 64, 65);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true, opacity: 0.76 }));
    sprite.scale.set(0.49, 0.49, 1);
    sprite.userData.square = square;
    return sprite;
  }

  private applyTileStyles(): void {
    if (!this.state) return;
    const selected = this.state.pieces.find((piece) => piece.id === this.selectedPieceId);
    const activeKing = this.state.pieces.find((piece) => piece.type === "king" && piece.side === this.state!.activePlayer);
    const destinations = new Set(this.legalMoves.map((move) => move.toTileId));
    const routeTiles = new Set(this.legalMoves.flatMap((move) => move.route));
    const kingThreatened = activeKing ? isInCheck(this.state, activeKing.side) : false;
    for (const [tileId, visual] of this.tileVisuals) {
      const isSelected = selected?.tileId === tileId;
      const isDestination = destinations.has(tileId);
      const isRoute = routeTiles.has(tileId) && !isSelected && !isDestination;
      const isThreatenedKing = activeKing?.tileId === tileId && kingThreatened;
      const isTutorialTarget = tileId === this.tutorialTileId;
      const color = isThreatenedKing ? "#c85c47" : isSelected ? "#d69a52" : isDestination ? "#d27d4d" : isRoute ? "#477b7c" : isTutorialTarget ? "#75c8c2" : null;
      visual.mesh.material.color.set(color ?? baseColor(tileId));
      visual.mesh.material.emissive.set(color ?? "#000000");
      visual.mesh.material.emissiveIntensity = isSelected ? 0.28 : isDestination ? 0.17 : isRoute ? 0.08 : isThreatenedKing || isTutorialTarget ? 0.18 : 0;
      visual.rim.material.color.set(isDestination ? "#efaa74" : isRoute || isTutorialTarget ? "#8ed1c7" : "#526f76");
      visual.rim.material.opacity = isDestination ? 0.96 : isRoute || isTutorialTarget ? 0.8 : 0.43;
    }
  }

  private rebuildRoutes(): void {
    clearGroup(this.routeLayer);
    clearGroup(this.markerLayer);
    if (!this.selectedPieceId || !this.state) return;
    const selected = this.state.pieces.find((piece) => piece.id === this.selectedPieceId);
    if (!selected) return;
    const hoveredTarget = this.focusedTileId;

    for (const move of this.legalMoves) {
      const points = routeDisplayPoints(move.route, this.renderMode);
      if (points.length < 2) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const active = move.toTileId === hoveredTarget;
      const material = this.renderMode === "hyperbolic"
        ? new THREE.LineDashedMaterial({ color: active ? "#be613a" : "#527f80", dashSize: active ? 0.27 : 0.18, gapSize: active ? 0.12 : 0.22, transparent: true, opacity: active ? 0.95 : 0.55, linewidth: active ? 2 : 1 })
        : new THREE.LineBasicMaterial({ color: active ? "#be613a" : "#527f80", transparent: true, opacity: active ? 0.87 : 0.48, linewidth: active ? 2 : 1 });
      const line = this.renderMode === "hyperbolic" ? new THREE.Line(geometry, material) : new THREE.Line(geometry, material);
      if (line.material instanceof THREE.LineDashedMaterial) line.computeLineDistances();
      this.routeLayer.add(line);

      const destination = this.tileVisuals.get(move.toTileId);
      if (destination) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.105, 12, 10),
          new THREE.MeshBasicMaterial({ color: "#dd8457", transparent: true, opacity: 0.92 }),
        );
        marker.position.copy(this.getTilePosition(destination)).addScaledVector(this.getTileNormal(destination), 0.22);
        marker.scale.setScalar(localScale(destination, this.renderMode) * 0.75);
        marker.userData.tileId = move.toTileId;
        this.markerLayer.add(marker);
      }
    }
  }

  private rebuildPieces(): void {
    this.pieceMeshes.clear();
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
      if (!group) {
        group = this.makePiece(piece);
        this.pieceAssets.set(piece.id, group);
      }
      group.scale.setScalar(scale);
      group.position.copy(this.getTilePosition(visual)).addScaledVector(normal, 0.085 * scale);
      group.quaternion.setFromUnitVectors(WORLD_UP, normal);
      group.userData.pieceId = piece.id;
      group.userData.tileId = piece.tileId;
      this.pieceLayer.add(group);
      this.pieceMeshes.set(piece.id, group);
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
    for (const child of group.children) {
      child.userData.pieceId = piece.id;
      child.userData.tileId = piece.tileId;
    }
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
        visual.label.position.copy(center).addScaledVector(toNormal, 0.03);
        visual.label.scale.setScalar(0.49 * (this.renderMode === "hyperbolic" ? Math.min(localScale(visual, "hyperbolic"), 3.2) : 1));
      }
    }
    this.rebuildPieces();
    if (this.legalMoves.length) this.rebuildRoutes();
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
      const bounds = canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects([this.pieceLayer, this.markerLayer, this.tileLayer], true);
      const hit = hits.find((item) => findData(item.object, "tileId"));
      if (!hit) return;
      const tileId = findData(hit.object, "tileId");
      if (typeof tileId !== "string") return;
      const pieceId = findData(hit.object, "pieceId");
      this.focusedTileId = tileId;
      this.onTilePicked(tileId, typeof pieceId === "string" ? pieceId : null);
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    canvas.addEventListener("pointerleave", () => { this.pressedAt = null; });
    canvas.addEventListener("pointercancel", () => { this.pressedAt = null; });
  }

  private resize(): void {
    const rect = this.renderer.domElement.parentElement?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    this.camera.aspect = rect.width / rect.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    if (this.overview) this.setOverviewPose(this.renderMode, this.wholeArena);
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

function hyperbolicTile(tile: HyperbolicTile): { boundary: THREE.Vector3[]; grid: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 } {
  const boundary: THREE.Vector3[] = [];
  const modelBoundary: Vector3[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const first = tile.vertices[edge];
    const second = tile.vertices[(edge + 1) % 4];
    for (let step = 0; step < EDGE_STEPS; step += 1) {
      const point = geodesicPoint(first, second, step / EDGE_STEPS);
      modelBoundary.push(point);
      boundary.push(toDisplayPoint(point));
    }
  }
  const center = toDisplayPoint(tile.center);
  const normal = displayNormal(tile.center);
  const grid: THREE.Vector3[] = [];
  for (let ring = 1; ring <= TILE_RING_STEPS; ring += 1) {
    const progress = ring / TILE_RING_STEPS;
    for (const point of modelBoundary) grid.push(toDisplayPoint(geodesicPoint(tile.center, point, progress)));
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

function routeDisplayPoints(route: string[], mode: GeometryMode): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let index = 0; index < route.length; index += 1) {
    const currentId = route[index];
    const current = ARENA.tiles.get(currentId);
    const visualCenter = currentId ? tileCenter(currentId, mode) : null;
    if (!visualCenter) continue;
    if (index === 0) result.push(visualCenter);
    const nextId = route[index + 1];
    if (!nextId) continue;
    if (mode === "hyperbolic" && current) {
      const exitEdge = current.neighbors.findIndex((candidate) => candidate?.tileId === nextId);
      const nextTile = ARENA.tiles.get(nextId);
      if (exitEdge >= 0 && nextTile) {
        const midpoint = edgeMidpoint(current.vertices, exitEdge);
        result.push(toDisplayPoint(midpoint));
      }
    }
    result.push(tileCenter(nextId, mode) ?? visualCenter);
  }
  return result.map((point) => point.clone().add(new THREE.Vector3(0, 0.06, 0)));
}

function tileCenter(tileId: string, mode: GeometryMode): THREE.Vector3 | null {
  const tile = ARENA.tiles.get(tileId);
  if (!tile) return null;
  if (mode === "hyperbolic") return toDisplayPoint(tile.center);
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
  return square ? anchorColor(square) : "#71888d";
}

function anchorColor(square: SquareId): string {
  const { row, col } = squareCoordinates(square);
  return (row + col) % 2 === 0 ? "#bac9c3" : "#71888b";
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
      object.geometry.dispose();
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
