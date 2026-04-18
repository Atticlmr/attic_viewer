// Test setup file
import { vi } from 'vitest';

type MockElement = {
  style: Record<string, unknown>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  appendChild: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
  querySelectorAll: ReturnType<typeof vi.fn>;
};

type MockDocument = {
  getElementById: ReturnType<typeof vi.fn>;
  createElement: ReturnType<typeof vi.fn>;
  body: {
    appendChild: ReturnType<typeof vi.fn>;
    removeChild: ReturnType<typeof vi.fn>;
  };
};

const testGlobal = globalThis as Record<string, unknown>;

// Mock window and document objects for Node.js environment
testGlobal.window = (testGlobal.window as Record<string, unknown> | undefined) || {};
testGlobal.document = (testGlobal.document as MockDocument | undefined) || {
  getElementById: vi.fn(),
  createElement: vi.fn((): MockElement => ({
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
testGlobal.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 0);
testGlobal.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);

// Mock performance.now
if (typeof performance === 'undefined') {
  testGlobal.performance = { now: Date.now };
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
