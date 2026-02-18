# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Attic Viewer (robot-viewer) is a web-based 3D robot model viewer built with Three.js. It supports multiple robot description formats (URDF, Xacro, MJCF, USD) and allows users to visualize, edit, and simulate robot models directly in the browser.

## Development Commands

```bash
pnpm install      # Install dependencies
pnpm dev          # Start Vite development server
pnpm build        # Build for production
pnpm preview      # Preview production build
pnpm test         # Run unit tests with Vitest
pnpm test:watch   # Run tests in watch mode
pnpm test:coverage# Run tests with coverage report
pnpm typecheck    # Run TypeScript type checking
```

## Architecture

The project uses several key patterns:

- **Handler Pattern**: `src/app/handlers/` contains specialized handlers for Canvas, File, Model, ModelTree, Simulation, Theme, and USDViewer functionality
- **Adapter Pattern**: `src/adapters/` converts different robot formats (URDF, MJCF, USD, Xacro) to a unified internal representation
- **Manager Pattern**: Multiple manager classes in `src/renderer/` handle rendering (SceneManager, VisualizationManager, MujocoSimulationManager, etc.)
- **Factory Pattern**: ModelLoaderFactory determines the appropriate adapter based on file type

### Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/app/` | Main application class (App.ts), state (AppState.ts), and handlers |
| `src/adapters/` | Robot format adapters (URDF, MJCF, USD, Xacro) |
| `src/renderer/` | Three.js rendering managers |
| `src/controllers/` | File, CodeEditor, and Measurement controllers |
| `src/editor/` | CodeMirror integration for code editing |
| `src/utils/` | Math utilities, drag controls, file utilities |

### State Management

AppState class (`src/app/AppState.ts`) manages application state including currentModel, angleUnit, reloading status, and theme settings.

## TypeScript Status

- Build: Passing
- ~91% type errors resolved
- Tests: 7 passing tests in `src/app/AppState.test.ts`

The tsconfig is permissive (strict: false) with some remaining type inference issues for DOM elements that don't affect build or runtime.
