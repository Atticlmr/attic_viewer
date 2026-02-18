import * as THREE from 'three';

// Global type declarations

declare global {
  interface Window {
    sceneManager: any;
    app: any;
    d3: any;
    i18n: any;
    vscodeAdapter?: {
      log: (message: string) => void;
      showError: (message: string) => void;
      postMessage: (message: any) => void;
    };
    THREE?: typeof THREE;
  }

  interface File {
    vscodeDirectory?: string;
    vscodePath?: string;
  }
}

// THREE.js module augmentation
declare module 'three' {
  interface Object3D {
    userData: Record<string, any>;
  }
}

export {};
