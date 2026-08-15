import { GAME_CONFIG } from '../game/config';
import {
  generateMapCandidates,
  MAP_PRESETS,
  type MapPreset,
} from '../game/maps/MapGenerator';
import {
  cloneOrchardMap,
  insideArena,
  landmarkBlocksPoint,
  landmarkInsideArena,
  MAX_MAP_APPLES,
  MAX_MAP_LANDMARKS,
  MAX_TERRAIN_ZONES,
  MAX_MAP_TREES,
  parseOrchardMap,
  TREE_VARIANTS,
  type LandmarkKind,
  type OrchardLandmark,
  type OrchardMap,
  type OrchardTerrainZone,
  type OrchardTree,
  type TreeVariant,
  validateOrchardMap,
} from '../game/maps/OrchardMap';
import type { Vec2 } from '../game/types';
import {
  deleteSavedMap,
  loadActiveMap,
  loadSavedMaps,
  saveMapToLibrary,
  setActiveMap,
} from '../systems/MapStorage';

type EditorTool =
  | 'tree'
  | 'erase'
  | 'homestead'
  | 'pond'
  | 'orchard'
  | 'meadow'
  | 'apple'
  | 'kid'
  | 'guard1'
  | 'guard2'
  | 'delivery';

type ViewportTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

const TOOL_KEYS: Record<string, EditorTool> = {
  Digit1: 'tree',
  Digit2: 'erase',
  Digit3: 'homestead',
  Digit4: 'pond',
  Digit5: 'orchard',
  Digit6: 'meadow',
  Digit7: 'apple',
  Digit8: 'kid',
  Digit9: 'guard1',
  KeyQ: 'guard2',
  KeyW: 'delivery',
};

export class MapEditor {
  private readonly context: CanvasRenderingContext2D;
  private readonly listeners = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private readonly nameInput = getElement<HTMLInputElement>('#map-name');
  private readonly status = getElement<HTMLElement>('#map-status');
  private readonly validationList = getElement<HTMLElement>('#validation-list');
  private readonly playButton = getElement<HTMLButtonElement>('#play-button');
  private readonly undoButton = getElement<HTMLButtonElement>('#undo-button');
  private readonly redoButton = getElement<HTMLButtonElement>('#redo-button');
  private readonly brushInput = getElement<HTMLInputElement>('#brush-size');
  private readonly brushValue = getElement<HTMLOutputElement>('#brush-size-value');
  private readonly treeVariantInput = getElement<HTMLSelectElement>('#tree-variant');
  private readonly presetInput = getElement<HTMLSelectElement>('#preset-select');
  private readonly seedInput = getElement<HTMLInputElement>('#seed-input');
  private readonly opennessInput = getElement<HTMLInputElement>('#openness-input');
  private readonly opennessValue = getElement<HTMLOutputElement>('#openness-value');
  private readonly landmarkDensityInput = getElement<HTMLInputElement>('#landmark-density-input');
  private readonly landmarkDensityValue = getElement<HTMLOutputElement>('#landmark-density-value');
  private readonly candidateList = getElement<HTMLElement>('#candidate-list');
  private readonly savedMapList = getElement<HTMLElement>('#saved-map-list');
  private readonly importInput = getElement<HTMLInputElement>('#import-input');
  private readonly toast = getElement<HTMLElement>('#editor-toast');

