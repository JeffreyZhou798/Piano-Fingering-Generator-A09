// Q-Learning求解器 - 翻译自 src/q_learning.jl
import { Note, Hand, Finger, Fingering, FingeringState, Part, QLearningSolverConfig } from './types';
import { rewardFunction, actionSpace } from './mdp';

/**
 * Q-Learning求解器
 */
export class QLearningSolver {
  private nEpisodes: number;
  private maxEpisodeLength: number;
  private learningRate: number;
  private explorationRate: number;
  private qTable: Map<string, number>;

  constructor(config: QLearningSolverConfig) {
    this.nEpisodes = config.nEpisodes;
    this.maxEpisodeLength = config.maxEpisodeLength;
    this.learningRate = config.learningRate;
    this.explorationRate = config.explorationRate;
    this.qTable = new Map();
  }

  /**
   * 求解MDP问题
   */
  solve(
    hand: Hand,
    allNotes: Note[][],
    part: Part,
    onProgress?: (episode: number, totalEpisodes: number) => void
  ): Fingering[] {
    // 初始化Q表
    this.qTable.clear();

    let oldAvg = 0;

    // Episode循环
    for (let episode = 1; episode <= this.nEpisodes; episode++) {
      // 初始状态
      let state: FingeringState = {
        index: 0,
        fingering: [],
        nextNotes: allNotes[0],
        part
      };

      let step = 0;

      // Step循环
      while (state.index < allNotes.length && step < this.maxEpisodeLength) {
        // 获取可用动作
        const actions = actionSpace(hand, state, allNotes);
        if (actions.length === 0) break;

        // 选择动作（ε-greedy策略）
        const action = this.selectAction(hand, state, actions);

        // 执行动作，获取奖励
        const reward = rewardFunction(hand, state, action);

        // 下一个状态
        const nextState: FingeringState = {
          index: state.index + 1,
          fingering: action,
          nextNotes: state.index + 1 < allNotes.length ? allNotes[state.index + 1] : [],
          part
        };

        // 更新Q值
        this.updateQValue(hand, state, action, reward, nextState, allNotes);

        // 转移到下一个状态
        state = nextState;
        step++;
      }

      // 定期评估
      if (episode % 10 === 0) {
        const newAvg = this.evaluate(hand, allNotes, part, 20);
        
        if (onProgress) {
          onProgress(episode, this.nEpisodes);
        }

        // 收敛检查
        if (Math.round(oldAvg * 10) === Math.round(newAvg * 10)) {
          console.log(`Converged at episode ${episode}`);
          break;
        }
        oldAvg = newAvg;
      }
    }

    // 返回最优策略
    return this.extractPolicy(hand, allNotes, part);
  }

  /**
   * 选择动作（ε-greedy策略）
   */
  private selectAction(
    hand: Hand,
    state: FingeringState,
    actions: Fingering[]
  ): Fingering {
    // ε-greedy探索
    if (Math.random() < this.explorationRate) {
      // 随机选择
      return actions[Math.floor(Math.random() * actions.length)];
    } else {
      // 选择Q值最大的动作
      let bestAction = actions[0];
      let bestValue = this.getQValue(state, bestAction);

      for (const action of actions) {
        const value = this.getQValue(state, action);
        if (value > bestValue) {
          bestValue = value;
          bestAction = action;
        }
      }

      return bestAction;
    }
  }

  /**
   * 更新Q值
   */
  private updateQValue(
    hand: Hand,
    state: FingeringState,
    action: Fingering,
    reward: number,
    nextState: FingeringState,
    allNotes: Note[][]
  ): void {
    const currentQ = this.getQValue(state, action);

    // 计算下一个状态的最大Q值
    let maxNextQ = 0;
    if (nextState.index < allNotes.length) {
      const nextActions = actionSpace(hand, nextState, allNotes);
      if (nextActions.length > 0) {
        maxNextQ = Math.max(...nextActions.map(a => this.getQValue(nextState, a)));
      }
    }

    // Q-Learning更新公式
    const newQ = currentQ + this.learningRate * (reward + 0.99 * maxNextQ - currentQ);

    this.setQValue(state, action, newQ);
  }

  /**
   * 获取Q值
   */
  private getQValue(state: FingeringState, action: Fingering): number {
    const key = this.stateActionKey(state, action);
    return this.qTable.get(key) || 0;
  }

  /**
   * 设置Q值
   */
  private setQValue(state: FingeringState, action: Fingering, value: number): void {
    const key = this.stateActionKey(state, action);
    this.qTable.set(key, value);
  }

  /**
   * 生成状态-动作键
   */
  private stateActionKey(state: FingeringState, action: Fingering): string {
    const stateStr = `${state.index}_${this.fingeringToString(state.fingering)}`;
    const actionStr = this.fingeringToString(action);
    return `${stateStr}|${actionStr}`;
  }

  /**
   * 指法转字符串
   */
  private fingeringToString(fingering: Fingering): string {
    return fingering.map(entry => `${entry.pitch}:${entry.finger}`).join(',');
  }

  /**
   * 评估策略
   */
  private evaluate(hand: Hand, allNotes: Note[][], part: Part, nTrajectories: number): number {
    let totalReward = 0;

    for (let i = 0; i < nTrajectories; i++) {
      let state: FingeringState = {
        index: 0,
        fingering: [],
        nextNotes: allNotes[0],
        part
      };

      let trajectoryReward = 0;

      while (state.index < allNotes.length) {
        const actions = actionSpace(hand, state, allNotes);
        if (actions.length === 0) break;

        // 选择最优动作（不探索）
        let bestAction = actions[0];
        let bestValue = this.getQValue(state, bestAction);

        for (const action of actions) {
          const value = this.getQValue(state, action);
          if (value > bestValue) {
            bestValue = value;
            bestAction = action;
          }
        }

        const reward = rewardFunction(hand, state, bestAction);
        trajectoryReward += reward;

        state = {
          index: state.index + 1,
          fingering: bestAction,
          nextNotes: state.index + 1 < allNotes.length ? allNotes[state.index + 1] : [],
          part
        };
      }

      totalReward += trajectoryReward;
    }

    return totalReward / nTrajectories;
  }

  /**
   * 提取最优策略
   */
  private extractPolicy(hand: Hand, allNotes: Note[][], part: Part): Fingering[] {
    const policy: Fingering[] = [];

    let state: FingeringState = {
      index: 0,
      fingering: [],
      nextNotes: allNotes[0],
      part
    };

    while (state.index < allNotes.length) {
      const actions = actionSpace(hand, state, allNotes);
      
      let bestAction: Fingering;
      
      if (actions.length === 0) {
        // 如果没有可用动作，使用默认指法（这种情况现在应该很少见）
        const notes = allNotes[state.index];
        bestAction = notes.map((note, i) => ({
          pitch: note.pitch,
          finger: Math.min(i + 1, 5) as Finger
        }));
      } else {
        // 选择Q值最大的动作
        bestAction = actions[0];
        let bestValue = this.getQValue(state, bestAction);

        for (const action of actions) {
          const value = this.getQValue(state, action);
          if (value > bestValue) {
            bestValue = value;
            bestAction = action;
          }
        }
      }

      policy.push(bestAction);

      state = {
        index: state.index + 1,
        fingering: bestAction,
        nextNotes: state.index + 1 < allNotes.length ? allNotes[state.index + 1] : [],
        part
      };
    }

    return policy;
  }
}
