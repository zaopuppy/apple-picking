import * as THREE from 'three';
import type { OrchardLandmark } from '../game/maps/OrchardMap';
import type { OrchardMaterials } from './OrchardMaterials';

export type WorldLandmarkVisuals = {
  root: THREE.Group;
  meshes: number;
  triangles: number;
};

export function createWorldLandmarks(
  landmarks: readonly OrchardLandmark[],
  materials: OrchardMaterials,
): WorldLandmarkVisuals {
  const root = new THREE.Group();
  root.name = 'semantic-world-landmarks';
  for (const landmark of landmarks) {
    const visual = landmark.kind === 'homestead'
      ? createHomestead(landmark, materials)
      : createPond(landmark, materials);
    visual.position.set(landmark.x, 0, landmark.z);
    visual.rotation.y = landmark.rotationY;
    root.add(visual);
  }

  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const indexCount = object.geometry.index?.count;
    const vertexCount = object.geometry.attributes.position?.count ?? 0;
    const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
    triangles += (indexCount ? indexCount / 3 : vertexCount / 3) * instances;
  });
  return { root, meshes, triangles };
}

function createHomestead(
  landmark: OrchardLandmark,
  materials: OrchardMaterials,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `homestead-${landmark.id}`;

  const yard = new THREE.Mesh(
    new THREE.BoxGeometry(landmark.radiusX * 2, 0.08, landmark.radiusZ * 2),
    materials.orchardGround,
  );
  yard.name = 'homestead-yard';
  yard.position.y = 0.035;
  yard.receiveShadow = true;
  root.add(yard);

  const houseWidth = Math.min(5.2, landmark.radiusX * 1.06);
  const houseDepth = Math.min(3.8, landmark.radiusZ * 0.94);
  const wallHeight = 2.35;
  const house = new THREE.Mesh(
    new THREE.BoxGeometry(houseWidth, wallHeight, houseDepth),
    materials.cottageWall,
  );
  house.name = 'cottage-walls';
  house.position.set(0, wallHeight / 2 + 0.08, -landmark.radiusZ * 0.24);
  house.castShadow = true;
  house.receiveShadow = true;
  root.add(house);

  const roofRise = 1.05;
  const roofHalfWidth = houseWidth / 2 + 0.34;
  const roofSlope = Math.hypot(roofHalfWidth, roofRise);
  const roofAngle = Math.atan2(roofRise, roofHalfWidth);
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(roofSlope, 0.2, houseDepth + 0.58),
      materials.cottageRoof,
    );
    roof.name = side < 0 ? 'cottage-roof-left' : 'cottage-roof-right';
    roof.position.set(
      side * roofHalfWidth * 0.5,
      wallHeight + 0.08 + roofRise * 0.52,
      house.position.z,
    );
    roof.rotation.z = side * roofAngle;
    roof.castShadow = true;
    root.add(roof);
  }

  const frontZ = house.position.z + houseDepth / 2 + 0.04;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.62, 0.12), materials.woodDark);
  door.name = 'cottage-door';
  door.position.set(0, 0.89, frontZ);
  door.castShadow = true;
  root.add(door);

  for (const x of [-houseWidth * 0.31, houseWidth * 0.31]) {
    const window = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 0.66, 0.1),
      materials.cottageTrim,
    );
    window.name = 'cottage-window';
    window.position.set(x, 1.47, frontZ + 0.015);
    root.add(window);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.13), materials.wood);
    cross.position.copy(window.position);
    cross.position.z += 0.02;
    root.add(cross);
  }

  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.3, 1.3, 6),
    materials.stone,
  );
  chimney.name = 'cottage-chimney';
  chimney.position.set(houseWidth * 0.28, wallHeight + 1.05, house.position.z - houseDepth * 0.18);
  chimney.castShadow = true;
  root.add(chimney);

  root.add(createYardFence(landmark.radiusX, landmark.radiusZ, materials));

  const shrubs = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.34, 0),
    materials.leaf,
    5,
  );
  shrubs.name = 'homestead-shrubs';
  shrubs.castShadow = true;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < shrubs.count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    dummy.position.set(
      side * (landmark.radiusX - 0.65),
      0.32,
      -landmark.radiusZ + 1.1 + index * 1.15,
    );
    dummy.scale.setScalar(0.82 + (index % 3) * 0.12);
    dummy.rotation.y = index * 1.7;
    dummy.updateMatrix();
    shrubs.setMatrixAt(index, dummy.matrix);
  }
  shrubs.instanceMatrix.needsUpdate = true;
  root.add(shrubs);
  return root;
}

