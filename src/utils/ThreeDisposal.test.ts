import { describe, expect, it, vi } from 'vitest';
import { disposeObject3D } from './ThreeDisposal.js';

function createRoot(children: unknown[]): { traverse: (callback: (object: unknown) => void) => void } {
    return {
        traverse(callback) {
            children.forEach(callback);
        }
    };
}

describe('disposeObject3D', () => {
    it('disposes shared geometry, material, texture, and bitmap once', () => {
        const close = vi.fn();
        const texture = { isTexture: true, image: { close }, dispose: vi.fn() };
        const geometry = { dispose: vi.fn() };
        const material = { map: texture, dispose: vi.fn() };
        const skeleton = { dispose: vi.fn() };
        const root = createRoot([
            { geometry, material, skeleton },
            { geometry, material }
        ]);

        disposeObject3D(root as never);

        expect(geometry.dispose).toHaveBeenCalledTimes(1);
        expect(material.dispose).toHaveBeenCalledTimes(1);
        expect(texture.dispose).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
        expect(skeleton.dispose).toHaveBeenCalledTimes(1);
    });

    it('preserves shared textures when requested', () => {
        const texture = { isTexture: true, dispose: vi.fn() };
        const material = { envMap: texture, dispose: vi.fn() };
        const root = createRoot([{ material }]);

        disposeObject3D(root as never, { preserveTextures: new Set([texture as never]) });

        expect(material.dispose).toHaveBeenCalledTimes(1);
        expect(texture.dispose).not.toHaveBeenCalled();
    });

    it('can dispose cloned materials without disposing their shared textures', () => {
        const texture = { isTexture: true, dispose: vi.fn() };
        const material = { map: texture, dispose: vi.fn() };
        const root = createRoot([{ material }]);

        disposeObject3D(root as never, { disposeTextures: false });

        expect(material.dispose).toHaveBeenCalledTimes(1);
        expect(texture.dispose).not.toHaveBeenCalled();
    });
});
