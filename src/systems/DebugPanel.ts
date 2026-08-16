import GUI, { type Controller } from 'lil-gui';
import type { MovementTuning } from '../game/config';

export type DebugTuning = MovementTuning & {
  landscapeCameraAngle: number;
  cameraZoom: number;
  cameraPositionX: number;
  cameraPositionY: number;
  cameraPositionZ: number;
  cameraTargetX: number;
  cameraTargetY: number;
  cameraTargetZ: number;
  hemisphereIntensity: number;
  sunIntensity: number;
  reducedMotion: boolean;
};

type DebugPanelCallbacks = {
  cameraPointerModeChanged(enabled: boolean): void;
  cameraAngleChanged(): void;
  cameraChanged(): void;
  movementChanged(): void;
  lightingChanged(): void;
  motionChanged(): void;
  reset(): void;
};

export class DebugPanel {
  private readonly gui = new GUI({ title: '开发调试 · DEV', width: 280 });
  private readonly cameraFolder: GUI;
  private readonly cameraPositionFolder: GUI;
  private readonly cameraTargetFolder: GUI;
  private readonly auxiliaryFolders: GUI[];
  private readonly cameraValueControllers: Controller[];
  private readonly cameraModeController: Controller;
  private readonly cameraHintController: Controller;
  private readonly resetController: Controller;
  private cameraPointerMode = false;

  constructor(tuning: DebugTuning, callbacks: DebugPanelCallbacks) {
    this.gui.domElement.dataset.testid = 'debug-panel';
    this.gui.domElement.dataset.cameraControl = 'manual';

    this.cameraFolder = this.gui.addFolder('镜头');
    this.cameraModeController = this.cameraFolder.add({
      toggle: () => callbacks.cameraPointerModeChanged(!this.cameraPointerMode),
    }, 'toggle').name('进入鼠标调镜头');
    this.cameraHintController = this.cameraFolder.add({
      gesture: '滚轮缩放 · 左键旋转 · 右键移动',
    }, 'gesture').name('鼠标操作').disable().hide();

    const landscapeAngle = this.cameraFolder.add(tuning, 'landscapeCameraAngle', 15, 82, 1)
      .name('横屏倾角（度）')
      .onChange(callbacks.cameraAngleChanged);
    const cameraZoom = this.cameraFolder.add(tuning, 'cameraZoom', 0.55, 1.8, 0.01)
      .name('画面缩放')
      .onChange(callbacks.cameraChanged);
    this.cameraPositionFolder = this.cameraFolder.addFolder('横屏位置');
    const cameraPositionX = this.cameraPositionFolder.add(tuning, 'cameraPositionX', -240, 240, 0.25)
      .name('位置 X')
      .onChange(callbacks.cameraChanged);
    const cameraPositionY = this.cameraPositionFolder.add(tuning, 'cameraPositionY', -80, 280, 0.25)
      .name('位置 Y')
      .onChange(callbacks.cameraChanged);
    const cameraPositionZ = this.cameraPositionFolder.add(tuning, 'cameraPositionZ', -240, 240, 0.25)
      .name('位置 Z')
      .onChange(callbacks.cameraChanged);
    this.cameraPositionFolder.close();
    this.cameraTargetFolder = this.cameraFolder.addFolder('朝向目标');
    const cameraTargetX = this.cameraTargetFolder.add(tuning, 'cameraTargetX', -120, 120, 0.25)
      .name('目标 X')
      .onChange(callbacks.cameraChanged);
    const cameraTargetY = this.cameraTargetFolder.add(tuning, 'cameraTargetY', -80, 120, 0.25)
      .name('目标 Y')
      .onChange(callbacks.cameraChanged);
    const cameraTargetZ = this.cameraTargetFolder.add(tuning, 'cameraTargetZ', -120, 120, 0.25)
      .name('目标 Z')
      .onChange(callbacks.cameraChanged);
    this.cameraTargetFolder.close();
    this.cameraValueControllers = [
      landscapeAngle,
      cameraZoom,
      cameraPositionX,
      cameraPositionY,
      cameraPositionZ,
      cameraTargetX,
      cameraTargetY,
      cameraTargetZ,
    ];

    const movement = this.gui.addFolder('移动速度');
    movement.add(tuning, 'baseSpeed', 5, 20, 0.1)
      .name('基准速度')
      .onChange(callbacks.movementChanged);
    movement.add(tuning, 'guardSpeedMultiplier', 0.5, 2, 0.05)
      .name('Guard 速度系数')
      .onChange(callbacks.movementChanged);
    movement.add(tuning, 'kidSpeedMultiplier', 0.5, 2, 0.05)
      .name('Kid 速度系数')
      .onChange(callbacks.movementChanged);

    const lighting = this.gui.addFolder('光照');
    lighting.add(tuning, 'hemisphereIntensity', 0.5, 4, 0.05)
      .name('环境光')
      .onChange(callbacks.lightingChanged);
    lighting.add(tuning, 'sunIntensity', 0.5, 5, 0.05)
      .name('主光')
      .onChange(callbacks.lightingChanged);

    const presentation = this.gui.addFolder('表现');
    presentation.add(tuning, 'reducedMotion')
      .name('减少动态效果')
      .onChange(callbacks.motionChanged);

    this.auxiliaryFolders = [movement, lighting, presentation];
    this.resetController = this.gui.add({ reset: callbacks.reset }, 'reset').name('恢复推荐值');
  }

  setHidden(hidden: boolean): void {
    this.gui.show(!hidden);
  }

  refresh(): void {
    for (const controller of this.gui.controllersRecursive()) controller.updateDisplay();
  }

  refreshCamera(): void {
    for (const controller of this.cameraValueControllers) controller.updateDisplay();
  }

  setCameraPointerMode(enabled: boolean): void {
    this.cameraPointerMode = enabled;
    this.gui.domElement.dataset.cameraControl = enabled ? 'mouse' : 'manual';
    this.gui.title(enabled ? '镜头调试 · 鼠标控制' : '开发调试 · DEV');
    this.cameraModeController.name(enabled ? '退出鼠标调镜头' : '进入鼠标调镜头');
    this.cameraHintController.show(enabled);
    for (const controller of this.cameraValueControllers) controller.disable(enabled);
    for (const folder of this.auxiliaryFolders) folder.show(!enabled);
    this.resetController.show(!enabled);
    this.cameraFolder.open();
    if (enabled) {
      this.cameraPositionFolder.open();
      this.cameraTargetFolder.open();
    } else {
      this.cameraPositionFolder.close();
      this.cameraTargetFolder.close();
    }
    this.refreshCamera();
  }

  dispose(): void {
    this.gui.destroy();
  }
}
