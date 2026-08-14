import { GAME_CONFIG, TICKS_PER_SECOND } from '../game/config';
import type { GameEvent, GameSnapshot, GuardSnapshot } from '../game/types';

export class Hud {
  private readonly deliveredValue = this.getElement('#delivered-value');
  private readonly deliveredTotal = this.getElement('#delivered-total');
  private readonly deliveredFill = this.getElement('#delivered-fill');
  private readonly catchesValue = this.getElement('#catches-value');
  private readonly catchesTotal = this.getElement('#catches-total');
  private readonly catchesFill = this.getElement('#catches-fill');
  private readonly carriedValue = this.getElement('#carried-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly fpsValue = this.getElement('#fps-value');
  private readonly matchMessage = this.getElement('#match-message');
  private readonly statusLine = this.getElement('#status-line');
  private readonly guard1State = this.getElement('#guard1-state');
  private readonly guard2State = this.getElement('#guard2-state');
  private readonly kidState = this.getElement('#kid-state');
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
    const minutes = Math.floor(snapshot.elapsedSeconds / 60).toString().padStart(2, '0');
    const seconds = Math.floor(snapshot.elapsedSeconds % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;
    this.fpsValue.textContent = fps > 0 ? String(fps) : '--';
    this.guard1State.textContent = this.guardLabel(snapshot.guards[0]);
    this.guard2State.textContent = this.guardLabel(snapshot.guards[1]);
    this.kidState.textContent = this.kidLabel(snapshot);

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

  announce(event: GameEvent): void {
    const message = this.eventMessage(event);
    if (!message) return;
    this.statusLine.textContent = message;
    this.statusLine.animate(
      [
        { transform: 'translate(-50%, 4px)', opacity: 0.35 },
        { transform: 'translate(-50%, 0)', opacity: 1 },
      ],
      { duration: 180, easing: 'ease-out' },
    );
  }

  private guardLabel(guard: GuardSnapshot): string {
    if (guard.state === 'Stunned') return `撞晕 ${this.seconds(guard.stateTicks)}s`;
    if (guard.state === 'Recover') return `起身 ${this.seconds(guard.stateTicks)}s`;
    if (guard.state === 'Pounce') return '飞扑中';
    if (guard.cooldownTicks > 0) return `冷却 ${this.seconds(guard.cooldownTicks)}s`;
    return '飞扑就绪';
  }

  private kidLabel(snapshot: GameSnapshot): string {
    if (snapshot.kid.state === 'Picking') {
      return `拾取 ${Math.round(snapshot.kid.pickingProgress * 100)}%`;
    }
    if (snapshot.kid.state === 'Invincible') {
      return `脱身 ${this.seconds(snapshot.kid.stateTicks)}s`;
    }
    return snapshot.kid.carriedAppleIds.length > 0 ? '携果逃跑' : '寻找苹果';
  }

  private eventMessage(event: GameEvent): string | null {
    switch (event.type) {
      case 'match-started': return '开抓！';
      case 'restarted': return '重新开局';
      case 'pounce': return `${event.guardId === 'guard1' ? '蓝' : '绿'}守卫飞扑！`;
      case 'guards-stunned': return '砰！两个守卫撞晕了';
      case 'pick-started': return 'kid 正在捡苹果——快抓！';
      case 'pick-cancelled': return '拾取被打断';
      case 'picked': return '拿到一个苹果';
      case 'dropped': return event.reason === 'manual' ? '扔掉一个，跑快点！' : null;
      case 'captured': return `抓到！${event.catches}/${GAME_CONFIG.catchTarget}`;
      case 'delivered': return `送达 ${event.count} 个，累计 ${event.total}`;
      case 'match-ended': return event.winner === 'kid' ? 'kid 全部送达！' : '守卫完成三次抓捕！';
    }
  }

  private seconds(ticks: number): string {
    return (ticks / TICKS_PER_SECOND).toFixed(1);
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}
