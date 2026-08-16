import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { OrchardTree, TreeVariant } from '../game/maps/OrchardMap';

const NATURE_PACK_URL = `${import.meta.env.BASE_URL}assets/models/animal-crossing/free_download_low_poly_nature_pack.glb`;
const APPLE_NODE_NAME = 'APPLE__20';
const TREE_NODE_NAMES: Record<TreeVariant, string> = {
  stump: 'Cut_0',
  broadleaf: 'Full_Grow001_2',
  pine: 'Full_Grow003_7',
  cherry: 'MidGrow005_13',
};
const TREE_TARGET_HEIGHTS: Record<TreeVariant, number> = {
  stump: 0.46,
  broadleaf: 2.65,
  pine: 2.9,
  cherry: 2.55,
};
const APPLE_TARGET_HEIGHT = 0.78;
const ISLAND_MATTE_TINT = new THREE.Color('#f1e5c7');

export type NatureMaterialProfile = 'source' | 'island-matte';

export type LoadedTreeVisuals = {
  root: THREE.Group;
  variants: number;
  instances: number;
  triangles: number;
  materials: number;
  materialProfile: NatureMaterialProfile;
};

export type LoadedAppleVisual = {
  root: THREE.Group;
  materials: THREE.MeshStandardMaterial[];
  triangles: number;
  materialProfile: NatureMaterialProfile;
};

type MeshPrototype = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  sourceMatrix: THREE.Matrix4;
  bounds: THREE.Box3;
  triangles: number;
};

let packPromise: Promise<GLTF> | null = null;

export async function loadNaturePackTreeVisuals(
  placements: readonly OrchardTree[],
  materialProfile: NatureMaterialProfile = 'source',
): Promise<LoadedTreeVisuals> {
  const gltf = await loadNaturePack();
  gltf.scene.updateMatrixWorld(true);
  const prototypes = new Map<TreeVariant, MeshPrototype>();
  for (const variant of Object.keys(TREE_NODE_NAMES) as TreeVariant[]) {
    prototypes.set(variant, extractPrototype(gltf.scene, TREE_NODE_NAMES[variant]));
  }

  const root = new THREE.Group();
  root.name = 'nature-pack-orchard-trees';
  let triangles = 0;
  const profiledMaterials = new Map<THREE.Material, THREE.Material>();

  for (const variant of Object.keys(TREE_NODE_NAMES) as TreeVariant[]) {
    const prototype = prototypes.get(variant);
    if (!prototype) continue;
    const variantPlacements = placements.filter((placement) => placement.variant === variant);
    if (variantPlacements.length === 0) continue;
    const instances = new THREE.InstancedMesh(
      prototype.geometry,
      materialForProfile(prototype.material, materialProfile, profiledMaterials),
      variantPlacements.length,
    );
    instances.name = `nature-pack-tree-${variant}`;
    instances.castShadow = variant !== 'stump';
    instances.receiveShadow = true;
    instances.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const size = prototype.bounds.getSize(new THREE.Vector3());
    const center = prototype.bounds.getCenter(new THREE.Vector3());
    const normalize = new THREE.Matrix4().makeTranslation(
      -center.x,
      -prototype.bounds.min.y,
      -center.z,
    );
    const normalizedSource = normalize.multiply(prototype.sourceMatrix);
    const wrapper = new THREE.Object3D();
    const matrix = new THREE.Matrix4();

    variantPlacements.forEach((placement, index) => {
      const scale = TREE_TARGET_HEIGHTS[variant] * placement.scale / Math.max(0.001, size.y);
      wrapper.position.set(placement.x, 0, placement.z);
      wrapper.rotation.set(0, placement.rotationY, 0);
      wrapper.scale.setScalar(scale);
      wrapper.updateMatrix();
      matrix.multiplyMatrices(wrapper.matrix, normalizedSource);
      instances.setMatrixAt(index, matrix);
    });
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingSphere();
    root.add(instances);
    triangles += prototype.triangles * variantPlacements.length;
  }

  return {
    root,
    variants: prototypes.size,
    instances: placements.length,
    triangles,
    materials: profiledMaterials.size,
    materialProfile,
  };
}

