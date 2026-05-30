import { describe, expect, it } from 'vitest';
import { FileHandler } from './FileHandler.js';
import type { FileSystemEntryLike } from '../utils/FileUtils.js';
import type { LoadableFileInfo } from '../types/app.js';

function loadable(path: string, type: LoadableFileInfo['type'], category: LoadableFileInfo['category'] = 'model'): LoadableFileInfo {
    const name = path.split('/').pop() || path;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return {
        file: new File([''], name),
        name,
        path,
        type,
        category,
        ext
    };
}

describe('FileHandler', () => {
    it('prefers root robot model files over mesh assets', () => {
        const handler = new FileHandler();
        const files = [
            loadable('robot/meshes/base.stl', 'mesh', 'mesh'),
            loadable('robot/robot.urdf', 'urdf'),
            loadable('robot/meshes/arm.obj', 'mesh', 'mesh')
        ];

        expect(handler.getDefaultLoadableFile(files)?.path).toBe('robot/robot.urdf');
    });

    it('prefers root USD stages over nested props and thumbnails', () => {
        const handler = new FileHandler();
        const files = [
            loadable('asset/Props/chair.usda', 'usd'),
            loadable('asset/.thumbs/preview.usd', 'usd'),
            loadable('asset/scene.usda', 'usd')
        ];

        expect(handler.getDefaultLoadableFile(files)?.path).toBe('asset/scene.usda');
    });

    it('prefers directory-named USD roots over nested configuration layers', () => {
        const handler = new FileHandler();
        const files = [
            loadable('rofly_USD/configuration/rofly_robot.usd', 'usd'),
            loadable('rofly_USD/configuration/rofly_base.usd', 'usd'),
            loadable('rofly_USD/rofly.usd', 'usd')
        ];

        expect(handler.getDefaultLoadableFile(files)?.path).toBe('rofly_USD/rofly.usd');
    });

    it('does not duplicate base paths when entries already provide fullPath', () => {
        const handler = new FileHandler();
        const entry = {
            isFile: true,
            isDirectory: false,
            name: 'rofly_base.usd',
            fullPath: '/rofly_USD/configuration/rofly_base.usd'
        } satisfies FileSystemEntryLike;

        expect(handler.normalizeEntryPath(entry, 'rofly_USD/configuration')).toBe('rofly_USD/configuration/rofly_base.usd');
    });
});
