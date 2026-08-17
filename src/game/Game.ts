import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { InputRouter } from '../core/InputRouter';
import { Loop } from '../core/Loop';
import {
  createRenderer,
  resizeRenderer,
  updateCameraProjection,
  usesPortraitArenaLayout,
  type CameraProjection,
  type ResponsiveCamera,
} from '../core/Renderer';
import { ArenaView } from '../render/ArenaView';
import { AudioSystem } from '../systems/AudioSystem';
import {
  orthographicFrameOccupancy,
  resolveOrthographicFollowZoom,
} from '../systems/CameraFollow';
import type { DebugPanel, DebugTuning } from '../systems/DebugPanel';
import { Hud } from '../systems/Hud';
import { loadActiveMap } from '../systems/MapStorage';
import { DEFAULT_MOVEMENT_TUNING, FIXED_DELTA_SECONDS, GAME_CONFIG } from './config';
import { type GameDriver, LocalGameDriver } from './GameDriver';
import { GameSimulation } from './GameSimulation';
import {
  resolveMedievalWorldMap,
  type MedievalWorldPreset,
} from './maps/MedievalWorldExperiments';
import { isIslandTourMap, resolveIslandTourMap } from './maps/IslandTourMap';
import { deliveryZonesForMap, type OrchardMap } from './maps/OrchardMap';
import {
  createEmptyCommands,
  type GameCommands,
  type GameSnapshot,
  type SimulationStep,
} from './types';

const PORTRAIT_CAMERA_ANGLE = 25;
const DEFAULT_LANDSCAPE_CAMERA_ANGLE = 34;
const DEFAULT_PERSPECTIVE_FOV = 22;
const DEFAULT_LANDSCAPE_CAMERA_HEIGHT = 117.5;
const ISLAND_LANDSCAPE_CAMERA_ANGLE = 40;
const ISLAND_LANDSCAPE_CAMERA_HEIGHT = 112;
const ISLAND_CAMERA_ZOOM = 0.96;
const ONLINE_CAMERA_MAX_ZOOM = 1.4;
const ONLINE_CAMERA_SAFE_FRAME = 0.78;
const ONLINE_CAMERA_SUBJECT_PADDING = 3;
const ONLINE_CAMERA_POSITION_LAG_SECONDS = 0.16;
const ONLINE_CAMERA_ZOOM_OUT_LAG_SECONDS = 0.08;
const ONLINE_CAMERA_ZOOM_IN_LAG_SECONDS = 0.42;
const DEFAULT_LANDSCAPE_CAMERA_DISTANCE = roundCameraValue(DEFAULT_LANDSCAPE_CAMERA_HEIGHT *
  Math.tan(THREE.MathUtils.degToRad(DEFAULT_LANDSCAPE_CAMERA_ANGLE)));

export type CameraFollowSeat = 'guards' | 'kid';

export type GameOptions = {
  map?: OrchardMap;
  driver?: GameDriver;
  cameraFollowSeat?: CameraFollowSeat;
};

