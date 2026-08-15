import * as THREE from 'three';
import { createAppleMaterial, ORCHARD_COLORS, type OrchardMaterials } from './OrchardMaterials';

export type OrchardWorldKitView = {
  root: THREE.Group;
  flagPivot: THREE.Group;
  weatherVane: THREE.Group;
};

type InstancePart = {
  position: THREE.Vector3;
  scale: THREE.Vector3;
  rotation: THREE.Euler;
};

const dummy = new THREE.Object3D();

export function createOrchardWorldKit(materials: OrchardMaterials): OrchardWorldKitView {
  const root = new THREE.Group();
  root.name = 'orchard-world-kit';

  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(70, 60), materials.meadow);
  meadow.name = 'outer-meadow';
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.045;
  meadow.receiveShadow = true;
  root.add(meadow);

  const entrance = createEntrance(materials);
  const shed = createToolShed(materials);
  root.add(entrance.root, shed.root, createBorderPlants(materials), createFarTreeBand(materials));

  return {
    root,
    flagPivot: entrance.flagPivot,
    weatherVane: shed.weatherVane,
  };
}

export function syncOrchardWorldKit(
  view: OrchardWorldKitView,
  time: number,
  reducedMotion: boolean,
): void {
  view.flagPivot.rotation.z = reducedMotion ? -0.08 : -0.08 + Math.sin(time * 1.7) * 0.075;
  view.weatherVane.rotation.y = reducedMotion ? 0.45 : time * 0.22;
}

function createEntrance(materials: OrchardMaterials): { root: THREE.Group; flagPivot: THREE.Group } {
  const root = new THREE.Group();
  root.name = 'closed-orchard-entrance';
  root.position.set(-8.7, 0, 9.18);

  const frame = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.woodDark, [
    part(-1.22, 0.98, 0, 0.25, 1.96, 0.28),
    part(1.22, 0.98, 0, 0.25, 1.96, 0.28),
    part(0, 1.86, 0, 2.75, 0.22, 0.3),
    part(-1.22, 2.02, 0, 0.38, 0.18, 0.38),
    part(1.22, 2.02, 0, 0.38, 0.18, 0.38),
  ]);
  frame.name = 'entrance-frame';
  frame.castShadow = true;

  const gateParts: InstancePart[] = [];
  for (let index = 0; index < 7; index += 1) {
    gateParts.push(part(-0.92 + index * 0.305, 0.65, 0.02, 0.19, 1.28, 0.14));
  }
  gateParts.push(
    part(0, 0.45, 0.05, 2.18, 0.14, 0.16, 0, 0, 0.28),
    part(0, 0.86, 0.05, 2.18, 0.14, 0.16, 0, 0, -0.28),
  );
  const gate = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.wood, gateParts);
  gate.name = 'closed-gate-slats';
  gate.castShadow = true;

  const bases = createInstances(new THREE.DodecahedronGeometry(0.38, 0), materials.pathStone, [
    part(-1.22, 0.22, 0, 1, 0.62, 1),
    part(1.22, 0.22, 0, 1, 0.62, 1),
  ]);
  bases.name = 'entrance-stone-bases';

  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.5, 0.17), materials.shedWall);
  sign.name = 'entrance-sign';
  sign.position.set(0, 2.13, 0.06);
  sign.castShadow = true;
  const signApple = new THREE.Mesh(new THREE.DodecahedronGeometry(0.19, 0), createAppleMaterial(0));
  signApple.name = 'entrance-apple-emblem';
  signApple.position.set(-0.08, 2.13, 0.18);
  signApple.scale.set(1.08, 0.94, 0.48);
  const signLeaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 4), materials.appleLeaf);
  signLeaf.position.set(0.08, 2.28, 0.2);
  signLeaf.rotation.set(0, 0, -0.72);

  const pathStones = createInstances(new THREE.DodecahedronGeometry(0.43, 0), materials.pathStone, [
    part(-0.22, 0.04, 0.83, 1.2, 0.12, 0.72, 0, 0.2),
    part(0.18, 0.04, 1.56, 1.05, 0.12, 0.68, 0, -0.14),
    part(-0.13, 0.04, 2.26, 1.16, 0.12, 0.74, 0, 0.1),
  ]);
  pathStones.name = 'entrance-path-stones';
  pathStones.receiveShadow = true;

  const flagPivot = new THREE.Group();
  flagPivot.name = 'entrance-flag-pivot';
  flagPivot.position.set(1.36, 2.08, 0.1);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.75, -0.17);
  flagShape.lineTo(0, -0.42);
  flagShape.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), materials.banner);
  flag.name = 'entrance-pennant';
  flagPivot.add(flag);

  root.add(frame, gate, bases, sign, signApple, signLeaf, pathStones, flagPivot);
  return { root, flagPivot };
}

