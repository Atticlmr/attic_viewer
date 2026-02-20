![screenshot](./docs/screenshot.png)

---

[中文README](./README_ZH.md)

---

# Attic Viewer

[![Version](https://img.shields.io/badge/version-v1.2.0-blue.svg)](https://github.com/Atticlmr/attic_viewer)
[![License](https://img.shields.io/badge/license-Apache--2.0-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-web-orange.svg)](https://github.com/Atticlmr/attic_viewer)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6.svg)](https://github.com/Atticlmr/attic_viewer)
[![Three.js](https://img.shields.io/badge/Three.js-0.163.0-black.svg)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-4.5.0-646cff.svg)](https://vitejs.dev/)
[![Demo](https://img.shields.io/badge/Demo-Live-brightgreen.svg)](http://viewer.osaerialrobot.top/)

**Attic Viewer** is a web-based 3D viewer for robot models and scenes. Built on top of [Three.js](https://threejs.org/), it provides an intuitive interface for visualizing, editing, and simulating robots directly in the browser without any installation required.

**Live Demo**: http://viewer.osaerialrobot.top/

> 📝 This is a fork of [fan-ziqi/robot_viewer](https://github.com/fan-ziqi/robot_viewer), rewritten in **TypeScript**.

## Key Features

- **Format Support**: URDF, Xacro, MJCF, USD
- **Visualization**: Visual/collision geometry, inertia tensors, center of mass, coordinate frames
- **Interactive Controls**: Drag joints in real-time
- **Measurement Tools**: Measure distances between joints and links
- **Code Editor**: Built-in CodeMirror editor with syntax highlighting

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Atticlmr/attic_viewer.git
cd attic_viewer

# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Build for production
pnpm run build

# Run tests
pnpm test

# TypeScript type checking
pnpm typecheck
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm preview` | Preview production build |
| `pnpm test` | Run unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |
| `pnpm typecheck` | TypeScript type checking |

## Project Structure

```
attic_viewer/
├── src/
│   ├── main.ts              # Application entry point
│   ├── app/
│   │   ├── App.ts           # Main application class
│   │   ├── AppState.ts      # Application state management
│   │   └── handlers/         # Event handlers
│   ├── adapters/             # Model format adapters (URDF, MJCF, USD, Xacro)
│   ├── controllers/          # Controllers (File, CodeEditor, Measurement)
│   ├── editor/              # Code editor (CodeMirror)
│   ├── loaders/             # Model loaders
│   ├── models/
│   │   └── UnifiedRobotModel.ts  # Unified robot model data interface
│   ├── renderer/            # Render managers (Scene, Visual, MuJoCo, etc.)
│   ├── ui/                  # UI components
│   ├── utils/               # Utilities
│   ├── views/               # View components (FileTree, ModelGraph)
│   └── test/                # Test setup
├── tsconfig.json            # TypeScript configuration
├── vitest.config.js         # Vitest configuration
└── vite.config.js           # Vite configuration
```

## TypeScript Migration

This project has been migrated from JavaScript to TypeScript:

- **Status**: ~91% type errors resolved
- **Build**: Passing ✓
- **Tests**: Passing (7 tests) ✓

### Remaining TypeScript Issues

Some type errors remain (primarily DOM element type inference), but these do not affect build or runtime.

## Branches

- `main` - Stable release branch (from original repo)
- `dev` - Development branch with TypeScript rewrite

## Contributing

We welcome contributions! Please read our contributing guidelines before submitting PRs.

## License

Apache License 2.0 - see [LICENSE](LICENSE) file.
