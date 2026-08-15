import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

const MEDIEVAL_HOUSE_URL = `${import.meta.env.BASE_URL}assets/models/kaykit-medieval/house.glb`;

export type LoadedMedievalHouseVisual = {
  root: THREE.Group;
  meshes: number;
  triangles: number;
  materials: number;
  textures: number;
  bounds: {
    width: number;
    height: number;
    depth: number;
  };
};

let housePromise: Promise<GLTF> | null = null;

export async function createMedievalHouseVisual(
  targetWidth: number,
): Promise<LoadedMedievalHouseVisual> {
  const gltf = await loadMedievalHouse();
  const scene = gltf.scene.clone(true);
  scene.name = 'kaykit-medieval-house';
  scene.updateMatrixWorld(true);

  const sourceBounds = new THREE.Box3().setFromObject(scene);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  if (sourceBounds.isEmpty() || sourceSize.x <= 0 || sourceSize.y <= 0 || sourceSize.z <= 0) {
    throw new Error('KayKit medieval house has invalid bounds.');
  }

  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  let meshes = 0;
  let triangles = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    object.castShadow = true;
    object.receiveShadow = true;
    const indexCount = object.geometry.index?.count;
    const vertexCount = object.geometry.attributes.position?.count ?? 0;
    triangles += indexCount ? indexCount / 3 : vertexCount / 3;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material) as unknown[]) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });

  const normalized = new THREE.Group();
  normalized.name = 'kaykit-medieval-house-normalized';
  scene.position.set(-sourceCenter.x, -sourceBounds.min.y, -sourceCenter.z);
  normalized.add(scene);
  const scale = targetWidth / sourceSize.x;
  normalized.scale.setScalar(scale);

  const root = new THREE.Group();
  root.name = 'imported-medieval-house';
  root.add(normalized);
  root.updateMatrixWorld(true);
  const finalSize = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());

  return {
    root,
    meshes,
    triangles,
    materials: materials.size,
    textures: textures.size,
    bounds: {
      width: finalSize.x,
      height: finalSize.y,
      depth: finalSize.z,
    },
  };
}

function loadMedievalHouse(): Promise<GLTF> {
  housePromise ??= new GLTFLoader().loadAsync(MEDIEVAL_HOUSE_URL);
  return housePromise;
}
