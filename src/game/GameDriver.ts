import { GameSimulation } from './GameSimulation';
import type { MovementTuning } from './config';
import {
  commandsWithoutEdges,
  type GameCommands,
  type GameSnapshot,
  type SimulationStep,
} from './types';

export type GameDriverMode = 'local' | 'online';

export interface GameDriver {
  readonly mode: GameDriverMode;
  tick(commands: GameCommands): readonly SimulationStep[];
  getSnapshot(): GameSnapshot;
  getMovementTuning(): Readonly<MovementTuning>;
  setMovementTuning(tuning: MovementTuning): void;
  seed(value: number): void;
  loadScenario(name: string): void;
  stepForTest(commands: GameCommands, ticks: number): readonly SimulationStep[];
  dispose(): void;
}

export class LocalGameDriver implements GameDriver {
  readonly mode = 'local' as const;

  constructor(private readonly simulation: GameSimulation) {}

  tick(commands: GameCommands): readonly SimulationStep[] {
    return [this.simulation.step(commands)];
  }

  getSnapshot(): GameSnapshot {
    return this.simulation.getSnapshot();
  }

  getMovementTuning(): Readonly<MovementTuning> {
    return this.simulation.getMovementTuning();
  }

  setMovementTuning(tuning: MovementTuning): void {
    this.simulation.setMovementTuning(tuning);
  }

  seed(value: number): void {
    this.simulation.seed(value);
  }

  loadScenario(name: string): void {
    this.simulation.loadScenario(name);
  }

  stepForTest(commands: GameCommands, ticks: number): readonly SimulationStep[] {
    const steps: SimulationStep[] = [];
    let currentCommands = commands;
    for (let index = 0; index < Math.max(1, ticks); index += 1) {
      steps.push(this.simulation.step(currentCommands));
      currentCommands = commandsWithoutEdges(currentCommands);
    }
    return steps;
  }

  dispose(): void {}
}
