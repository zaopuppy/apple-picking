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
};

function matte(color: THREE.ColorRepresentation, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
}

export function createIslandMaterials(): IslandMaterials {
  const grassTexture = createGrassTexture();
  const grassPatchTexture = grassTexture.clone();
  grassPatchTexture.name = 'island-grass-patch-texture';
  grassPatchTexture.repeat.set(3.25, 3.25);
  grassPatchTexture.needsUpdate = true;

  return {
    grass: texturedGrass('#7eb45d', grassTexture, 0.94),
    grassLight: texturedGrass('#88bb65', grassTexture, 0.95),
    grassDark: texturedGrass('#65994d', grassTexture, 0.97),
    grassPatch: texturedGrass('#82b75f', grassPatchTexture, 0.96),
    cliff: matte('#c98957', 0.98),
    cliffDark: matte('#98613f', 1),
    sand: matte('#e6c77f', 0.96),
    sandLight: matte('#f2dca0', 0.98),
    soil: matte('#8a5b3e', 1),
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
    wood: matte('#a96c3f', 0.88),
    woodDark: matte('#6f402b', 0.94),
    plaster: matte('#f3dfb7', 0.9),
    roof: matte('#dd7160', 0.86),
    roofLight: matte('#f09473', 0.88),
    stone: matte('#a59d8c', 0.98),
    foliage: matte('#4f9e4c', 0.92),
    flowerPink: matte('#f59bb5', 0.86),
    flowerYellow: matte('#f4d65c', 0.86),
    flowerWhite: matte('#fff4dc', 0.9),
    window: new THREE.MeshStandardMaterial({
      color: '#a9d9dc',
      emissive: '#5f9da2',
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0,
    }),
  };
}

function texturedGrass(
  color: THREE.ColorRepresentation,
  map: THREE.Texture,
  roughness: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map,
    roughness,
    metalness: 0,
  });
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
