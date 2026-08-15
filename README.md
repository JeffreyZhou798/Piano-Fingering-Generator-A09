# 🎹 Piano Fingering Generator – Neuro-Symbolic Hybrid Engine

> A browser-based piano fingering generation system powered by **Transformer neural network + Dyna-Q reinforcement learning**. Upload a MusicXML score, get AI-generated fingering annotations — **runs entirely in your browser, no server, no signup, completely free.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-000000?logo=next.js)](https://nextjs.org/)
[![ONNX Runtime](https://img.shields.io/badge/ONNX%20Runtime-1.21-purple)](https://onnxruntime.ai/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 🚀 Live Demo

**Try It Now:** 👉 https://piano-fingering-generator-a09.vercel.app/  👉https://foanqkwyv-pianofingering09-51bwv014b.maozi.io/

**Source Code:** 👉 https://github.com/JeffreyZhou798/Piano-Fingering-Generator-A09/tree/main

[English](#english) | [中文](#中文) | [日本語](#日本語)

---

## English

### ✨ Overview

This application generates piano fingerings (1–5 for each hand) for any MusicXML score. It combines two AI technologies:

1. **Transformer Neural Network** — A pre-trained model that predicts finger probability distributions for each note, learning from thousands of human fingering annotations.
2. **Dyna-Q Reinforcement Learning** — A model-based RL algorithm that plans optimal fingering sequences using physical rules (finger strength, hand span, crossing, stretch) as reward signals.

The two engines work together in a **single hybrid mode**: the neural network provides data-driven priors, and the RL solver refines them with physical constraints. Neither engine runs alone — they are permanently coupled.

### 🌟 Key Features

#### 🧠 Neuro-Symbolic Hybrid Engine

- **Transformer + Dyna-Q**: Neural network priors injected into RL via hot-start Q-values, soft pruning, and hybrid reward
- **Single mode**: Data + Rules (no mode switching, no pure-rule fallback)
- **Dynamic λ**: Entropy-based weighting — when the neural network is confident, data gets more weight; when uncertain, physical rules get more weight
- **Conservative adoption**: If RL's choice disagrees with the neural network but the Q-margin is small, the neural network's choice is kept (prevents RL from "fixing" already-correct fingerings)

#### 🚀 Capabilities

- **MusicXML Support**: Upload `.musicxml` and `.mxl` (compressed) files
- **Left/Right Hand Separation**: Automatic detection via staff or part
- **Chord Handling**: Up to 5-note chords with no-finger-repeat hard constraint
- **Multi-language**: English, Chinese, Japanese (defaults to English)
- **Real-time Progress**: Four-stage progress bar (engine → parse → neural → RL)
- **Browser-Based**: Runs entirely in your browser — your score never leaves your device
- **Smart Caching**: IndexedDB caching for instant results on repeated files
- **Adaptive Performance**: Multi-core parallel training (4/2/1 workers based on hardware)
- **Dual Format Download**: `.musicxml` or `.mxl` (matching input format)
- **Offline Ready**: Model files cached in IndexedDB after first load — works offline on subsequent visits

### 🧠 How It Works

```
┌─────────────────────────────────────────────────────────┐
│                    Your Browser                          │
│                                                         │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │  UI Layer    │───▶│  Parse Layer  │───▶│ Neural     │ │
│  │  (Next.js)   │    │  (MusicXML)   │    │ Prior Layer│ │
│  │  - Upload    │    │  - .mxl unzip │    │ (ONNX)     │ │
│  │  - Progress  │    │  - L/R split  │    │ - P[n][5]  │ │
│  │  - Download  │    │  - Chord grp  │    └─────┬──────┘ │
│  └─────────────┘    └──────────────┘          │        │
│                                                 ▼        │
│  ┌──────────────────────────────────────────────────────┐│
│  │          Decision Layer (Web Worker)                 ││
│  │  ┌─────────────────────────────────────────────────┐ ││
│  │  │  ICCD: ≤3 rounds NN↔Dyna-Q co-decoding          │ ││
│  │  │  1. Hot-start: Q₀ = τ·logP + γ·R_phys           │ ││
│  │  │  2. Soft pruning: Top-3(P) ∩ physical            │ ││
│  │  │  3. Hybrid reward: R = λ·R_data + (1-λ)·R_phys  │ ││
│  │  │  4. Planning: Dyna-Q with priority replay       │ ││
│  │  │  5. Conservative adoption                       │ ││
│  │  └─────────────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────────────┘│
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Output Layer: Write <fingering> tags → Download   ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 📖 Usage Guide

1. **Open the app** in your browser (local: `http://localhost:3000`)
2. **Select language** (English / 中文 / 日本語) — top right corner
3. **Upload a MusicXML file** — drag & drop or click to browse (`.musicxml` or `.mxl`, max 10MB)
4. **Wait for processing** — typically 3–15 seconds for medium scores
5. **Download the result** — the file format matches your input (`.mxl` → `.mxl`, `.musicxml` → `.musicxml`)
6. **Open in MuseScore** or any music notation software to view the fingering annotations

**Processing stages you'll see:**

| Stage | Description | Typical Time |
|-------|-------------|-------------|
| ⚙️ Starting neural engine | Loading ONNX model (first time ~1MB download, cached after) | 1–3s |
| 📄 Parsing score | Extracting notes, separating hands | <1s |
| 🧠 Neural inference | Running Transformer on all notes | 0.1–0.5s |
| 🤖 RL planning | Dyna-Q with hybrid reward | 2–12s |

### 🚀 Quick Start

#### Online Version

Visit the deployed app on Vercel or GitHub Pages.

#### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/JeffreyZhou798/Piano-Fingering-Generator.git
cd Piano-Fingering-Generator/frontend

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Open browser
# http://localhost:3000
```

#### Production Build

```bash
cd frontend
npm run build    # Outputs static site to ./out/
```

The `out/` directory can be deployed to any static hosting (Vercel, GitHub Pages, Netlify).

### 🏗️ Deployment

#### Vercel (Recommended) — **Live Demo: 👉https://piano-fingering-generator-a09.vercel.app/ 👉https://foanqkwyv-pianofingering09-51bwv014b.maozi.io/**

1. Fork this repository to your GitHub
2. Go to [Vercel](https://vercel.com) → New Project → Import your repo
3. **Root Directory**: Select `frontend`
4. Framework Preset: Next.js (auto-detected)
5. Build Command: `next build` (default, override ON)
6. Output Directory: leave as **Next.js default** (override OFF — do NOT set it to `out`)
7. Deploy — done!

> ⚠️ **Important**: Do NOT override the "Output Directory" in Vercel settings. Since `next.config.mjs` uses `output: 'export'`, the static output is auto-detected. Manually setting `outputDirectory` in `vercel.json` or Vercel will trigger a "Routes Manifest Could Not Be Found" error.

#### GitHub Pages

```bash
cd frontend
npm run build
# Deploy the contents of ./out/ to GitHub Pages
```

**Note**: If deploying to a sub-path (e.g., `username.github.io/repo/`), add `basePath` and `assetPrefix` to `next.config.mjs`:

```javascript
const nextConfig = {
  output: 'export',
  basePath: '/your-repo-name',
  assetPrefix: '/your-repo-name/',
  // ...
};
```

### ⚙️ Technical Details

#### Neural Network Model

- **Architecture**: Transformer (26 tokens × 5 features per note)
- **Model size**: ~0.4–1 MB per hand (left/right separate models)
- **Format**: ONNX (runs in browser via `onnxruntime-web`)
- **Inference**: Single-threaded WASM (compatible with all modern browsers, no COOP/COEP required)
- **Self-check**: On engine startup, a 5-note test inference verifies output validity (finite probabilities, sum ≈ 1). If it fails, an explicit error is shown — the app never silently falls back to rule-only mode.

#### Guarantee Stack (G0–G6)

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| G0 | ONNX weights vendored in `public/models/` (CDN-distributed) | Runtime external deps |
| G1 | First visit: fetch + cache to IndexedDB | Network fluctuation |
| G2 | Subsequent: read from IndexedDB (offline-capable) | Network/CDN failure |
| G3 | Session creation: single-thread WASM + retry | ort/browser differences |
| G4 | Startup self-check: 5-note test inference | Environment unusable |
| G5 | Runtime: `session.run` try/catch + one retry | Transient failures |
| G6 | Last resort: explicit bilingual error page + retry button | Unrecoverable |

#### Hybrid Reward Formula

```
λ(s) = 0.4 + 0.45 · (1 - H(P_s) / log 5)    ∈ [0.4, 0.85]
R(s,a) = λ(s) · R_data(s,a) + (1 - λ(s)) · R_phys(s,a)
Q₀(s,a) = τ · log P(a|s) + γ · R_phys(s,a)    (τ=5.0, γ≡0.3)
```

- **λ and γ are hardcoded constants** — pure-data or pure-rule modes are impossible at the code level
- **Data item (logP) is always present** in the reward, even when pruning narrows the candidate set

#### Browser Compatibility

- Chrome 90+ ✅
- Firefox 88+ ✅
- Safari 14+ ✅
- Edge 90+ ✅

Requires: Web Workers, IndexedDB, WASM, ES2020+

### 📁 Project Structure

```
frontend/
├── public/
│   ├── models/                          # ONNX model weights (vendored)
│   │   ├── fingering_transformer_left.onnx
│   │   └── fingering_transformer_right.onnx
│   └── ort/                             # ONNX Runtime WASM (self-hosted)
│       ├── ort-wasm-simd-threaded.wasm
│       └── ort-wasm-simd-threaded.mjs
├── src/
│   ├── app/page.tsx                     # Main page
│   ├── components/                      # UI components
│   │   ├── FileUploader.tsx
│   │   ├── ProcessingStatus.tsx
│   │   └── LanguageSwitcher.tsx
│   ├── lib/
│   │   ├── algorithm/                   # Core algorithm
│   │   │   ├── types.ts                 # Type definitions
│   │   │   ├── const.ts                 # Constants & helpers
│   │   │   ├── fingering.ts             # Fingering functions
│   │   │   ├── mdp.ts                   # MDP & reward function
│   │   │   ├── fusion.ts                # Hybrid reward, soft pruning, λ
│   │   │   ├── dynaQ.ts                 # Dyna-Q solver
│   │   │   └── process.ts               # Main processing pipeline
│   │   ├── music/                       # Music file processing
│   │   │   ├── parser.ts                # MusicXML parser
│   │   │   ├── writer.ts                # MusicXML writer (fingering tags)
│   │   │   └── mxl.ts                   # MXL extract/compress
│   │   ├── nn/                          # Neural network layer
│   │   │   ├── ort.ts                   # ONNX Runtime abstraction
│   │   │   ├── tokens.ts                # 26-token builder
│   │   │   ├── inference.ts             # Whole-piece inference + ICCD
│   │   │   └── engine.ts                # Guarantee stack G0-G6
│   │   ├── cache/indexedDB.ts           # Result caching
│   │   └── i18n.ts                      # i18n (en/zh/ja)
│   └── workers/
│       ├── fingering.worker.ts          # Main worker (full pipeline)
│       └── dynaQ.worker.ts              # Parallel training worker
├── next.config.mjs
├── vercel.json
├── tsconfig.json
└── package.json
```

### 📄 License

MIT License — see [LICENSE](LICENSE) for details.

### 👤 Author

**Jeffrey Zhou**

---

## 中文

### ✨ 项目简介

本应用为任意 MusicXML 乐谱生成钢琴指法（左右手各 1–5 指），结合两种 AI 技术：

1. **Transformer 神经网络** — 预训练模型为每个音符预测指法概率分布，从大量人类指法标注中学习
2. **Dyna-Q 强化学习** — 基于模型的 RL 算法，利用物理规则（手指力量、手跨度、穿指、伸展）作为奖励信号规划最优指法序列

两个引擎以**单一混合模式**协同工作：神经网络提供数据驱动的先验，RL 求解器用物理约束精炼。两个引擎永不同时缺席——它们永久耦合。

### 🌟 核心功能

#### 🧠 神经符号混合引擎

- **Transformer + Dyna-Q**：神经网络先验通过热启动 Q 值、软剪枝、混合奖励注入 RL
- **单一模式**：数据+规则（无模式切换、无纯规则回退）
- **动态 λ**：基于熵的自适应加权——网络确信时数据权重高，犹豫时物理规则权重高
- **保守采纳**：RL 选择与神经网络不一致但 Q 边际很小时，保留神经网络的选择

#### 🚀 功能特性

- **MusicXML 支持**：上传 `.musicxml` 和 `.mxl`（压缩）格式
- **左右手分离**：通过 staff 或 part 自动检测
- **和弦处理**：最多 5 音和弦，手指不重复硬约束
- **多语言**：中英日三语（默认英文）
- **实时进度**：四阶段进度条（引擎→解析→神经→RL）
- **浏览器运行**：完全在浏览器中运行，乐谱不离开设备
- **智能缓存**：IndexedDB 缓存，重复文件秒开
- **自适应性能**：多核并行训练（4/2/1 Worker 自适应）
- **双格式下载**：`.musicxml` 或 `.mxl`（与输入格式一致）
- **离线可用**：模型首次加载后缓存到 IndexedDB，后续可离线使用

### 📖 使用说明

1. **打开应用**（本地：`http://localhost:3000`）
2. **选择语言**（中文 / English / 日本語）——右上角
3. **上传 MusicXML 文件** ——拖拽或点击（`.musicxml` 或 `.mxl`，最大 10MB）
4. **等待处理** ——中等乐谱通常 3–15 秒
5. **下载结果** ——格式与输入一致（`.mxl` → `.mxl`，`.musicxml` → `.musicxml`）
6. **在 MuseScore 中打开**查看指法标注

**处理阶段说明：**

| 阶段 | 说明 | 典型耗时 |
|------|------|---------|
| ⚙️ 启动神经引擎 | 加载 ONNX 模型（首次约 1MB，之后缓存） | 1–3秒 |
| 📄 解析乐谱 | 提取音符、分离左右手 | <1秒 |
| 🧠 神经推理 | Transformer 对全部音符推理 | 0.1–0.5秒 |
| 🤖 RL 规划 | 混合奖励 Dyna-Q | 2–12秒 |

### 🚀 快速开始

#### 在线版本

访问 Vercel 或 GitHub Pages 上的部署版本。

#### 本地开发

```bash
git clone https://github.com/JeffreyZhou798/Piano-Fingering-Generator.git
cd Piano-Fingering-Generator/frontend
npm install
npm run dev
# 浏览器打开 http://localhost:3000
```

#### 生产构建

```bash
cd frontend
npm run build    # 静态站点输出到 ./out/
```

`out/` 目录可部署到任何静态托管（Vercel、GitHub Pages、Netlify）。

### 🏗️ 部署

#### Vercel（推荐）— **在线体验：👉https://piano-fingering-generator-a09.vercel.app/ 👉https://foanqkwyv-pianofingering09-51bwv014b.maozi.io/**

1. Fork 本仓库到你的 GitHub
2. 进入 [Vercel](https://vercel.com) → New Project → 导入仓库
3. **Root Directory**：选择 `frontend`
4. Framework Preset：Next.js（自动检测）
5. Build Command：`next build`（默认，Override 开启）
6. Output Directory：保持 **Next.js 默认**（Override 关闭，**不要设为 `out`**）
7. 部署——完成！

> ⚠️ **重要**：不要在 Vercel 设置中手动指定 Output Directory。由于 `next.config.mjs` 使用了 `output: 'export'`，静态输出目录会被自动检测。手动在 `vercel.json` 或 Vercel 面板中设置 `outputDirectory` 会导致 "Routes Manifest Could Not Be Found" 错误。

#### GitHub Pages

```bash
cd frontend
npm run build
# 将 ./out/ 内容部署到 GitHub Pages
```

### 👤 作者

**Jeffrey Zhou**

---

## 日本語

### ✨ 概要

このアプリケーションは、任意の MusicXML 楽譜に対してピアノ運指（左右各 1–5 指）を生成します。2つの AI 技術を組み合わせています：

1. **Transformer ニューラルネットワーク** — 人間の運指アノテーションから学習し、各音符の運指確率分布を予測する事前学習済みモデル
2. **Dyna-Q 強化学習** — 物理ルール（指の力、手のスパン、交差、ストレッチ）を報酬信号として用いて最適運指シーケンスを計画するモデルベース RL アルゴリズム

2つのエンジンは**単一のハイブリッドモード**で協調します。ニューラルネットワークがデータ駆動の事前分布を提供し、RL ソルバーが物理制約で洗練します。どちらのエンジンも単独で動作することはなく、常に結合されています。

### 🌟 主な機能

#### 🧠 ニューロシンボリック・ハイブリッドエンジン

- **Transformer + Dyna-Q**：ホットスタート Q 値、ソフトプルーニング、ハイブリッド報酬を通じてニューラルネットワークの事前分布を RL に注入
- **単一モード**：データ+ルール（モード切替なし、純ルールフォールバックなし）
- **動的 λ**：エントロピーベースの適応重み付け — ネットワークが自信を持つ時はデータ重視、迷う時は物理ルール重視
- **保守的採用**：RL の選択がニューラルネットワークと異なるが Q 差分が小さい場合、ニューラルネットワークの選択を保持

#### 🚀 機能

- **MusicXML サポート**：`.musicxml` と `.mxl`（圧縮）形式のアップロード
- **左右手分離**：staff または part による自動検出
- **和音処理**：最大5音和音、指番号重複なしのハード制約
- **多言語**：英中日三言語（デフォルト英語）
- **リアルタイム進捗**：4段階プログレスバー（エンジン→解析→ニューラル→RL）
- **ブラウザ実行**：完全にブラウザ内で実行、楽譜はデバイスから出ません
- **スマートキャッシング**：IndexedDB キャッシュで繰り返しファイルは即座に表示
- **適応パフォーマンス**：マルチコア並列トレーニング（4/2/1 Worker 適応）
- **デュアル形式ダウンロード**：`.musicxml` または `.mxl`（入力形式に一致）
- **オフライン対応**：モデルは初回ロード後 IndexedDB にキャッシュ、以降オフラインで使用可能

### 📖 使用方法

1. **アプリを開く**（ローカル：`http://localhost:3000`）
2. **言語を選択**（中文 / English / 日本語）— 右上
3. **MusicXML ファイルをアップロード** — ドラッグ&ドロップまたはクリック
4. **処理を待つ** — 中規模楽譜で通常 3–15 秒
5. **結果をダウンロード** — 形式は入力に一致
6. **MuseScore で開いて**運指注釈を確認

### 🚀 クイックスタート

#### ローカル開発

```bash
git clone https://github.com/JeffreyZhou798/Piano-Fingering-Generator.git
cd Piano-Fingering-Generator/frontend
npm install
npm run dev
# ブラウザで http://localhost:3000 を開く
```

#### 本番ビルド

```bash
cd frontend
npm run build    # 静的サイトを ./out/ に出力
```

### 🏗️ デプロイ

#### Vercel（推奨）— **ライブデモ：👉https://piano-fingering-generator-a09.vercel.app/ 👉https://foanqkwyv-pianofingering09-51bwv014b.maozi.io/**

1. このリポジトリを GitHub にフォーク
2. [Vercel](https://vercel.com) → New Project → リポジトリをインポート
3. **Root Directory**：`frontend` を選択
4. Framework Preset：Next.js（自動検出）
5. Build Command：`next build`（デフォルト、Override ON）
6. Output Directory：**Next.js デフォルト**のまま（Override OFF、`out` に設定しない）
7. デプロイ — 完了！

> ⚠️ **重要**：Vercel 設定で Output Directory を手動で指定しないでください。`next.config.mjs` で `output: 'export'` を使用しているため、静的出力ディレクトリは自動検出されます。手動設定すると "Routes Manifest Could Not Be Found" エラーが発生します。

#### GitHub Pages

```bash
cd frontend
npm run build
# ./out/ の内容を GitHub Pages にデプロイ
```

### 👤 作者

**Jeffrey Zhou**

---

## ⚠️ Copyright

© 2026 Jeffrey Zhou. All rights reserved.

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

*Built with ❤️ for music education*
