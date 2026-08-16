import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMedievalWorldVisual } from '../assets/MedievalWorldAssets';
import { loadNaturePackTreeVisuals } from '../assets/NaturePackAssets';
import { GAME_CONFIG } from '../game/config';
import {
  cloneOrchardMap,
  deliveryZonesForMap,
  type OrchardIslandLayout,
  type OrchardMap,
} from '../game/maps/OrchardMap';
import type { Vec2 } from '../game/types';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import {
  createIslandWorldVisual,
  type IslandWorldVisual,
} from '../render/IslandWorldView';

const PREVIEW_BACKGROUND = '#9fba78';
const ISLAND_PREVIEW_BACKGROUND = '#54bfd0';
const EDITOR_SELECTION_COLOR = '#ffd15c';
const EDITOR_INVALID_COLOR = '#ef6a52';

export type MapPreviewSelectionKind =
  | 'region'
  | 'route-block'
  | 'water-segment'
  | 'bridge'
  | 'landmark'
  | 'terrain-zone'
  | 'delivery-zone';

export type MapPreviewPlacementKind =
  | 'homestead'
  | 'pond'
  | 'orchard'
  | 'meadow'
  | 'apple'
  | 'kid'
  | 'guard1'
  | 'guard2'
  | 'delivery'
  | 'region'
  | 'route-block'
  | 'water-segment'
  | 'bridge';

export type MapPreviewSelection = {
  kind: MapPreviewSelectionKind;
  id: string;
};

export type MapPreviewMoveResult = {
  ok: boolean;
  message?: string;
};

export type MapPreview3DHandlers = {
  onSelectionChange: (selection: MapPreviewSelection | null) => void;
  onMovePreview: (selection: MapPreviewSelection, position: Vec2) => boolean;
  onMoveCommit: (selection: MapPreviewSelection, position: Vec2) => MapPreviewMoveResult;
  onPlace: (kind: MapPreviewPlacementKind, position: Vec2) => MapPreviewMoveResult;
};

type EditorProxyDescriptor = {
  selection: MapPreviewSelection;
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  rotationY: number;
  priority: number;
};

type PreviewDrag = {
  pointerId: number;
  selection: MapPreviewSelection;
  startGround: THREE.Vector3;
  startPosition: Vec2;
  position: Vec2;
  moved: boolean;
  valid: boolean;
};

