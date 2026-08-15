/// <reference types="vite/client" />

import type { AppleSnapshot, GameCommands, GameSnapshot, GuardSnapshot, KidSnapshot, MatchState } from './game/types';

declare global {
  interface ThreeGameDiagnostics {
    frame: number;
    frameRate: {
      current: number;
      cap: number;
    };
    tick: number;
    elapsed: number;
    matchState: MatchState;
    catches: number;
    delivered: number;
    totalApples: number;
    kid: KidSnapshot;
    guards: [GuardSnapshot, GuardSnapshot];
    apples: {
      ground: number;
      carried: number;
      delivered: number;
    };
    physics: {
      engine: string;
      timestep: number;
      bodies: number;
      colliders: number;
      sensors: number;
      ccdBodies: number;
    };
    audio: {
      externalEnabled: boolean;
      unlocked: boolean;
      sampleFiles: number;
      fetchedSamples: number;
      decodedSamples: number;
      failedSamples: number;
      lastFailure: string | null;
      samplePlays: number;
      fallbackPlays: number;
    };
    environment: {
      treeMode: 'loading' | 'imported' | 'procedural';
      externalRequested: boolean;
      treeVariants: number;
      treeInstances: number;
      treeTriangles: number;
      lastFailure: string | null;
    };
    renderer: {
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
    };
    camera: {
      viewWidth: number;
      viewHeight: number;
      verticalOffset: number;
      portraitLayout: boolean;
      positionX: number;
      positionY: number;
      positionZ: number;
    };
    canvas: {
      clientWidth: number;
      clientHeight: number;
      width: number;
      height: number;
      dpr: number;
    };
  }

  interface ThreeGameTestHooks {
    seed(value: number): void;
    setState(name: string): void;
    scenario(name: string): void;
    step(commands?: Partial<GameCommands>, ticks?: number): GameSnapshot;
    getSnapshot(): GameSnapshot;
    setPausedForScreenshot(paused: boolean): void;
    setReducedMotion(enabled: boolean): void;
    hideDebugUi(hidden: boolean): void;
  }

  interface Window {
    __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
    __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
  }
}

export type { AppleSnapshot };
export {};
