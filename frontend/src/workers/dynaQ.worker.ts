// Dyna-Q Worker - 并行训练
import { DynaQSolver } from '../lib/algorithm/dynaQ';
import { Note, Hand, Part, WorkerConfig } from '../lib/algorithm/types';

// Worker消息类型
interface WorkerMessage {
  type: 'train';
  notes: Note[][];
  hand: Hand;
  part: Part;
  config: WorkerConfig;
}

interface WorkerResponse {
  type: 'complete' | 'error' | 'progress';
  qTable?: [string, number][];
  finalReward?: number;
  episodesCompleted?: number;
  error?: string;
  progress?: number;
}

// 监听主线程消息
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { notes, hand, part, config } = e.data;

  try {
    // 创建Dyna-Q求解器（数据+规则混合模式：带神经先验）
    const solver = new DynaQSolver({
      nEpisodes: config.episodes,
      maxEpisodeLength: 100,
      learningRate: config.learningRate,
      explorationRate: config.explorationRate,
      planningSteps: config.planningSteps,
      randomSeed: config.seed,
      priors: config.priors
    });

    // 训练
    const policy = solver.solve(hand, notes, part, (episode, total) => {
      // 发送进度更新
      const progress = (episode / total) * 100;
      const response: WorkerResponse = {
        type: 'progress',
        progress
      };
      self.postMessage(response);
    });

    // 获取Q表
    const qTable = solver.getQTable();
    const qTableArray: [string, number][] = Array.from(qTable.entries());

    // 返回结果
    const response: WorkerResponse = {
      type: 'complete',
      qTable: qTableArray,
      finalReward: 0, // 可以添加评估逻辑
      episodesCompleted: config.episodes
    };

    self.postMessage(response);

  } catch (error) {
    // 返回错误
    const response: WorkerResponse = {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    self.postMessage(response);
  }
};

// 导出空对象以满足TypeScript模块要求
export {};
