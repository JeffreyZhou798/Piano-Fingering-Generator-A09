// 类型定义 - 对应Julia代码的数据结构

// 枚举类型
export enum Hand {
  LeftHand = -1,
  RightHand = 1
}

export enum Finger {
  F1 = 1,
  F2 = 2,
  F3 = 3,
  F4 = 4,
  F5 = 5
}

export enum Direct {
  Up = 1,
  Down = -1,
  Level = 0
}

export enum FingeringType {
  Nature = 'nature',
  Cross = 'cross',
  Move = 'move'
}

export enum Part {
  FirstPart = 'first_part',
  LastPart = 'last_part',
  MiddlePart = 'middle_part',
  WholePart = 'whole_part'
}

// 音符类型
export interface Note {
  pitch: number;
  velocity: number;
  position: number;
  duration: number;
  channel: number;
  timeMs?: number;     // 绝对时间（毫秒，假定 120 BPM 换算，供神经先验使用）
  durationMs?: number; // 时值（毫秒）
}

// 指法条目
export interface FingeringEntry {
  pitch: number;
  finger: Finger;
}

// 指法映射（使用数组，按pitch排序）
export type Fingering = FingeringEntry[];

// 指法对
export interface NoteFingerPair {
  note: Note;
  finger: Finger;
}

// 指法状态
export interface FingeringState {
  index: number;
  fingering: Fingering;
  nextNotes: Note[];
  part?: Part;
}

// 指法结果（用于输出）
export interface FingeringResultEntry {
  pitch: number;
  finger: number;
  position: number;
}

export interface FingeringResult {
  rightHand?: FingeringResultEntry[];
  leftHand?: FingeringResultEntry[];
}

// Q-Learning配置
export interface QLearningSolverConfig {
  nEpisodes: number;
  maxEpisodeLength: number;
  learningRate: number;
  explorationRate: number;
}

// Dyna-Q配置
export interface DynaQConfig {
  nEpisodes: number;
  maxEpisodeLength: number;
  learningRate: number;
  explorationRate: number;
  planningSteps: number;
  randomSeed: number;
  priors?: import('./fusion').GroupPriors[]; // 神经先验 P_base（与音符组对齐，数据+规则模式必需）
}

// 模型条目
export interface ModelEntry {
  nextState: FingeringState;
  reward: number;
}

// Worker配置
export interface WorkerConfig {
  seed: number;
  episodes: number;
  planningSteps: number;
  learningRate: number;
  explorationRate: number;
  priors?: import('./fusion').GroupPriors[]; // 神经先验（随消息传入 Worker）
}

// Worker结果
export interface WorkerResult {
  qTable: [string, number][];
  finalReward: number;
  episodesCompleted: number;
}

// 进度回调
export type ProgressCallback = (progress: number) => void;