function createYardFence(
  radiusX: number,
  radiusZ: number,
  materials: OrchardMaterials,
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'homestead-fence';
  const posts: Array<{ x: number; z: number }> = [];
  const spacing = 1.75;
  for (let x = -radiusX; x <= radiusX + 0.01; x += spacing) {
    posts.push({ x: Math.min(x, radiusX), z: -radiusZ });
    posts.push({ x: Math.min(x, radiusX), z: radiusZ });
  }
  for (let z = -radiusZ + spacing; z <= radiusZ - spacing + 0.01; z += spacing) {
    posts.push({ x: -radiusX, z });
    posts.push({ x: radiusX, z });
  }
  const postMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 0.92, 0.16),
    materials.wood,
    posts.length,
  );
  postMesh.name = 'homestead-fence-posts';
  postMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  posts.forEach((post, index) => {
    dummy.position.set(post.x, 0.46, post.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    postMesh.setMatrixAt(index, dummy.matrix);
  });
  postMesh.instanceMatrix.needsUpdate = true;
  root.add(postMesh);

  const railGeometry = new THREE.BoxGeometry(1, 0.12, 0.12);
  for (const y of [0.34, 0.68]) {
    for (const z of [-radiusZ, radiusZ]) {
      const rail = new THREE.Mesh(railGeometry, materials.wood);
      rail.position.set(0, y, z);
      rail.scale.x = radiusX * 2;
      rail.castShadow = true;
      root.add(rail);
    }
    for (const x of [-radiusX, radiusX]) {
      const rail = new THREE.Mesh(railGeometry, materials.wood);
      rail.position.set(x, y, 0);
      rail.rotation.y = Math.PI / 2;
      rail.scale.x = radiusZ * 2;
      rail.castShadow = true;
      root.add(rail);
    }
  }
  return root;
}

function createPond(
  landmark: OrchardLandmark,
  materials: OrchardMaterials,
): THREE.Group {
  const root = new THREE.Group();
  root.name = `pond-${landmark.id}`;
  const bank = new THREE.Mesh(new THREE.CircleGeometry(1, 36), materials.waterEdge);
  bank.name = 'pond-bank';
  bank.rotation.x = -Math.PI / 2;
  bank.position.y = 0.025;
  bank.scale.set(landmark.radiusX, landmark.radiusZ, 1);
  bank.receiveShadow = true;
  root.add(bank);

  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 36), materials.water);
  water.name = 'pond-water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.045;
  water.scale.set(landmark.radiusX * 0.86, landmark.radiusZ * 0.82, 1);
  water.receiveShadow = true;
  root.add(water);

  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.3, 0),
    materials.stone,
    12,
  );
  stones.name = 'pond-edge-stones';
  stones.castShadow = true;
  const dummy = new THREE.Object3D();
  for (let index = 0; index < stones.count; index += 1) {
    const angle = index / stones.count * Math.PI * 2 + (index % 2) * 0.08;
    dummy.position.set(
      Math.cos(angle) * landmark.radiusX * 0.94,
      0.16,
      Math.sin(angle) * landmark.radiusZ * 0.92,
    );
    dummy.rotation.set(index * 0.21, angle, index * 0.13);
    dummy.scale.setScalar(0.72 + (index % 4) * 0.1);
    dummy.updateMatrix();
    stones.setMatrixAt(index, dummy.matrix);
  }
  stones.instanceMatrix.needsUpdate = true;
  root.add(stones);

  const reeds = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.08, 0.72, 5),
    materials.leaf,
    8,
  );
  reeds.name = 'pond-reeds';
  reeds.castShadow = true;
  for (let index = 0; index < reeds.count; index += 1) {
    const angle = (index / reeds.count * Math.PI * 2) + 0.35;
    dummy.position.set(
      Math.cos(angle) * landmark.radiusX * 0.78,
      0.36,
      Math.sin(angle) * landmark.radiusZ * 0.76,
    );
    dummy.rotation.set(0, angle, (index % 2 ? -1 : 1) * 0.08);
    dummy.scale.set(1, 0.78 + (index % 3) * 0.16, 1);
    dummy.updateMatrix();
    reeds.setMatrixAt(index, dummy.matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  root.add(reeds);
  return root;
}
