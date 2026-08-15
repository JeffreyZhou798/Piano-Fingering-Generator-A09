// ONNX Runtime 抽象层 - 依赖注入设计
// 同一套推理代码可在浏览器（onnxruntime-web）与 Node.js 测试（onnxruntime-node）中运行

export interface OrtTensorLike {
  data: Float32Array | number[];
}

export interface OrtSessionLike {
  run(feeds: Record<string, unknown>): Promise<Record<string, OrtTensorLike>>;
  release?(): Promise<void> | void;
}

export interface OrtLike {
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: {
    create(bytes: ArrayBuffer | Uint8Array, options?: Record<string, unknown>): Promise<OrtSessionLike>;
  };
}

export interface ModelSessions {
  left: OrtSessionLike;
  right: OrtSessionLike;
}