export async function createNaturePackAppleVisual(
  materialProfile: NatureMaterialProfile = 'source',
): Promise<LoadedAppleVisual> {
  const gltf = await loadNaturePack();
  gltf.scene.updateMatrixWorld(true);
  const prototype = extractPrototype(gltf.scene, APPLE_NODE_NAME);
  const sourceMaterial = prototype.material;
  if (!(sourceMaterial instanceof THREE.MeshStandardMaterial)) {
    throw new Error(`Nature pack apple material is not MeshStandardMaterial: ${sourceMaterial.type}`);
  }

  const material = sourceMaterial.clone();
  material.name = 'nature-pack-apple-instance-material';
  applyMaterialProfile(material, materialProfile);
  material.emissive.set('#7f211b');
  material.emissiveIntensity = 0.08;
  const mesh = new THREE.Mesh(prototype.geometry, material);
  mesh.name = 'nature-pack-apple-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const size = prototype.bounds.getSize(new THREE.Vector3());
  const center = prototype.bounds.getCenter(new THREE.Vector3());
  const scale = APPLE_TARGET_HEIGHT / Math.max(0.001, size.y);
  const matrix = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(
      -center.x,
      -prototype.bounds.min.y,
      -center.z,
    ))
    .multiply(prototype.sourceMatrix);
  matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);

  const root = new THREE.Group();
  root.name = 'nature-pack-apple-visual';
  root.add(mesh);
  return {
    root,
    materials: [material],
    triangles: prototype.triangles,
    materialProfile,
  };
}

function materialForProfile(
  source: THREE.Material,
  profile: NatureMaterialProfile,
  cache: Map<THREE.Material, THREE.Material>,
): THREE.Material {
  const cached = cache.get(source);
  if (cached) return cached;
  const material = profile === 'source' ? source : source.clone();
  material.name = profile === 'source'
    ? material.name
    : `island-matte-${source.name || source.type}`;
  applyMaterialProfile(material, profile);
  cache.set(source, material);
  return material;
}

function applyMaterialProfile(
  material: THREE.Material,
  profile: NatureMaterialProfile,
): void {
  if (profile !== 'island-matte' || !(material instanceof THREE.MeshStandardMaterial)) return;
  material.color.lerp(ISLAND_MATTE_TINT, 0.045);
  material.roughness = 0.88;
  material.metalness = 0;
  material.envMapIntensity = 0.7;
  material.dithering = true;
}

function loadNaturePack(): Promise<GLTF> {
  packPromise ??= new GLTFLoader().loadAsync(NATURE_PACK_URL);
  return packPromise;
}

function extractPrototype(scene: THREE.Group, nodeName: string): MeshPrototype {
  const source = scene.getObjectByName(nodeName);
  if (!source) throw new Error(`Nature pack node not found: ${nodeName}`);
  source.updateWorldMatrix(true, true);
  let sourceMesh: THREE.Mesh | null = null;
  source.traverse((object) => {
    if (!sourceMesh && object instanceof THREE.Mesh) sourceMesh = object;
  });
  if (!sourceMesh) throw new Error(`Nature pack node contains no mesh: ${nodeName}`);
  const mesh = sourceMesh as THREE.Mesh;
  if (Array.isArray(mesh.material)) {
    throw new Error(`Nature pack node contains multiple materials: ${nodeName}`);
  }
  const indexCount = mesh.geometry.index?.count;
  const vertexCount = mesh.geometry.attributes.position?.count ?? 0;
  return {
    geometry: mesh.geometry,
    material: mesh.material,
    sourceMatrix: mesh.matrixWorld.clone(),
    bounds: new THREE.Box3().setFromObject(source),
    triangles: indexCount ? indexCount / 3 : vertexCount / 3,
  };
}
