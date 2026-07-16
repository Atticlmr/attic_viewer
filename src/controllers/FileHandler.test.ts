import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileHandler } from './FileHandler.js';
import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
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
    afterEach(() => {
        vi.restoreAllMocks();
    });

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

    it('commits only the newest asynchronous model load', async () => {
        const handler = new FileHandler();
        const firstFile = new File(['<robot name="first"/>'], 'first.urdf');
        const secondFile = new File(['<robot name="second"/>'], 'second.urdf');
        const firstModel = { name: 'first', threeObject: null };
        const secondModel = { name: 'second', threeObject: null };
        let resolveFirst: (model: unknown) => void;
        let resolveSecond: (model: unknown) => void;
        let markFirstStarted: () => void;
        let markSecondStarted: () => void;
        const firstStarted = new Promise<void>(resolve => { markFirstStarted = resolve; });
        const secondStarted = new Promise<void>(resolve => { markSecondStarted = resolve; });
        const firstResult = new Promise(resolve => { resolveFirst = resolve; });
        const secondResult = new Promise(resolve => { resolveSecond = resolve; });

        vi.spyOn(ModelLoaderFactory, 'loadModel').mockImplementation(async (_type, _content, fileName) => {
            if (fileName === firstFile.name) {
                markFirstStarted();
                return await firstResult;
            }
            markSecondStarted();
            return await secondResult;
        });

        const loaded = vi.fn(async () => {});
        handler.onModelLoaded = loaded;

        const firstLoad = handler.loadFile(firstFile);
        await firstStarted;
        const secondLoad = handler.loadFile(secondFile);
        await secondStarted;

        resolveSecond(secondModel);
        await secondLoad;
        resolveFirst(firstModel);
        await firstLoad;

        expect(loaded).toHaveBeenCalledTimes(1);
        expect(loaded).toHaveBeenCalledWith(secondModel, secondFile, false, null);
        expect(handler.getCurrentModelFile()).toBe(secondFile);
    });

    it('waits for model installation before resolving the load', async () => {
        const handler = new FileHandler();
        const file = new File(['<robot name="robot"/>'], 'robot.urdf');
        const model = { name: 'robot', threeObject: null };
        let finishInstall: () => void;
        const installFinished = new Promise<void>(resolve => { finishInstall = resolve; });

        vi.spyOn(ModelLoaderFactory, 'loadModel').mockResolvedValue(model);
        handler.onModelLoaded = async () => {
            await installFinished;
        };

        let resolved = false;
        const load = handler.loadFile(file).then(() => { resolved = true; });
        await vi.waitFor(() => expect(handler.getCurrentModelFile()).toBe(file));
        await Promise.resolve();
        expect(resolved).toBe(false);

        finishInstall();
        await load;
        expect(resolved).toBe(true);
    });
});
