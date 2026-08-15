import * as THREE from 'three';

export const ORCHARD_COLORS = {
  meadow: '#b9d493',
  grass: '#91ad62',
  grassShadow: '#647d43',
  soil: '#775537',
  soilDark: '#5f422d',
  wood: '#755036',
  woodDark: '#4d3425',
  leaf: '#3f753b',
  leafLight: '#5c913f',
  leafFar: '#315c35',
  shedWall: '#d9bd77',
  roof: '#a94f35',
  pathStone: '#ba9a69',
  banner: '#d95a39',
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
  meadow: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  grassShadow: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  soilDark: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  woodDark: THREE.MeshStandardMaterial;
  leaf: THREE.MeshStandardMaterial;
  leafFar: THREE.MeshStandardMaterial;
  shedWall: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  pathStone: THREE.MeshStandardMaterial;
  flower: THREE.MeshStandardMaterial;
  banner: THREE.MeshStandardMaterial;
  basketCloth: THREE.MeshStandardMaterial;
  appleStem: THREE.MeshStandardMaterial;
  appleLeaf: THREE.MeshStandardMaterial;
  boot: THREE.MeshStandardMaterial;
  faceDark: THREE.MeshStandardMaterial;
};

export function createOrchardMaterials(): OrchardMaterials {
  return {
    meadow: standard(ORCHARD_COLORS.meadow, 1),
    grass: standard(ORCHARD_COLORS.grass, 0.96),
    grassShadow: standard(ORCHARD_COLORS.grassShadow, 1),
    soil: standard(ORCHARD_COLORS.soil, 1),
    soilDark: standard(ORCHARD_COLORS.soilDark, 1),
    wood: standard(ORCHARD_COLORS.wood, 0.86),
    woodDark: standard(ORCHARD_COLORS.woodDark, 0.92),
    leaf: new THREE.MeshStandardMaterial({
      color: ORCHARD_COLORS.leaf,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    }),
    leafFar: standard(ORCHARD_COLORS.leafFar, 0.98, true),
    shedWall: standard(ORCHARD_COLORS.shedWall, 0.92),
    roof: standard(ORCHARD_COLORS.roof, 0.88, true),
    pathStone: standard(ORCHARD_COLORS.pathStone, 1, true),
    flower: standard('#fff2a6', 0.82, true),
    banner: new THREE.MeshStandardMaterial({
      color: ORCHARD_COLORS.banner,
      roughness: 0.86,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
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
