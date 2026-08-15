import { GAME_CONFIG, TICKS_PER_SECOND } from '../game/config';
import type { GameSnapshot } from '../game/types';

export class Hud {
  private readonly deliveredValue = this.getElement('#delivered-value');
  private readonly deliveredTotal = this.getElement('#delivered-total');
  private readonly deliveredFill = this.getElement('#delivered-fill');
  private readonly catchesValue = this.getElement('#catches-value');
  private readonly catchesTotal = this.getElement('#catches-total');
  private readonly catchesFill = this.getElement('#catches-fill');
  private readonly carriedValue = this.getElement('#carried-value');
  private readonly carriedTotal = this.getElement('#carried-total');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly fpsValue = this.getElement('#fps-value');
  private readonly matchMessage = this.getElement('#match-message');
  private readonly resultOverlay = this.getElement('#result-overlay');
  private readonly resultTitle = this.getElement('#result-title');

  update(snapshot: GameSnapshot, fps: number): void {
    this.deliveredValue.textContent = String(snapshot.delivered);
    this.deliveredTotal.textContent = String(snapshot.totalApples);
    this.deliveredFill.style.width = `${snapshot.delivered / snapshot.totalApples * 100}%`;
    this.catchesValue.textContent = String(snapshot.catches);
    this.catchesTotal.textContent = String(GAME_CONFIG.catchTarget);
    this.catchesFill.style.width = `${snapshot.catches / GAME_CONFIG.catchTarget * 100}%`;
    this.carriedValue.textContent = String(snapshot.kid.carriedAppleIds.length);
    this.carriedTotal.textContent = String(GAME_CONFIG.maxCarriedApples);
    const minutes = Math.floor(snapshot.elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(snapshot.elapsedSeconds % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.fpsValue.textContent = String(Math.round(fps));

    if (snapshot.matchState === 'Countdown') {
      this.matchMessage.textContent = String(Math.max(1, Math.ceil(snapshot.countdownTicks / TICKS_PER_SECOND)));
      this.matchMessage.classList.add('visible');
      this.resultOverlay.classList.remove('visible');
    } else if (snapshot.matchState === 'Playing') {
      this.matchMessage.classList.remove('visible');
      this.resultOverlay.classList.remove('visible');
    } else {
      this.matchMessage.classList.remove('visible');
      this.resultTitle.textContent = snapshot.matchState === 'KidWin' ? '偷果成功！' : '守卫抓住了小偷！';
      this.resultOverlay.classList.add('visible');
    }
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
