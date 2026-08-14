import * as THREE from 'three';
import { InputRouter } from '../core/InputRouter';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { ArenaView } from '../render/ArenaView';
import { AudioSystem } from '../systems/AudioSystem';
import { Hud } from '../systems/Hud';
import { FIXED_DELTA_SECONDS, GAME_CONFIG } from './config';
import { GameSimulation } from './GameSimulation';
import {
  commandsWithoutEdges,
  createEmptyCommands,
  type GameCommands,
  type SimulationStep,
} from './types';

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-14, 14, 11, -11, 0.1, 100);
  private readonly input = new InputRouter();
  private readonly simulation = new GameSimulation();
  private readonly view: ArenaView;
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private frame = 0;
  private accumulator = 0;
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private renderTime = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.scene.background = new THREE.Color('#cfe3b0');
    this.scene.fog = new THREE.Fog('#cfe3b0', 31, 55);
    this.camera.position.set(0, 23.5, 19.5);
    this.camera.lookAt(0, 0, 0);
    this.createLighting();
    this.view = new ArenaView(this.scene);
    resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    this.syncPresentation();
    this.installTestHooks();
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.view.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    resizeRenderer(this.renderer, this.camera, GAME_CONFIG.maxDpr);
    this.renderTime = this.reducedMotion ? 0 : elapsed;
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
    for (const event of step.events) {
      this.hud.announce(event);
      this.audio.play(event);
    }
  }

  private syncPresentation(): void {
    const snapshot = this.simulation.getSnapshot();
    this.view.sync(snapshot, this.renderTime, this.reducedMotion);
    this.hud.update(snapshot);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private createLighting(): void {
    const hemisphere = new THREE.HemisphereLight('#fff7db', '#55743d', 2.1);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight('#fff0bd', 3.1);
    sun.position.set(-9, 18, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 48;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.bias = -0.0004;
    this.scene.add(sun);
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
        this.syncPresentation();
      },
      hideDebugUi: (_hidden: boolean) => {
        // The greybox has no player-facing debug panel.
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
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      tick: snapshot.tick,
      elapsed: snapshot.elapsedSeconds,
      matchState: snapshot.matchState,
      catches: snapshot.catches,
      delivered: snapshot.delivered,
      totalApples: snapshot.totalApples,
      kid: snapshot.kid,
      guards: snapshot.guards,
      apples: {
        ground: snapshot.apples.filter((apple) => apple.state === 'Ground').length,
        carried: snapshot.apples.filter((apple) => apple.state === 'Carried').length,
        delivered: snapshot.apples.filter((apple) => apple.state === 'Delivered').length,
      },
      physics: {
        engine: 'custom-xz-circle-aabb',
        timestep: FIXED_DELTA_SECONDS,
        bodies: 3,
        colliders: 7,
        sensors: 1,
        ccdBodies: 0,
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
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
