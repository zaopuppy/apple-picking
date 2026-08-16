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
    movement: {
      baseSpeed: number;
      guardSpeedMultiplier: number;
      kidSpeedMultiplier: number;
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
      fruitMode: 'loading' | 'imported' | 'procedural';
      externalRequested: boolean;
      treeVariants: number;
      treeInstances: number;
      stumpInstances: number;
      largeTreeInstances: number;
      treeTriangles: number;
      fruitInstances: number;
      fruitTriangles: number;
      mapId: string;
      mapName: string;
      paths: number;
      clearings: number;
      landmarks: number;
      terrainZones: number;
      deliveryZones: number;
      landmarkMode: 'loading' | 'imported' | 'procedural';
      importedHomesteads: number;
      landmarkMeshes: number;
      landmarkTriangles: number;
      landmarkAssetMeshes: number;
      landmarkAssetTriangles: number;
      landmarkAssetMaterials: number;
      landmarkAssetTextures: number;
      landmarkHouseBounds: {
        width: number;
        height: number;
        depth: number;
      } | null;
      landmarkLastFailure: string | null;
      worldMode: 'procedural' | 'loading' | 'medieval' | 'island';
      worldPreset: 'village' | 'riverside' | 'fortified' | null;
      worldTileInstances: number;
      worldPropInstances: number;
      worldMeshes: number;
      worldTriangles: number;
      worldMaterials: number;
      worldTextures: number;
      worldAssetRequests: number;
      worldCatalogAssets: number;
      worldTileShape: 'square' | 'hex' | null;
      worldLastFailure: string | null;
      groundMaterialMode: 'flat-color' | 'grass-texture';
      deliveryMarkerMode: 'ring' | 'parcel-sign';
      deliveryMarkerLabels: number;
      waterSegments: number;
      waterCollisionBlocks: number;
      bridges: number;
      arenaWidth: number;
      arenaDepth: number;
      lastFailure: string | null;
    };
    characters: {
      guard1Mode: 'loading' | 'imported' | 'failed';
      guard2Mode: 'loading' | 'imported' | 'failed';
      kidMode: 'loading' | 'imported' | 'failed';
      importedGuards: number;
      importedCharacters: number;
      meshes: number;
      triangles: number;
      materials: number;
      textures: number;
      animations: string[];
      kidAnimations: string[];
      currentAnimations: {
        guard1: string | null;
        guard2: string | null;
        kid: string | null;
      };
      sockets: string[];
      kidSockets: string[];
      kidDetails: {
        backpackScaleZ: number;
        sweatDrops: number;
        postureLean: number;
        breathScaleY: number;
        animationPaused: boolean | null;
        headShakeAngle: number;
      } | null;
      lastFailure: string | null;
      lastFailures: {
        guard1: string | null;
        guard2: string | null;
        kid: string | null;
      };
    };
    renderer: {
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
    };
    camera: {
      controlMode: 'manual' | 'mouse';
      projectionMode: 'orthographic' | 'weak-perspective';
      perspectiveFov: number | null;
      distance: number;
      viewWidth: number;
      viewHeight: number;
      verticalOffset: number;
      portraitLayout: boolean;
      positionX: number;
      positionY: number;
      positionZ: number;
      targetX: number;
      targetY: number;
      targetZ: number;
      directionX: number;
      directionY: number;
      directionZ: number;
      angleFromGroundNormal: number;
      zoom: number;
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
