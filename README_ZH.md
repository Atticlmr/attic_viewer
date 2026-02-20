![screenshot](./docs/screenshot.png)

[English README](./README.md)
---

# Attic Viewer (机器人模型查看器)

[![版本](https://img.shields.io/badge/version-v1.2.0-blue.svg)](https://github.com/Atticlmr/attic_viewer)
[![许可证](https://img.shields.io/badge/license-Apache--2.0-yellow.svg)](LICENSE)
[![平台](https://img.shields.io/badge/platform-web-orange.svg)](https://github.com/Atticlmr/attic_viewer)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6.svg)](https://github.com/Atticlmr/attic_viewer)
[![Three.js](https://img.shields.io/badge/Three.js-0.163.0-black.svg)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-4.5.0-646cff.svg)](https://vitejs.dev/)
[![演示](https://img.shields.io/badge/Demo-Live-brightgreen.svg)](http://viewer.osaerialrobot.top/)

**Attic Viewer** 是一个基于 Web 的 3D 机器人模型查看器。基于 [Three.js](https://threejs.org/) 构建，提供直观的界面，可直接在浏览器中查看、编辑和仿真机器人模型，无需安装任何软件。

**在线演示**: http://viewer.osaerialrobot.top/

> 📝 这是 [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer) 的分支，使用 **TypeScript** 重写。

## 主要特性

- **格式支持**: URDF, Xacro, MJCF, USD
- **可视化**: 视觉/碰撞几何、惯性张量、质心、坐标系

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/Atticlmr/attic_viewer.git
cd attic_viewer

# 安装依赖
pnpm install

# 启动开发服务器
pnpm run dev

# 构建生产版本
pnpm run build

# 运行测试
pnpm test

# TypeScript 类型检查
pnpm typecheck
```

## 开发命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产版本 |
| `pnpm test` | 运行单元测试 |
| `pnpm test:watch` | 监听模式运行测试 |
| `pnpm test:coverage` | 运行测试并生成覆盖率报告 |
| `pnpm typecheck` | TypeScript 类型检查 |

## 项目结构

```
attic_viewer/
├── src/
│   ├── main.ts              # 应用入口
│   ├── app/
│   │   ├── App.ts           # 主应用类
│   │   ├── AppState.ts      # 应用状态管理
│   │   └── handlers/         # 事件处理器
│   ├── adapters/             # 模型格式适配器 (URDF, MJCF, USD, Xacro)
│   ├── controllers/          # 控制器 (文件、代码编辑器、测量)
│   ├── editor/              # 代码编辑器 (CodeMirror)
│   ├── loaders/             # 模型加载器
│   ├── models/
│   │   └── UnifiedRobotModel.ts  # 统一机器人模型数据接口
│   ├── renderer/            # 渲染管理器 (场景、可视化、MuJoCo等)
│   ├── ui/                  # UI 组件
│   ├── utils/               # 工具函数
│   ├── views/               # 视图组件 (文件树、模型图)
│   └── test/                # 测试配置
├── tsconfig.json            # TypeScript 配置
├── vitest.config.js         # Vitest 配置
└── vite.config.js           # Vite 配置
```

## TypeScript 迁移

本项目已从 JavaScript 迁移到 TypeScript：

- **进度**: 已解决约 91% 的类型错误
- **构建**: 通过 ✓
- **测试**: 通过 (7 个测试) ✓

### 剩余的 TypeScript 问题

仍有一些类型错误（主要是 DOM 元素类型推断），但不影响构建和运行。

## 分支

- `main` - 稳定发布分支 (来自原仓库)
- `dev` - TypeScript 重写的开发分支

## 贡献

欢迎贡献！请在提交 PR 之前阅读贡献指南。

## 许可证

Apache License 2.0 - 参见 [LICENSE](LICENSE) 文件。

---

