// Test setup file
import { vi } from 'vitest';

// Mock window and document objects for Node.js environment
global.window = global.window || {};
global.document = global.document || {
  getElementById: vi.fn(),
  createElement: vi.fn(() => ({
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() },
    appendChild: vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(() => []),
  })),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
};

// Mock requestAnimationFrame
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Mock performance.now
if (typeof performance === 'undefined') {
  global.performance = { now: Date.now };
}

// Mock THREE.js - avoid loading the actual library in tests
vi.mock('three', () => ({
  default: {
    Scene: vi.fn(() => ({
      add: vi.fn(),
      remove: vi.fn(),
      children: [],
    })),
    PerspectiveCamera: vi.fn(),
    WebGLRenderer: vi.fn(() => ({
      setSize: vi.fn(),
      render: vi.fn(),
    })),
    Vector2: vi.fn(() => ({ x: 0, y: 0 })),
    Vector3: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    Quaternion: vi.fn(),
    Matrix4: vi.fn(),
    Color: vi.fn(),
    MOUSE: { ROTATE: 0, DOLLY: 1, PAN: 2 },
  },
  OrbitControls: vi.fn(),
}));

// Mock d3
vi.mock('d3', () => ({
  default: {
    select: vi.fn(() => ({
      selectAll: vi.fn(() => ({
        remove: vi.fn(),
      })),
      append: vi.fn(),
      remove: vi.fn(),
      text: vi.fn(),
      classed: vi.fn(),
      style: vi.fn(),
      on: vi.fn(),
    })),
    selectAll: vi.fn(),
  },
}));
