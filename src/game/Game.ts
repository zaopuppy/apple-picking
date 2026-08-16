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
import type { DebugPanel, DebugTuning } from '../systems/DebugPanel';
import { Hud } from '../systems/Hud';
import { loadActiveMap } from '../systems/MapStorage';
import { DEFAULT_MOVEMENT_TUNING, FIXED_DELTA_SECONDS, GAME_CONFIG } from './config';
import { GameSimulation } from './GameSimulation';
import {
  resolveMedievalWorldMap,
  type MedievalWorldPreset,
} from './maps/MedievalWorldExperiments';
import { resolveIslandTourMap } from './maps/IslandTourMap';
import { deliveryZonesForMap, type OrchardMap } from './maps/OrchardMap';
import {
  commandsWithoutEdges,
  createEmptyCommands,
  type GameCommands,
  type SimulationStep,
} from './types';

const PORTRAIT_CAMERA_ANGLE = 25;
const DEFAULT_LANDSCAPE_CAMERA_ANGLE = 34;
const DEFAULT_PERSPECTIVE_FOV = 22;
const DEFAULT_LANDSCAPE_CAMERA_HEIGHT = 117.5;
const ISLAND_LANDSCAPE_CAMERA_ANGLE = 40;
const ISLAND_LANDSCAPE_CAMERA_HEIGHT = 112;
const ISLAND_CAMERA_ZOOM = 0.96;
const DEFAULT_LANDSCAPE_CAMERA_DISTANCE = roundCameraValue(DEFAULT_LANDSCAPE_CAMERA_HEIGHT *
  Math.tan(THREE.MathUtils.degToRad(DEFAULT_LANDSCAPE_CAMERA_ANGLE)));

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
  private readonly map: OrchardMap;
  private readonly islandWorld: boolean;
  private readonly simulation: GameSimulation;
  private readonly hemisphere = new THREE.HemisphereLight('#fff7db', '#55743d', 2.1);
  private readonly sun = new THREE.DirectionalLight('#fff0bd', 3.1);
  private readonly debugTuning: DebugTuning = { ...DEFAULT_DEBUG_TUNING };
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly projectionDirection = new THREE.Vector3();
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

  private frame = 0;
  private accumulator = 0;
  private fps = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private renderTime = 0;
  private debugPanel: DebugPanel | null = null;
  private debugUiHidden = false;
  private cameraPointerMode = false;
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

  constructor(private readonly canvas: HTMLCanvasElement) {
    const activeMap = loadActiveMap();
    const islandMap = resolveIslandTourMap();
    const medievalWorld = islandMap ? null : resolveMedievalWorldMap(activeMap);
    this.map = islandMap ?? medievalWorld?.map ?? activeMap;
    this.islandWorld = islandMap !== null;
    if (this.islandWorld) this.configureIslandCamera();
    this.simulation = new GameSimulation(this.map);
    this.renderer = createRenderer(canvas);
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
    this.createLighting();
    this.view = new ArenaView(this.scene, this.map);
    const mapName = document.querySelector<HTMLElement>('#active-map-name');
    if (mapName) mapName.textContent = this.map.name;
    this.configureWorldNavigation(medievalWorld?.preset ?? null, this.islandWorld);
    resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    this.updateCameraComposition();
    this.syncPresentation();
    this.installTestHooks();
    this.publishDiagnostics();
    if (import.meta.env.DEV) void this.installDebugPanel();
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
    this.audio.dispose();
    this.view.dispose();
    this.debugPanel?.dispose();
    this.debugPanel = null;
    this.orthographicControls.removeEventListener('change', this.handleOrthographicControlsChange);
    this.perspectiveControls.removeEventListener('change', this.handlePerspectiveControlsChange);
    this.orthographicControls.dispose();
    this.perspectiveControls.dispose();
    this.canvas.removeEventListener('contextmenu', this.handleCanvasContextMenu);
    this.canvas.classList.remove('camera-pointer-mode');
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number, fps: number): void {
    this.frame += 1;
    this.fps = fps;
    if (resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr)) {
      this.updateCameraComposition();
    }
    if (this.cameraPointerMode) this.cameraControls.update();
    this.renderTime = elapsed;
    if (this.pausedForScreenshot) {
      this.syncPresentation();
      this.publishDiagnostics();
      return;
    }

    this.accumulator += Math.min(delta, GAME_CONFIG.maxFrameDelta);
    let firstStep = true;
    while (this.accumulator >= FIXED_DELTA_SECONDS) {
      const commands = firstStep ? this.input.consumeCommands() : this.input.readHeldCommands();
      this.handleStep(this.simulation.step(commands));
      this.accumulator -= FIXED_DELTA_SECONDS;
      firstStep = false;
    }
    this.syncPresentation();
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
    const snapshot = this.simulation.getSnapshot();
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
    if (this.cameraPointerMode === enabled) return;
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
    this.debugPanel?.setCameraPointerMode(enabled);
    this.publishDiagnostics();
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
    this.scene.add(this.hemisphere);
    this.sun.position.set(-45, 90, 50);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.bias = -0.0004;
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
        this.simulation.setMovementTuning(this.debugTuning);
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
        this.simulation.setMovementTuning(this.debugTuning);
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
        this.simulation.seed(value);
      },
      setState: (name: string) => {
        this.simulation.loadScenario(name === 'complete' ? 'kid-win' : name);
        this.syncPresentation();
        this.publishDiagnostics();
      },
      scenario: (name: string) => {
        this.simulation.loadScenario(name);
        this.syncPresentation();
        this.publishDiagnostics();
      },
      step: (partialCommands, ticks = 1) => {
        let commands = this.mergeTestCommands(partialCommands);
        let result = this.simulation.getSnapshot();
        for (let index = 0; index < Math.max(1, ticks); index += 1) {
          const step = this.simulation.step(commands);
          this.handleStep(step);
          result = step.snapshot;
          commands = commandsWithoutEdges(commands);
        }
        this.syncPresentation();
        this.publishDiagnostics();
        return result;
      },
      getSnapshot: () => this.simulation.getSnapshot(),
      setPausedForScreenshot: (paused: boolean) => {
        this.pausedForScreenshot = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
        this.debugTuning.reducedMotion = enabled;
        this.debugPanel?.refresh();
        this.syncPresentation();
      },
      hideDebugUi: (hidden: boolean) => {
        this.debugUiHidden = hidden;
        if (hidden) this.setCameraPointerMode(false);
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
    const snapshot = this.simulation.getSnapshot();
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
      movement: this.simulation.getMovementTuning(),
      audio: this.audio.getDiagnostics(),
      environment: this.view.getEnvironmentDiagnostics(),
      characters: this.view.getCharacterDiagnostics(),
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      camera: {
        controlMode: this.cameraPointerMode ? 'mouse' : 'manual',
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
