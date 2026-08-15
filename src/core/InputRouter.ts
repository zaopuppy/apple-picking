import type { ActorCommand, GameCommands } from '../game/types';

const GAME_KEYS = new Set([
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyE',
  'KeyF',
  'KeyI',
  'KeyJ',
  'KeyK',
  'KeyL',
  'Semicolon',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ControlRight',
  'ShiftRight',
  'KeyR',
]);

export class InputRouter {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    if (!this.held.has(event.code) && !event.repeat) {
      this.pressed.add(event.code);
    }
    this.held.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    this.held.delete(event.code);
  };

  private readonly clear = (): void => {
    this.held.clear();
    this.pressed.clear();
  };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    window.addEventListener('blur', this.clear);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  consumeCommands(): GameCommands {
    const commands: GameCommands = {
      guard1: this.readActor(['KeyS', 'KeyF', 'KeyE', 'KeyD'], 'KeyA'),
      guard2: this.readActor(['KeyJ', 'KeyL', 'KeyI', 'KeyK'], 'Semicolon'),
      kid: this.readActor(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], 'ControlRight', 'ShiftRight'),
      restartPressed: this.pressed.has('KeyR'),
    };
    this.pressed.clear();
    return commands;
  }

  readHeldCommands(): GameCommands {
    return {
      guard1: this.readActor(['KeyS', 'KeyF', 'KeyE', 'KeyD'], ''),
      guard2: this.readActor(['KeyJ', 'KeyL', 'KeyI', 'KeyK'], ''),
      kid: this.readActor(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], ''),
      restartPressed: false,
    };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.clear();
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) this.clear();
  };

  private readActor(
    [left, right, up, down]: [string, string, string, string],
    action: string,
    drop = '',
  ): ActorCommand {
    let moveX = Number(this.held.has(right)) - Number(this.held.has(left));
    let moveZ = Number(this.held.has(down)) - Number(this.held.has(up));
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) {
      moveX /= length;
      moveZ /= length;
    }
    return {
      moveX,
      moveZ,
      actionPressed: action.length > 0 && this.pressed.has(action),
      dropPressed: drop.length > 0 && this.pressed.has(drop),
    };
  }
}
