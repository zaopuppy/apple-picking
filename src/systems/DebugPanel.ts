import GUI from 'lil-gui';

export type DebugTuning = {
  portraitCameraAngle: number;
  landscapeCameraAngle: number;
  cameraZoom: number;
  hemisphereIntensity: number;
  sunIntensity: number;
  reducedMotion: boolean;
};

type DebugPanelCallbacks = {
  cameraChanged(): void;
  lightingChanged(): void;
  motionChanged(): void;
  reset(): void;
};

export class DebugPanel {
  private readonly gui = new GUI({ title: '开发调试 · DEV', width: 280 });

  constructor(tuning: DebugTuning, callbacks: DebugPanelCallbacks) {
    this.gui.domElement.dataset.testid = 'debug-panel';

    const camera = this.gui.addFolder('镜头');
    camera.add(tuning, 'portraitCameraAngle', 25, 50, 1)
      .name('竖屏倾角（度）')
      .onChange(callbacks.cameraChanged);
    camera.add(tuning, 'landscapeCameraAngle', 25, 50, 1)
      .name('横屏倾角（度）')
      .onChange(callbacks.cameraChanged);
    camera.add(tuning, 'cameraZoom', 0.8, 1.25, 0.01)
      .name('画面缩放')
      .onChange(callbacks.cameraChanged);

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

    this.gui.add({ reset: callbacks.reset }, 'reset').name('恢复推荐值');
  }

  setHidden(hidden: boolean): void {
    this.gui.show(!hidden);
  }

  refresh(): void {
    for (const controller of this.gui.controllersRecursive()) controller.updateDisplay();
  }

  dispose(): void {
    this.gui.destroy();
  }
}
