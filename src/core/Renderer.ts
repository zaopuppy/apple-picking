import * as THREE from 'three';

const LANDSCAPE_WORLD_WIDTH = 29;
const PORTRAIT_WORLD_WIDTH = 25;
const MINIMUM_WORLD_HEIGHT = 23;
const PORTRAIT_BLEND_START = 0.9;
const PORTRAIT_BLEND_END = 0.62;
const PORTRAIT_VERTICAL_OFFSET = 0.65;

export function getPortraitFramingAmount(aspect: number): number {
  return THREE.MathUtils.clamp(
    (PORTRAIT_BLEND_START - aspect) / (PORTRAIT_BLEND_START - PORTRAIT_BLEND_END),
    0,
    1,
  );
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
  camera: THREE.OrthographicCamera,
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
    const aspect = width / height;
    const portraitAmount = getPortraitFramingAmount(aspect);
    const minimumWorldWidth = THREE.MathUtils.lerp(
      LANDSCAPE_WORLD_WIDTH,
      PORTRAIT_WORLD_WIDTH,
      portraitAmount,
    );
    const viewHeight = Math.max(MINIMUM_WORLD_HEIGHT, minimumWorldWidth / aspect);
    const viewWidth = viewHeight * aspect;
    const verticalOffset = PORTRAIT_VERTICAL_OFFSET * portraitAmount;
    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = verticalOffset + viewHeight / 2;
    camera.bottom = verticalOffset - viewHeight / 2;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}
