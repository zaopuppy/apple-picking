import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TREE_ASSET_ROOT = `${import.meta.env.BASE_URL}assets/models/kaykit-forest/`;

const TREE_VARIANTS = [
  'Tree_1_A_Color1.glb',
  'Tree_2_B_Color1.glb',
  'Tree_3_C_Color1.glb',
] as const;

export type TreePlacement = {
  variant: number;
  x: number;
  z: number;
  rotationY: number;
};

export type LoadedTreeVisuals = {
  root: THREE.Group;
  variants: number;
  instances: number;
  triangles: number;
};

type TreePrototype = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  sourceMatrix: THREE.Matrix4;
  bounds: THREE.Box3;
  triangles: number;
};

export async function loadForestTreeVisuals(
  placements: readonly TreePlacement[],
): Promise<LoadedTreeVisuals> {
  const loader = new GLTFLoader();
  const gltfs = [];
  // The procedural trees remain visible while these arrive, so favour a small,
  // predictable request queue over a burst of model dependencies.
  for (const file of TREE_VARIANTS) {
    gltfs.push(await loader.loadAsync(`${TREE_ASSET_ROOT}${file}`));
  }
  const prototypes = gltfs.map((gltf, index) => extractPrototype(gltf.scene, TREE_VARIANTS[index]));
  shareTreeMaterial(prototypes);

  const root = new THREE.Group();
  root.name = 'kaykit-orchard-trees';
  let triangles = 0;

  prototypes.forEach((prototype, variant) => {
    const variantPlacements = placements.filter((placement) => placement.variant === variant);
    const trees = new THREE.InstancedMesh(
      prototype.geometry,
      prototype.material,
      variantPlacements.length,
    );
    trees.name = `kaykit-tree-variant-${variant + 1}`;
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const size = prototype.bounds.getSize(new THREE.Vector3());
    const center = prototype.bounds.getCenter(new THREE.Vector3());
    const scale = 2.2 / Math.max(0.001, size.y);
    const normalize = new THREE.Matrix4().makeTranslation(-center.x, -prototype.bounds.min.y, -center.z);
    const normalizedSource = normalize.multiply(prototype.sourceMatrix);
    const wrapper = new THREE.Object3D();
    const matrix = new THREE.Matrix4();

    variantPlacements.forEach((placement, index) => {
      wrapper.position.set(placement.x, 0, placement.z);
      wrapper.rotation.set(0, placement.rotationY, 0);
      wrapper.scale.setScalar(scale);
      wrapper.updateMatrix();
      matrix.multiplyMatrices(wrapper.matrix, normalizedSource);
      trees.setMatrixAt(index, matrix);
    });
    trees.instanceMatrix.needsUpdate = true;
    root.add(trees);
    triangles += prototype.triangles * variantPlacements.length;
  });

  return {
    root,
    variants: prototypes.length,
    instances: placements.length,
    triangles,
  };
}

function extractPrototype(scene: THREE.Group, file: string): TreePrototype {
  scene.updateMatrixWorld(true);
  let treeMesh: THREE.Mesh | undefined;
  scene.traverse((object) => {
    if (!treeMesh && object instanceof THREE.Mesh) treeMesh = object;
  });
  if (!treeMesh) throw new Error(`Tree asset contains no mesh: ${file}`);
  if (Array.isArray(treeMesh.material)) {
    throw new Error(`Tree asset contains multiple materials: ${file}`);
  }

  const indexCount = treeMesh.geometry.index?.count;
  const vertexCount = treeMesh.geometry.attributes.position?.count ?? 0;
  return {
    geometry: treeMesh.geometry,
    material: treeMesh.material,
    sourceMatrix: treeMesh.matrixWorld.clone(),
    bounds: new THREE.Box3().setFromObject(scene),
    triangles: indexCount ? indexCount / 3 : vertexCount / 3,
  };
}

function shareTreeMaterial(prototypes: TreePrototype[]): void {
  const sharedMaterial = prototypes[0]?.material;
  if (!sharedMaterial) return;
  sharedMaterial.name = 'kaykit-forest-shared-material';

  for (let index = 1; index < prototypes.length; index += 1) {
    const material = prototypes[index].material;
    if (material === sharedMaterial) continue;
    disposeMaterialTextures(material, sharedMaterial);
    material.dispose();
    prototypes[index].material = sharedMaterial;
  }
}

function disposeMaterialTextures(material: THREE.Material, sharedMaterial: THREE.Material): void {
  const materialValues = Object.values(material) as unknown[];
  const sharedTextures = new Set(
    (Object.values(sharedMaterial) as unknown[]).filter((value): value is THREE.Texture => value instanceof THREE.Texture),
  );
  for (const value of materialValues) {
    if (value instanceof THREE.Texture && !sharedTextures.has(value)) value.dispose();
  }
}
