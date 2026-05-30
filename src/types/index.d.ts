import * as THREE from 'three';
import type * as D3 from 'd3';
import type { i18n as i18nInstance } from '../utils/i18n.js';

// Global type declarations

declare global {
  interface Navigator {
    userLanguage?: string;
  }

  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string[]>;
  }

  interface FilePickerOptions {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }

  interface FileSystemWritableFileStream {
    write(data: BufferSource | Blob | string): Promise<void>;
    close(): Promise<void>;
  }

  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemDirectoryHandle {
    name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  }

  interface HTMLInputElement {
    webkitdirectory: boolean;
  }

  interface DataTransferItem {
    webkitGetAsEntry?: () => import('../utils/FileUtils.js').FileSystemEntryLike | null;
  }

  interface Window {
    sceneManager: unknown;
    app?: {
      sceneManager?: {
        visualizationManager?: {
          showEnhancedLighting?: boolean;
        };
        environmentManager?: {
          getEnvironmentMap?: () => THREE.Texture | null;
        };
      };
      usdViewerManager?: {
        setDisplayOptions?: (options: Record<string, boolean>) => void;
        setJointAngle?: (jointName: string, value: number) => void;
      };
      mujocoSimulationManager?: {
        hasScene?: () => boolean;
        mujocoRoot?: THREE.Object3D;
        toggleVisualDisplay?: (enabled: boolean) => void;
        toggleCollisionDisplay?: (enabled: boolean) => void;
        toggleCOMDisplay?: (enabled: boolean) => void;
        toggleInertiaDisplay?: (enabled: boolean) => void;
        toggleAxesDisplay?: (enabled: boolean) => void;
        toggleJointAxesDisplay?: (enabled: boolean) => void;
      };
    };
    d3: typeof D3;
    i18n: typeof i18nInstance;
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
    vscodeAdapter?: {
      log: (message: string) => void;
      showError: (message: string) => void;
      postMessage: (message: unknown) => void;
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
  interface Material {
    color?: Color;
    map?: Texture | null;
    specular?: Color | number | null;
    shininess?: number;
    reflectivity?: number;
    envMap?: Texture | null;
    transparent?: boolean;
    opacity?: number;
    premultipliedAlpha?: boolean;
    polygonOffset?: boolean;
    polygonOffsetFactor?: number;
    polygonOffsetUnits?: number;
    depthTest?: boolean;
    depthWrite?: boolean;
    side?: Side;
    isMeshPhongMaterial?: boolean;
    isMeshStandardMaterial?: boolean;
    isMeshBasicMaterial?: boolean;
    isMeshLambertMaterial?: boolean;
  }

  interface Object3D {
    userData: Record<string, unknown>;
    isURDFLink?: boolean;
    isURDFJoint?: boolean;
    isURDFCollider?: boolean;
    isMesh?: boolean;
    material?: Material | Material[];
    axis?: Vector3;
    bodyID?: number;
    __origMaterial?: Material | Material[];
  }
}

export {};
