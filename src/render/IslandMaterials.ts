import * as THREE from 'three';

export type IslandMaterials = {
  grass: THREE.MeshStandardMaterial;
  grassLight: THREE.MeshStandardMaterial;
  grassDark: THREE.MeshStandardMaterial;
  grassPatch: THREE.MeshStandardMaterial;
  cliff: THREE.MeshStandardMaterial;
  cliffDark: THREE.MeshStandardMaterial;
  sand: THREE.MeshStandardMaterial;
  sandLight: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  water: THREE.MeshPhysicalMaterial;
  waterLight: THREE.MeshBasicMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofLight: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  flowerPink: THREE.MeshStandardMaterial;
  flowerYellow: THREE.MeshStandardMaterial;
  flowerWhite: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  groundContact: THREE.MeshBasicMaterial;
};

function matte(
  name: string,
  color: THREE.ColorRepresentation,
  roughness = 0.9,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  material.name = `island-${name}-material`;
  return material;
}

export function createIslandMaterials(): IslandMaterials {
  const grassTexture = createGrassTexture();
  const grassPatchTexture = grassTexture.clone();
  grassPatchTexture.name = 'island-grass-patch-texture';
  grassPatchTexture.repeat.set(3.25, 3.25);
  grassPatchTexture.needsUpdate = true;

  return {
    grass: texturedGrass('grass', '#7eb45d', grassTexture, 0.94),
    grassLight: texturedGrass('grass-light', '#88bb65', grassTexture, 0.95),
    grassDark: texturedGrass('grass-dark', '#65994d', grassTexture, 0.97),
    grassPatch: texturedGrass('grass-patch', '#82b75f', grassPatchTexture, 0.96),
    cliff: matte('cliff', '#c98957', 0.95),
    cliffDark: matte('cliff-dark', '#98613f', 0.99),
    sand: matte('sand', '#e6c77f', 0.93),
    sandLight: matte('sand-light', '#f2dca0', 0.96),
    soil: matte('soil', '#8a5b3e', 0.99),
    water: new THREE.MeshPhysicalMaterial({
      color: '#36b9cd',
      roughness: 0.24,
      metalness: 0,
      transparent: true,
      opacity: 0.9,
      clearcoat: 0.35,
      clearcoatRoughness: 0.32,
      depthWrite: true,
    }),
    waterLight: new THREE.MeshBasicMaterial({
      color: '#a7edf0',
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    wood: matte('wood', '#a96c3f', 0.8),
    woodDark: matte('wood-dark', '#6f402b', 0.9),
    plaster: matte('plaster', '#f3dfb7', 0.92),
    roof: matte('roof', '#dd7160', 0.74),
    roofLight: matte('roof-light', '#f09473', 0.79),
    stone: matte('stone', '#a59d8c', 0.96),
    foliage: matte('foliage', '#4f9e4c', 0.9),
    flowerPink: matte('flower-pink', '#f59bb5', 0.74),
    flowerYellow: matte('flower-yellow', '#f4d65c', 0.74),
    flowerWhite: matte('flower-white', '#fff4dc', 0.8),
    window: new THREE.MeshStandardMaterial({
      color: '#a9d9dc',
      emissive: '#5f9da2',
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0,
    }),
    groundContact: new THREE.MeshBasicMaterial({
      name: 'island-ground-contact-material',
      color: '#31533a',
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  };
}

function texturedGrass(
  name: string,
  color: THREE.ColorRepresentation,
  map: THREE.Texture,
  roughness: number,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    map,
    roughness,
    metalness: 0,
  });
  material.name = `island-${name}-material`;
  return material;
}

function createGrassTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the island grass texture.');

  context.fillStyle = '#f3f5e9';
  context.fillRect(0, 0, size, size);
  let seed = 0x5a17c9;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  const bladeColors = ['rgba(64, 91, 49, 0.18)', 'rgba(116, 139, 89, 0.14)', 'rgba(255, 255, 232, 0.22)'];
  for (let index = 0; index < 260; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = 1.5 + random() * 3.2;
    const lean = (random() - 0.5) * 1.3;
    context.beginPath();
    context.moveTo(x, y + length * 0.45);
    context.lineTo(x + lean, y - length * 0.55);
    context.strokeStyle = bladeColors[Math.floor(random() * bladeColors.length)] ?? bladeColors[0];
    context.lineWidth = random() > 0.9 ? 1.25 : 0.7;
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'island-grass-texture';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.18, 0.18);
  texture.anisotropy = 4;
  return texture;
}