  private map = loadActiveMap();
  private candidates: OrchardMap[] = [];
  private history: OrchardMap[] = [];
  private future: OrchardMap[] = [];
  private tool: EditorTool = 'tree';
  private pointerWorld: Vec2 | null = null;
  private drawing = false;
  private lastStamp: Vec2 | null = null;
  private serial = 0;
  private toastTimer: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable.');
    this.context = context;
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
  }

  start(): void {
    this.nameInput.value = this.map.name;
    this.bindControls();
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.resizeCanvas();
    this.generateCandidates();
    this.renderSavedMaps();
    this.refresh();
  }

  dispose(): void {
    this.listeners.abort();
    this.resizeObserver.disconnect();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
  }

  private bindControls(): void {
    const signal = this.listeners.signal;
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { signal });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { signal });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { signal });
    this.canvas.addEventListener('pointercancel', this.onPointerUp, { signal });
    this.canvas.addEventListener('pointerleave', this.onPointerLeave, { signal });
    window.addEventListener('keydown', this.onKeyDown, { signal });

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.addEventListener('click', () => this.selectTool(button.dataset.tool as EditorTool), { signal });
    }
    this.brushInput.addEventListener('input', () => {
      this.brushValue.value = this.brushSize.toFixed(1);
      this.draw();
    }, { signal });
    this.opennessInput.addEventListener('input', () => {
      this.opennessValue.value = `${this.opennessInput.value}%`;
    }, { signal });
    this.landmarkDensityInput.addEventListener('input', () => {
      this.landmarkDensityValue.value = `${this.landmarkDensityInput.value}%`;
    }, { signal });
    this.nameInput.addEventListener('input', () => {
      this.map.name = this.nameInput.value.trim() || '未命名果园';
    }, { signal });
    this.undoButton.addEventListener('click', () => this.undo(), { signal });
    this.redoButton.addEventListener('click', () => this.redo(), { signal });
    getElement<HTMLButtonElement>('#save-button').addEventListener('click', () => this.save(), { signal });
    this.playButton.addEventListener('click', () => this.play(), { signal });
    getElement<HTMLButtonElement>('#generate-button').addEventListener('click', () => this.generateCandidates(), { signal });
    getElement<HTMLButtonElement>('#export-button').addEventListener('click', () => this.exportMap(), { signal });
    getElement<HTMLButtonElement>('#import-button').addEventListener('click', () => this.importInput.click(), { signal });
    this.importInput.addEventListener('change', () => void this.importMap(), { signal });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const point = this.eventToWorld(event);
    if (!insideArena(point, 0.15)) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.pushHistory();
    this.drawing = true;
    this.lastStamp = null;
    this.applyTool(point, true);
    this.refresh();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerWorld = this.eventToWorld(event);
    if (this.drawing && insideArena(this.pointerWorld, 0.1)) {
      this.applyTool(this.pointerWorld, false);
      this.refresh();
    } else {
      this.draw();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.drawing) return;
    event.preventDefault();
    this.drawing = false;
    this.lastStamp = null;
    this.refresh();
  };

  private readonly onPointerLeave = (): void => {
    if (!this.drawing) this.pointerWorld = null;
    this.draw();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const active = document.activeElement;
    const editingText = active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
    if (!editingText && TOOL_KEYS[event.code]) {
      event.preventDefault();
      this.selectTool(TOOL_KEYS[event.code]);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
    }
  };

  private selectTool(tool: EditorTool): void {
    this.tool = tool;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.classList.toggle('active', button.dataset.tool === tool);
    }
    this.draw();
  }

  private applyTool(point: Vec2, initial: boolean): void {
    switch (this.tool) {
      case 'tree':
        if (initial || this.shouldStamp(point, Math.max(1.1, this.brushSize * 0.32))) this.stampTrees(point);
        break;
      case 'erase':
        if (initial || this.shouldStamp(point, Math.max(0.8, this.brushSize * 0.24))) {
          this.eraseAt(point, this.brushSize);
        }
        break;
      case 'homestead':
      case 'pond':
        if (!initial) return;
        this.placeLandmark(point, this.tool);
        break;
      case 'orchard':
      case 'meadow':
        if (!initial) return;
        this.placeTerrainZone(point, this.tool);
        break;
      case 'apple':
        if (!initial || this.map.appleSpawns.length >= MAX_MAP_APPLES) return;
        this.map.appleSpawns.push({ ...point });
        this.eraseTrees(point, 1.5);
        break;
      case 'kid':
        if (!initial) return;
        this.map.kidStart = { ...point };
        this.eraseTrees(point, 2);
        break;
      case 'guard1':
        if (!initial) return;
        this.map.guardStarts[0] = { ...point };
        this.eraseTrees(point, 2);
        break;
      case 'guard2':
        if (!initial) return;
        this.map.guardStarts[1] = { ...point };
        this.eraseTrees(point, 2);
        break;
      case 'delivery':
        if (!initial) return;
        this.map.deliveryZone = { ...point };
        this.eraseTrees(point, GAME_CONFIG.deliveryRadius + 1);
        break;
    }
  }

  private stampTrees(point: Vec2): void {
    if (this.map.trees.length >= MAX_MAP_TREES) return;
    const sampleCount = Math.max(1, Math.round(this.brushSize * 0.85));
    const variant = TREE_VARIANTS.includes(this.treeVariantInput.value as TreeVariant)
      ? this.treeVariantInput.value as TreeVariant
      : 'stump';
    for (let index = 0; index < sampleCount && this.map.trees.length < MAX_MAP_TREES; index += 1) {
      const phase = this.serial * 2.399963 + index * 1.87;
      const radius = index === 0 ? 0 : this.brushSize * (0.25 + (index % 3) * 0.18);
      const candidate = {
        x: point.x + Math.cos(phase) * radius,
        z: point.z + Math.sin(phase) * radius,
      };
      if (!insideArena(candidate, 0.5)) continue;
      if (this.map.trees.some((tree) => distance(tree, candidate) < 1.1)) continue;
      if (this.isImportantPoint(candidate, 1.3)) continue;
      if (this.map.landmarks.some((landmark) => landmarkBlocksPoint(landmark, candidate, 0.8))) {
        continue;
      }
      this.map.trees.push({
        id: `tree-custom-${Date.now()}-${this.serial}`,
        ...candidate,
        variant,
        rotationY: phase % (Math.PI * 2),
        scale: 0.86 + (this.serial % 7) * 0.045,
      });
      this.serial += 1;
    }
    this.lastStamp = { ...point };
  }

  private eraseAt(point: Vec2, radius: number): void {
    this.eraseTrees(point, radius);
    this.map.appleSpawns = this.map.appleSpawns.filter((apple) => distance(apple, point) > Math.max(0.5, radius * 0.4));
    this.map.clearings = this.map.clearings.filter((clearing) => distance(clearing, point) > radius * 0.5);
    this.map.landmarks = this.map.landmarks.filter((landmark) =>
      !landmarkBlocksPoint(landmark, point, radius * 0.2),
    );
    this.map.terrainZones = this.map.terrainZones.filter((zone) =>
      distance(zone, point) > Math.max(radius * 0.45, Math.min(zone.radiusX, zone.radiusZ) * 0.55),
    );
    this.lastStamp = { ...point };
  }

  private eraseTrees(point: Vec2, radius: number): void {
    this.map.trees = this.map.trees.filter((tree) => distance(tree, point) > radius);
  }

  private placeLandmark(point: Vec2, kind: LandmarkKind): void {
    if (this.map.landmarks.length >= MAX_MAP_LANDMARKS) return;
    const landmark: OrchardLandmark = {
      id: `landmark-custom-${Date.now()}-${this.serial}`,
      kind,
      ...point,
      rotationY: (this.serial % 4) * Math.PI / 2,
      radiusX: kind === 'homestead' ? Math.max(4.5, this.brushSize * 1.15) : Math.max(3.4, this.brushSize),
      radiusZ: kind === 'homestead' ? Math.max(3.5, this.brushSize * 0.88) : Math.max(2.6, this.brushSize * 0.72),
    };
    if (!landmarkInsideArena(landmark, 0.8)) {
      this.showToast('地标离边界太近，请向地图内部放置。');
      return;
    }
    if (this.isImportantPointInsideLandmark(landmark, 2.2)) {
      this.showToast('地标会挡住关键点，请换一个位置。');
      return;
    }
    const candidateRadius = Math.hypot(landmark.radiusX, landmark.radiusZ);
    if (this.map.landmarks.some((existing) =>
      distance(existing, landmark) < candidateRadius + Math.hypot(existing.radiusX, existing.radiusZ) + 1.5,
    )) {
      this.showToast('地标之间需要保留宽阔的绕行空间。');
      return;
    }
    this.map.landmarks.push(landmark);
    this.map.trees = this.map.trees.filter((tree) => !landmarkBlocksPoint(landmark, tree, 0.9));
    this.serial += 1;
  }

  private placeTerrainZone(point: Vec2, kind: 'orchard' | 'meadow'): void {
    if (this.map.terrainZones.length >= MAX_TERRAIN_ZONES) return;
    const zone: OrchardTerrainZone = {
      id: `terrain-custom-${Date.now()}-${this.serial}`,
      kind,
      ...point,
      rotationY: (this.serial % 5 - 2) * 0.12,
      radiusX: Math.min(16, Math.max(4.5, this.brushSize * 1.45)),
      radiusZ: Math.min(12, Math.max(3.5, this.brushSize)),
    };
    this.map.terrainZones.push(zone);
    this.serial += 1;
  }

  private isImportantPointInsideLandmark(landmark: OrchardLandmark, padding: number): boolean {
    return [
      this.map.kidStart,
      ...this.map.guardStarts,
      this.map.deliveryZone,
      ...this.map.appleSpawns,
    ].some((point) => landmarkBlocksPoint(landmark, point, padding));
  }

  private shouldStamp(point: Vec2, spacing: number): boolean {
    return !this.lastStamp || distance(this.lastStamp, point) >= spacing;
  }

  private isImportantPoint(point: Vec2, padding: number): boolean {
    return [
      this.map.kidStart,
      ...this.map.guardStarts,
      this.map.deliveryZone,
      ...this.map.appleSpawns,
    ].some((candidate) => distance(candidate, point) < padding);
  }

  private pushHistory(): void {
    this.history.push(cloneOrchardMap(this.map));
    if (this.history.length > 50) this.history.shift();
    this.future = [];
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(cloneOrchardMap(this.map));
    this.setMap(previous);
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(cloneOrchardMap(this.map));
    this.setMap(next);
  }

  private setMap(map: OrchardMap): void {
    this.map = cloneOrchardMap(map);
    this.nameInput.value = this.map.name;
    this.refresh();
  }

  private generateCandidates(): void {
    const preset = MAP_PRESETS.includes(this.presetInput.value as MapPreset)
      ? this.presetInput.value as MapPreset
      : 'village';
    const seed = Number(this.seedInput.value) || Date.now();
    this.candidates = generateMapCandidates({
      seed,
      preset,
      openness: Number(this.opennessInput.value) / 100,
      landmarkDensity: Number(this.landmarkDensityInput.value) / 100,
    });
    this.renderCandidates();
    this.showToast('已生成 4 个可重复的候选地图。点击缩略图选择。');
  }

  private renderCandidates(): void {
    this.candidateList.replaceChildren();
    this.candidates.forEach((candidate, index) => {
      const button = document.createElement('button');
      button.className = 'candidate-card';
      button.type = 'button';
      button.title = `选择候选 ${index + 1}`;
      const canvas = document.createElement('canvas');
      canvas.width = 260;
      canvas.height = 180;
      const label = document.createElement('span');
      label.textContent = `#${index + 1} · ${candidate.landmarks.length} 地标 · ${treeMixLabel(candidate)}`;
      button.append(canvas, label);
      button.addEventListener('click', () => {
        this.pushHistory();
        this.setMap(candidate);
      }, { signal: this.listeners.signal });
      this.candidateList.append(button);
      const context = canvas.getContext('2d');
      if (context) drawMap(context, candidate, canvas.width, canvas.height, null, 0, false);
    });
  }

  private save(): void {
    this.map.name = this.nameInput.value.trim() || '未命名果园';
    if (!saveMapToLibrary(this.map)) {
      this.showToast('浏览器没有允许保存地图。');
      return;
    }
    this.renderSavedMaps();
    this.showToast(`“${this.map.name}”已保存到本机。`);
  }

  private play(): void {
    const validation = validateOrchardMap(this.map);
    if (!validation.valid) {
      this.showToast('请先修复红色地图问题，再进入游戏。');
      return;
    }
    this.map.name = this.nameInput.value.trim() || this.map.name;
    saveMapToLibrary(this.map);
    if (!setActiveMap(this.map)) {
      this.showToast('无法把地图设为当前地图。');
      return;
    }
    window.location.href = '/';
  }

  private exportMap(): void {
    this.map.name = this.nameInput.value.trim() || this.map.name;
    const blob = new Blob([JSON.stringify(this.map, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFilename(this.map.name)}.orchard.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.showToast('地图 JSON 已导出。');
  }

  private async importMap(): Promise<void> {
    const file = this.importInput.files?.[0];
    this.importInput.value = '';
    if (!file) return;
    try {
      const parsed = parseOrchardMap(JSON.parse(await file.text()));
      if (!parsed) throw new Error('地图格式不受支持。');
      this.pushHistory();
      parsed.id = `imported-${Date.now()}`;
      this.setMap(parsed);
      this.showToast('地图已导入；请查看底部的可达性检查。');
    } catch (error) {
      this.showToast(error instanceof Error ? error.message : '地图导入失败。');
    }
  }

  private renderSavedMaps(): void {
    const maps = loadSavedMaps();
    this.savedMapList.replaceChildren();
    if (maps.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-library';
      empty.textContent = '还没有保存的地图。生成候选或手绘后，点击顶部“保存地图”。';
      this.savedMapList.append(empty);
      return;
    }
    for (const map of maps) {
      const row = document.createElement('article');
      row.className = 'saved-map';
      const name = document.createElement('strong');
      name.textContent = map.name;
      const meta = document.createElement('small');
      meta.textContent = `${map.landmarks.length} 地标 · ${treeMixLabel(map)} · ${map.appleSpawns.length} 果实 · seed ${map.seed}`;
      const actions = document.createElement('div');
      const load = document.createElement('button');
      load.type = 'button';
      load.textContent = '↗';
      load.title = '载入地图';
      load.addEventListener('click', () => {
        this.pushHistory();
        this.setMap(map);
      }, { signal: this.listeners.signal });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = '删除地图';
      remove.addEventListener('click', () => {
        deleteSavedMap(map.id);
        this.renderSavedMaps();
      }, { signal: this.listeners.signal });
      actions.append(load, remove);
      row.append(name, meta, actions);
      this.savedMapList.append(row);
    }
  }

  private refresh(): void {
    const validation = validateOrchardMap(this.map);
    this.status.dataset.state = validation.valid ? 'valid' : 'invalid';
    this.status.textContent = validation.valid
      ? `可游玩 · ${this.map.landmarks.length} 地标 · ${this.map.trees.length} 木本点缀（${largeTreeCount(this.map)} 大树） · ${this.map.appleSpawns.length} 果实`
      : `${validation.errors.length} 个问题需要处理`;
    this.playButton.disabled = !validation.valid;
    this.undoButton.disabled = this.history.length === 0;
    this.redoButton.disabled = this.future.length === 0;
    this.validationList.replaceChildren();
    const messages = validation.valid
      ? [`全部 ${validation.totalTargets} 个关键目标可达。`, ...validation.warnings]
      : [...validation.errors, ...validation.warnings];
    for (const message of messages) {
      const chip = document.createElement('span');
      chip.textContent = message;
      chip.classList.toggle('error', validation.errors.includes(message));
      this.validationList.append(chip);
    }
    this.draw();
  }

  private resizeCanvas(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.draw();
  }

  private draw(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMap(
      this.context,
      this.map,
      rect.width,
      rect.height,
      this.pointerWorld,
      this.brushSize,
      true,
    );
  }

  private eventToWorld(event: PointerEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    const transform = viewportTransform(rect.width, rect.height);
    return {
      x: clamp((event.clientX - rect.left - transform.offsetX) / transform.scale, -GAME_CONFIG.arenaHalfWidth, GAME_CONFIG.arenaHalfWidth),
      z: clamp((event.clientY - rect.top - transform.offsetY) / transform.scale, -GAME_CONFIG.arenaHalfDepth, GAME_CONFIG.arenaHalfDepth),
    };
  }

  private showToast(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add('visible');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('visible'), 2600);
  }

  private get brushSize(): number {
    return Number(this.brushInput.value);
  }
}

