import { describe, expect, it } from 'vitest';
import { createZipArchive } from './archive.js';

describe('createZipArchive', () => {
    it('builds a valid zip header for multiple files', () => {
        const archive = createZipArchive([
            {
                path: 'robot/model.xml',
                content: new TextEncoder().encode('<mujoco />')
            },
            {
                path: 'robot/meshes/base.stl',
                content: new TextEncoder().encode('solid base')
            }
        ]);

        expect(archive[0]).toBe(0x50);
        expect(archive[1]).toBe(0x4b);
        expect(archive[2]).toBe(0x03);
        expect(archive[3]).toBe(0x04);
        expect(new TextDecoder().decode(archive)).toContain('robot/model.xml');
        expect(new TextDecoder().decode(archive)).toContain('robot/meshes/base.stl');
    });
});
