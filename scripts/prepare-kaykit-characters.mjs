import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const TEXTURE_SIZE = 256;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(
  repoRoot,
  process.argv[2] ?? 'assets/KayKit_Adventurers_2.0_FREE',
);
const outputRoot = resolve(repoRoot, 'public/assets/models/kaykit-adventurers');

const movementPath = resolve(
  sourceRoot,
  'Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb',
);
const generalPath = resolve(
  sourceRoot,
  'Animations/gltf/Rig_Medium/Rig_Medium_General.glb',
);

const characters = [
  {
    source: resolve(sourceRoot, 'Characters/gltf/Knight.glb'),
    output: resolve(outputRoot, 'Knight_Guard.glb'),
    clips: [
      [generalPath, 'Idle_A'],
      [movementPath, 'Running_A'],
      [movementPath, 'Jump_Full_Short'],
      [movementPath, 'Jump_Land'],
      [generalPath, 'Hit_A'],
    ],
  },
  {
    source: resolve(sourceRoot, 'Characters/gltf/Rogue.glb'),
    output: resolve(outputRoot, 'Rogue_Kid.glb'),
    clips: [
      [generalPath, 'Idle_A'],
      [movementPath, 'Running_A'],
      [generalPath, 'PickUp'],
      [generalPath, 'Hit_A'],
    ],
  },
];

mkdirSync(outputRoot, { recursive: true });
for (const character of characters) {
  const destination = readGlb(character.source);
  resizeEmbeddedTextures(destination, TEXTURE_SIZE);

  const animationSources = new Map();
  for (const [sourcePath, clipName] of character.clips) {
    const source = animationSources.get(sourcePath) ?? readGlb(sourcePath);
    animationSources.set(sourcePath, source);
    copyAnimation(destination, source, clipName);
  }

  destination.json.asset.generator = 'apple-picking KayKit runtime packer';
  destination.json.extras = {
    ...(destination.json.extras ?? {}),
    sourcePack: 'KayKit Adventurers 2.0 FREE',
    textureSize: TEXTURE_SIZE,
    selectedAnimations: character.clips.map(([, clipName]) => clipName),
  };
  writeGlb(character.output, destination);
  console.log(`${character.output}: ${destination.json.animations.length} animations, ${destination.binary.length} binary bytes`);
}

function readGlb(path) {
  const data = readFileSync(path);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2) {
    throw new Error(`Expected a glTF 2.0 GLB: ${path}`);
  }

  let json = null;
  let binary = null;
  let offset = 12;
  while (offset < data.length) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const chunk = data.subarray(offset + 8, offset + 8 + length);
    if (type === JSON_CHUNK) {
      json = JSON.parse(chunk.toString('utf8').replace(/\0+$/g, '').trimEnd());
    } else if (type === BIN_CHUNK) {
      binary = Buffer.from(chunk);
    }
    offset += 8 + length;
  }

  if (!json || !binary) throw new Error(`GLB is missing JSON or BIN data: ${path}`);
  return { json, binary };
}

function resizeEmbeddedTextures(document, targetSize) {
  const replacements = new Map();
  for (const image of document.json.images ?? []) {
    if (image.mimeType !== 'image/png' || image.bufferView === undefined) continue;
    const view = document.json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    const source = document.binary.subarray(start, start + view.byteLength);
    const decoded = PNG.sync.read(source);
    if (decoded.width <= targetSize && decoded.height <= targetSize) continue;

    const scale = Math.min(targetSize / decoded.width, targetSize / decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const resized = new PNG({ width, height });
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(decoded.height - 1, Math.floor((y + 0.5) / scale));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(decoded.width - 1, Math.floor((x + 0.5) / scale));
        const sourceOffset = (sourceY * decoded.width + sourceX) * 4;
        const targetOffset = (y * width + x) * 4;
        decoded.data.copy(resized.data, targetOffset, sourceOffset, sourceOffset + 4);
      }
    }
    replacements.set(image.bufferView, PNG.sync.write(resized));
  }

  if (replacements.size === 0) return;
  rebuildBufferViews(document, replacements);
}

