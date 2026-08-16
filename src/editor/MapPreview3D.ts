import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createMedievalWorldVisual } from '../assets/MedievalWorldAssets';
import { loadNaturePackTreeVisuals } from '../assets/NaturePackAssets';
import { GAME_CONFIG } from '../game/config';
import {
  cloneOrchardMap,
  deliveryZonesForMap,
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

export class MapPreview3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-42, 42, 32, -32, 0.1, 320);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private worldRoot: THREE.Group | null = null;
  private markerRoot: THREE.Group | null = null;
  private islandVisual: IslandWorldVisual | null = null;
  private pendingMap: OrchardMap | null = null;
  private rebuildTimer: number | null = null;
  private animationFrame = 0;
  private revision = 0;
  private visible = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly status: HTMLElement,
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

  dispose(): void {
    this.disposed = true;
    this.revision += 1;
    if (this.rebuildTimer !== null) window.clearTimeout(this.rebuildTimer);
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.disposeMarkers();
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
      this.worldRoot = new THREE.Group();
      this.worldRoot.name = 'map-editor-3d-world';
      this.worldRoot.add(world.root, trees.root);
      this.islandVisual = islandVisual;
      this.scene.add(this.worldRoot);
      this.markerRoot = createPreviewMarkers(map);
      this.scene.add(this.markerRoot);
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
      this.status.textContent = islandMode
        ? `岛屿 v5 已同步 · ${map.islandLayout?.regions.length ?? 0} 区域 · ` +
          `${map.islandLayout?.waterSegments.length ?? 0} 水面 · ` +
          `${map.islandLayout?.bridges.length ?? 0} 桥 · ${world.propInstances} 场景物件`
        : `3D 已同步 · ${world.tileInstances} 地块 · ${world.propInstances} 场景物件`;
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
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.animationFrame = window.requestAnimationFrame(this.animate);
    if (!this.visible) return;
    this.controls.update();
    this.islandVisual?.update(performance.now() / 1000, false);
    this.renderer.render(this.scene, this.camera);
  };

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
