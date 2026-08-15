// Dyna-Q求解器 - 数据+规则混合模式（唯一模式）
// 神经先验通过热启动、软剪枝、混合奖励深度注入决策回路，数据项与规则项永远同时在场
import { Note, Hand, Finger, Fingering, FingeringState, Part, DynaQConfig, ModelEntry } from './types';
import { rewardFunction, actionSpace } from './mdp';
import { GroupPriors, hybridReward, hotStartQ, nnArgmaxAction, TAU } from './fusion';

/**
 * Dyna-Q求解器
 * 核心算法：Q-Learning + 模型学习
 * 
 * Dyna-Q = 真实交互 + 模拟学习
 * 每次真实交互后，从模型中随机采样进行多次模拟学习
 */
export class DynaQSolver {
  private nEpisodes: number;
  private maxEpisodeLength: number;
  private learningRate: number;
  private explorationRate: number;
  private planningSteps: number;
  private theta: number; // 优先级阈值
  private randomSeed: number;
  private qTable: Map<string, number>;
  private model: Map<string, ModelEntry>;
  private predict: Map<string, Set<string>>; // 前驱状态字典: state -> Set of (s,a) keys that lead to it
  private priorityQueue: Array<{key: string, priority: number}>; // 优先级队列
  private initialStates: Set<string>; // 初始状态集合
  private rng: () => number;
  private priors?: GroupPriors[]; // 神经先验 P_base（数据+规则模式必需）
  private currentHand: Hand = Hand.RightHand;

  constructor(config: DynaQConfig) {
    this.nEpisodes = config.nEpisodes;
    this.maxEpisodeLength = config.maxEpisodeLength;
    this.learningRate = config.learningRate;
    this.explorationRate = config.explorationRate;
    this.planningSteps = config.planningSteps;
    this.theta = 3.0; // 默认阈值
    this.randomSeed = config.randomSeed;
    this.priors = config.priors;
    this.qTable = new Map();
    this.model = new Map();
    this.predict = new Map(); // 前驱状态追踪
    this.priorityQueue = []; // 优先级队列
    this.initialStates = new Set(); // 初始状态集合

    // 使用种子初始化随机数生成器
    this.rng = this.seededRandom(this.randomSeed);
  }

  /**
   * 种子随机数生成器
   */
  private seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
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
    // 初始化Q表、模型和优先级队列
    this.qTable.clear();
    this.model.clear();
    this.predict.clear();
    this.priorityQueue = [];
    this.initialStates.clear();
    this.currentHand = hand;

    let oldAvg = 0;