function createToolShed(materials: OrchardMaterials): { root: THREE.Group; weatherVane: THREE.Group } {
  const root = new THREE.Group();
  root.name = 'tool-shed-and-crates';
  root.position.set(13.4, 0, -1.9);
  root.scale.setScalar(0.82);

  const wall = new THREE.Mesh(new THREE.BoxGeometry(3.05, 1.85, 2.35), materials.shedWall);
  wall.name = 'tool-shed-wall';
  wall.position.y = 1.02;
  wall.castShadow = true;
  wall.receiveShadow = true;

  const roof = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.roof, [
    part(-0.72, 2.13, 0, 1.78, 0.18, 2.72, 0, 0, -0.43),
    part(0.72, 2.13, 0, 1.78, 0.18, 2.72, 0, 0, 0.43),
  ]);
  roof.name = 'tool-shed-roof';
  roof.castShadow = true;

  const facade = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.woodDark, [
    part(-0.62, 0.77, 1.205, 0.9, 1.5, 0.08),
    part(0.66, 1.17, 1.205, 0.86, 0.68, 0.08),
    part(0.66, 0.79, 1.23, 0.94, 0.08, 0.08),
    part(0.66, 1.55, 1.23, 0.94, 0.08, 0.08),
    part(0.19, 1.17, 1.23, 0.08, 0.68, 0.08),
    part(1.13, 1.17, 1.23, 0.08, 0.68, 0.08),
  ]);
  facade.name = 'tool-shed-door-window';

  const windowPane = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.52, 0.035),
    new THREE.MeshStandardMaterial({
      color: '#92bfd0',
      roughness: 0.42,
      metalness: 0,
      emissive: '#477888',
      emissiveIntensity: 0.08,
    }),
  );
  windowPane.name = 'tool-shed-window';
  windowPane.position.set(0.66, 1.17, 1.255);

  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.8, 6), materials.woodDark);
  chimney.name = 'tool-shed-chimney';
  chimney.position.set(0.88, 2.55, -0.3);
  chimney.castShadow = true;

  const crateBodies = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.wood, [
    part(-1.25, 0.34, 0.72, 0.76, 0.68, 0.76, 0, 0.18),
    part(-0.68, 0.3, 1.48, 0.64, 0.6, 0.64, 0, -0.12),
    part(-1.28, 0.89, 0.72, 0.58, 0.52, 0.58, 0, -0.08),
  ]);
  crateBodies.name = 'shed-crate-bodies';
  crateBodies.castShadow = true;

  const crateTrimParts: InstancePart[] = [];
  for (const crate of [
    { x: -1.25, y: 0.34, z: 0.72, size: 0.76 },
    { x: -0.68, y: 0.3, z: 1.48, size: 0.64 },
    { x: -1.28, y: 0.89, z: 0.72, size: 0.58 },
  ]) {
    crateTrimParts.push(
      part(crate.x, crate.y, crate.z + crate.size * 0.51, crate.size * 0.92, 0.08, 0.045, 0, 0, 0.62),
      part(crate.x, crate.y, crate.z + crate.size * 0.515, crate.size * 0.92, 0.08, 0.045, 0, 0, -0.62),
    );
  }
  const crateTrim = createInstances(new THREE.BoxGeometry(1, 1, 1), materials.woodDark, crateTrimParts);
  crateTrim.name = 'shed-crate-cross-braces';

  const weatherVane = new THREE.Group();
  weatherVane.name = 'tool-shed-weather-vane';
  weatherVane.position.set(0, 2.84, 0);
  const vaneRod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.78, 6), materials.woodDark);
  vaneRod.position.y = -0.3;
  const vaneShaft = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.07, 0.07), materials.woodDark);
  const vaneArrow = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.34, 4), materials.banner);
  vaneArrow.position.x = 0.65;
  vaneArrow.rotation.z = -Math.PI / 2;
  weatherVane.add(vaneRod, vaneShaft, vaneArrow);

  root.add(wall, roof, facade, windowPane, chimney, crateBodies, crateTrim, weatherVane);
  return { root, weatherVane };
}

