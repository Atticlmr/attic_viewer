/**
 * Application State Management
 * Centralizes all application state
 */
import type { ViewerModel, VSCodeFileInfo } from '../types/app.js';

type AngleUnit = 'rad' | 'deg';

export class AppState {
    currentModel: ViewerModel | null;
    currentMJCFFile: File | null;
    currentMJCFModel: ViewerModel | null;
    angleUnit: AngleUnit;
    vscodeFileMap: Map<string, VSCodeFileInfo>;
    _isReloading: boolean;

    constructor() {
        this.currentModel = null;
        this.currentMJCFFile = null;
        this.currentMJCFModel = null;
        this.angleUnit = 'rad';
        this.vscodeFileMap = new Map();
        this._isReloading = false;
    }

    /**
     * Reset state when loading new model
     */
    reset(): void {
        this.currentModel = null;
        this.currentMJCFFile = null;
        this.currentMJCFModel = null;
    }

    /**
     * Set reloading state
     */
    setReloading(value: boolean): void {
        this._isReloading = value;
    }

    /**
     * Check if currently reloading
     */
    isReloading(): boolean {
        return this._isReloading;
    }

    /**
     * Get angle unit
     */
    getAngleUnit(): AngleUnit {
        return this.angleUnit;
    }

    /**
     * Set angle unit
     */
    setAngleUnit(unit: AngleUnit): void {
        this.angleUnit = unit;
    }

    /**
     * Get model info summary
     */
    getModelSummary(): {
        hasLinks: boolean;
        hasJoints: boolean;
        controllableJoints: number;
        hasConstraints: boolean;
        rootLink: string | null;
    } | null {
        if (!this.currentModel) return null;

        const model = this.currentModel;
        const summary = {
            hasLinks: false,
            hasJoints: false,
            controllableJoints: 0,
            hasConstraints: false,
            rootLink: null,
        };

        if (model.links) {
            summary.hasLinks = model.links.size > 0;
        }

        if (model.joints) {
            summary.hasJoints = model.joints.size > 0;
            summary.controllableJoints = Array.from(model.joints.values())
                .filter(joint => joint.type !== 'fixed').length;
        }

        if (model.constraints) {
            summary.hasConstraints = model.constraints.size > 0;
        }

        if (model.rootLink) {
            summary.rootLink = model.rootLink;
        }

        return summary;
    }
}
