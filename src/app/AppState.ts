/**
 * Application State Management
 * Centralizes all application state
 */
export class AppState {
    currentModel: any;
    currentMJCFFile: any;
    currentMJCFModel: any;
    angleUnit: string;
    vscodeFileMap: any;
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
    reset() {
        this.currentModel = null;
        this.currentMJCFFile = null;
        this.currentMJCFModel = null;
    }

    /**
     * Set reloading state
     */
    setReloading(value) {
        this._isReloading = value;
    }

    /**
     * Check if currently reloading
     */
    isReloading() {
        return this._isReloading;
    }

    /**
     * Get angle unit
     */
    getAngleUnit() {
        return this.angleUnit;
    }

    /**
     * Set angle unit
     */
    setAngleUnit(unit) {
        this.angleUnit = unit;
    }

    /**
     * Get model info summary
     */
    getModelSummary() {
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
            summary.controllableJoints = Array.from(model.joints.values() as any[])
                .filter((j: any) => j.type !== 'fixed').length;
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
