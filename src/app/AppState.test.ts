import { describe, it, expect, beforeEach } from 'vitest';
import { AppState } from './AppState.js';

describe('AppState', () => {
    let state;

    beforeEach(() => {
        state = new AppState();
    });

    it('should create empty state', () => {
        expect(state.currentModel).toBeNull();
        expect(state.currentMJCFFile).toBeNull();
        expect(state.currentMJCFModel).toBeNull();
        expect(state.angleUnit).toBe('rad');
    });

    it('should set and get angle unit', () => {
        state.setAngleUnit('deg');
        expect(state.getAngleUnit()).toBe('deg');
    });

    it('should manage reloading state', () => {
        expect(state.isReloading()).toBe(false);
        state.setReloading(true);
        expect(state.isReloading()).toBe(true);
        state.setReloading(false);
        expect(state.isReloading()).toBe(false);
    });

    it('should reset state', () => {
        state.currentModel = { name: 'test' };
        state.currentMJCFFile = { name: 'test.xml' };
        state.currentMJCFModel = { joints: new Map() };

        state.reset();

        expect(state.currentModel).toBeNull();
        expect(state.currentMJCFFile).toBeNull();
        expect(state.currentMJCFModel).toBeNull();
    });

    it('should get model summary for null model', () => {
        const summary = state.getModelSummary();
        expect(summary).toBeNull();
    });

    it('should get model summary for model with links and joints', () => {
        const mockModel = {
            links: new Map([['link1', {}], ['link2', {}]]),
            joints: new Map([
                ['joint1', { type: 'revolute' }],
                ['joint2', { type: 'fixed' }],
                ['joint3', { type: 'prismatic' }]
            ]),
            rootLink: 'base_link'
        };

        state.currentModel = mockModel;
        const summary = state.getModelSummary();

        expect(summary.hasLinks).toBe(true);
        expect(summary.hasJoints).toBe(true);
        expect(summary.controllableJoints).toBe(2); // revolute + prismatic, not fixed
        expect(summary.rootLink).toBe('base_link');
    });

    it('should get model summary with constraints', () => {
        const mockModel = {
            links: new Map(),
            joints: new Map(),
            constraints: new Map([
                ['c1', { type: 'connect' }],
                ['c2', { type: 'weld' }]
            ])
        };

        state.currentModel = mockModel;
        const summary = state.getModelSummary();

        expect(summary.hasConstraints).toBe(true);
    });
});
