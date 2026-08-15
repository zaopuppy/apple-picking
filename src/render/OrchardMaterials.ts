import * as THREE from 'three';

export const ORCHARD_COLORS = {
  grass: '#91ad62',
  grassShadow: '#647d43',
  meadow: '#a8be72',
  orchardGround: '#a58b5c',
  wildflowersGround: '#8faa67',
  soil: '#775537',
  soilDark: '#5f422d',
  wood: '#755036',
  woodDark: '#4d3425',
  cottageWall: '#e3c887',
  cottageRoof: '#b85f43',
  cottageTrim: '#f1e1b5',
  water: '#58a6a4',
  waterEdge: '#72885b',
  stone: '#8c8b75',
  leaf: '#3f753b',
  leafLight: '#5c913f',
  apple: '#d74432',
  appleDark: '#8f241d',
  appleLeaf: '#477b38',
  kidCloth: '#e35c38',
  kidAccent: '#f2b941',
  kidSkin: '#f2c57c',
  kidHair: '#6a3d2a',
  guardBlue: '#2e68a3',
  guardBlueAccent: '#d7ecf3',
  guardGreen: '#4f7a3c',
  guardGreenAccent: '#e1eccb',
  boot: '#49392e',
  reward: '#ffe071',
  danger: '#ef6a4a',
  invincible: '#fff2a3',
  sweat: '#2e9bd6',
} as const;

export type OrchardMaterials = {
  grass: THREE.MeshStandardMaterial;
  grassShadow: THREE.MeshStandardMaterial;
  meadow: THREE.MeshStandardMaterial;
  orchardGround: THREE.MeshStandardMaterial;
  wildflowersGround: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  soilDark: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  cottageWall: THREE.MeshStandardMaterial;
  cottageRoof: THREE.MeshStandardMaterial;
  cottageTrim: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  waterEdge: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  basketCloth: THREE.MeshStandardMaterial;
  appleStem: THREE.MeshStandardMaterial;
  appleLeaf: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  faceDark: THREE.MeshStandardMaterial;
};

export function createOrchardMaterials(): OrchardMaterials {
  return {
    grass: standard(ORCHARD_COLORS.grass, 0.96),
    grassShadow: standard(ORCHARD_COLORS.grassShadow, 1),
    meadow: standard(ORCHARD_COLORS.meadow, 0.98),
    orchardGround: standard(ORCHARD_COLORS.orchardGround, 1),
    wildflowersGround: standard(ORCHARD_COLORS.wildflowersGround, 0.96),
    soil: standard(ORCHARD_COLORS.soil, 1),
    soilDark: standard(ORCHARD_COLORS.soilDark, 1),
    wood: standard(ORCHARD_COLORS.wood, 0.86),
    woodDark: standard(ORCHARD_COLORS.woodDark, 0.92),
    cottageWall: standard(ORCHARD_COLORS.cottageWall, 0.9, true),
    cottageRoof: standard(ORCHARD_COLORS.cottageRoof, 0.84, true),
    cottageTrim: standard(ORCHARD_COLORS.cottageTrim, 0.88),
    water: new THREE.MeshStandardMaterial({
      color: ORCHARD_COLORS.water,
      roughness: 0.28,
      metalness: 0,
      transparent: true,
      opacity: 0.88,
    }),
    waterEdge: standard(ORCHARD_COLORS.waterEdge, 0.98, true),
    stone: standard(ORCHARD_COLORS.stone, 1, true),
    leaf: new THREE.MeshStandardMaterial({
      color: ORCHARD_COLORS.leaf,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    }),
    basketCloth: standard('#e8cb73', 0.94),
    appleStem: standard('#51351e', 0.94),
    appleLeaf: standard(ORCHARD_COLORS.appleLeaf, 0.9, true),
    boot: standard(ORCHARD_COLORS.boot, 0.96),
    faceDark: standard('#3b2f29', 0.82),
  };
}

export function createCharacterMaterial(color: string, roughness = 0.72): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    flatShading: true,
  });
}

export function createAppleMaterial(id: number): THREE.MeshStandardMaterial {
  const shade = id % 3 === 0 ? '#d74432' : id % 3 === 1 ? '#c9362c' : '#e14c31';
  return new THREE.MeshStandardMaterial({
    color: shade,
    emissive: ORCHARD_COLORS.appleDark,
    emissiveIntensity: 0.1,
    roughness: 0.58,
    metalness: 0,
    flatShading: true,
  });
}

function standard(color: string, roughness: number, flatShading = false): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0,
    flatShading,
  });
}