function rebuildBufferViews(document, replacements) {
  const original = document.binary;
  const parts = [];
  let length = 0;
  document.json.bufferViews.forEach((view, index) => {
    const padding = alignedLength(length) - length;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
      length += padding;
    }
    const start = view.byteOffset ?? 0;
    const contents = replacements.get(index) ?? original.subarray(start, start + view.byteLength);
    view.byteOffset = length;
    view.byteLength = contents.length;
    parts.push(contents);
    length += contents.length;
  });
  document.binary = Buffer.concat(parts, length);
  document.json.buffers[0].byteLength = length;
}

function copyAnimation(destination, source, clipName) {
  const animation = source.json.animations?.find((candidate) => candidate.name === clipName);
  if (!animation) throw new Error(`Animation not found: ${clipName}`);
  destination.json.animations ??= [];
  if (destination.json.animations.some((candidate) => candidate.name === clipName)) {
    throw new Error(`Duplicate animation: ${clipName}`);
  }

  const targetNodes = new Map();
  destination.json.nodes.forEach((node, index) => {
    if (node.name) targetNodes.set(node.name, index);
  });
  const accessorMap = new Map();
  const bufferViewMap = new Map();

  const copyBufferView = (sourceIndex) => {
    const existing = bufferViewMap.get(sourceIndex);
    if (existing !== undefined) return existing;
    const sourceView = source.json.bufferViews[sourceIndex];
    const sourceOffset = sourceView.byteOffset ?? 0;
    const contents = source.binary.subarray(sourceOffset, sourceOffset + sourceView.byteLength);
    const padding = alignedLength(destination.binary.length) - destination.binary.length;
    if (padding > 0) destination.binary = Buffer.concat([destination.binary, Buffer.alloc(padding)]);
    const destinationIndex = destination.json.bufferViews.length;
    destination.json.bufferViews.push({
      ...sourceView,
      buffer: 0,
      byteOffset: destination.binary.length,
    });
    destination.binary = Buffer.concat([destination.binary, contents]);
    destination.json.buffers[0].byteLength = destination.binary.length;
    bufferViewMap.set(sourceIndex, destinationIndex);
    return destinationIndex;
  };

  const copyAccessor = (sourceIndex) => {
    const existing = accessorMap.get(sourceIndex);
    if (existing !== undefined) return existing;
    const sourceAccessor = source.json.accessors[sourceIndex];
    if (sourceAccessor.sparse || sourceAccessor.bufferView === undefined) {
      throw new Error(`Unsupported sparse animation accessor in ${clipName}`);
    }
    const destinationIndex = destination.json.accessors.length;
    destination.json.accessors.push({
      ...sourceAccessor,
      bufferView: copyBufferView(sourceAccessor.bufferView),
    });
    accessorMap.set(sourceIndex, destinationIndex);
    return destinationIndex;
  };

  const samplers = animation.samplers.map((sampler) => ({
    ...sampler,
    input: copyAccessor(sampler.input),
    output: copyAccessor(sampler.output),
  }));
  const channels = animation.channels.map((channel) => {
    const sourceNode = source.json.nodes[channel.target.node];
    const targetNode = sourceNode.name ? targetNodes.get(sourceNode.name) : undefined;
    if (targetNode === undefined) {
      throw new Error(`Animation ${clipName} targets missing node: ${sourceNode.name ?? channel.target.node}`);
    }
    return {
      ...channel,
      target: { ...channel.target, node: targetNode },
    };
  });
  destination.json.animations.push({ ...animation, samplers, channels });
}

function writeGlb(path, document) {
  const jsonData = Buffer.from(JSON.stringify(document.json));
  const jsonPadding = alignedLength(jsonData.length) - jsonData.length;
  const binaryPadding = alignedLength(document.binary.length) - document.binary.length;
  const jsonChunk = Buffer.concat([jsonData, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryChunk = Buffer.concat([document.binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonChunk.copy(output, 20);
  const binaryHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binaryChunk.length, binaryHeader);
  output.writeUInt32LE(BIN_CHUNK, binaryHeader + 4);
  binaryChunk.copy(output, binaryHeader + 8);
  writeFileSync(path, output);
}

function alignedLength(length) {
  return (length + 3) & ~3;
}