    // Episode循环（热启动后收敛大幅加快，每100轮评估一次）
    for (let episode = 1; episode <= this.nEpisodes; episode++) {
      this.runEpisode(hand, allNotes, part);

      // 定期评估
      if (episode % 100 === 0) {
        const nEvalTraj = Math.min(20, allNotes.length);
        const newAvg = this.evaluate(hand, allNotes, part, nEvalTraj);
        
        if (onProgress) {
          onProgress(episode, this.nEpisodes);
        }

        console.log(`On Iteration ${episode}, Returns: ${newAvg}`);

        // 收敛检查（精度到0.1，与原Julia实现一致）
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
   * 运行一个Episode（完整实现优先级回放）
   */
  private runEpisode(hand: Hand, allNotes: Note[][], part: Part): void {
    // 初始状态
    let state: FingeringState = {
      index: 0,
      fingering: [],
      nextNotes: allNotes[0],
      part
    };

    // 记录初始状态
    const initialStateKey = this.stateKey(state);
    if (!this.initialStates.has(initialStateKey)) {
      this.initialStates.add(initialStateKey);
    }

    let step = 0;

    // Step循环
    while (state.index < allNotes.length && step < this.maxEpisodeLength) {
      // 获取可用动作（软剪枝：数据高概率 ∩ 物理可达）
      const actions = actionSpace(hand, state, allNotes, this.priors);
      if (actions.length === 0) break;

      // 1. 选择动作（ε-greedy策略）
      const action = this.selectAction(hand, state, actions);

      // 2. 执行动作，获取混合奖励（数据项 + 规则项同时在场）
      const reward = hybridReward(hand, state, action, this.priors?.[state.index]);

      // 3. 下一个状态
      const nextState: FingeringState = {
        index: state.index + 1,
        fingering: action,
        nextNotes: state.index + 1 < allNotes.length ? allNotes[state.index + 1] : [],
        part
      };

      // 4. 更新predict字典（记录前驱状态）
      const nextStateKey = this.stateKey(nextState);
      const stateActionKey = this.stateActionKey(state, action);
      
      if (!this.predict.has(nextStateKey)) {
        this.predict.set(nextStateKey, new Set());
      }
      this.predict.get(nextStateKey)!.add(stateActionKey);

      // 5. 记录到模型
      this.model.set(stateActionKey, {
        nextState: nextState,
        reward: reward
      });

      // 6. 计算所有可用动作的Q值
      const nextActions = actionSpace(hand, nextState, allNotes, this.priors);
      const actionValues = nextActions.map(a => this.getQValue(nextState, a));
      const maxSpPrediction = actionValues.length > 0 ? Math.max(...actionValues) : 0;

      // 7. 获取当前Q值
      const currentSPrediction = this.getQValue(state, action);

      // 8. 计算TD误差
      const tdError = reward + 0.99 * maxSpPrediction - currentSPrediction;

      // 9. 计算优先级
      const prioritize = Math.abs(tdError);

      // 10. 加入优先级队列（与原Julia实现一致，不检查theta阈值）
      this.enqueue(stateActionKey, prioritize);

      // 11. 优先级回放（Dyna-Q核心）
      while (this.priorityQueue.length > 0) {
        // 取出优先级最高的状态-动作对
        const {key: tempSAKey, priority: tempPriority} = this.dequeue()!;
        
        // 获取模型中的经验
        const modelEntry = this.model.get(tempSAKey);
        if (!modelEntry) continue;

        const {state: tempS, action: tempA} = this.parseStateActionKey(tempSAKey);
        const {nextState: tempSp, reward: tempR} = modelEntry;

        // 计算tempSp的最大Q值
        const tempNextActions = actionSpace(hand, tempSp, allNotes, this.priors);
        const tempActionValues = tempNextActions.map(a => this.getQValue(tempSp, a));
        const tempMaxSpPrediction = tempActionValues.length > 0 ? Math.max(...tempActionValues) : 0;

        // 更新Q值
        const oldQ = this.getQValue(tempS, tempA);
        const newQ = oldQ + this.learningRate * (tempR + 0.99 * tempMaxSpPrediction - oldQ);
        this.setQValue(tempS, tempA, newQ);

        // 如果tempS不是初始状态，更新其前驱状态的优先级
        const tempSKey = this.stateKey(tempS);
        if (!this.initialStates.has(tempSKey)) {
          const predecessors = this.predict.get(tempSKey);
          if (predecessors) {
            for (const preSAKey of predecessors) {
              const preModelEntry = this.model.get(preSAKey);
              if (!preModelEntry) continue;

              const {action: preA} = this.parseStateActionKey(preSAKey);
              const {reward: preR} = preModelEntry;

              // 计算tempS的最大Q值
              const tempSActions = actionSpace(hand, tempS, allNotes, this.priors);
              const tempSActionValues = tempSActions.map(a => this.getQValue(tempS, a));
              const tempMaxSPrediction = tempSActionValues.length > 0 ? Math.max(...tempSActionValues) : 0;

              // 计算前驱状态的TD误差
              const preQ = this.qTable.get(preSAKey) || 0;
              const preTdError = preR + 0.99 * tempMaxSPrediction - preQ;
              const prePrioritize = Math.abs(preTdError);

              // 如果优先级超过阈值，加入队列
              if (prePrioritize > this.theta) {
                this.enqueue(preSAKey, prePrioritize);
              }
            }
          }
        }
      }

      // 转移到下一个状态
      state = nextState;
      step++;
    }
  }

  /**
   * 优先级队列操作：入队
   */
  private enqueue(key: string, priority: number): void {
    // 检查是否已存在，如果存在则更新优先级
    const existingIndex = this.priorityQueue.findIndex(item => item.key === key);
    if (existingIndex !== -1) {
      this.priorityQueue[existingIndex].priority = priority;
    } else {
      this.priorityQueue.push({key, priority});
    }
    
    // 按优先级降序排序（优先级高的在前）
    this.priorityQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 优先级队列操作：出队
   */
  private dequeue(): {key: string, priority: number} | undefined {
    return this.priorityQueue.shift();
  }

  /**
   * 生成状态键（用于predict字典）
   */
  private stateKey(state: FingeringState): string {
    return `${state.index}_${this.fingeringToString(state.fingering)}`;
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
    if (this.rng() < this.explorationRate) {
      // 随机选择
      const randomIndex = Math.floor(this.rng() * actions.length);
      return actions[randomIndex];
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
   * 获取Q值（含热启动：未访问的 (s,a) 返回冻结价值估计 τ·logP + γ·R_phys）
   */
  private getQValue(state: FingeringState, action: Fingering): number {
    const key = this.stateActionKey(state, action);
    const existing = this.qTable.get(key);
    if (existing !== undefined) return existing;
    if (this.priors) {
      return hotStartQ(this.currentHand, state, action, this.priors[state.index]);
    }
    return 0;
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
   * 解析状态-动作键
   */
  private parseStateActionKey(key: string): { state: FingeringState; action: Fingering } {
    const [stateStr, actionStr] = key.split('|');
    const [indexStr, fingeringStr] = stateStr.split('_');
    
    const index = parseInt(indexStr);
    const fingering = this.stringToFingering(fingeringStr);
    const action = this.stringToFingering(actionStr);

    const state: FingeringState = {
      index: index,
      fingering: fingering,
      nextNotes: [],
      part: Part.WholePart
    };

    return { state, action };
  }

  /**
   * 指法转字符串
   */
  private fingeringToString(fingering: Fingering): string {
    if (!fingering || fingering.length === 0) return '';
    return fingering.map(entry => `${entry.pitch}:${entry.finger}`).join(',');
  }

  /**
   * 字符串转指法
   */
  private stringToFingering(str: string): Fingering {
    if (!str) return [];
    return str.split(',').map(entry => {
      const [pitch, finger] = entry.split(':');
      return {
        pitch: parseInt(pitch),
        finger: parseInt(finger) as Finger
      };
    });
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
        const actions = actionSpace(hand, state, allNotes, this.priors);
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

        const reward = hybridReward(hand, state, bestAction, this.priors?.[state.index]);
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
      const actions = actionSpace(hand, state, allNotes, this.priors);

      let bestAction: Fingering;

      if (actions.length === 0) {
        // 如果没有可用动作，使用默认指法
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

        // 保守采纳：若 NN 主选择与 RL 最优的 Q 边际 < 0.1τ，回退 NN 主选择
        // （防止 RL 把 NN 本来就对的指法修错）
        const nnAction = nnArgmaxAction(actions, this.priors?.[state.index]);
        if (nnAction && nnAction !== bestAction) {
          const nnValue = this.getQValue(state, nnAction);
          if (bestValue - nnValue < 0.1 * TAU) {
            bestAction = nnAction;
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

  /**
   * 获取Q表（用于并行训练合并）
   */
  getQTable(): Map<string, number> {
    return new Map(this.qTable);
  }

  /**
   * 获取最终奖励（用于评估）
   */
  getFinalReward(): number {
    return this.evaluate(Hand.RightHand, [], Part.WholePart, 1);
  }
}