const DEFAULT_DEBUG_TUNING: Readonly<DebugTuning> = {
  ...DEFAULT_MOVEMENT_TUNING,
  cameraProjection: 'orthographic',
  perspectiveFov: DEFAULT_PERSPECTIVE_FOV,
  landscapeCameraAngle: DEFAULT_LANDSCAPE_CAMERA_ANGLE,
  cameraZoom: 1.08,
  cameraDistance: roundCameraValue(Math.hypot(
    DEFAULT_LANDSCAPE_CAMERA_HEIGHT,
    DEFAULT_LANDSCAPE_CAMERA_DISTANCE,
  )),
  cameraPositionX: 0,
  cameraPositionY: DEFAULT_LANDSCAPE_CAMERA_HEIGHT,
  cameraPositionZ: DEFAULT_LANDSCAPE_CAMERA_DISTANCE,
  cameraTargetX: 0,
  cameraTargetY: 0,
  cameraTargetZ: 0,
  hemisphereIntensity: 2.1,
  sunIntensity: 3.1,
  reducedMotion: false,
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly orthographicCamera = new THREE.OrthographicCamera(-70, 70, 55, -55, 0.1, 500);
  private readonly perspectiveCamera = new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_FOV, 1, 5, 500);
  private readonly orthographicControls: OrbitControls;
  private readonly perspectiveControls: OrbitControls;
  private readonly input = new InputRouter();
  private readonly cameraControl = getElement<HTMLElement>('#camera-control');
  private readonly cameraModeToggle = getElement<HTMLButtonElement>('#camera-mode-toggle');
  private readonly cameraModeLabel = getElement<HTMLElement>('#camera-mode-label');
  private readonly map: OrchardMap;
  private readonly islandWorld: boolean;
  private readonly driver: GameDriver;
  private readonly cameraFollowSeat: CameraFollowSeat | null;
  private readonly hemisphere = new THREE.HemisphereLight('#fff7db', '#55743d', 2.1);
  private readonly sun = new THREE.DirectionalLight('#fff0bd', 3.1);
  private readonly debugTuning: DebugTuning = { ...DEFAULT_DEBUG_TUNING };
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly projectionDirection = new THREE.Vector3();
  private readonly cameraFollowTarget = new THREE.Vector3();
  private readonly cameraFollowDesiredTarget = new THREE.Vector3();
  private readonly cameraFollowOffset = new THREE.Vector3();
  private readonly cameraFollowRight = new THREE.Vector3();
  private readonly cameraFollowUp = new THREE.Vector3();
  private readonly cameraFollowSubjectOffset = new THREE.Vector3();
  private readonly view: ArenaView;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly loop = new Loop(
    (delta, elapsed, fps) => this.update(delta, elapsed, fps),
    () => this.render(),
    GAME_CONFIG.maxFrameRate,
  );
  private readonly handleOrthographicControlsChange = (): void => {
    this.handleCameraControlsChange(this.orthographicControls);
  };
  private readonly handlePerspectiveControlsChange = (): void => {
    this.handleCameraControlsChange(this.perspectiveControls);
  };
  private readonly handleCanvasContextMenu = (event: MouseEvent): void => {
    if (this.cameraPointerMode) event.preventDefault();
  };
  private readonly handleCameraModeToggle = (): void => {
    this.setCameraPointerMode(!this.cameraPointerMode);
  };

  private frame = 0;
  private accumulator = 0;
  private fps = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private renderTime = 0;
  private presentationSnapshot: GameSnapshot | null = null;
  private debugPanel: DebugPanel | null = null;
  private debugUiHidden = false;
  private cameraPointerMode = false;
  private cameraFollowInitialized = false;
  private cameraFollowDesiredZoom: number | null = null;
  private cameraFollowFrameOccupancy: number | null = null;
  private cameraFollowSubjectCount = 0;
  private activeProjection: CameraProjection = DEFAULT_DEBUG_TUNING.cameraProjection;
  private disposed = false;

  private get camera(): ResponsiveCamera {
    return this.activeProjection === 'orthographic'
      ? this.orthographicCamera
      : this.perspectiveCamera;
  }

  private get cameraControls(): OrbitControls {
    return this.activeProjection === 'orthographic'
      ? this.orthographicControls
      : this.perspectiveControls;
  }

  constructor(private readonly canvas: HTMLCanvasElement, options: GameOptions = {}) {
    if (options.driver && !options.map) {
      throw new Error('An injected game driver requires an authoritative map.');
    }
    const activeMap = loadActiveMap();
    const islandMap = options.map ? null : resolveIslandTourMap();
    const medievalWorld = options.map || islandMap ? null : resolveMedievalWorldMap(activeMap);
    this.map = options.map ?? islandMap ?? medievalWorld?.map ?? activeMap;
    this.islandWorld = isIslandTourMap(this.map);
    if (this.islandWorld) this.configureIslandCamera();
    this.driver = options.driver ?? new LocalGameDriver(new GameSimulation(this.map));
    this.cameraFollowSeat = this.driver.mode === 'online'
      ? options.cameraFollowSeat ?? null
      : null;
    this.renderer = createRenderer(canvas);
    if (this.islandWorld) {
      this.renderer.toneMappingExposure = 1.01;
    }
    if (this.islandWorld && window.matchMedia('(max-width: 600px)').matches) {
      this.renderer.shadowMap.enabled = false;
    }
    this.scene.background = new THREE.Color(this.islandWorld ? '#54bfd0' : '#91ad62');
    this.orthographicCamera.position.set(
      this.debugTuning.cameraPositionX,
      this.debugTuning.cameraPositionY,
      this.debugTuning.cameraPositionZ,
    );
    this.orthographicCamera.lookAt(0, 0, 0);
    this.perspectiveCamera.position.copy(this.orthographicCamera.position);
    this.perspectiveCamera.lookAt(0, 0, 0);
    this.orthographicControls = new OrbitControls(this.orthographicCamera, canvas);
    this.perspectiveControls = new OrbitControls(this.perspectiveCamera, canvas);
    this.configureCameraControls(this.orthographicControls, this.handleOrthographicControlsChange);
    this.configureCameraControls(this.perspectiveControls, this.handlePerspectiveControlsChange);
    this.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
    this.cameraModeToggle.addEventListener('click', this.handleCameraModeToggle);
    this.createLighting();
    this.view = new ArenaView(this.scene, this.map);
    const mapName = document.querySelector<HTMLElement>('#active-map-name');
    if (mapName) mapName.textContent = this.map.name;
    this.configureWorldNavigation(medievalWorld?.preset ?? null, this.islandWorld);
    resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    this.updateCameraComposition();
    this.syncCameraControlUi();
    this.syncPresentation();
    this.updateCameraFollow(0, true);
    this.installTestHooks();
    this.publishDiagnostics();
    if (import.meta.env.DEV && this.driver.mode === 'local') void this.installDebugPanel();
  }

  private configureIslandCamera(): void {
    const horizontalDistance = ISLAND_LANDSCAPE_CAMERA_HEIGHT * Math.tan(
      THREE.MathUtils.degToRad(ISLAND_LANDSCAPE_CAMERA_ANGLE),
    );
    this.debugTuning.landscapeCameraAngle = ISLAND_LANDSCAPE_CAMERA_ANGLE;
    this.debugTuning.cameraZoom = ISLAND_CAMERA_ZOOM;
    this.debugTuning.cameraPositionY = ISLAND_LANDSCAPE_CAMERA_HEIGHT;
    this.debugTuning.cameraPositionZ = roundCameraValue(horizontalDistance);
    this.debugTuning.cameraDistance = roundCameraValue(Math.hypot(
      ISLAND_LANDSCAPE_CAMERA_HEIGHT,
      horizontalDistance,
    ));
  }

  private configureWorldNavigation(
    preset: MedievalWorldPreset | null,
    islandWorld: boolean,
  ): void {
    const customWorld = new URLSearchParams(window.location.search).get('world') === 'custom';
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-world-layout]')) {
      const active = islandWorld
        ? link.dataset.worldLayout === 'island'
        : customWorld
          ? link.dataset.worldLayout === 'custom'
          : preset === null
            ? link.dataset.worldLayout === 'base'
            : link.dataset.worldLayout === preset;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.disposed = true;
    this.loop.stop();
    this.input.dispose();
    this.driver.dispose();
    this.audio.dispose();
    this.view.dispose();
    this.debugPanel?.dispose();
    this.debugPanel = null;
    this.orthographicControls.removeEventListener('change', this.handleOrthographicControlsChange);
    this.perspectiveControls.removeEventListener('change', this.handlePerspectiveControlsChange);
    this.orthographicControls.dispose();
    this.perspectiveControls.dispose();
    this.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.cameraModeToggle.removeEventListener('click', this.handleCameraModeToggle);
    this.canvas.classList.remove('camera-pointer-mode');
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number, fps: number): void {
    this.frame += 1;
    this.fps = fps;
    const resized = resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    if (resized) {
      this.updateCameraComposition();
    }
    if (this.cameraPointerMode) this.cameraControls.update();
    this.renderTime = elapsed;
    if (this.pausedForScreenshot) {
      this.syncPresentation();
      this.updateCameraFollow(delta, resized);
      this.publishDiagnostics();
      return;
    }

    this.accumulator += Math.min(delta, GAME_CONFIG.maxFrameDelta);
    let firstStep = true;
    while (this.accumulator >= FIXED_DELTA_SECONDS) {
      const commands = firstStep ? this.input.consumeCommands() : this.input.readHeldCommands();
      for (const step of this.driver.tick(commands)) this.handleStep(step);
      this.accumulator -= FIXED_DELTA_SECONDS;
      firstStep = false;
    }
    this.syncPresentation();
    this.updateCameraFollow(delta, resized);
    this.publishDiagnostics();
  }

  private handleStep(step: SimulationStep): void {
    const presentationTime = this.reducedMotion ? step.snapshot.elapsedSeconds : this.renderTime;
    for (const event of step.events) {
      this.view.handleEvent(event, step.snapshot, presentationTime);
      this.audio.play(event);
    }
  }

  private syncPresentation(): void {
    const interpolationAlpha = Math.max(0, Math.min(1, this.accumulator / FIXED_DELTA_SECONDS));
    const snapshot = this.driver.getSnapshot(interpolationAlpha);
    this.presentationSnapshot = snapshot;
    const presentationTime = this.reducedMotion ? snapshot.elapsedSeconds : this.renderTime;
    this.view.sync(snapshot, presentationTime, this.reducedMotion);
    this.hud.update(snapshot, this.fps);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateCameraComposition(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    updateCameraProjection(this.camera, width, height);
    this.perspectiveCamera.fov = this.debugTuning.perspectiveFov;
    if (this.cameraPointerMode) {
      this.camera.updateProjectionMatrix();
      return;
    }
    const portraitLayout = usesPortraitArenaLayout(width / height);
    if (portraitLayout) {
      const cameraHeight = this.islandWorld ? 156 : 170;
      const portraitAngle = this.islandWorld ? 30 : PORTRAIT_CAMERA_ANGLE;
      const horizontalDistance = cameraHeight * Math.tan(THREE.MathUtils.degToRad(portraitAngle));
      this.camera.position.set(horizontalDistance, cameraHeight, 0);
      this.cameraLookTarget.set(0, 0, 0);
    } else {
      this.camera.position.set(
        this.debugTuning.cameraPositionX,
        this.debugTuning.cameraPositionY,
        this.debugTuning.cameraPositionZ,
      );
      this.cameraLookTarget.set(
        this.debugTuning.cameraTargetX,
        this.debugTuning.cameraTargetY,
        this.debugTuning.cameraTargetZ,
      );
      this.debugTuning.landscapeCameraAngle = roundCameraValue(this.cameraAngleFromGroundNormal());
    }
    this.camera.zoom = this.debugTuning.cameraZoom;
    this.camera.lookAt(this.cameraLookTarget);
    this.camera.updateProjectionMatrix();
    this.debugTuning.cameraDistance = roundCameraValue(
      this.camera.position.distanceTo(this.cameraLookTarget),
    );
  }

  private updateCameraFollow(delta: number, snap: boolean): void {
    const snapshot = this.presentationSnapshot;
    if (!snapshot || !this.cameraFollowSeat || this.cameraPointerMode) return;

    const subjects = this.cameraFollowSeat === 'kid'
      ? [snapshot.kid.position]
      : snapshot.guards.map((guard) => guard.position);
    this.cameraFollowSubjectCount = subjects.length;
    const targetX = subjects.reduce((total, subject) => total + subject.x, 0) / subjects.length;
    const targetZ = subjects.reduce((total, subject) => total + subject.z, 0) / subjects.length;
    this.cameraFollowDesiredTarget.set(targetX, 0, targetZ);

    const snapPosition = snap || !this.cameraFollowInitialized;
    if (snapPosition) {
      this.cameraFollowTarget.copy(this.cameraFollowDesiredTarget);
      this.cameraFollowInitialized = true;
    } else {
      const positionFactor = exponentialFollowFactor(delta, ONLINE_CAMERA_POSITION_LAG_SECONDS);
      this.cameraFollowTarget.lerp(this.cameraFollowDesiredTarget, positionFactor);
    }

    this.cameraFollowOffset.copy(this.cameraFollowTarget).sub(this.cameraLookTarget);
    this.camera.position.add(this.cameraFollowOffset);
    this.cameraLookTarget.copy(this.cameraFollowTarget);
    this.camera.lookAt(this.cameraLookTarget);
    this.camera.updateMatrixWorld();

    const minimumZoom = this.islandWorld ? ISLAND_CAMERA_ZOOM : DEFAULT_DEBUG_TUNING.cameraZoom;
    let desiredZoom = ONLINE_CAMERA_MAX_ZOOM;
    let horizontalExtent = 0;
    let verticalExtent = 0;
    let halfWidth = 0;
    let halfHeight = 0;
    if (this.camera instanceof THREE.OrthographicCamera) {
      this.cameraFollowRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
      this.cameraFollowUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
      horizontalExtent = ONLINE_CAMERA_SUBJECT_PADDING;
      verticalExtent = ONLINE_CAMERA_SUBJECT_PADDING;
      for (const subject of subjects) {
        this.cameraFollowSubjectOffset.set(
          subject.x - this.cameraLookTarget.x,
          -this.cameraLookTarget.y,
          subject.z - this.cameraLookTarget.z,
        );
        horizontalExtent = Math.max(
          horizontalExtent,
          Math.abs(this.cameraFollowSubjectOffset.dot(this.cameraFollowRight)) +
            ONLINE_CAMERA_SUBJECT_PADDING,
        );
        verticalExtent = Math.max(
          verticalExtent,
          Math.abs(this.cameraFollowSubjectOffset.dot(this.cameraFollowUp)) +
            ONLINE_CAMERA_SUBJECT_PADDING,
        );
      }
      halfWidth = (this.camera.right - this.camera.left) / 2;
      halfHeight = (this.camera.top - this.camera.bottom) / 2;
      desiredZoom = resolveOrthographicFollowZoom(
        { halfWidth, halfHeight, horizontalExtent, verticalExtent },
        minimumZoom,
        ONLINE_CAMERA_MAX_ZOOM,
        ONLINE_CAMERA_SAFE_FRAME,
      );
    }
    desiredZoom = THREE.MathUtils.clamp(desiredZoom, minimumZoom, ONLINE_CAMERA_MAX_ZOOM);
    this.cameraFollowDesiredZoom = desiredZoom;

    if (snapPosition) {
      this.camera.zoom = desiredZoom;
    } else {
      const zoomLag = desiredZoom < this.camera.zoom
        ? ONLINE_CAMERA_ZOOM_OUT_LAG_SECONDS
        : ONLINE_CAMERA_ZOOM_IN_LAG_SECONDS;
      this.camera.zoom = THREE.MathUtils.lerp(
        this.camera.zoom,
        desiredZoom,
        exponentialFollowFactor(delta, zoomLag),
      );
    }
    this.camera.updateProjectionMatrix();
    this.cameraFollowFrameOccupancy = this.camera instanceof THREE.OrthographicCamera
      ? orthographicFrameOccupancy(
        { halfWidth, halfHeight, horizontalExtent, verticalExtent },
        this.camera.zoom,
      )
      : null;
  }

  private configureCameraControls(
    controls: OrbitControls,
    changeHandler: () => void,
  ): void {
    controls.enabled = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = false;
    controls.minZoom = 0.55;
    controls.maxZoom = 1.8;
    controls.minDistance = 45;
    controls.maxDistance = 320;
    controls.minPolarAngle = THREE.MathUtils.degToRad(15);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    controls.addEventListener('change', changeHandler);
  }

  private handleCameraControlsChange(controls: OrbitControls): void {
    if (!this.cameraPointerMode || controls !== this.cameraControls) return;
    this.syncCameraTuningFromControls();
    this.debugPanel?.refreshCamera();
    this.publishDiagnostics();
  }

  private setCameraPointerMode(enabled: boolean): void {
    if (this.cameraPointerMode === enabled) {
      this.syncCameraControlUi();
      return;
    }
    this.cameraPointerMode = enabled;
    this.orthographicControls.enabled = false;
    this.perspectiveControls.enabled = false;
    this.cameraControls.enabled = enabled;
    this.canvas.classList.toggle('camera-pointer-mode', enabled);
    if (enabled) {
      this.cameraControls.target.copy(this.cameraLookTarget);
      this.cameraControls.update();
    }
    this.syncCameraTuningFromControls();
    if (!enabled && this.cameraFollowSeat) {
      this.restoreCameraFollowComposition();
      this.updateCameraFollow(0, true);
    }
    this.debugPanel?.setCameraPointerMode(enabled);
    this.syncCameraControlUi();
    this.publishDiagnostics();
  }

  private restoreCameraFollowComposition(): void {
    if (this.islandWorld) {
      this.debugTuning.cameraPositionX = 0;
      this.debugTuning.cameraTargetX = 0;
      this.debugTuning.cameraTargetY = 0;
      this.debugTuning.cameraTargetZ = 0;
      this.configureIslandCamera();
    }
    this.updateCameraComposition();
  }

  private syncCameraControlUi(): void {
    this.cameraControl.dataset.mode = this.cameraPointerMode ? 'mouse' : 'fixed';
    this.cameraModeToggle.setAttribute('aria-pressed', String(this.cameraPointerMode));
    this.cameraModeToggle.title = this.cameraPointerMode
      ? '固定当前镜头'
      : '开启自由镜头';
    this.cameraModeToggle.setAttribute(
      'aria-label',
      this.cameraPointerMode
        ? '自由镜头已开启，点击固定当前镜头'
        : '开启自由镜头：左键旋转，右键平移，滚轮缩放',
    );
    this.cameraModeLabel.textContent = this.cameraPointerMode ? '固定镜头' : '自由镜头';
  }

  private setCameraProjection(projection: CameraProjection): void {
    if (this.activeProjection === projection) {
      this.perspectiveCamera.fov = this.debugTuning.perspectiveFov;
      this.perspectiveCamera.updateProjectionMatrix();
      this.debugPanel?.setCameraProjection(projection);
      return;
    }

    const sourceCamera = this.camera;
    const sourceControls = this.cameraControls;
    if (this.cameraPointerMode) sourceControls.update();
    sourceControls.enabled = false;
    sourceCamera.getWorldDirection(this.projectionDirection);
    const sourceDistance = sourceCamera.position.distanceTo(this.cameraLookTarget);

    this.activeProjection = projection;
    this.debugTuning.cameraProjection = projection;
    const destinationCamera = this.camera;
    const destinationControls = this.cameraControls;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    updateCameraProjection(destinationCamera, width, height);
    destinationCamera.zoom = this.debugTuning.cameraZoom;

    const distance = projection === 'weak-perspective'
      ? this.perspectiveDistanceForOrthographicFrame(width, height)
      : sourceDistance;
    destinationCamera.position.copy(this.cameraLookTarget)
      .addScaledVector(this.projectionDirection, -distance);
    destinationCamera.lookAt(this.cameraLookTarget);
    destinationCamera.updateProjectionMatrix();
    destinationControls.target.copy(this.cameraLookTarget);
    destinationControls.enabled = this.cameraPointerMode;
    destinationControls.update();
    this.syncCameraTuningFromControls();
    this.debugPanel?.setCameraProjection(projection);
    this.debugPanel?.refreshCamera();
    this.publishDiagnostics();
  }

  private perspectiveDistanceForOrthographicFrame(width: number, height: number): number {
    updateCameraProjection(this.orthographicCamera, width, height);
    this.perspectiveCamera.fov = this.debugTuning.perspectiveFov;
    this.perspectiveCamera.aspect = width / height;
    const viewHeight = this.orthographicCamera.top - this.orthographicCamera.bottom;
    return viewHeight / (
      2 * Math.tan(THREE.MathUtils.degToRad(this.debugTuning.perspectiveFov / 2))
    );
  }

  private updatePerspectiveFov(): void {
    this.perspectiveCamera.fov = this.debugTuning.perspectiveFov;
    this.perspectiveCamera.updateProjectionMatrix();
    this.publishDiagnostics();
  }

  private syncCameraTuningFromControls(): void {
    this.cameraLookTarget.copy(this.cameraControls.target);
    this.debugTuning.cameraPositionX = roundCameraValue(this.camera.position.x);
    this.debugTuning.cameraPositionY = roundCameraValue(this.camera.position.y);
    this.debugTuning.cameraPositionZ = roundCameraValue(this.camera.position.z);
    this.debugTuning.cameraTargetX = roundCameraValue(this.cameraLookTarget.x);
    this.debugTuning.cameraTargetY = roundCameraValue(this.cameraLookTarget.y);
    this.debugTuning.cameraTargetZ = roundCameraValue(this.cameraLookTarget.z);
    this.debugTuning.landscapeCameraAngle = roundCameraValue(this.cameraAngleFromGroundNormal());
    this.debugTuning.cameraZoom = roundCameraValue(this.camera.zoom);
    this.debugTuning.cameraDistance = roundCameraValue(
      this.camera.position.distanceTo(this.cameraLookTarget),
    );
  }

  private updateLandscapeCameraPositionFromAngle(): void {
    const horizontalX = this.debugTuning.cameraPositionX - this.debugTuning.cameraTargetX;
    const horizontalZ = this.debugTuning.cameraPositionZ - this.debugTuning.cameraTargetZ;
    const horizontalLength = Math.hypot(horizontalX, horizontalZ);
    const directionX = horizontalLength > 0.001 ? horizontalX / horizontalLength : 0;
    const directionZ = horizontalLength > 0.001 ? horizontalZ / horizontalLength : 1;
    const verticalDistance = Math.max(
      1,
      Math.abs(this.debugTuning.cameraPositionY - this.debugTuning.cameraTargetY),
    );
    const horizontalDistance = verticalDistance * Math.tan(
      THREE.MathUtils.degToRad(this.debugTuning.landscapeCameraAngle),
    );
    this.debugTuning.cameraPositionX = roundCameraValue(
      this.debugTuning.cameraTargetX + directionX * horizontalDistance,
    );
    this.debugTuning.cameraPositionZ = roundCameraValue(
      this.debugTuning.cameraTargetZ + directionZ * horizontalDistance,
    );
  }

  private cameraAngleFromGroundNormal(): number {
    const horizontalDistance = Math.hypot(
      this.camera.position.x - this.cameraLookTarget.x,
      this.camera.position.z - this.cameraLookTarget.z,
    );
    const verticalDistance = Math.abs(this.camera.position.y - this.cameraLookTarget.y);
    return THREE.MathUtils.radToDeg(Math.atan2(horizontalDistance, Math.max(0.001, verticalDistance)));
  }

  private createLighting(): void {
    if (this.islandWorld) {
      this.hemisphere.color.set('#fff3d4');
      this.hemisphere.groundColor.set('#4e7148');
      this.sun.color.set('#ffe4a8');
    }
    this.scene.add(this.hemisphere);
    this.sun.position.set(
      this.islandWorld ? -42 : -45,
      this.islandWorld ? 88 : 90,
      this.islandWorld ? 46 : 50,
    );
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.camera.left = this.islandWorld ? -44 : -70;
    this.sun.shadow.camera.right = this.islandWorld ? 44 : 70;
    this.sun.shadow.camera.top = this.islandWorld ? 36 : 55;
    this.sun.shadow.camera.bottom = this.islandWorld ? -36 : -55;
    this.sun.shadow.bias = this.islandWorld ? -0.00025 : -0.0004;
    this.sun.shadow.normalBias = this.islandWorld ? 0.025 : 0;
    this.sun.shadow.radius = this.islandWorld ? 1.35 : 1;
    this.scene.add(this.sun);
  }

  private async installDebugPanel(): Promise<void> {
    const { DebugPanel: DebugPanelClass } = await import('../systems/DebugPanel');
    if (this.disposed) return;
    this.debugPanel = new DebugPanelClass(this.debugTuning, {
      cameraPointerModeChanged: (enabled) => {
        this.setCameraPointerMode(enabled);
      },
      cameraProjectionChanged: () => {
        this.setCameraProjection(this.debugTuning.cameraProjection);
      },
      perspectiveFovChanged: () => {
        this.updatePerspectiveFov();
      },
      cameraAngleChanged: () => {
        this.updateLandscapeCameraPositionFromAngle();
        this.updateCameraComposition();
        this.publishDiagnostics();
        this.debugPanel?.refresh();
      },
      cameraChanged: () => {
        this.updateCameraComposition();
        this.publishDiagnostics();
        this.debugPanel?.refresh();
      },
      movementChanged: () => {
        this.driver.setMovementTuning(this.debugTuning);
        this.publishDiagnostics();
      },
      lightingChanged: () => {
        this.hemisphere.intensity = this.debugTuning.hemisphereIntensity;
        this.sun.intensity = this.debugTuning.sunIntensity;
      },
      motionChanged: () => {
        this.reducedMotion = this.debugTuning.reducedMotion;
        this.syncPresentation();
      },
      reset: () => {
        Object.assign(this.debugTuning, DEFAULT_DEBUG_TUNING);
        this.setCameraProjection(this.debugTuning.cameraProjection);
        this.driver.setMovementTuning(this.debugTuning);
        this.reducedMotion = this.debugTuning.reducedMotion;
        this.hemisphere.intensity = this.debugTuning.hemisphereIntensity;
        this.sun.intensity = this.debugTuning.sunIntensity;
        this.updateCameraComposition();
        this.syncPresentation();
        this.publishDiagnostics();
        this.debugPanel?.refresh();
      },
    });
    this.debugPanel.setCameraProjection(this.activeProjection);
    this.debugPanel.setCameraPointerMode(this.cameraPointerMode);
    this.debugPanel.setHidden(this.debugUiHidden);
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.driver.seed(value);
      },
      setState: (name: string) => {
        this.driver.loadScenario(name === 'complete' ? 'kid-win' : name);
        this.syncPresentation();
        this.publishDiagnostics();
      },
      scenario: (name: string) => {
        this.driver.loadScenario(name);
        this.syncPresentation();
        this.publishDiagnostics();
      },
      step: (partialCommands, ticks = 1) => {
        const commands = this.mergeTestCommands(partialCommands);
        let result = this.driver.getSnapshot();
        for (const step of this.driver.stepForTest(commands, ticks)) {
          this.handleStep(step);
          result = step.snapshot;
        }
        this.syncPresentation();
        this.publishDiagnostics();
        return result;
      },
      getSnapshot: () => this.presentationSnapshot ?? this.driver.getSnapshot(),
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.debugTuning.reducedMotion = enabled;
        this.debugPanel?.refresh();
        this.syncPresentation();
        this.publishDiagnostics();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugUiHidden = hidden;
        this.debugPanel?.setHidden(hidden);
      },
    };
  }

  private mergeTestCommands(partial?: Partial<GameCommands>): GameCommands {
    const commands = createEmptyCommands();
    if (!partial) return commands;
    return {
      guard1: { ...commands.guard1, ...partial.guard1 },
      guard2: { ...commands.guard2, ...partial.guard2 },
      kid: { ...commands.kid, ...partial.kid },
      restartPressed: partial.restartPressed ?? false,
    };
  }

  private cameraViewMetrics(): { width: number; height: number; verticalOffset: number } {
    if (this.camera instanceof THREE.OrthographicCamera) {
      return {
        width: this.camera.right - this.camera.left,
        height: this.camera.top - this.camera.bottom,
        verticalOffset: (this.camera.top + this.camera.bottom) / 2,
      };
    }
    const distance = this.camera.position.distanceTo(this.cameraLookTarget);
    const height = 2 * distance * Math.tan(
      THREE.MathUtils.degToRad(this.camera.fov / 2),
    ) / this.camera.zoom;
    return {
      width: height * this.camera.aspect,
      height,
      verticalOffset: 0,
    };
  }

  private publishDiagnostics(): void {
    const snapshot = this.presentationSnapshot ?? this.driver.getSnapshot();
    const info = this.renderer.info;
    const groundAppleCount = snapshot.apples.filter((apple) => apple.state === 'Ground').length;
    const looseAppleCount = snapshot.apples.filter((apple) => apple.state !== 'Carried').length;
    this.camera.getWorldDirection(this.cameraDirection);
    const cameraView = this.cameraViewMetrics();
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      frameRate: {
        current: this.fps,
        cap: GAME_CONFIG.maxFrameRate,
      },
      tick: snapshot.tick,
      elapsed: snapshot.elapsedSeconds,
      matchState: snapshot.matchState,
      catches: snapshot.catches,
      delivered: snapshot.delivered,
      totalApples: snapshot.totalApples,
      kid: snapshot.kid,
      guards: snapshot.guards,
      apples: {
        ground: groundAppleCount,
        carried: snapshot.apples.filter((apple) => apple.state === 'Carried').length,
        delivered: snapshot.apples.filter((apple) => apple.state === 'Delivered').length,
      },
      physics: {
        engine: 'custom-xz-circles',
        timestep: FIXED_DELTA_SECONDS,
        bodies: 3 + looseAppleCount,
        colliders: 4 + this.map.trees.length + this.map.landmarks.length + looseAppleCount,
        sensors: deliveryZonesForMap(this.map).length,
        ccdBodies: 0,
      },
      movement: this.driver.getMovementTuning(),
      audio: this.audio.getDiagnostics(),
      environment: this.view.getEnvironmentDiagnostics(),
      characters: this.view.getCharacterDiagnostics(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        toneMapping: 'ACESFilmic',
        exposure: this.renderer.toneMappingExposure,
        shadowMapEnabled: this.renderer.shadowMap.enabled,
        shadowMapType: this.renderer.shadowMap.type === THREE.PCFSoftShadowMap
          ? 'PCFSoft'
          : 'PCF',
        shadowMapSize: this.sun.shadow.mapSize.x,
        shadowCastingLights: this.sun.castShadow ? 1 : 0,
        postPasses: 0,
      },
      camera: {
        controlMode: this.cameraPointerMode ? 'mouse' : 'manual',
        followSeat: this.cameraFollowSeat,
        followActive: this.cameraFollowSeat !== null && !this.cameraPointerMode,
        followDesiredZoom: this.cameraFollowDesiredZoom,
        followFrameOccupancy: this.cameraFollowFrameOccupancy,
        followSubjectCount: this.cameraFollowSubjectCount,
        projectionMode: this.activeProjection,
        perspectiveFov: this.activeProjection === 'weak-perspective'
          ? this.perspectiveCamera.fov
          : null,
        distance: this.camera.position.distanceTo(this.cameraLookTarget),
        viewWidth: cameraView.width,
        viewHeight: cameraView.height,
        verticalOffset: cameraView.verticalOffset,
        portraitLayout: usesPortraitArenaLayout(this.canvas.clientWidth / this.canvas.clientHeight),
        positionX: this.camera.position.x,
        positionY: this.camera.position.y,
        positionZ: this.camera.position.z,
        targetX: this.cameraLookTarget.x,
        targetY: this.cameraLookTarget.y,
        targetZ: this.cameraLookTarget.z,
        directionX: this.cameraDirection.x,
        directionY: this.cameraDirection.y,
        directionZ: this.cameraDirection.z,
        angleFromGroundNormal: roundCameraValue(this.cameraAngleFromGroundNormal()),
        zoom: this.camera.zoom,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, GAME_CONFIG.maxDpr),
      },
    };
  }
}

function roundCameraValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function exponentialFollowFactor(delta: number, lagSeconds: number): number {
  return 1 - Math.exp(-Math.max(0, delta) / Math.max(0.001, lagSeconds));
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector} element.`);
  return element;
}