function createBorderPlants(materials: OrchardMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = 'border-flowers-and-grass';
  const positions: THREE.Vector3[] = [];
  for (let index = 0; index < 17; index += 1) {
    const x = -11.3 + index * 1.42;
    if (Math.abs(x + 8.7) > 1.5) positions.push(new THREE.Vector3(x, 0, 9.7 + (index % 2) * 0.16));
  }
  for (let index = 0; index < 10; index += 1) {
    const z = -7.3 + index * 1.62;
    positions.push(new THREE.Vector3(-12.62, 0, z));
    if (z > 1.3 || z < -4.8) positions.push(new THREE.Vector3(12.62, 0, z));
  }

  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.025, 0.035, 0.34, 5),
    materials.appleLeaf,
    positions.length,
  );
  const blooms = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.105, 0),
    materials.flower,
    positions.length,
  );
  const grass = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.14, 0.42, 4),
    materials.leaf,
    positions.length,
  );
  const bloomColors = ['#fff0a1', '#f3a0a0', '#f4eee1', '#e9bb56'];
  positions.forEach((position, index) => {
    setInstance(stems, index, position.clone().setY(0.18), new THREE.Vector3(1, 1, 1));
    setInstance(
      blooms,
      index,
      position.clone().add(new THREE.Vector3(index % 2 === 0 ? -0.05 : 0.05, 0.39, 0)),
      new THREE.Vector3(1, 0.82, 1),
      new THREE.Euler(0.1, index * 0.67, 0.08),
    );
    blooms.setColorAt(index, new THREE.Color(bloomColors[index % bloomColors.length]));
    setInstance(
      grass,
      index,
      position.clone().add(new THREE.Vector3(index % 3 * 0.08 - 0.08, 0.18, index % 2 * 0.08)),
      new THREE.Vector3(1, 0.8 + index % 3 * 0.12, 0.72),
      new THREE.Euler(0, index * 0.73, index % 2 === 0 ? 0.18 : -0.18),
    );
  });
  stems.instanceMatrix.needsUpdate = true;
  blooms.instanceMatrix.needsUpdate = true;
  grass.instanceMatrix.needsUpdate = true;
  if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
  root.add(stems, blooms, grass);
  return root;
}

function createFarTreeBand(materials: OrchardMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = 'far-orchard-tree-band';
  const positions = [-11, -8.3, -5.5, -2.7, 0.2, 3, 5.8, 8.6, 11];
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.17, 0.24, 1.15, 6),
    materials.woodDark,
    positions.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.76, 0),
    materials.leafFar,
    positions.length * 2,
  );
  trunks.castShadow = true;
  crowns.castShadow = true;
  positions.forEach((x, index) => {
    const z = -10.35 - (index % 2) * 0.22;
    setInstance(trunks, index, new THREE.Vector3(x, 0.62, z), new THREE.Vector3(0.82 + index % 2 * 0.12, 1, 0.82));
    const color = new THREE.Color(index % 3 === 0 ? '#386840' : ORCHARD_COLORS.leafFar);
    setInstance(
      crowns,
      index * 2,
      new THREE.Vector3(x - 0.22, 1.55, z),
      new THREE.Vector3(0.84 + index % 3 * 0.07, 0.76 + index % 2 * 0.09, 0.82 + index % 2 * 0.06),
      new THREE.Euler(0.08, index * 0.71, 0.06),
    );
    crowns.setColorAt(index * 2, color);
    setInstance(
      crowns,
      index * 2 + 1,
      new THREE.Vector3(x + 0.32, 1.62, z - 0.08),
      new THREE.Vector3(0.66 + index % 2 * 0.07, 0.62 + index % 3 * 0.045, 0.7 + index % 3 * 0.04),
      new THREE.Euler(-0.05, index * 0.47, -0.08),
    );
    crowns.setColorAt(index * 2 + 1, color.clone().offsetHSL(0.01, -0.04, 0.06));
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  root.add(trunks, crowns);
  return root;
}

function createInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  parts: InstancePart[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
  parts.forEach((entry, index) => setInstance(mesh, index, entry.position, entry.scale, entry.rotation));
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function part(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rx = 0,
  ry = 0,
  rz = 0,
): InstancePart {
  return {
    position: new THREE.Vector3(x, y, z),
    scale: new THREE.Vector3(sx, sy, sz),
    rotation: new THREE.Euler(rx, ry, rz),
  };
}

function setInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  rotation = new THREE.Euler(),
): void {
  dummy.position.copy(position);
  dummy.rotation.copy(rotation);
  dummy.scale.copy(scale);
  dummy.updateMatrix();
  mesh.setMatrixAt(index, dummy.matrix);
}
