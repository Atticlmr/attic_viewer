import type { UnifiedRobotModel } from '../models/UnifiedRobotModel.js';

export type AppFileType = 'urdf' | 'xacro' | 'mjcf' | 'usd' | 'mesh' | 'unknown';
export type LoadableFileCategory = 'model' | 'mesh';

export type ViewerModel = UnifiedRobotModel;

export interface VSCodeFileInfo {
    name: string;
    path: string;
    content: string;
    directory: string;
}

export interface LoadableFileInfo {
    file: File;
    name: string;
    type: AppFileType;
    path: string;
    category: LoadableFileCategory;
    ext: string;
}

export interface FileWithPath {
    file: File;
    path: string;
}
