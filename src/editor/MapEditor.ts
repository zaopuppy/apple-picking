import { GAME_CONFIG } from '../game/config';
import {
  generateMapCandidates,
  MAP_PRESETS,
  type MapPreset,
} from '../game/maps/MapGenerator';
import {
  cloneOrchardMap,
  deliveryZonesForMap,
  insideArena,
  ISLAND_REGION_KINDS,
  ISLAND_ROUTE_BLOCK_KINDS,
  KAYKIT_BUILDING_ASSETS,
  KAYKIT_TILE_SHAPES,
  KAYKIT_WORLD_THEMES,
  landmarkBlocksPoint,
  landmarkInsideArena,
  MAX_DELIVERY_ZONES,
  MAX_ISLAND_OUTLINE_POINTS,
  MAX_ISLAND_BRIDGES,
  MAX_ISLAND_REGIONS,
  MAX_ISLAND_ROUTE_BLOCKS,
  MAX_ISLAND_WATER_SEGMENTS,
  MAX_MAP_APPLES,
  MAX_MAP_LANDMARKS,
  MAX_TERRAIN_ZONES,
  MAX_MAP_TREES,
  parseOrchardMap,
  TREE_VARIANTS,
  type KayKitBuildingAsset,
  type KayKitTileShape,
  type KayKitWorldTheme,
  type LandmarkKind,
  type OrchardDeliveryZone,
  type OrchardLandmark,
  type OrchardIslandLayout,
  type OrchardIslandRegionKind,
  type OrchardIslandRouteBlockKind,
  type OrchardMap,
  type OrchardTerrainZone,
  type OrchardTree,
  type TreeVariant,
  validateOrchardMap,
} from '../game/maps/OrchardMap';
import type { Vec2 } from '../game/types';
import {
  addDeliveryZone,
  moveDeliveryZone,
  removeDeliveryZone,
  reorderDeliveryZone,
} from '../game/maps/DeliveryZoneEditing';
import {
  addIslandObject,
  applyIslandGeometryUpdate,
  insertIslandOutlinePoint,
  moveIslandOutlinePoint,
  removeIslandObject,
  removeIslandOutlinePoint,
  type EditableIslandGeometryKind,
  type IslandObjectKind,
} from '../game/maps/IslandLayoutEditing';
import {
  deleteSavedMap,
  loadActiveMap,
  loadSavedMaps,
  saveMapToLibrary,
  setActiveMap,
} from '../systems/MapStorage';
import {
  MapPreview3D,
  type MapPreviewMoveResult,
  type MapPreviewSelection,
} from './MapPreview3D';

type EditorTool =
  | 'island-select'
  | 'tree'
  | 'erase'
  | 'homestead'
  | 'pond'
  | 'orchard'
  | 'meadow'
  | 'path'
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

type IslandSelectionKind =
  | 'outline'
  | 'region'
  | 'route-block'
  | 'water-segment'
  | 'water-block'
  | 'bridge';

type IslandSelection = {
  kind: IslandSelectionKind;
  id: string;
};

const TOOL_KEYS: Record<string, EditorTool> = {
  KeyR: 'island-select',
  Digit1: 'tree',
  Digit2: 'erase',
  Digit3: 'homestead',
  Digit4: 'pond',
  Digit5: 'orchard',
  Digit6: 'meadow',
  KeyE: 'path',
  Digit7: 'apple',
  Digit8: 'kid',
  Digit9: 'guard1',
  KeyQ: 'guard2',
  KeyW: 'delivery',
};

const BUILDING_LABELS: Record<KayKitBuildingAsset, string> = {
  house: '住宅',
  market: '集市',
  farmPlot: '农田',
  lumbermill: '伐木场',
  mill: '风车',
  watermill: '水车',
  well: '水井',
  archeryRange: '靶场',
  barracks: '兵营',
  watchtower: '瞭望塔',
  castle: '城堡',
  mine: '矿山',
};

export class MapEditor {
  private readonly context: CanvasRenderingContext2D;
  private readonly preview: MapPreview3D;
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
  private readonly worldStyleControls = getElement<HTMLElement>('#world-style-controls');
  private readonly buildingControls = getElement<HTMLElement>('#building-controls');
  private readonly treeControls = getElement<HTMLElement>('#tree-controls');
  private readonly brushControls = getElement<HTMLElement>('#brush-controls');
  private readonly worldThemeInput = getElement<HTMLSelectElement>('#world-theme');
  private readonly tileShapeInput = getElement<HTMLSelectElement>('#tile-shape');
  private readonly buildingAssetInput = getElement<HTMLSelectElement>('#building-asset');
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
  private readonly mapLegend = getElement<HTMLElement>('#map-legend');
  private readonly previewHelp = getElement<HTMLElement>('#preview-help');
  private readonly islandSelection = getElement<HTMLElement>('#island-selection');
  private readonly islandGeometryPanel = getElement<HTMLFormElement>('#island-geometry-panel');
  private readonly islandAddKind = getElement<HTMLSelectElement>('#island-add-kind');
  private readonly islandObjectAdd = getElement<HTMLButtonElement>('#island-object-add');
  private readonly islandGeometryTitle = getElement<HTMLElement>('#island-geometry-title');
  private readonly islandGeometryFields = getElement<HTMLElement>('#island-geometry-fields');
  private readonly islandGeometryKindField = getElement<HTMLElement>('#island-geometry-kind-field');
  private readonly islandGeometryKindLabel = getElement<HTMLElement>('#island-geometry-kind-label');
  private readonly islandGeometryKind = getElement<HTMLSelectElement>('#island-geometry-kind');
  private readonly islandGeometryRotationField = getElement<HTMLElement>('#island-geometry-rotation-field');
  private readonly islandGeometryRotation = getElement<HTMLInputElement>('#island-geometry-rotation');
  private readonly islandGeometryX = getElement<HTMLInputElement>('#island-geometry-x');
  private readonly islandGeometryZ = getElement<HTMLInputElement>('#island-geometry-z');
  private readonly islandGeometrySizeX = getElement<HTMLInputElement>('#island-geometry-size-x');
  private readonly islandGeometrySizeZ = getElement<HTMLInputElement>('#island-geometry-size-z');
  private readonly islandGeometrySizeXLabel = getElement<HTMLElement>('#island-geometry-size-x-label');
  private readonly islandGeometrySizeZLabel = getElement<HTMLElement>('#island-geometry-size-z-label');
  private readonly islandGeometryNote = getElement<HTMLElement>('#island-geometry-note');
  private readonly islandGeometryApply = getElement<HTMLButtonElement>('#island-geometry-apply');
  private readonly islandGeometrySizeFields = Array.from(
    document.querySelectorAll<HTMLElement>('.island-geometry-size-field'),
  );
  private readonly islandNodeInsert = getElement<HTMLButtonElement>('#island-node-insert');
  private readonly islandNodeDelete = getElement<HTMLButtonElement>('#island-node-delete');
  private readonly islandObjectDelete = getElement<HTMLButtonElement>('#island-object-delete');
  private readonly deliveryZonePanel = getElement<HTMLElement>('#delivery-zone-panel');
  private readonly deliveryZoneCount = getElement<HTMLElement>('#delivery-zone-count');
  private readonly deliveryZoneList = getElement<HTMLElement>('#delivery-zone-list');
  private readonly deliveryZoneNote = getElement<HTMLElement>('#delivery-zone-note');
  private readonly deliveryZoneAdd = getElement<HTMLButtonElement>('#delivery-zone-add');
  private readonly deliveryZoneDelete = getElement<HTMLButtonElement>('#delivery-zone-delete');
  private readonly deliveryZoneUp = getElement<HTMLButtonElement>('#delivery-zone-up');
  private readonly deliveryZoneDown = getElement<HTMLButtonElement>('#delivery-zone-down');