function drawMap(
  context: CanvasRenderingContext2D,
  map: OrchardMap,
  width: number,
  height: number,
  pointer: Vec2 | null,
  brushSize: number,
  detailed: boolean,
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#718e4c';
  context.fillRect(0, 0, width, height);
  const transform = viewportTransform(width, height);
  const toScreen = (point: Vec2) => ({
    x: transform.offsetX + point.x * transform.scale,
    y: transform.offsetY + point.z * transform.scale,
  });

  context.save();
  context.beginPath();
  const topLeft = toScreen({ x: -GAME_CONFIG.arenaHalfWidth, z: -GAME_CONFIG.arenaHalfDepth });
  context.rect(
    topLeft.x,
    topLeft.y,
    GAME_CONFIG.arenaHalfWidth * 2 * transform.scale,
    GAME_CONFIG.arenaHalfDepth * 2 * transform.scale,
  );
  context.clip();

  context.fillStyle = '#91ad62';
  context.fillRect(
    topLeft.x,
    topLeft.y,
    GAME_CONFIG.arenaHalfWidth * 2 * transform.scale,
    GAME_CONFIG.arenaHalfDepth * 2 * transform.scale,
  );

  if (detailed) {
    context.strokeStyle = 'rgba(47, 74, 40, 0.12)';
    context.lineWidth = 1;
    for (let x = -GAME_CONFIG.arenaHalfWidth; x <= GAME_CONFIG.arenaHalfWidth; x += 5) {
      const start = toScreen({ x, z: -GAME_CONFIG.arenaHalfDepth });
      const end = toScreen({ x, z: GAME_CONFIG.arenaHalfDepth });
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    for (let z = -GAME_CONFIG.arenaHalfDepth; z <= GAME_CONFIG.arenaHalfDepth; z += 5) {
      const start = toScreen({ x: -GAME_CONFIG.arenaHalfWidth, z });
      const end = toScreen({ x: GAME_CONFIG.arenaHalfWidth, z });
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
  }

  for (const zone of map.terrainZones) {
    const screen = toScreen(zone);
    context.beginPath();
    context.ellipse(
      screen.x,
      screen.y,
      zone.radiusX * transform.scale,
      zone.radiusZ * transform.scale,
      -zone.rotationY,
      0,
      Math.PI * 2,
    );
    context.fillStyle = zone.kind === 'orchard'
      ? '#a58b5c'
      : zone.kind === 'wildflowers'
        ? '#8faa67'
        : '#a8be72';
    context.globalAlpha = detailed ? 0.82 : 0.72;
    context.fill();
    context.globalAlpha = 1;
  }

  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const path of map.paths) {
    if (path.points.length < 2) continue;
    context.beginPath();
    path.points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.strokeStyle = '#b29266';
    context.lineWidth = path.width * transform.scale;
    context.stroke();
    if (detailed) {
      context.strokeStyle = 'rgba(255, 240, 195, 0.18)';
      context.lineWidth = Math.max(1, path.width * transform.scale - 5);
      context.stroke();
    }
  }

  for (const clearing of map.clearings) {
    const screen = toScreen(clearing);
    context.beginPath();
    context.arc(screen.x, screen.y, clearing.radius * transform.scale, 0, Math.PI * 2);
    context.fillStyle = '#ad8f66';
    context.fill();
  }

  for (const landmark of map.landmarks) {
    drawLandmark(context, landmark, toScreen(landmark), transform.scale, detailed);
  }

  for (const tree of map.trees) drawTree(context, tree, toScreen(tree), transform.scale, detailed);
  for (const apple of map.appleSpawns) {
    const screen = toScreen(apple);
    context.beginPath();
    context.arc(screen.x, screen.y, Math.max(3, transform.scale * 0.23), 0, Math.PI * 2);
    context.fillStyle = '#d44734';
    context.fill();
    context.strokeStyle = '#fff2c4';
    context.lineWidth = detailed ? 1.5 : 0.8;
    context.stroke();
  }

  drawMarker(context, toScreen(map.kidStart), '#e46438', 'K', detailed);
  drawMarker(context, toScreen(map.guardStarts[0]), '#346ca0', '1', detailed);
  drawMarker(context, toScreen(map.guardStarts[1]), '#477b47', '2', detailed);
  const delivery = toScreen(map.deliveryZone);
  context.beginPath();
  context.arc(delivery.x, delivery.y, GAME_CONFIG.deliveryRadius * transform.scale, 0, Math.PI * 2);
  context.fillStyle = 'rgba(241, 202, 92, 0.24)';
  context.fill();
  context.strokeStyle = '#e5b94d';
  context.lineWidth = detailed ? 3 : 1.5;
  context.stroke();

  if (pointer && brushSize > 0) {
    const screen = toScreen(pointer);
    context.beginPath();
    context.arc(screen.x, screen.y, brushSize * transform.scale, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255, 245, 205, 0.12)';
    context.fill();
    context.setLineDash([5, 4]);
    context.strokeStyle = 'rgba(255, 250, 224, 0.92)';
    context.lineWidth = 1.5;
    context.stroke();
    context.setLineDash([]);
  }
  context.restore();

  context.strokeStyle = '#f0dfac';
  context.lineWidth = detailed ? 3 : 1.5;
  context.strokeRect(
    topLeft.x,
    topLeft.y,
    GAME_CONFIG.arenaHalfWidth * 2 * transform.scale,
    GAME_CONFIG.arenaHalfDepth * 2 * transform.scale,
  );
}

function drawLandmark(
  context: CanvasRenderingContext2D,
  landmark: OrchardLandmark,
  screen: { x: number; y: number },
  scale: number,
  detailed: boolean,
): void {
  if (landmark.kind === 'pond') {
    context.beginPath();
    context.ellipse(
      screen.x,
      screen.y,
      landmark.radiusX * scale,
      landmark.radiusZ * scale,
      -landmark.rotationY,
      0,
      Math.PI * 2,
    );
    context.fillStyle = '#71885b';
    context.fill();
    context.beginPath();
    context.ellipse(
      screen.x,
      screen.y,
      landmark.radiusX * scale * 0.84,
      landmark.radiusZ * scale * 0.8,
      -landmark.rotationY,
      0,
      Math.PI * 2,
    );
    context.fillStyle = '#58a6a4';
    context.fill();
    if (detailed) {
      context.strokeStyle = 'rgba(225, 241, 207, 0.72)';
      context.lineWidth = 1.5;
      context.stroke();
    }
    return;
  }

  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(-landmark.rotationY);
  const width = landmark.radiusX * 2 * scale;
  const depth = landmark.radiusZ * 2 * scale;
  context.fillStyle = '#a58b5c';
  context.fillRect(-width / 2, -depth / 2, width, depth);
  context.strokeStyle = '#755036';
  context.lineWidth = detailed ? 2 : 1;
  context.strokeRect(-width / 2, -depth / 2, width, depth);
  const houseWidth = width * 0.52;
  const houseDepth = depth * 0.48;
  context.fillStyle = '#e3c887';
  context.fillRect(-houseWidth / 2, -depth * 0.22 - houseDepth / 2, houseWidth, houseDepth);
  context.fillStyle = '#b85f43';
  context.beginPath();
  context.moveTo(-houseWidth * 0.58, -depth * 0.22 - houseDepth / 2);
  context.lineTo(0, -depth * 0.22 - houseDepth * 0.78);
  context.lineTo(houseWidth * 0.58, -depth * 0.22 - houseDepth / 2);
  context.closePath();
  context.fill();
  if (detailed) {
    context.fillStyle = '#4d3425';
    context.fillRect(-houseWidth * 0.1, -depth * 0.22 + houseDepth * 0.08, houseWidth * 0.2, houseDepth * 0.42);
  }
  context.restore();
}

function drawTree(
  context: CanvasRenderingContext2D,
  tree: OrchardTree,
  screen: { x: number; y: number },
  scale: number,
  detailed: boolean,
): void {
  if (tree.variant === 'stump') {
    const radius = Math.max(1.6, 0.4 * scale * tree.scale);
    context.beginPath();
    context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    context.fillStyle = '#6a4630';
    context.fill();
    if (detailed) {
      context.beginPath();
      context.arc(screen.x, screen.y - radius * 0.12, radius * 0.68, 0, Math.PI * 2);
      context.fillStyle = '#b78652';
      context.fill();
      context.beginPath();
      context.arc(screen.x, screen.y - radius * 0.12, radius * 0.34, 0, Math.PI * 2);
      context.strokeStyle = '#7d5837';
      context.lineWidth = 1;
      context.stroke();
    }
    return;
  }

  const radius = Math.max(2.6, 0.58 * scale * tree.scale);
  context.beginPath();
  context.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  context.fillStyle = tree.variant === 'cherry'
    ? '#d58da0'
    : tree.variant === 'pine'
      ? '#315f3e'
      : '#47763f';
  context.fill();
  if (detailed) {
    context.beginPath();
    context.arc(screen.x - radius * 0.28, screen.y - radius * 0.24, radius * 0.55, 0, Math.PI * 2);
    context.fillStyle = tree.variant === 'cherry' ? '#e3a7b3' : '#628c4c';
    context.fill();
    context.beginPath();
    context.arc(screen.x, screen.y, Math.max(1.4, radius * 0.17), 0, Math.PI * 2);
    context.fillStyle = '#5e422e';
    context.fill();
  }
}

function largeTreeCount(map: OrchardMap): number {
  return map.trees.reduce((count, tree) => count + (tree.variant === 'stump' ? 0 : 1), 0);
}

function treeMixLabel(map: OrchardMap): string {
  const largeTrees = largeTreeCount(map);
  return `${map.trees.length - largeTrees} 桩 / ${largeTrees} 树`;
}

function drawMarker(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
  label: string,
  detailed: boolean,
): void {
  const radius = detailed ? 9 : 4.5;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = '#fff3ca';
  context.lineWidth = detailed ? 2 : 1;
  context.stroke();
  if (!detailed) return;
  context.fillStyle = '#fff9e3';
  context.font = '800 9px ui-monospace, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, point.x, point.y + 0.5);
}

function viewportTransform(width: number, height: number): ViewportTransform {
  const padding = Math.min(24, Math.max(10, Math.min(width, height) * 0.04));
  const scale = Math.max(0.001, Math.min(
    (width - padding * 2) / (GAME_CONFIG.arenaHalfWidth * 2),
    (height - padding * 2) / (GAME_CONFIG.arenaHalfDepth * 2),
  ));
  return {
    scale,
    offsetX: width / 2,
    offsetY: height / 2,
  };
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing editor element: ${selector}`);
  return element;
}

function distance(first: Vec2, second: Vec2): number {
  return Math.hypot(first.x - second.x, first.z - second.z);
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'orchard-map';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
