import * as THREE from 'three';

export type IslandMaterials = {
  grass: THREE.MeshStandardMaterial;
  grassLight: THREE.MeshStandardMaterial;
  grassDark: THREE.MeshStandardMaterial;
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
  return {
    grass: matte('#79b957', 0.92),
    grassLight: matte('#9dce68', 0.94),
    grassDark: matte('#4f873f', 0.96),
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
