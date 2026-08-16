import * as THREE from 'three';
import { GAME_CONFIG } from '../game/config';

const LANDSCAPE_WORLD_WIDTH = GAME_CONFIG.arenaHalfWidth * 2 * 1.06;
const PORTRAIT_WORLD_WIDTH = GAME_CONFIG.arenaHalfDepth * 2 * 1.25;
const LANDSCAPE_WORLD_HEIGHT = GAME_CONFIG.arenaHalfDepth * 2 * 1.12;
const PORTRAIT_WORLD_HEIGHT = GAME_CONFIG.arenaHalfWidth * 2 * 1.25;
const PORTRAIT_LAYOUT_THRESHOLD = 0.86;

export type CameraProjection = 'orthographic' | 'weak-perspective';
export type ResponsiveCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera;

export function usesPortraitArenaLayout(aspect: number): boolean {
  return aspect < PORTRAIT_LAYOUT_THRESHOLD;
}

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: ResponsiveCamera,
  maxDpr = 2,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);
  const needsResize = canvas.width !== bufferWidth || canvas.height !== bufferHeight;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    updateCameraProjection(camera, width, height);
  }

  return needsResize;
}

export function updateCameraProjection(
  camera: ResponsiveCamera,
  width: number,
  height: number,
): void {
  const aspect = Math.max(1, width) / Math.max(1, height);
  if (camera instanceof THREE.OrthographicCamera) {
    const portraitLayout = usesPortraitArenaLayout(aspect);
    const minimumWorldWidth = portraitLayout ? PORTRAIT_WORLD_WIDTH : LANDSCAPE_WORLD_WIDTH;
    const minimumWorldHeight = portraitLayout ? PORTRAIT_WORLD_HEIGHT : LANDSCAPE_WORLD_HEIGHT;
    const viewHeight = Math.max(minimumWorldHeight, minimumWorldWidth / aspect);
    const viewWidth = viewHeight * aspect;
    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
  } else {
    camera.aspect = aspect;
  }
  camera.updateProjectionMatrix();
}