export class MapPreview3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-42, 42, 32, -32, 0.1, 320);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly listeners = new AbortController();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private worldRoot: THREE.Group | null = null;
  private markerRoot: THREE.Group | null = null;
  private editorProxyRoot: THREE.Group | null = null;
  private selectionVisual: THREE.Group | null = null;
  private islandVisual: IslandWorldVisual | null = null;
  private pendingMap: OrchardMap | null = null;
  private selection: MapPreviewSelection | null = null;
  private placement: MapPreviewPlacementKind | null = null;
  private drag: PreviewDrag | null = null;
  private readyStatusText = '';
  private rebuildTimer: number | null = null;
  private animationFrame = 0;
  private revision = 0;
  private visible = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly status: HTMLElement,
    private readonly handlers: MapPreview3DHandlers,
  ) {
    this.renderer = createRenderer(canvas);
    this.renderer.setClearColor(PREVIEW_BACKGROUND);
    this.camera.position.set(52, 74, 64);
    this.camera.zoom = 0.88;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.minZoom = 0.62;
    this.controls.maxZoom = 1.75;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(72);
    this.controls.minPolarAngle = THREE.MathUtils.degToRad(26);
    this.controls.update();

    const hemisphere = new THREE.HemisphereLight('#fff7d8', '#557044', 2.35);
    const sun = new THREE.DirectionalLight('#fff0c3', 3.2);
    sun.position.set(-42, 76, 48);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 190;
    sun.shadow.camera.left = -54;
    sun.shadow.camera.right = 54;
    sun.shadow.camera.top = 46;
    sun.shadow.camera.bottom = -46;
    sun.shadow.bias = -0.00035;
    this.scene.add(hemisphere, sun);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    const signal = this.listeners.signal;
    canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    canvas.addEventListener('pointercancel', this.onPointerCancel, { signal });
    canvas.addEventListener('lostpointercapture', this.onPointerCancel, { signal });
    this.animate();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.hidden = !visible;
    this.status.hidden = !visible;
    if (!visible) return;
    this.resize();
    if (this.pendingMap) this.scheduleRebuild(0);
  }

  setMap(map: OrchardMap): void {
    this.pendingMap = cloneOrchardMap(map);
    if (this.visible) this.scheduleRebuild(120);
  }

  setSelection(selection: MapPreviewSelection | null): void {
    this.selection = selection ? { ...selection } : null;
    this.syncSelectionVisual();
  }

  setPlacement(placement: MapPreviewPlacementKind | null): void {
    this.placement = placement;
    this.canvas.dataset.placementKind = placement ?? '';
    this.canvas.classList.toggle('placement-mode', placement !== null);
    if (!this.visible || !this.readyStatusText) return;
    this.status.dataset.state = placement ? 'editing' : 'ready';
    this.status.textContent = placement
      ? `放置模式 · ${previewPlacementLabel(placement)} · 点击地面放置`
      : this.readyStatusText;
  }

  dispose(): void {
    this.disposed = true;
    this.revision += 1;
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    window.cancelAnimationFrame(this.animationFrame);
    this.listeners.abort();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeMarkers();
    this.disposeEditorOverlay();
    this.worldRoot?.removeFromParent();
    this.islandVisual = null;
    this.renderer.dispose();
  }

  private scheduleRebuild(delay: number): void {
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuild();
    }, delay);
  }

  private async rebuild(): Promise<void> {
    const map = this.pendingMap;
    if (!map || this.disposed) return;
    const revision = ++this.revision;
    this.status.dataset.state = 'loading';
    this.status.textContent = '正在拼装 KayKit 3D 地图…';
    this.canvas.dataset.ready = 'false';
    try {
      const islandMode = Boolean(map.islandLayout);
      const islandVisual = islandMode ? createIslandWorldVisual(map) : null;
      const [world, trees] = await Promise.all([
        islandVisual
          ? Promise.resolve(islandVisual)
          : createMedievalWorldVisual(map.worldStyle.theme, map),
        loadNaturePackTreeVisuals(map.trees),
      ]);
      if (this.disposed || revision !== this.revision) return;
      this.worldRoot?.removeFromParent();
      this.disposeMarkers();
      this.disposeEditorOverlay();
      this.worldRoot = new THREE.Group();
      this.worldRoot.name = 'map-editor-3d-world';
      this.worldRoot.add(world.root, trees.root);
      this.islandVisual = islandVisual;
      this.scene.add(this.worldRoot);
      this.markerRoot = createPreviewMarkers(map);
      this.scene.add(this.markerRoot);
      this.editorProxyRoot = createEditorProxyRoot(map);
      this.scene.add(this.editorProxyRoot);
      this.syncSelectionVisual();
      this.canvas.dataset.editorProxies = String(this.editorProxyRoot.children.length);
      this.publishEditorProxyScreens();
      this.canvas.dataset.ready = 'true';
      this.canvas.dataset.mapId = map.id;
      this.canvas.dataset.worldMode = islandMode ? 'island-v5' : 'kaykit';
      this.canvas.dataset.islandRegions = String(map.islandLayout?.regions.length ?? 0);
      this.canvas.dataset.islandRouteBlocks = String(map.islandLayout?.routeBlocks.length ?? 0);
      this.canvas.dataset.islandWaterSegments = String(map.islandLayout?.waterSegments.length ?? 0);
      this.canvas.dataset.islandBridges = String(map.islandLayout?.bridges.length ?? 0);
      this.canvas.dataset.islandRegionPropClusters = String(islandVisual?.regionPropClusters ?? 0);
      this.canvas.dataset.islandRegionPatchSignature = regionPatchSignature(islandVisual?.root ?? null);
      this.canvas.dataset.islandLandmarkSignature = islandLandmarkSignature(islandVisual?.root ?? null);
      this.renderer.setClearColor(islandMode ? ISLAND_PREVIEW_BACKGROUND : PREVIEW_BACKGROUND);
      this.status.dataset.state = 'ready';
      this.readyStatusText = islandMode
        ? `岛屿 v5 已同步 · ${map.islandLayout?.regions.length ?? 0} 区域 · ` +
          `${map.islandLayout?.waterSegments.length ?? 0} 水面 · ` +
          `${map.islandLayout?.bridges.length ?? 0} 桥 · ${world.propInstances} 场景物件`
        : `3D 已同步 · ${world.tileInstances} 地块 · ${world.propInstances} 场景物件`;
      this.status.textContent = this.readyStatusText;
      this.setPlacement(this.placement);
    } catch (error) {
      if (this.disposed || revision !== this.revision) return;
      this.canvas.dataset.ready = 'error';
      this.status.dataset.state = 'error';
      this.status.textContent = error instanceof Error ? error.message : '3D 预览载入失败';
    }
  }

  private resize(): void {
    if (!this.visible) return;
    if (resizeRenderer(this.renderer, this.camera, 1.5)) {
      this.camera.zoom = Math.max(0.62, this.camera.zoom);
      this.camera.updateProjectionMatrix();
      this.publishEditorProxyScreens();
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = window.requestAnimationFrame(this.animate);
    if (!this.visible) return;
    if (this.controls.update()) this.publishEditorProxyScreens();
    this.islandVisual?.update(performance.now() / 1000, false);
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.visible || event.button !== 0 || !this.editorProxyRoot) return;
    if (this.placement) {
      const point = this.pointerGroundIntersection(event);
      if (!point) return;
      event.preventDefault();
      this.handlers.onPlace(this.placement, {
        x: snapEditorCoordinate(point.x),
        z: snapEditorCoordinate(point.z),
      });
      return;
    }
    const proxy = this.pickEditorProxy(event);
    if (!proxy) {
      this.setSelection(null);
      this.handlers.onSelectionChange(null);
      return;
    }
    const descriptor = proxy.userData.editorDescriptor as EditorProxyDescriptor;
    this.setSelection(descriptor.selection);
    this.handlers.onSelectionChange(descriptor.selection);
    const startGround = this.pointerGroundIntersection(event);
    if (!startGround) return;
    event.preventDefault();
    this.controls.enabled = false;
    this.canvas.setPointerCapture(event.pointerId);
    this.drag = {
      pointerId: event.pointerId,
      selection: { ...descriptor.selection },
      startGround,
      startPosition: { x: descriptor.x, z: descriptor.z },
      position: { x: descriptor.x, z: descriptor.z },
      moved: false,
      valid: true,
    };
    this.canvas.dataset.dragging = 'false';
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const ground = this.pointerGroundIntersection(event);
    if (!ground) return;
    const deltaX = ground.x - drag.startGround.x;
    const deltaZ = ground.z - drag.startGround.z;
    if (!drag.moved && Math.hypot(deltaX, deltaZ) < 0.2) return;
    drag.moved = true;
    drag.position = constrainPreviewMove(drag.selection, {
      x: snapEditorCoordinate(drag.startPosition.x + deltaX),
      z: snapEditorCoordinate(drag.startPosition.z + deltaZ),
    }, drag.startPosition);
    drag.valid = this.handlers.onMovePreview(drag.selection, drag.position);
    this.moveSelectionVisual(drag.position, drag.valid);
    this.canvas.dataset.dragging = 'true';
    this.canvas.dataset.dragValid = String(drag.valid);
    this.status.dataset.state = drag.valid ? 'editing' : 'error';
    this.status.textContent = drag.valid
      ? `拖动中 · X ${drag.position.x.toFixed(1)} · Z ${drag.position.z.toFixed(1)} · 松开应用`
      : '当前位置会破坏岛屿结构；松开后将恢复。';
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.finishDrag(event.pointerId, false);
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.finishDrag(event.pointerId, true);
  };

  private finishDrag(pointerId: number, cancelled: boolean): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== pointerId) return;
    this.drag = null;
    this.controls.enabled = true;
    if (this.canvas.hasPointerCapture(pointerId)) this.canvas.releasePointerCapture(pointerId);
    delete this.canvas.dataset.dragging;
    delete this.canvas.dataset.dragValid;
    this.status.dataset.state = 'ready';
    this.status.textContent = this.readyStatusText;
    if (cancelled || !drag.moved || !drag.valid) {
      this.syncSelectionVisual();
      return;
    }
    const result = this.handlers.onMoveCommit(drag.selection, drag.position);
    if (!result.ok) this.syncSelectionVisual();
  }

  private pickEditorProxy(event: PointerEvent): THREE.Mesh | null {
    if (!this.editorProxyRoot) return null;
    this.updateRaycaster(event);
    const intersections = this.raycaster.intersectObjects(this.editorProxyRoot.children, false);
    const proxies = intersections
      .map((intersection) => intersection.object)
      .filter((object): object is THREE.Mesh =>
        object instanceof THREE.Mesh && Boolean(object.userData.editorDescriptor));
    return proxies.sort((first, second) =>
      (second.userData.editorDescriptor as EditorProxyDescriptor).priority -
      (first.userData.editorDescriptor as EditorProxyDescriptor).priority)[0] ?? null;
  }

  private pointerGroundIntersection(event: PointerEvent): THREE.Vector3 | null {
    this.updateRaycaster(event);
    return this.raycaster.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
  }

  private updateRaycaster(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      (event.clientX - rect.left) / Math.max(1, rect.width) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private publishEditorProxyScreens(): void {
    if (!this.editorProxyRoot) {
      delete this.canvas.dataset.editorProxyScreens;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const screens = this.editorProxyRoot.children.map((object) => {
      const descriptor = object.userData.editorDescriptor as EditorProxyDescriptor;
      const projected = new THREE.Vector3(descriptor.x, 0.4, descriptor.z).project(this.camera);
      return {
        kind: descriptor.selection.kind,
        id: descriptor.selection.id,
        x: Number(((projected.x + 1) * rect.width / 2).toFixed(1)),
        y: Number(((1 - projected.y) * rect.height / 2).toFixed(1)),
      };
    });
    this.canvas.dataset.editorProxyScreens = JSON.stringify(screens);
  }

  private syncSelectionVisual(): void {
    this.disposeSelectionVisual();
    if (!this.selection || !this.editorProxyRoot) {
      delete this.canvas.dataset.selectedKind;
      delete this.canvas.dataset.selectedId;
      return;
    }
    const proxy = this.editorProxyRoot.children.find((object) => {
      const descriptor = object.userData.editorDescriptor as EditorProxyDescriptor | undefined;
      if (!descriptor) return false;
      return descriptor.selection.kind === this.selection?.kind &&
        descriptor.selection.id === this.selection.id;
    });
    const descriptor = proxy?.userData.editorDescriptor as EditorProxyDescriptor | undefined;
    if (!descriptor) {
      delete this.canvas.dataset.selectedKind;
      delete this.canvas.dataset.selectedId;
      return;
    }
    this.selectionVisual = createSelectionVisual(descriptor);
    this.scene.add(this.selectionVisual);
    this.canvas.dataset.selectedKind = descriptor.selection.kind;
    this.canvas.dataset.selectedId = descriptor.selection.id;
  }

  private moveSelectionVisual(position: Vec2, valid: boolean): void {
    if (!this.selectionVisual) return;
    this.selectionVisual.position.x = position.x;
    this.selectionVisual.position.z = position.z;
    this.selectionVisual.traverse((object) => {
      const material = object instanceof THREE.Mesh || object instanceof THREE.LineSegments
        ? object.material
        : null;
      const materials = material ? Array.isArray(material) ? material : [material] : [];
      for (const entry of materials) {
        if ('color' in entry) entry.color.set(valid ? EDITOR_SELECTION_COLOR : EDITOR_INVALID_COLOR);
      }
    });
  }

  private disposeMarkers(): void {
    if (!this.markerRoot) return;
    this.markerRoot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
    this.markerRoot.removeFromParent();
    this.markerRoot = null;
  }

  private disposeEditorOverlay(): void {
    this.disposeSelectionVisual();
    if (!this.editorProxyRoot) return;
    disposeObjectMaterials(this.editorProxyRoot);
    this.editorProxyRoot.removeFromParent();
    this.editorProxyRoot = null;
    delete this.canvas.dataset.editorProxies;
    delete this.canvas.dataset.editorProxyScreens;
  }

  private disposeSelectionVisual(): void {
    if (!this.selectionVisual) return;
    disposeObjectMaterials(this.selectionVisual);
    this.selectionVisual.removeFromParent();
    this.selectionVisual = null;
  }
}

function createEditorProxyRoot(map: OrchardMap): THREE.Group {
  const root = new THREE.Group();
  root.name = 'map-editor-3d-semantic-proxies';
  const descriptors: EditorProxyDescriptor[] = [
    ...(map.islandLayout ? islandEditorDescriptors(map.islandLayout) : []),
    ...map.landmarks
      .filter((landmark) => landmark.kind === 'pond' || Boolean(landmark.asset))
      .map((landmark) => ({
        selection: { kind: 'landmark' as const, id: landmark.id },
        x: landmark.x,
        z: landmark.z,
        sizeX: landmark.radiusX * 2,
        sizeZ: landmark.radiusZ * 2,
        rotationY: landmark.rotationY,
        priority: 6,
      })),
    ...(map.islandLayout ? [] : map.terrainZones.map((zone) => ({
      selection: { kind: 'terrain-zone' as const, id: zone.id },
      x: zone.x,
      z: zone.z,
      sizeX: zone.radiusX * 2,
      sizeZ: zone.radiusZ * 2,
      rotationY: zone.rotationY,
      priority: 1,
    }))),
    ...deliveryZonesForMap(map).map((zone) => ({
      selection: { kind: 'delivery-zone' as const, id: zone.id },
      x: zone.x,
      z: zone.z,
      sizeX: GAME_CONFIG.deliveryRadius * 2,
      sizeZ: GAME_CONFIG.deliveryRadius * 2,
      rotationY: 0,
      priority: 7,
    })),
  ];
  for (const descriptor of descriptors) {
    const geometry = new THREE.BoxGeometry(descriptor.sizeX, 0.7, descriptor.sizeZ);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    material.colorWrite = false;
    const proxy = new THREE.Mesh(geometry, material);
    proxy.name = `map-editor-proxy-${descriptor.selection.kind}-${descriptor.selection.id}`;
    proxy.position.set(descriptor.x, 0.25 + descriptor.priority * 0.04, descriptor.z);
    proxy.rotation.y = descriptor.rotationY;
    proxy.userData.editorDescriptor = descriptor;
    root.add(proxy);
  }
  return root;
}

function islandEditorDescriptors(layout: OrchardIslandLayout): EditorProxyDescriptor[] {
  return [
    ...layout.regions.map((region) => ({
      selection: { kind: 'region' as const, id: region.id },
      x: region.x,
      z: region.z,
      sizeX: region.radiusX * 2,
      sizeZ: region.radiusZ * 2,
      rotationY: region.rotationY,
      priority: 1,
    })),
    ...layout.waterSegments.map((segment) => ({
      selection: { kind: 'water-segment' as const, id: segment.id },
      x: segment.x,
      z: segment.z,
      sizeX: segment.sizeX,
      sizeZ: segment.sizeZ,
      rotationY: 0,
      priority: 2,
    })),
    ...layout.routeBlocks.map((block) => ({
      selection: { kind: 'route-block' as const, id: block.id },
      x: block.x,
      z: block.z,
      sizeX: block.radiusX * 2,
      sizeZ: block.radiusZ * 2,
      rotationY: 0,
      priority: 3,
    })),
    ...layout.bridges.map((bridge) => ({
      selection: { kind: 'bridge' as const, id: bridge.id },
      x: bridge.x,
      z: bridge.z,
      sizeX: bridge.width,
      sizeZ: bridge.depth,
      rotationY: 0,
      priority: 4,
    })),
  ];
}

function createSelectionVisual(descriptor: EditorProxyDescriptor): THREE.Group {
  const root = new THREE.Group();
  root.name = 'map-editor-3d-selection';
  root.position.set(descriptor.x, 0.08, descriptor.z);
  root.rotation.y = descriptor.rotationY;

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(descriptor.sizeX, descriptor.sizeZ),
    new THREE.MeshBasicMaterial({
      color: EDITOR_SELECTION_COLOR,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.renderOrder = 50;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(descriptor.sizeX, 0.24, descriptor.sizeZ)),
    new THREE.LineBasicMaterial({
      color: EDITOR_SELECTION_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    }),
  );
  edges.position.y = 0.12;
  edges.renderOrder = 51;

  const center = new THREE.Mesh(
    new THREE.CircleGeometry(0.7, 18),
    new THREE.MeshBasicMaterial({
      color: EDITOR_SELECTION_COLOR,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    }),
  );
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.28;
  center.renderOrder = 52;
  root.add(fill, edges, center);
  return root;
}

function constrainPreviewMove(
  selection: MapPreviewSelection,
  position: Vec2,
  startPosition: Vec2,
): Vec2 {
  return {
    x: clampEditorCoordinate(position.x, -GAME_CONFIG.arenaHalfWidth, GAME_CONFIG.arenaHalfWidth),
    z: selection.kind === 'bridge'
      ? startPosition.z
      : clampEditorCoordinate(position.z, -GAME_CONFIG.arenaHalfDepth, GAME_CONFIG.arenaHalfDepth),
  };
}

function previewPlacementLabel(kind: MapPreviewPlacementKind): string {
  const labels: Record<MapPreviewPlacementKind, string> = {
    homestead: '建筑',
    pond: '池塘',
    orchard: '果园地块',
    meadow: '草地空场',
    apple: '果实',
    kid: '小偷起点',
    guard1: '守卫一起点',
    guard2: '守卫二起点',
    delivery: '投递点',
    region: '视觉区域',
    'route-block': '矩形障碍',
    'water-segment': '水面段',
    bridge: '桥梁',
  };
  return labels[kind];
}

function snapEditorCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampEditorCoordinate(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function disposeObjectMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function regionPatchSignature(root: THREE.Group | null): string {
  const patches = root?.getObjectByName('island-v5-semantic-region-patches');
  if (!patches) return '';
  return patches.children.map((patch) => [
    String(patch.userData.regionId),
    patch.position.x.toFixed(2),
    patch.position.z.toFixed(2),
    patch.scale.x.toFixed(2),
    patch.scale.y.toFixed(2),
  ].join(':')).join('|');
}

function islandLandmarkSignature(root: THREE.Group | null): string {
  const landmarks = root?.getObjectByName('island-editable-landmark-visuals');
  if (!landmarks) return '';
  return landmarks.children.map((landmark) => [
    String(landmark.userData.landmarkId),
    landmark.position.x.toFixed(2),
    landmark.position.z.toFixed(2),
  ].join(':')).join('|');
}

function createPreviewMarkers(map: OrchardMap): THREE.Group {
  const root = new THREE.Group();
  root.name = 'map-editor-3d-markers';
  root.add(
    createActorMarker(map.kidStart, '#e9623e'),
    createActorMarker(map.guardStarts[0], '#3978ad'),
    createActorMarker(map.guardStarts[1], '#315f92'),
  );

  const appleGeometry = new THREE.SphereGeometry(0.32, 12, 9);
  const appleMaterial = new THREE.MeshStandardMaterial({
    color: '#e8432e',
    emissive: '#7f1f16',
    emissiveIntensity: 0.12,
    roughness: 0.62,
  });
  const apples = new THREE.InstancedMesh(appleGeometry, appleMaterial, map.appleSpawns.length);
  apples.name = 'map-editor-preview-apples';
  apples.castShadow = true;
  const transform = new THREE.Object3D();
  map.appleSpawns.forEach((apple, index) => {
    transform.position.set(apple.x, 0.38, apple.z);
    transform.rotation.set(0, index * 1.17, 0);
    transform.scale.setScalar(1);
    transform.updateMatrix();
    apples.setMatrixAt(index, transform.matrix);
  });
  apples.instanceMatrix.needsUpdate = true;
  root.add(apples);

  const deliveryGeometry = new THREE.RingGeometry(
    GAME_CONFIG.deliveryRadius - 0.22,
    GAME_CONFIG.deliveryRadius,
    48,
  );
  const deliveryMaterial = new THREE.MeshBasicMaterial({
    color: '#f1bf49',
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  for (const zone of deliveryZonesForMap(map)) {
    const delivery = new THREE.Mesh(deliveryGeometry, deliveryMaterial);
    delivery.name = `map-editor-preview-delivery-${zone.id}`;
    delivery.rotation.x = -Math.PI / 2;
    delivery.position.set(zone.x, 0.12, zone.z);
    root.add(delivery);
  }
  return root;
}

function createActorMarker(position: Vec2, color: THREE.ColorRepresentation): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.58 });
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 0.86, 10), material);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), material.clone());
  body.position.y = 0.56;
  head.position.y = 1.18;
  body.castShadow = true;
  head.castShadow = true;
  root.position.set(position.x, 0.08, position.z);
  root.add(body, head);
  return root;
}