  private map = loadActiveMap();
  private candidates: OrchardMap[] = [];
  private history: OrchardMap[] = [];
  private future: OrchardMap[] = [];
  private tool: EditorTool = 'tree';
  private selectedIsland: IslandSelection | null = null;
  private placingIslandObject: IslandObjectKind | null = null;
  private selectedDeliveryZoneId: string | null = null;
  private placingDeliveryZone = false;
  private islandDraggingIndex: number | null = null;
  private islandDragPointerStart: Vec2 | null = null;
  private islandDragHistoryPushed = false;
  private islandDragError: string | null = null;
  private pointerWorld: Vec2 | null = null;
  private drawing = false;
  private lastStamp: Vec2 | null = null;
  private activePathId: string | null = null;
  private serial = 0;
  private toastTimer: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    previewCanvas: HTMLCanvasElement,
    previewStatus: HTMLElement,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas is unavailable.');
    this.context = context;
    this.preview = new MapPreview3D(previewCanvas, previewStatus, {
      onSelectionChange: (selection) => this.handlePreviewSelection(selection),
      onMovePreview: (selection, position) => this.previewIslandMoveIsValid(selection, position),
      onMoveCommit: (selection, position) => this.commitPreviewIslandMove(selection, position),
    });
    this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
  }

  start(): void {
    this.nameInput.value = this.map.name;
    this.syncWorldStyleControls();
    this.updateToolSpecificControls();
    this.bindControls();
    this.resizeObserver.observe(this.canvas);
    this.resizeCanvas();
    this.preview.setMap(this.map);
    this.generateCandidates();
    this.renderSavedMaps();
    this.refresh();
  }

  dispose(): void {
    this.listeners.abort();
    this.resizeObserver.disconnect();
    this.preview.dispose();
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
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-editor-view]')) {
      button.addEventListener('click', () => {
        this.selectView(button.dataset.editorView === '3d' ? '3d' : '2d');
      }, { signal });
    }
    this.brushInput.addEventListener('input', () => {
      this.brushValue.value = this.brushSize.toFixed(1);
      this.draw();
    }, { signal });
    this.worldThemeInput.addEventListener('change', () => {
      const theme = this.readWorldTheme();
      if (theme === this.map.worldStyle.theme) return;
      this.pushHistory();
      this.map.worldStyle.theme = theme;
      this.assignThemeBuildings();
      this.refresh();
      this.showToast(`已切换为${worldThemeLabel(theme)}；现有建筑按主题重新分配。`);
    }, { signal });
    this.tileShapeInput.addEventListener('change', () => {
      const tileShape = this.readTileShape();
      if (tileShape === this.map.worldStyle.tileShape) return;
      this.pushHistory();
      this.map.worldStyle.tileShape = tileShape;
      this.refresh();
      this.showToast(tileShape === 'square' ? '已切换为方形地块。' : '已切换为六边形地块。');
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
    this.islandGeometryPanel.addEventListener('submit', (event) => {
      event.preventDefault();
      this.applySelectedIslandGeometry();
    }, { signal });
    this.islandNodeInsert.addEventListener('click', () => this.insertSelectedIslandNode(), { signal });
    this.islandNodeDelete.addEventListener('click', () => this.deleteSelectedIslandNode(), { signal });
    this.islandObjectAdd.addEventListener('click', () => this.toggleIslandObjectPlacement(), { signal });
    this.islandObjectDelete.addEventListener('click', () => this.deleteSelectedIslandObject(), { signal });
    this.islandAddKind.addEventListener('change', () => {
      if (this.placingIslandObject) this.placingIslandObject = this.readIslandAddKind();
      this.updateIslandGeometryPanel();
      this.draw();
    }, { signal });
    this.deliveryZoneAdd.addEventListener('click', () => this.toggleDeliveryPlacement(), { signal });
    this.deliveryZoneDelete.addEventListener('click', () => this.deleteSelectedDeliveryZone(), { signal });
    this.deliveryZoneUp.addEventListener('click', () => this.reorderSelectedDeliveryZone(-1), { signal });
    this.deliveryZoneDown.addEventListener('click', () => this.reorderSelectedDeliveryZone(1), { signal });
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    const point = this.eventToWorld(event);
    if (!insideArena(point, 0.15)) return;
    if (this.tool === 'island-select') {
      if (this.placingIslandObject) {
        this.placeIslandObject(point);
        return;
      }
      this.selectIslandAt(point);
      const nodeIndex = outlineNodeIndex(this.selectedIsland);
      if (nodeIndex !== null) {
        this.canvas.setPointerCapture(event.pointerId);
        this.islandDraggingIndex = nodeIndex;
        this.islandDragPointerStart = { ...point };
        this.islandDragHistoryPushed = false;
        this.islandDragError = null;
      }
      return;
    }
    if (this.tool === 'delivery') {
      this.handleDeliveryPointer(point);
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.pushHistory();
    this.drawing = true;
    this.lastStamp = null;
    this.applyTool(point, true);
    this.refresh();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerWorld = this.eventToWorld(event);
    if (this.islandDraggingIndex !== null) {
      if (!insideArena(this.pointerWorld)) return;
      if (!this.islandDragHistoryPushed && this.islandDragPointerStart &&
        distance(this.pointerWorld, this.islandDragPointerStart) < 0.3) {
        this.draw();
        return;
      }
      if (!this.islandDragHistoryPushed) this.pushHistory();
      const result = moveIslandOutlinePoint(this.map, this.islandDraggingIndex, this.pointerWorld);
      if (!result.ok) {
        if (!this.islandDragHistoryPushed) this.history.pop();
        this.islandDragError = result.error ?? '海岸节点移动失败。';
        this.draw();
        return;
      }
      this.islandDragHistoryPushed = true;
      this.islandDragError = null;
      this.refresh();
      return;
    }
    if (this.drawing && insideArena(this.pointerWorld, 0.1)) {
      this.applyTool(this.pointerWorld, false);
      this.refresh();
    } else {
      this.draw();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.islandDraggingIndex !== null) {
      event.preventDefault();
      const moved = this.islandDragHistoryPushed;
      const error = this.islandDragError;
      this.islandDraggingIndex = null;
      this.islandDragPointerStart = null;
      this.islandDragHistoryPushed = false;
      this.islandDragError = null;
      if (moved) this.showToast('海岸节点与沿岸碰撞已同步。');
      else if (error) this.showToast(error);
      this.draw();
      return;
    }
    if (!this.drawing) return;
    event.preventDefault();
    this.drawing = false;
    if (this.activePathId) {
      const path = this.map.paths.find((candidate) => candidate.id === this.activePathId);
      if (path && path.points.length < 2) this.map.paths = this.map.paths.filter((candidate) => candidate !== path);
      this.activePathId = null;
    }
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
    if (tool !== 'delivery') this.placingDeliveryZone = false;
    if (tool !== 'island-select') {
      this.placingIslandObject = null;
      this.islandDraggingIndex = null;
      this.islandDragPointerStart = null;
      this.islandDragHistoryPushed = false;
      this.islandDragError = null;
    }
    this.canvas.classList.toggle('island-select-mode', tool === 'island-select');
    this.canvas.classList.toggle('island-place-mode', tool === 'island-select' && Boolean(this.placingIslandObject));
    this.canvas.classList.toggle('delivery-place-mode', tool === 'delivery' && this.placingDeliveryZone);
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
      button.classList.toggle('active', button.dataset.tool === tool);
    }
    this.updateToolSpecificControls();
    this.updateIslandGeometryPanel();
    this.updateDeliveryZonePanel();
    this.draw();
  }

  private updateToolSpecificControls(): void {
    const structureTool = this.tool === 'island-select' || this.tool === 'delivery';
    this.worldStyleControls.hidden = structureTool;
    this.buildingControls.hidden = this.tool !== 'homestead';
    this.treeControls.hidden = this.tool !== 'tree';
    this.brushControls.hidden = ![
      'tree',
      'erase',
      'homestead',
      'pond',
      'orchard',
      'meadow',
      'path',
    ].includes(this.tool);
  }

  private selectIslandAt(point: Vec2): void {
    if (!this.map.islandLayout) {
      this.selectedIsland = null;
      this.updateIslandSelectionInfo();
      this.showToast('当前地图没有 v5 岛屿结构。');
      this.draw();
      return;
    }
    this.selectedIsland = hitTestIslandLayout(this.map.islandLayout, point);
    this.updateIslandSelectionInfo();
    if (this.selectedIsland) {
      this.showToast(`已选择${islandSelectionLabel(this.map.islandLayout, this.selectedIsland)}。`);
    }
    this.draw();
  }

  private handlePreviewSelection(selection: MapPreviewSelection | null): void {
    if (!selection) {
      this.selectedIsland = null;
      this.updateIslandSelectionInfo();
      return;
    }
    this.selectTool('island-select');
    this.selectedIsland = { ...selection };
    this.preview.setSelection(selection);
    this.updateIslandSelectionInfo();
    if (this.map.islandLayout) {
      this.showToast(`已在 3D 中选择${islandSelectionLabel(this.map.islandLayout, selection)}；直接拖动可移动。`);
    }
  }

  private previewIslandMoveIsValid(selection: MapPreviewSelection, position: Vec2): boolean {
    const candidate = cloneOrchardMap(this.map);
    return applyPreviewIslandMove(candidate, selection, position) &&
      validateOrchardMap(candidate).valid;
  }

  private commitPreviewIslandMove(
    selection: MapPreviewSelection,
    position: Vec2,
  ): MapPreviewMoveResult {
    const candidate = cloneOrchardMap(this.map);
    if (!applyPreviewIslandMove(candidate, selection, position)) {
      const message = '3D 移动失败：结构已经不存在或不允许这样移动。';
      this.showToast(message);
      return { ok: false, message };
    }
    const validation = validateOrchardMap(candidate);
    if (!validation.valid) {
      const message = validation.errors[0] ?? '当前位置会破坏地图结构。';
      this.showToast(message);
      return { ok: false, message };
    }
    this.pushHistory();
    this.map = candidate;
    this.selectedIsland = { ...selection };
    this.refresh();
    this.showToast(selection.kind === 'bridge'
      ? '桥梁已沿水面移动，碰撞缺口已同步。'
      : '3D 位置已应用，并写入一条撤销记录。');
    return { ok: true };
  }

  private updateIslandSelectionInfo(): void {
    const layout = this.map.islandLayout;
    const selection = this.selectedIsland;
    this.islandSelection.hidden = !layout;
    this.canvas.dataset.layoutMode = layout ? 'island-v5' : 'orchard';
    this.canvas.dataset.islandRegions = String(layout?.regions.length ?? 0);
    this.canvas.dataset.islandRouteBlocks = String(layout?.routeBlocks.length ?? 0);
    this.canvas.dataset.islandWaterSegments = String(layout?.waterSegments.length ?? 0);
    this.canvas.dataset.islandBridges = String(layout?.bridges.length ?? 0);
    if (!layout) {
      this.islandSelection.textContent = '';
      delete this.canvas.dataset.selectedIslandId;
      delete this.canvas.dataset.selectedIslandKind;
      this.updateIslandGeometryPanel();
      return;
    }
    if (!selection || !islandSelectionExists(layout, selection)) {
      this.selectedIsland = null;
      this.islandSelection.textContent = `岛屿 v5 · ${layout.regions.length} 区域 · 使用“岛屿结构”选择查看`;
      delete this.canvas.dataset.selectedIslandId;
      delete this.canvas.dataset.selectedIslandKind;
      this.updateIslandGeometryPanel();
      return;
    }
    this.islandSelection.textContent = `已选择 · ${islandSelectionLabel(layout, selection)}`;
    this.canvas.dataset.selectedIslandId = selection.id;
    this.canvas.dataset.selectedIslandKind = selection.kind;
    this.updateIslandGeometryPanel();
  }

  private updateIslandGeometryPanel(): void {
    const layout = this.map.islandLayout;
    const selection = this.selectedIsland;
    this.islandGeometryPanel.hidden = !layout || this.tool !== 'island-select';
    this.updateIslandObjectBuilder(layout);
    if (!layout || !selection || !islandSelectionExists(layout, selection)) {
      this.islandGeometryTitle.textContent = '选择岛屿结构';
      this.islandGeometryFields.hidden = true;
      this.islandGeometryNote.textContent = this.placingIslandObject
        ? islandPlacementHint(this.placingIslandObject)
        : '在画布中选择海岸节点、区域、矩形障碍、水面或桥梁。';
      this.islandGeometryApply.disabled = true;
      this.islandNodeInsert.hidden = true;
      this.islandNodeDelete.hidden = true;
      this.islandObjectDelete.hidden = true;
      this.islandGeometryKindField.hidden = true;
      this.islandGeometryRotationField.hidden = true;
      this.islandGeometryPanel.dataset.editable = 'false';
      return;
    }

    const geometry = islandGeometryView(layout, selection);
    const nodeIndex = outlineNodeIndex(selection);
    this.islandGeometryTitle.textContent = islandSelectionLabel(layout, selection);
    this.islandGeometryFields.hidden = geometry === null;
    this.islandGeometryApply.disabled = !geometry?.editable;
    this.islandNodeInsert.hidden = nodeIndex === null;
    this.islandNodeDelete.hidden = nodeIndex === null;
    this.islandObjectDelete.hidden = nodeIndex !== null || selection.kind === 'water-block';
    this.islandObjectDelete.disabled = selection.kind === 'region' && layout.regions.length <= 1;
    this.islandNodeInsert.disabled = layout.outline.length >= MAX_ISLAND_OUTLINE_POINTS;
    this.islandNodeDelete.disabled = layout.outline.length <= 3;
    this.islandGeometryPanel.dataset.editable = String(geometry?.editable ?? false);
    if (!geometry) {
      this.islandGeometryNote.textContent = '轮廓节点编辑将在海岸线工具阶段开放。';
      return;
    }

    this.islandGeometryX.value = formatGeometryNumber(geometry.x);
    this.islandGeometryZ.value = formatGeometryNumber(geometry.z);
    this.islandGeometrySizeX.value = formatGeometryNumber(geometry.sizeX);
    this.islandGeometrySizeZ.value = formatGeometryNumber(geometry.sizeZ);
    this.islandGeometrySizeXLabel.textContent = geometry.sizeXLabel;
    this.islandGeometrySizeZLabel.textContent = geometry.sizeZLabel;
    this.configureIslandSemanticFields(geometry);
    for (const field of this.islandGeometrySizeFields) field.hidden = !geometry.hasSize;
    this.islandGeometryX.disabled = !geometry.editable;
    this.islandGeometrySizeX.disabled = !geometry.editable || !geometry.hasSize;
    this.islandGeometrySizeZ.disabled = !geometry.editable || !geometry.hasSize;
    this.islandGeometryZ.disabled = !geometry.editable || selection.kind === 'bridge';
    this.islandGeometryNote.textContent = geometry.note;
  }

  private updateIslandObjectBuilder(layout: OrchardIslandLayout | undefined): void {
    const kind = this.readIslandAddKind();
    const atLimit = !layout || (kind === 'region'
      ? layout.regions.length >= MAX_ISLAND_REGIONS
      : kind === 'route-block'
        ? layout.routeBlocks.length >= MAX_ISLAND_ROUTE_BLOCKS
        : kind === 'water-segment'
          ? layout.waterSegments.length >= MAX_ISLAND_WATER_SEGMENTS
          : layout.bridges.length >= MAX_ISLAND_BRIDGES || layout.waterSegments.length === 0);
    this.islandObjectAdd.disabled = atLimit;
    this.islandObjectAdd.textContent = this.placingIslandObject ? '取消放置' : '放置新结构';
    this.islandObjectAdd.dataset.placing = String(Boolean(this.placingIslandObject));
    this.canvas.classList.toggle(
      'island-place-mode',
      this.tool === 'island-select' && Boolean(this.placingIslandObject),
    );
  }

  private configureIslandSemanticFields(geometry: IslandGeometryView): void {
    this.islandGeometryKindField.hidden = !geometry.kindOptions;
    this.islandGeometryRotationField.hidden = geometry.rotationY === undefined;
    if (geometry.kindOptions) {
      this.islandGeometryKindLabel.textContent = geometry.kindLabel ?? '结构类型';
      this.islandGeometryKind.replaceChildren(...geometry.kindOptions.map(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      }));
      this.islandGeometryKind.value = geometry.semanticKind ?? geometry.kindOptions[0][0];
    }
    this.islandGeometryRotation.value = geometry.rotationY === undefined
      ? '0'
      : formatGeometryNumber(geometry.rotationY * 180 / Math.PI);
  }

  private applySelectedIslandGeometry(): void {
    const selection = this.selectedIsland;
    if (!this.map.islandLayout || !selection) return;
    const nodeIndex = outlineNodeIndex(selection);
    if (nodeIndex !== null) {
      const point = {
        x: Number(this.islandGeometryX.value),
        z: Number(this.islandGeometryZ.value),
      };
      if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
        this.showToast('请输入有效的海岸节点坐标。');
        return;
      }
      this.pushHistory();
      const result = moveIslandOutlinePoint(this.map, nodeIndex, point);
      if (!result.ok) {
        this.history.pop();
        this.showToast(result.error ?? '海岸节点移动失败。');
        return;
      }
      this.refresh();
      this.showToast('海岸节点与沿岸碰撞已同步。');
      return;
    }
    if (!isEditableIslandSelection(selection)) return;
    const numericUpdate = {
      x: Number(this.islandGeometryX.value),
      z: Number(this.islandGeometryZ.value),
      sizeX: Number(this.islandGeometrySizeX.value),
      sizeZ: Number(this.islandGeometrySizeZ.value),
    };
    const rotationY = Number(this.islandGeometryRotation.value) * Math.PI / 180;
    if (Object.values(numericUpdate).some((value) => !Number.isFinite(value)) ||
      (selection.kind === 'region' && !Number.isFinite(rotationY))) {
      this.showToast('请输入有效的结构坐标与尺寸。');
      return;
    }
    const update = {
      ...numericUpdate,
      ...(selection.kind === 'region' || selection.kind === 'route-block'
        ? { semanticKind: this.islandGeometryKind.value as
          OrchardIslandRegionKind | OrchardIslandRouteBlockKind }
        : {}),
      ...(selection.kind === 'region' ? { rotationY } : {}),
    };
    this.pushHistory();
    if (!applyIslandGeometryUpdate(this.map, selection.kind, selection.id, update)) {
      this.history.pop();
      this.showToast('结构修改失败：找不到对应的岛屿对象或水面。');
      return;
    }
    this.refresh();
    this.showToast(selection.kind === 'bridge'
      ? '桥梁与水域碰撞缺口已同步。'
      : selection.kind === 'water-segment'
        ? '水面、所属桥梁与派生碰撞已同步。'
      : selection.kind === 'route-block'
        ? '矩形通路块与碰撞代理已同步。'
        : '岛屿区域已更新。');
  }

  private insertSelectedIslandNode(): void {
    const nodeIndex = outlineNodeIndex(this.selectedIsland);
    if (nodeIndex === null) return;
    this.pushHistory();
    const result = insertIslandOutlinePoint(this.map, nodeIndex);
    if (!result.ok) {
      this.history.pop();
      this.showToast(result.error ?? '海岸节点插入失败。');
      return;
    }
    this.selectedIsland = { kind: 'outline', id: outlineNodeId(result.index) };
    this.refresh();
    this.showToast('已插入海岸节点，并重建沿岸碰撞。');
  }

  private deleteSelectedIslandNode(): void {
    const nodeIndex = outlineNodeIndex(this.selectedIsland);
    if (nodeIndex === null) return;
    this.pushHistory();
    const result = removeIslandOutlinePoint(this.map, nodeIndex);
    if (!result.ok) {
      this.history.pop();
      this.showToast(result.error ?? '海岸节点删除失败。');
      return;
    }
    this.selectedIsland = { kind: 'outline', id: outlineNodeId(result.index) };
    this.refresh();
    this.showToast('已删除海岸节点，并重建沿岸碰撞。');
  }

  private toggleIslandObjectPlacement(): void {
    if (this.placingIslandObject) {
      this.placingIslandObject = null;
      this.updateIslandGeometryPanel();
      this.draw();
      this.showToast('已取消放置岛屿结构。');
      return;
    }
    this.placingIslandObject = this.readIslandAddKind();
    this.selectedIsland = null;
    this.updateIslandSelectionInfo();
    this.draw();
    this.showToast(islandPlacementHint(this.placingIslandObject));
  }

  private placeIslandObject(point: Vec2): void {
    const kind = this.placingIslandObject;
    if (!kind) return;
    this.pushHistory();
    const result = addIslandObject(this.map, kind, point);
    if (!result.ok || !result.id) {
      this.history.pop();
      this.showToast(result.error ?? '岛屿结构放置失败。');
      return;
    }
    this.selectedIsland = { kind, id: result.id };
    this.placingIslandObject = null;
    this.refresh();
    this.showToast(`${islandObjectKindLabel(kind)}已添加；可继续精确调整。`);
  }

  private deleteSelectedIslandObject(): void {
    const selection = this.selectedIsland;
    if (!selection || !isEditableIslandSelection(selection)) return;
    this.pushHistory();
    const result = removeIslandObject(this.map, selection.kind, selection.id);
    if (!result.ok) {
      this.history.pop();
      this.showToast(result.error ?? '岛屿结构删除失败。');
      return;
    }
    this.selectedIsland = null;
    this.refresh();
    this.showToast(`${islandObjectKindLabel(selection.kind)}已删除，派生碰撞已同步。`);
  }

  private readIslandAddKind(): IslandObjectKind {
    const value = this.islandAddKind.value;
    return value === 'route-block' || value === 'water-segment' || value === 'bridge'
      ? value
      : 'region';
  }

  private handleDeliveryPointer(point: Vec2): void {
    const zones = deliveryZonesForMap(this.map);
    if (this.placingDeliveryZone) {
      this.pushHistory();
      const zone = addDeliveryZone(this.map, point);
      if (!zone) {
        this.history.pop();
        this.placingDeliveryZone = false;
        this.updateDeliveryZonePanel();
        this.showToast(`投递点最多 ${MAX_DELIVERY_ZONES} 个。`);
        return;
      }
      this.selectedDeliveryZoneId = zone.id;
      this.placingDeliveryZone = false;
      this.eraseTrees(zone, GAME_CONFIG.deliveryRadius + 1);
      this.refresh();
      this.showToast(`已添加投递点 ${deliveryZonesForMap(this.map).length}。`);
      return;
    }

    const hit = nearestDeliveryZoneAt(zones, point);
    if (hit) {
      this.selectDeliveryZone(hit.id);
      return;
    }

    const selectedId = zones.some((zone) => zone.id === this.selectedDeliveryZoneId)
      ? this.selectedDeliveryZoneId
      : zones[0]?.id;
    if (!selectedId) return;
    this.pushHistory();
    if (!moveDeliveryZone(this.map, selectedId, point)) {
      this.history.pop();
      return;
    }
    const moved = deliveryZonesForMap(this.map).find((zone) => zone.id === selectedId);
    if (moved) this.eraseTrees(moved, GAME_CONFIG.deliveryRadius + 1);
    this.refresh();
    this.showToast('选中投递点已移动。');
  }

  private selectDeliveryZone(id: string): void {
    if (!deliveryZonesForMap(this.map).some((zone) => zone.id === id)) return;
    this.selectedDeliveryZoneId = id;
    this.placingDeliveryZone = false;
    this.updateDeliveryZonePanel();
    this.draw();
    this.showToast('已选择投递点；点击空白地图可移动。');
  }

  private toggleDeliveryPlacement(): void {
    const zones = deliveryZonesForMap(this.map);
    if (zones.length >= MAX_DELIVERY_ZONES) return;
    this.placingDeliveryZone = !this.placingDeliveryZone;
    this.canvas.classList.toggle('delivery-place-mode', this.placingDeliveryZone);
    this.updateDeliveryZonePanel();
    this.draw();
    this.showToast(this.placingDeliveryZone ? '请在地图上点击新投递点位置。' : '已取消添加投递点。');
  }

  private deleteSelectedDeliveryZone(): void {
    const zones = deliveryZonesForMap(this.map);
    const index = zones.findIndex((zone) => zone.id === this.selectedDeliveryZoneId);
    if (index < 0 || zones.length <= 1) return;
    this.pushHistory();
    if (!removeDeliveryZone(this.map, zones[index].id)) {
      this.history.pop();
      return;
    }
    const remaining = deliveryZonesForMap(this.map);
    this.selectedDeliveryZoneId = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
    this.placingDeliveryZone = false;
    this.refresh();
    this.showToast('选中投递点已删除。');
  }

  private reorderSelectedDeliveryZone(offset: -1 | 1): void {
    const id = this.selectedDeliveryZoneId;
    if (!id) return;
    this.pushHistory();
    if (!reorderDeliveryZone(this.map, id, offset)) {
      this.history.pop();
      return;
    }
    this.refresh();
    this.showToast(offset < 0 ? '投递点顺序已上移。' : '投递点顺序已下移。');
  }

  private updateDeliveryZonePanel(): void {
    const zones = deliveryZonesForMap(this.map);
    this.deliveryZonePanel.hidden = this.tool !== 'delivery';
    if (!zones.some((zone) => zone.id === this.selectedDeliveryZoneId)) {
      this.selectedDeliveryZoneId = zones[0]?.id ?? null;
    }
    const selectedIndex = zones.findIndex((zone) => zone.id === this.selectedDeliveryZoneId);
    this.deliveryZoneCount.textContent = `${zones.length} / ${MAX_DELIVERY_ZONES}`;
    this.deliveryZoneList.replaceChildren();
    zones.forEach((zone, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'delivery-zone-entry';
      button.classList.toggle('selected', zone.id === this.selectedDeliveryZoneId);
      button.setAttribute('aria-label', `选择投递点 ${index + 1} ${zone.id}`);
      button.setAttribute('aria-current', zone.id === this.selectedDeliveryZoneId ? 'true' : 'false');
      button.title = zone.id;
      const number = document.createElement('span');
      number.textContent = String(index + 1);
      const name = document.createElement('strong');
      name.textContent = index === 0 ? `主点 · ${zone.id}` : zone.id;
      const position = document.createElement('small');
      position.textContent = `X ${formatGeometryNumber(zone.x)} · Z ${formatGeometryNumber(zone.z)}`;
      button.append(number, name, position);
      button.addEventListener('click', () => this.selectDeliveryZone(zone.id), {
        signal: this.listeners.signal,
      });
      this.deliveryZoneList.append(button);
    });
    this.deliveryZoneNote.textContent = this.placingDeliveryZone
      ? '添加模式：点击地图放置新点；再次点击“取消添加”退出。'
      : selectedIndex >= 0
        ? `已选择投递点 ${selectedIndex + 1}；点击空白地图移动它。`
        : '选择一个点，再点击地图移动它。';
    this.deliveryZoneAdd.disabled = zones.length >= MAX_DELIVERY_ZONES;
    this.deliveryZoneAdd.textContent = this.placingDeliveryZone ? '取消添加' : '添加新点';
    this.deliveryZoneAdd.dataset.placing = String(this.placingDeliveryZone);
    this.deliveryZoneDelete.disabled = zones.length <= 1 || selectedIndex < 0;
    this.deliveryZoneUp.disabled = selectedIndex <= 0;
    this.deliveryZoneDown.disabled = selectedIndex < 0 || selectedIndex >= zones.length - 1;
    this.canvas.dataset.deliveryZones = String(zones.length);
    if (this.selectedDeliveryZoneId) {
      this.canvas.dataset.selectedDeliveryZoneId = this.selectedDeliveryZoneId;
    } else {
      delete this.canvas.dataset.selectedDeliveryZoneId;
    }
  }

  private applyTool(point: Vec2, initial: boolean): void {
    switch (this.tool) {
      case 'island-select':
        return;
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
      case 'path':
        this.placePathPoint(point, initial);
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
        return;
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
      (this.map.islandLayout && isIslandProxyLandmark(this.map.islandLayout, landmark.id)) ||
        !landmarkBlocksPoint(landmark, point, radius * 0.2),
    );
    this.map.terrainZones = this.map.terrainZones.filter((zone) =>
      distance(zone, point) > Math.max(radius * 0.45, Math.min(zone.radiusX, zone.radiusZ) * 0.55),
    );
    this.map.paths = this.map.paths.filter((path) =>
      distanceToEditorPath(point, path.points) > Math.max(1.2, radius * 0.58),
    );
    this.lastStamp = { ...point };
  }

  private placePathPoint(point: Vec2, initial: boolean): void {
    if (initial) {
      const id = `path-custom-${Date.now()}-${this.serial}`;
      this.map.paths.push({
        id,
        width: Math.max(3.8, this.brushSize * 1.12),
        points: [{ ...point }],
      });
      this.activePathId = id;
      this.serial += 1;
      this.eraseTrees(point, this.brushSize * 0.72 + 0.8);
      return;
    }
    const path = this.map.paths.find((candidate) => candidate.id === this.activePathId);
    const previous = path?.points[path.points.length - 1];
    if (!path || !previous || distance(previous, point) < 1.45) return;
    const next = this.map.worldStyle.tileShape === 'square'
      ? snapSquareRoadPoint(previous, point)
      : { ...point };
    if (distance(previous, next) < 0.8) return;
    path.points.push(next);
    this.eraseTrees(next, path.width / 2 + 0.75);
  }

  private eraseTrees(point: Vec2, radius: number): void {
    this.map.trees = this.map.trees.filter((tree) => distance(tree, point) > radius);
  }

  private placeLandmark(point: Vec2, kind: LandmarkKind): void {
    if (this.map.landmarks.length >= MAX_MAP_LANDMARKS) return;
    const buildingAsset = this.readBuildingAsset();
    const landmark: OrchardLandmark = {
      id: `landmark-custom-${Date.now()}-${this.serial}`,
      kind,
      ...point,
      ...(kind === 'homestead' ? { asset: buildingAsset } : {}),
      rotationY: 0,
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
      ...deliveryZonesForMap(this.map),
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
      ...deliveryZonesForMap(this.map),
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
    this.selectedIsland = null;
    this.placingIslandObject = null;
    this.selectedDeliveryZoneId = null;
    this.placingDeliveryZone = false;
    this.islandDraggingIndex = null;
    this.islandDragPointerStart = null;
    this.islandDragHistoryPushed = false;
    this.islandDragError = null;
    this.nameInput.value = this.map.name;
    this.syncWorldStyleControls();
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
    }).map((candidate) => {
      candidate.worldStyle = {
        theme: this.readWorldTheme(),
        tileShape: this.readTileShape(),
      };
      assignBuildingsForTheme(candidate, candidate.worldStyle.theme);
      return candidate;
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
      if (context) drawMap(context, candidate, canvas.width, canvas.height, null, 0, false, null);
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
    window.location.href = '/?world=custom';
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
      meta.textContent = `${worldThemeLabel(map.worldStyle.theme)} · ${map.worldStyle.tileShape === 'square' ? '方格' : '六边形'} · ${map.landmarks.length} 地标 · ${treeMixLabel(map)} · ${map.appleSpawns.length} 果实`;
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
    const islandSummary = this.map.islandLayout
      ? ` · 岛屿 v5 · ${this.map.islandLayout.regions.length} 区域`
      : '';
    this.status.dataset.state = validation.valid ? 'valid' : 'invalid';
    this.status.textContent = validation.valid
      ? `可游玩 · ${this.map.worldStyle.tileShape === 'square' ? '方格' : '六边形'}${islandSummary} · ${this.map.landmarks.length} 地标 · ${this.map.trees.length} 木本点缀（${largeTreeCount(this.map)} 大树） · ${this.map.appleSpawns.length} 果实`
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
    this.updateIslandSelectionInfo();
    this.updateDeliveryZonePanel();
    this.preview.setMap(this.map);
    this.preview.setSelection(isPreviewSelection(this.selectedIsland) ? this.selectedIsland : null);
    this.draw();
  }

  private selectView(view: '2d' | '3d'): void {
    const previewVisible = view === '3d';
    this.canvas.hidden = previewVisible;
    this.mapLegend.hidden = previewVisible;
    this.previewHelp.hidden = !previewVisible;
    this.updateIslandSelectionInfo();
    this.updateDeliveryZonePanel();
    this.preview.setVisible(previewVisible);
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-editor-view]')) {
      const active = button.dataset.editorView === view;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (previewVisible) {
      this.preview.setSelection(isPreviewSelection(this.selectedIsland) ? this.selectedIsland : null);
      this.preview.setMap(this.map);
    }
    else this.resizeCanvas();
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
      this.tool === 'island-select'
        ? this.placingIslandObject ? this.brushSize : 0
        : this.tool === 'delivery'
          ? GAME_CONFIG.deliveryRadius
          : this.brushSize,
      true,
      this.selectedIsland,
      this.tool === 'delivery' ? this.selectedDeliveryZoneId : null,
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

  private syncWorldStyleControls(): void {
    this.worldThemeInput.value = this.map.worldStyle.theme;
    this.tileShapeInput.value = this.map.worldStyle.tileShape;
    const firstBuilding = this.map.landmarks.find((landmark) =>
      landmark.kind === 'homestead' && landmark.asset);
    if (firstBuilding?.asset) {
      this.buildingAssetInput.value = firstBuilding.asset;
    }
  }

  private readWorldTheme(): KayKitWorldTheme {
    return KAYKIT_WORLD_THEMES.includes(this.worldThemeInput.value as KayKitWorldTheme)
      ? this.worldThemeInput.value as KayKitWorldTheme
      : 'village';
  }

  private readTileShape(): KayKitTileShape {
    return KAYKIT_TILE_SHAPES.includes(this.tileShapeInput.value as KayKitTileShape)
      ? this.tileShapeInput.value as KayKitTileShape
      : 'square';
  }

  private readBuildingAsset(): KayKitBuildingAsset {
    return KAYKIT_BUILDING_ASSETS.includes(this.buildingAssetInput.value as KayKitBuildingAsset)
      ? this.buildingAssetInput.value as KayKitBuildingAsset
      : 'house';
  }

  private assignThemeBuildings(): void {
    assignBuildingsForTheme(this.map, this.map.worldStyle.theme);
    const firstBuilding = this.map.landmarks.find((landmark) => landmark.kind === 'homestead');
    if (firstBuilding?.asset) this.buildingAssetInput.value = firstBuilding.asset;
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

function assignBuildingsForTheme(map: OrchardMap, theme: KayKitWorldTheme): void {
  const assets: Record<KayKitWorldTheme, readonly KayKitBuildingAsset[]> = {
    village: ['house', 'market', 'farmPlot', 'lumbermill', 'well', 'archeryRange'],
    riverside: ['watermill', 'market', 'mill', 'house', 'well', 'lumbermill'],
    fortified: ['barracks', 'watchtower', 'castle', 'mine', 'house', 'market'],
  };
  let buildingIndex = 0;
  for (const landmark of map.landmarks) {
    if (landmark.kind !== 'homestead') continue;
    const themeAssets = assets[theme];
    landmark.asset = themeAssets[buildingIndex % themeAssets.length];
    landmark.rotationY = 0;
    buildingIndex += 1;
  }
}

function worldThemeLabel(theme: KayKitWorldTheme): string {
  if (theme === 'riverside') return '河畔集市';
  if (theme === 'fortified') return '城堡果园';
  return '林间村落';
}

type IslandGeometryView = {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
  sizeXLabel: string;
  sizeZLabel: string;
  hasSize: boolean;
  semanticKind?: string;
  kindLabel?: string;
  kindOptions?: ReadonlyArray<readonly [string, string]>;
  rotationY?: number;
  editable: boolean;
  note: string;
};

function islandGeometryView(
  layout: OrchardIslandLayout,
  selection: IslandSelection,
): IslandGeometryView | null {
  if (selection.kind === 'outline') {
    const index = outlineNodeIndex(selection);
    const point = index === null ? null : layout.outline[index];
    return point ? {
      x: point.x,
      z: point.z,
      sizeX: 0,
      sizeZ: 0,
      sizeXLabel: '',
      sizeZLabel: '',
      hasSize: false,
      editable: true,
      note: '可直接拖动节点；每次修改都会检查自交、面积、边界和关键内容，并同步沿岸碰撞。',
    } : null;
  }
  if (selection.kind === 'region') {
    const region = layout.regions.find((entry) => entry.id === selection.id);
    return region ? {
      x: region.x,
      z: region.z,
      sizeX: region.radiusX,
      sizeZ: region.radiusZ,
      sizeXLabel: '半径 X',
      sizeZLabel: '半径 Z',
      hasSize: true,
      semanticKind: region.kind,
      kindLabel: '区域类型',
      kindOptions: ISLAND_REGION_KINDS.map((kind) => [kind, islandRegionLabel(kind)] as const),
      rotationY: region.rotationY,
      editable: true,
      note: '区域只控制视觉分区，不生成额外碰撞。',
    } : null;
  }
  if (selection.kind === 'route-block') {
    const block = layout.routeBlocks.find((entry) => entry.id === selection.id);
    return block ? {
      x: block.x,
      z: block.z,
      sizeX: block.radiusX,
      sizeZ: block.radiusZ,
      sizeXLabel: '半宽 X',
      sizeZLabel: '半深 Z',
      hasSize: true,
      semanticKind: block.kind,
      kindLabel: '障碍类型',
      kindOptions: ISLAND_ROUTE_BLOCK_KINDS.map((kind) => [kind, islandRouteBlockLabel(kind)] as const),
      editable: true,
      note: '应用时同步同 ID 的矩形碰撞代理。',
    } : null;
  }
  if (selection.kind === 'water-segment') {
    const segment = layout.waterSegments.find((entry) => entry.id === selection.id);
    return segment ? {
      x: segment.x,
      z: segment.z,
      sizeX: segment.sizeX,
      sizeZ: segment.sizeZ,
      sizeXLabel: '水面长度',
      sizeZLabel: '水面宽度',
      hasSize: true,
      editable: true,
      note: '修改水面会吸附所属桥梁，并重建全部水域碰撞块。',
    } : null;
  }
  if (selection.kind === 'water-block') {
    const block = layout.waterBlocks.find((entry) => entry.id === selection.id);
    return block ? {
      x: block.x,
      z: block.z,
      sizeX: block.radiusX,
      sizeZ: block.radiusZ,
      sizeXLabel: '碰撞半宽',
      sizeZLabel: '碰撞半深',
      hasSize: true,
      editable: false,
      note: '碰撞块由水面与桥梁自动推导，不能直接修改。',
    } : null;
  }
  const bridge = layout.bridges.find((entry) => entry.id === selection.id);
  return bridge ? {
    x: bridge.x,
    z: bridge.z,
    sizeX: bridge.width,
    sizeZ: bridge.depth,
    sizeXLabel: '桥梁宽度',
    sizeZLabel: '桥梁深度',
    hasSize: true,
    editable: true,
    note: 'Z 锁定到所属水面；应用后自动重算两侧碰撞缺口。',
  } : null;
}

function isEditableIslandSelection(
  selection: IslandSelection,
): selection is IslandSelection & { kind: EditableIslandGeometryKind } {
  return selection.kind === 'region' || selection.kind === 'route-block' ||
    selection.kind === 'water-segment' || selection.kind === 'bridge';
}

function isPreviewSelection(selection: IslandSelection | null): selection is MapPreviewSelection {
  return Boolean(selection && isEditableIslandSelection(selection));
}

function applyPreviewIslandMove(
  map: OrchardMap,
  selection: MapPreviewSelection,
  position: Vec2,
): boolean {
  if (!map.islandLayout) return false;
  const geometry = islandGeometryView(map.islandLayout, selection);
  if (!geometry) return false;
  return applyIslandGeometryUpdate(map, selection.kind, selection.id, {
    x: position.x,
    z: position.z,
    sizeX: geometry.sizeX,
    sizeZ: geometry.sizeZ,
    ...(geometry.semanticKind
      ? { semanticKind: geometry.semanticKind as OrchardIslandRegionKind | OrchardIslandRouteBlockKind }
      : {}),
    ...(geometry.rotationY === undefined ? {} : { rotationY: geometry.rotationY }),
  });
}

function outlineNodeId(index: number): string {
  return `island-outline-node-${index}`;
}

function outlineNodeIndex(selection: IslandSelection | null): number | null {
  if (selection?.kind !== 'outline') return null;
  const match = /^island-outline-node-(\d+)$/.exec(selection.id);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function formatGeometryNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function hitTestIslandLayout(layout: OrchardIslandLayout, point: Vec2): IslandSelection | null {
  for (let index = 0; index < layout.outline.length; index += 1) {
    if (distance(point, layout.outline[index]) <= 1.55) {
      return { kind: 'outline', id: outlineNodeId(index) };
    }
  }
  for (const bridge of layout.bridges) {
    if (insideAxisAlignedRectangle(point, bridge, bridge.width / 2, bridge.depth / 2)) {
      return { kind: 'bridge', id: bridge.id };
    }
  }
  for (const block of layout.routeBlocks) {
    if (insideAxisAlignedRectangle(point, block, block.radiusX, block.radiusZ)) {
      return { kind: 'route-block', id: block.id };
    }
  }
  for (const segment of layout.waterSegments) {
    if (insideAxisAlignedRectangle(point, segment, segment.sizeX / 2, segment.sizeZ / 2)) {
      return { kind: 'water-segment', id: segment.id };
    }
  }
  for (const region of layout.regions) {
    const deltaX = point.x - region.x;
    const deltaZ = point.z - region.z;
    const cosine = Math.cos(region.rotationY);
    const sine = Math.sin(region.rotationY);
    const localX = deltaX * cosine + deltaZ * sine;
    const localZ = -deltaX * sine + deltaZ * cosine;
    if ((localX / region.radiusX) ** 2 + (localZ / region.radiusZ) ** 2 <= 1) {
      return { kind: 'region', id: region.id };
    }
  }
  for (let index = 0; index < layout.outline.length; index += 1) {
    const start = layout.outline[index];
    const end = layout.outline[(index + 1) % layout.outline.length];
    if (distanceToEditorSegment(point, start, end) <= 1.35) {
      const closestIndex = distance(point, start) <= distance(point, end)
        ? index
        : (index + 1) % layout.outline.length;
      return { kind: 'outline', id: outlineNodeId(closestIndex) };
    }
  }
  return null;
}

function insideAxisAlignedRectangle(
  point: Vec2,
  center: Vec2,
  radiusX: number,
  radiusZ: number,
): boolean {
  return Math.abs(point.x - center.x) <= radiusX && Math.abs(point.z - center.z) <= radiusZ;
}

function islandSelectionExists(layout: OrchardIslandLayout, selection: IslandSelection): boolean {
  if (selection.kind === 'outline') {
    const index = outlineNodeIndex(selection);
    return index !== null && Boolean(layout.outline[index]);
  }
  if (selection.kind === 'region') return layout.regions.some((entry) => entry.id === selection.id);
  if (selection.kind === 'route-block') {
    return layout.routeBlocks.some((entry) => entry.id === selection.id);
  }
  if (selection.kind === 'water-segment') {
    return layout.waterSegments.some((entry) => entry.id === selection.id);
  }
  if (selection.kind === 'water-block') {
    return layout.waterBlocks.some((entry) => entry.id === selection.id);
  }
  return layout.bridges.some((entry) => entry.id === selection.id);
}

function islandSelectionLabel(layout: OrchardIslandLayout, selection: IslandSelection): string {
  if (selection.kind === 'outline') {
    const index = outlineNodeIndex(selection);
    return index === null
      ? `岛屿轮廓 · ${layout.outline.length} 节点`
      : `海岸节点 ${index + 1}/${layout.outline.length}`;
  }
  if (selection.kind === 'region') {
    const region = layout.regions.find((entry) => entry.id === selection.id);
    return region ? `${islandRegionLabel(region.kind)}区域 · ${region.id}` : selection.id;
  }
  if (selection.kind === 'route-block') {
    const block = layout.routeBlocks.find((entry) => entry.id === selection.id);
    return block ? `${islandRouteBlockLabel(block.kind)}障碍 · ${block.id}` : selection.id;
  }
  if (selection.kind === 'water-segment') return `可见水面 · ${selection.id}`;
  if (selection.kind === 'water-block') return `水域碰撞块 · ${selection.id}`;
  return `桥梁 · ${selection.id}`;
}

function drawMap(
  context: CanvasRenderingContext2D,
  map: OrchardMap,
  width: number,
  height: number,
  pointer: Vec2 | null,
  brushSize: number,
  detailed: boolean,
  selectedIsland: IslandSelection | null,
  selectedDeliveryZoneId: string | null = null,
): void {
  context.clearRect(0, 0, width, height);
  context.fillStyle = worldBorderColor(map.worldStyle.theme);
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

  if (map.islandLayout) {
    drawIslandBase(context, map.islandLayout, transform, toScreen);
    drawIslandRegions(context, map.islandLayout, transform, toScreen, detailed);
  } else {
    context.fillStyle = worldGroundColor(map.worldStyle.theme);
    context.fillRect(
      topLeft.x,
      topLeft.y,
      GAME_CONFIG.arenaHalfWidth * 2 * transform.scale,
      GAME_CONFIG.arenaHalfDepth * 2 * transform.scale,
    );
    if (detailed) drawEditorTileGrid(context, map.worldStyle.tileShape, transform, toScreen);
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

  if (map.islandLayout) {
    drawIslandWater(context, map.islandLayout, transform, toScreen, detailed);
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

  if (map.islandLayout) {
    drawIslandStructures(context, map.islandLayout, transform, toScreen, detailed);
  }

  for (const landmark of map.landmarks) {
    if (map.islandLayout && isIslandProxyLandmark(map.islandLayout, landmark.id)) continue;
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
  for (const [index, zone] of deliveryZonesForMap(map).entries()) {
    const delivery = toScreen(zone);
    const selected = zone.id === selectedDeliveryZoneId;
    context.beginPath();
    context.arc(delivery.x, delivery.y, GAME_CONFIG.deliveryRadius * transform.scale, 0, Math.PI * 2);
    context.fillStyle = 'rgba(241, 202, 92, 0.24)';
    context.fill();
    context.strokeStyle = '#e5b94d';
    context.lineWidth = selected ? 4 : detailed ? 3 : 1.5;
    context.stroke();
    if (selected) {
      context.beginPath();
      context.setLineDash([5, 4]);
      context.arc(
        delivery.x,
        delivery.y,
        (GAME_CONFIG.deliveryRadius + 0.65) * transform.scale,
        0,
        Math.PI * 2,
      );
      context.strokeStyle = '#fff8d2';
      context.lineWidth = 2;
      context.stroke();
      context.setLineDash([]);
    }
    if (detailed && deliveryZonesForMap(map).length > 1) {
      context.fillStyle = '#6b4b16';
      context.font = '700 11px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(index + 1), delivery.x, delivery.y);
    }
  }

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
  if (map.islandLayout && selectedIsland) {
    drawIslandSelection(context, map.islandLayout, selectedIsland, transform, toScreen);
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

function drawIslandBase(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
): void {
  const topLeft = toScreen({ x: -GAME_CONFIG.arenaHalfWidth, z: -GAME_CONFIG.arenaHalfDepth });
  context.fillStyle = '#58b7c8';
  context.fillRect(
    topLeft.x,
    topLeft.y,
    GAME_CONFIG.arenaHalfWidth * 2 * transform.scale,
    GAME_CONFIG.arenaHalfDepth * 2 * transform.scale,
  );
  traceIslandOutline(context, layout, toScreen);
  context.fillStyle = '#78b968';
  context.fill();
  context.strokeStyle = '#e6d395';
  context.lineWidth = 2.5;
  context.stroke();
}

function drawIslandRegions(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
  detailed: boolean,
): void {
  for (const region of layout.regions) {
    const screen = toScreen(region);
    context.beginPath();
    context.ellipse(
      screen.x,
      screen.y,
      region.radiusX * transform.scale,
      region.radiusZ * transform.scale,
      -region.rotationY,
      0,
      Math.PI * 2,
    );
    context.fillStyle = islandRegionColor(region.kind);
    context.globalAlpha = detailed ? 0.2 : 0.14;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = 'rgba(255, 248, 211, 0.68)';
    context.lineWidth = detailed ? 1.5 : 0.8;
    context.stroke();
    if (!detailed) continue;
    context.fillStyle = '#315843';
    context.font = '800 10px "Microsoft YaHei", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(islandRegionLabel(region.kind), screen.x, screen.y);
  }
}

function drawIslandWater(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
  detailed: boolean,
): void {
  for (const segment of layout.waterSegments) {
    const screen = toScreen(segment);
    const width = segment.sizeX * transform.scale;
    const depth = segment.sizeZ * transform.scale;
    context.fillStyle = '#4fa9c0';
    context.fillRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
    context.strokeStyle = '#c8eef0';
    context.lineWidth = detailed ? 2 : 1;
    context.strokeRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
  }
  if (!detailed) return;
  context.save();
  context.setLineDash([5, 4]);
  context.strokeStyle = 'rgba(37, 83, 104, 0.78)';
  context.lineWidth = 1.5;
  for (const block of layout.waterBlocks) {
    const screen = toScreen(block);
    context.strokeRect(
      screen.x - block.radiusX * transform.scale,
      screen.y - block.radiusZ * transform.scale,
      block.radiusX * 2 * transform.scale,
      block.radiusZ * 2 * transform.scale,
    );
  }
  context.restore();
}

function drawIslandStructures(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
  detailed: boolean,
): void {
  for (const block of layout.routeBlocks) {
    const screen = toScreen(block);
    const width = block.radiusX * 2 * transform.scale;
    const depth = block.radiusZ * 2 * transform.scale;
    context.fillStyle = islandRouteBlockColor(block.kind);
    context.fillRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
    context.strokeStyle = '#4d6541';
    context.lineWidth = detailed ? 2 : 1;
    context.strokeRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
  }
  for (const bridge of layout.bridges) {
    const screen = toScreen(bridge);
    const width = bridge.width * transform.scale;
    const depth = bridge.depth * transform.scale;
    context.fillStyle = '#a9764e';
    context.fillRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
    context.strokeStyle = '#68472f';
    context.lineWidth = detailed ? 2 : 1;
    context.strokeRect(screen.x - width / 2, screen.y - depth / 2, width, depth);
    if (!detailed) continue;
    context.strokeStyle = 'rgba(242, 211, 151, 0.78)';
    context.lineWidth = 1;
    for (let index = 1; index < 5; index += 1) {
      const y = screen.y - depth / 2 + depth * index / 5;
      context.beginPath();
      context.moveTo(screen.x - width / 2, y);
      context.lineTo(screen.x + width / 2, y);
      context.stroke();
    }
  }
}

function drawIslandSelection(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  selection: IslandSelection,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
): void {
  context.save();
  context.strokeStyle = '#fff5b8';
  context.lineWidth = 4;
  context.setLineDash([8, 4]);
  if (selection.kind === 'outline') {
    traceIslandOutline(context, layout, toScreen);
    context.stroke();
    context.setLineDash([]);
    const selectedIndex = outlineNodeIndex(selection);
    layout.outline.forEach((point, index) => {
      const screen = toScreen(point);
      context.beginPath();
      context.arc(screen.x, screen.y, index === selectedIndex ? 6 : 3.5, 0, Math.PI * 2);
      context.fillStyle = index === selectedIndex ? '#fff5b8' : '#315843';
      context.fill();
      context.strokeStyle = index === selectedIndex ? '#315843' : '#fff5b8';
      context.lineWidth = index === selectedIndex ? 2.5 : 1.5;
      context.stroke();
    });
    context.restore();
    return;
  }
  if (selection.kind === 'region') {
    const region = layout.regions.find((candidate) => candidate.id === selection.id);
    if (region) {
      const screen = toScreen(region);
      context.beginPath();
      context.ellipse(
        screen.x,
        screen.y,
        region.radiusX * transform.scale,
        region.radiusZ * transform.scale,
        -region.rotationY,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.restore();
    return;
  }
  const rectangle = islandSelectionRectangle(layout, selection);
  if (rectangle) {
    const screen = toScreen(rectangle);
    context.strokeRect(
      screen.x - rectangle.radiusX * transform.scale,
      screen.y - rectangle.radiusZ * transform.scale,
      rectangle.radiusX * 2 * transform.scale,
      rectangle.radiusZ * 2 * transform.scale,
    );
  }
  context.restore();
}

function traceIslandOutline(
  context: CanvasRenderingContext2D,
  layout: OrchardIslandLayout,
  toScreen: (point: Vec2) => { x: number; y: number },
): void {
  context.beginPath();
  layout.outline.forEach((point, index) => {
    const screen = toScreen(point);
    if (index === 0) context.moveTo(screen.x, screen.y);
    else context.lineTo(screen.x, screen.y);
  });
  context.closePath();
}

function islandSelectionRectangle(
  layout: OrchardIslandLayout,
  selection: IslandSelection,
): (Vec2 & { radiusX: number; radiusZ: number }) | null {
  if (selection.kind === 'route-block') {
    return layout.routeBlocks.find((candidate) => candidate.id === selection.id) ?? null;
  }
  if (selection.kind === 'water-block') {
    return layout.waterBlocks.find((candidate) => candidate.id === selection.id) ?? null;
  }
  if (selection.kind === 'water-segment') {
    const segment = layout.waterSegments.find((candidate) => candidate.id === selection.id);
    return segment
      ? { x: segment.x, z: segment.z, radiusX: segment.sizeX / 2, radiusZ: segment.sizeZ / 2 }
      : null;
  }
  if (selection.kind === 'bridge') {
    const bridge = layout.bridges.find((candidate) => candidate.id === selection.id);
    return bridge
      ? { x: bridge.x, z: bridge.z, radiusX: bridge.width / 2, radiusZ: bridge.depth / 2 }
      : null;
  }
  return null;
}

function isIslandProxyLandmark(layout: OrchardIslandLayout, id: string): boolean {
  return id.startsWith('island-boundary-') || id.startsWith('island-coast-edge-') ||
    id === 'island-north-terrace' ||
    layout.routeBlocks.some((block) => block.id === id) ||
    layout.waterBlocks.some((block) => block.id === id);
}

function islandRegionColor(kind: OrchardIslandLayout['regions'][number]['kind']): string {
  if (kind === 'orchard') return '#d7b76d';
  if (kind === 'homestead') return '#e4c98a';
  if (kind === 'plaza') return '#ebd17e';
  if (kind === 'garden') return '#b8d783';
  return '#ead09a';
}

function islandRegionLabel(kind: OrchardIslandLayout['regions'][number]['kind']): string {
  if (kind === 'orchard') return '果园';
  if (kind === 'homestead') return '住宅';
  if (kind === 'plaza') return '广场';
  if (kind === 'garden') return '花园';
  return '海滩';
}

function islandRouteBlockLabel(kind: OrchardIslandRouteBlockKind): string {
  if (kind === 'hedge') return '树篱';
  if (kind === 'hill') return '小山丘';
  if (kind === 'shrine') return '图腾';
  return '树林木堆';
}

function islandObjectKindLabel(kind: IslandObjectKind): string {
  if (kind === 'region') return '视觉区域';
  if (kind === 'route-block') return '矩形障碍';
  if (kind === 'water-segment') return '水面段';
  return '桥梁';
}

function islandPlacementHint(kind: IslandObjectKind): string {
  return kind === 'bridge'
    ? '桥梁放置模式：请点击一段可见水面；再次点击“取消放置”退出。'
    : `${islandObjectKindLabel(kind)}放置模式：点击地图创建；再次点击“取消放置”退出。`;
}

function islandRouteBlockColor(kind: OrchardIslandLayout['routeBlocks'][number]['kind']): string {
  if (kind === 'hedge') return '#6f9d50';
  if (kind === 'hill') return '#8ab662';
  if (kind === 'shrine') return '#d8bd76';
  return '#92694b';
}

function drawEditorTileGrid(
  context: CanvasRenderingContext2D,
  tileShape: KayKitTileShape,
  transform: ViewportTransform,
  toScreen: (point: Vec2) => { x: number; y: number },
): void {
  context.strokeStyle = 'rgba(35, 65, 45, 0.16)';
  context.lineWidth = 1;
  if (tileShape === 'square') {
    const tileSize = 4;
    for (let x = -GAME_CONFIG.arenaHalfWidth; x <= GAME_CONFIG.arenaHalfWidth; x += tileSize) {
      const start = toScreen({ x, z: -GAME_CONFIG.arenaHalfDepth });
      const end = toScreen({ x, z: GAME_CONFIG.arenaHalfDepth });
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    for (let z = -GAME_CONFIG.arenaHalfDepth; z <= GAME_CONFIG.arenaHalfDepth; z += tileSize) {
      const start = toScreen({ x: -GAME_CONFIG.arenaHalfWidth, z });
      const end = toScreen({ x: GAME_CONFIG.arenaHalfWidth, z });
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    return;
  }

  const tileWidth = 4.1;
  const tileDepth = tileWidth * 2 / Math.sqrt(3);
  const rowSpacing = tileDepth * 0.75;
  let row = 0;
  for (let z = -GAME_CONFIG.arenaHalfDepth - tileDepth; z <= GAME_CONFIG.arenaHalfDepth + tileDepth; z += rowSpacing) {
    const offsetX = row % 2 === 0 ? 0 : tileWidth / 2;
    for (let x = -GAME_CONFIG.arenaHalfWidth - tileWidth; x <= GAME_CONFIG.arenaHalfWidth + tileWidth; x += tileWidth) {
      const center = toScreen({ x: x + offsetX, z });
      context.beginPath();
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const angle = -Math.PI / 2 + vertex * Math.PI / 3;
        const pointX = center.x + Math.cos(angle) * tileDepth * 0.5 * transform.scale;
        const pointY = center.y + Math.sin(angle) * tileDepth * 0.5 * transform.scale;
        if (vertex === 0) context.moveTo(pointX, pointY);
        else context.lineTo(pointX, pointY);
      }
      context.closePath();
      context.stroke();
    }
    row += 1;
  }
}

function worldGroundColor(theme: KayKitWorldTheme): string {
  if (theme === 'riverside') return '#78bfa9';
  if (theme === 'fortified') return '#bd8a5d';
  return '#83c49a';
}

function worldBorderColor(theme: KayKitWorldTheme): string {
  if (theme === 'riverside') return '#4f887c';
  if (theme === 'fortified') return '#806344';
  return '#597e5c';
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
    context.fillStyle = '#2f2a20';
    context.font = `800 ${Math.max(9, Math.min(13, scale * 0.82))}px "Microsoft YaHei", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(BUILDING_LABELS[landmark.asset ?? 'house'], 0, depth * 0.33);
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

function nearestDeliveryZoneAt(
  zones: readonly OrchardDeliveryZone[],
  point: Vec2,
): OrchardDeliveryZone | null {
  return zones
    .map((zone) => ({ zone, distance: distance(zone, point) }))
    .filter((candidate) => candidate.distance <= GAME_CONFIG.deliveryRadius)
    .sort((first, second) => first.distance - second.distance ||
      first.zone.id.localeCompare(second.zone.id))[0]?.zone ?? null;
}

function snapSquareRoadPoint(previous: Vec2, point: Vec2): Vec2 {
  const deltaX = point.x - previous.x;
  const deltaZ = point.z - previous.z;
  return Math.abs(deltaX) >= Math.abs(deltaZ)
    ? { x: point.x, z: previous.z }
    : { x: previous.x, z: point.z };
}

function distanceToEditorPath(point: Vec2, points: readonly Vec2[]): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  if (points.length === 1) return distance(point, points[0]);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    minimum = Math.min(minimum, distanceToEditorSegment(point, points[index - 1], points[index]));
  }
  return minimum;
}

function distanceToEditorSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const lengthSquared = deltaX * deltaX + deltaZ * deltaZ;
  if (lengthSquared <= 0.000001) return distance(point, start);
  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.z - start.z) * deltaZ) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + deltaX * projection),
    point.z - (start.z + deltaZ * projection),
  );
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'orchard-map';
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
