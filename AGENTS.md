# AGENTS.md - Developer Guide

## Project Overview

Robot Viewer - A web-based 3D robot model viewer supporting URDF, MJCF, and USD formats. Built with TypeScript, Vite, Three.js, and Vitest.

## Build Commands

```bash
# Development
pnpm dev              # Start dev server on port 3000

# Build
pnpm build            # Production build to dist/
pnpm preview          # Preview production build

# Type Checking
pnpm typecheck        # Run TypeScript type checking (noEmit)

# Testing
pnpm test             # Run all tests once
pnpm test:watch       # Run tests in watch mode
pnpm test:ui         # Run tests with Vitest UI
pnpm test:coverage   # Run tests with coverage report

# Running a Single Test
pnpm vitest run --testNamePattern "should create empty state"
pnpm vitest run src/app/AppState.test.ts
```

## Code Style Guidelines

### TypeScript Configuration

- Target: ES2020
- Module: ESNext
- Strict mode is **disabled** (`strict: false`)
- Use `any` types when necessary - the codebase uses loose TypeScript
- Use `.js` extension in imports even for `.ts` files (e.g., `import from './AppState.js'`)

### Imports

```typescript
// Use .js extension even for TypeScript files
import { AppState } from './AppState.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// Use path aliases
import { SceneManager } from '@/renderer/SceneManager.js';
```

### Naming Conventions

- **Classes**: PascalCase (e.g., `SceneManager`, `AppState`)
- **Methods**: camelCase (e.g., `addModel()`, `setJointAngle()`)
- **Private members**: Prefix with underscore (e.g., `_dirty`, `_eventListeners`)
- **Constants**: camelCase (e.g., `maxDim`, `cameraDistance`)
- **Files**: PascalCase for classes (e.g., `SceneManager.ts`), camelCase otherwise

### Class Structure

```typescript
/**
 * ClassName - Brief description
 * More details if needed
 */
export class ClassName {
    // Public properties
    canvas: any;
    
    // Private properties (prefix with _)
    _dirty: boolean;
    
    constructor(canvas: any) {
        // Initialize properties
    }

    // Use JSDoc for public methods
    /**
     * Method description
     * @param paramName - Description
     */
    publicMethod(param) {
        // implementation
    }

    // Section dividers for organization
    // ==================== Render Loop ====================
}
```

### Formatting

- **Indentation**: 4 spaces (not tabs)
- **Line length**: No strict limit, but keep reasonably short
- **Semicolons**: Yes
- **Quotes**: Single quotes preferred
- **Trailing commas**: Where appropriate
- **Braces**: K&R style (opening brace on same line)

### Error Handling

```typescript
// Use try-catch for operations that may fail
try {
    const bbox = new THREE.Box3().setFromObject(model.threeObject);
} catch (error) {
    // Failed to calculate model size, using default
}

// Use console.warn for recoverable issues
console.warn('URDF model missing links or joints information');

// Use console.error for critical failures
console.error('Failed to parse URDF XML inertial data:', error);
```

### Testing

- Use Vitest with `describe`, `it`, `expect`, `beforeEach`
- Test files: `*.test.ts` in same directory as source
- Include: `src/**/*.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from './AppState.js';

describe('AppState', () => {
    let state: AppState;

    beforeEach(() => {
        state = new AppState();
    });

    it('should create empty state', () => {
        expect(state.currentModel).toBeNull();
    });
});
```

### File Organization

```
src/
├── app/           # Application core (App.ts, AppState.ts)
├── adapters/      # Model format adapters (URDF, MJCF, USD)
├── controllers/   # Controller classes
├── loaders/       # File loading logic
├── models/        # Data models
├── renderer/      # Three.js rendering (SceneManager, etc.)
├── ui/            # UI components
├── utils/         # Utility functions
└── views/         # View components
```

### Common Patterns

- **Event System**: Simple callback-based events in managers
- **Managers**: Central classes (SceneManager, EnvironmentManager) that coordinate specialized tasks
- **Adapters**: Convert between different model formats to unified format
- **Model References**: Store threeObject for Three.js access, links/joints as Maps

### Dependencies

- **three**: 3D rendering
- **urdf-loader**: URDF file loading
- **mujoco-js**: MuJoCo simulation
- **xacro-parser**: XACRO preprocessing
- **codemirror**: Code editor

### Development Notes

- Dev server runs on port 3000
- USD viewer requires COOP/COEP headers (configured in vite.config.js)
- Use `ignoreLimits` flag to bypass joint limits during drag operations
- On-demand rendering: use `redraw()` to mark scene as needing render
