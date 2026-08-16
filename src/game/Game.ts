import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { InputRouter } from '../core/InputRouter';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer, usesPortraitArenaLayout } from '../core/Renderer';
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
import type { OrchardMap } from './maps/OrchardMap';
import {
  commandsWithoutEdges,
  createEmptyCommands,
  type GameCommands,
  type SimulationStep,
} from './types';

const PORTRAIT_CAMERA_ANGLE = 25;
const DEFAULT_LANDSCAPE_CAMERA_ANGLE = 34;
const DEFAULT_LANDSCAPE_CAMERA_HEIGHT = 117.5;
const DEFAULT_LANDSCAPE_CAMERA_DISTANCE = roundCameraValue(DEFAULT_LANDSCAPE_CAMERA_HEIGHT *
  Math.tan(THREE.MathUtils.degToRad(DEFAULT_LANDSCAPE_CAMERA_ANGLE)));

const DEFAULT_DEBUG_TUNING: Readonly<DebugTuning> = {
  ...DEFAULT_MOVEMENT_TUNING,
  landscapeCameraAngle: DEFAULT_LANDSCAPE_CAMERA_ANGLE,
  cameraZoom: 1.08,
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
  private readonly camera = new THREE.OrthographicCamera(-70, 70, 55, -55, 0.1, 500);
  private readonly cameraControls: OrbitControls;
  private readonly input = new InputRouter();
  private readonly map: OrchardMap;
  private readonly simulation: GameSimulation;
  private readonly hemisphere = new THREE.HemisphereLight('#fff7db', '#55743d', 2.1);
  private readonly sun = new THREE.DirectionalLight('#fff0bd', 3.1);
  private readonly debugTuning: DebugTuning = { ...DEFAULT_DEBUG_TUNING };
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly view: ArenaView;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly loop = new Loop(
    (delta, elapsed, fps) => this.update(delta, elapsed, fps),
    () => this.render(),
    GAME_CONFIG.maxFrameRate,
  );
  private readonly handleCameraControlsChange = (): void => {
    if (!this.cameraPointerMode) return;
    this.syncCameraTuningFromControls();
    this.debugPanel?.refreshCamera();
    this.publishDiagnostics();
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
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const activeMap = loadActiveMap();
    const medievalWorld = resolveMedievalWorldMap(activeMap);
    this.map = medievalWorld?.map ?? activeMap;
    this.simulation = new GameSimulation(this.map);
    this.renderer = createRenderer(canvas);
    this.scene.background = new THREE.Color('#91ad62');
    this.camera.position.set(0, 117.5, 97.5);
    this.camera.lookAt(0, 0, 0);
    this.cameraControls = new OrbitControls(this.camera, canvas);
    this.configureCameraControls();
    this.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu);
    this.createLighting();
    this.view = new ArenaView(this.scene, this.map);
    const mapName = document.querySelector<HTMLElement>('#active-map-name');
    if (mapName) mapName.textContent = this.map.name;
    this.configureWorldNavigation(medievalWorld?.preset ?? null);
    resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    this.updateCameraComposition();
    this.syncPresentation();
    this.installTestHooks();
    this.publishDiagnostics();
    if (import.meta.env.DEV) void this.installDebugPanel();
  }

  private configureWorldNavigation(preset: MedievalWorldPreset | null): void {
    const customWorld = new URLSearchParams(window.location.search).get('world') === 'custom';
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-world-layout]')) {
      const active = customWorld
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
    this.cameraControls.removeEventListener('change', this.handleCameraControlsChange);
    this.cameraControls.dispose();
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
    if (this.cameraPointerMode) {
      this.camera.updateProjectionMatrix();
      return;
    }
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const portraitLayout = usesPortraitArenaLayout(width / height);
    if (portraitLayout) {
      const cameraHeight = 170;
      const horizontalDistance = cameraHeight * Math.tan(THREE.MathUtils.degToRad(PORTRAIT_CAMERA_ANGLE));
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
  }

  private configureCameraControls(): void {
    this.cameraControls.enabled = false;
    this.cameraControls.enableDamping = true;
    this.cameraControls.dampingFactor = 0.08;
    this.cameraControls.enablePan = true;
    this.cameraControls.screenSpacePanning = true;
    this.cameraControls.zoomToCursor = false;
    this.cameraControls.minZoom = 0.55;
    this.cameraControls.maxZoom = 1.8;
    this.cameraControls.minPolarAngle = THREE.MathUtils.degToRad(15);
    this.cameraControls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    this.cameraControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.cameraControls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.cameraControls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    this.cameraControls.addEventListener('change', this.handleCameraControlsChange);
  }

  private setCameraPointerMode(enabled: boolean): void {
    if (this.cameraPointerMode === enabled) return;
    this.cameraPointerMode = enabled;
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

  private publishDiagnostics(): void {
    const snapshot = this.simulation.getSnapshot();
    const info = this.renderer.info;
    const groundAppleCount = snapshot.apples.filter((apple) => apple.state === 'Ground').length;
    const looseAppleCount = snapshot.apples.filter((apple) => apple.state !== 'Carried').length;
    this.camera.getWorldDirection(this.cameraDirection);
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
        sensors: 1,
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
        viewWidth: this.camera.right - this.camera.left,
        viewHeight: this.camera.top - this.camera.bottom,
        verticalOffset: (this.camera.top + this.camera.bottom) / 2,
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
