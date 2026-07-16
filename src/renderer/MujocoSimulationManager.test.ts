import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('three');

const mujocoFactory = vi.hoisted(() => vi.fn());

vi.mock('@mujoco/mujoco', () => ({
    default: mujocoFactory
}));

vi.mock('@mujoco/mujoco/mujoco.wasm?url', () => ({
    default: '/assets/mujoco-test.wasm'
}));

import * as THREE from 'three';
import { MujocoSimulationManager } from './MujocoSimulationManager.js';

function createSceneManager() {
    return {
        renderer: { domElement: document.createElement('canvas') },
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
        controls: { enabled: true },
        currentModel: null,
        dragControls: { enabled: true },
        highlightManager: { clearHighlight: vi.fn() },
        groundPlane: null,
        redraw: vi.fn()
    };
}

function createFileSystem() {
    return {
        analyzePath: vi.fn(() => ({ exists: false })),
        mkdir: vi.fn(),
        readdir: vi.fn(() => ['.', '..']),
        stat: vi.fn(),
        isDir: vi.fn(() => false),
        unlink: vi.fn(),
        rmdir: vi.fn(),
        writeFile: vi.fn()
    };
}

describe('MujocoSimulationManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads the official module with the emitted WASM asset URL', async () => {
        const FS = createFileSystem();
        const module = { FS };
        mujocoFactory.mockResolvedValue(module);
        const manager = new MujocoSimulationManager(createSceneManager() as never);

        await expect(manager.init()).resolves.toBe(module);

        const options = mujocoFactory.mock.calls[0][0];
        expect(options.locateFile('mujoco.wasm')).toBe('/assets/mujoco-test.wasm');
        expect(options.locateFile('other.data')).toBe('other.data');
        expect(FS.mkdir).toHaveBeenCalledWith('/working');
    });

    it('steps MjData through the canonical mj_step API', () => {
        const manager = new MujocoSimulationManager(createSceneManager() as never);
        const data = {
            qfrc_applied: new Float64Array([4]),
            xpos: new Float64Array(),
            xquat: new Float64Array(),
            time: 0,
            delete: vi.fn()
        };
        const model = {
            opt: { timestep: 0.01 },
            nbody: 0,
            delete: vi.fn()
        };
        const mj_step = vi.fn(() => {
            data.time += model.opt.timestep;
        });

        manager.mujoco = { mj_step } as never;
        manager.model = model as never;
        manager.data = data as never;
        manager.isLoaded = true;
        manager.params.paused = false;
        manager.mujoco_time = 100;

        manager.update(150);

        expect(mj_step).toHaveBeenCalledTimes(5);
        expect(data.time).toBeCloseTo(0.05);
        expect(data.qfrc_applied[0]).toBe(0);
    });

    it('deletes MjData before MjModel when clearing a scene', () => {
        const manager = new MujocoSimulationManager(createSceneManager() as never);
        const FS = createFileSystem();
        const deleteData = vi.fn();
        const deleteModel = vi.fn();

        manager.mujoco = { FS } as never;
        manager.data = { delete: deleteData } as never;
        manager.model = { delete: deleteModel } as never;
        manager.isLoaded = true;

        manager.clearScene();

        expect(deleteData).toHaveBeenCalledOnce();
        expect(deleteModel).toHaveBeenCalledOnce();
        expect(deleteData.mock.invocationCallOrder[0]).toBeLessThan(deleteModel.mock.invocationCallOrder[0]);
        expect(manager.data).toBeNull();
        expect(manager.model).toBeNull();
        expect(manager.hasScene()).toBe(false);
    });
});
