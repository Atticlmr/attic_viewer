/**
 * USD Viewer Handler - Handles USD viewer container and manager
 */
import type { App } from '../App.js';
import type { USDViewerManager } from '../../renderer/USDViewerManager.js';
import { Joint, Link } from '../../models/UnifiedRobotModel.js';

type USDViewerMessageEvent = MessageEvent<{
    message?: string;
    error?: string;
    type?: string;
    meshCount?: number;
    primInfo?: {
        physicsAvailable?: boolean;
        joints?: Array<{
            name: string;
            path: string;
            type: string;
            body0?: string;
            body1?: string;
            axis?: number[];
            lowerLimit?: number | null;
            upperLimit?: number | null;
        }>;
        rigidBodies?: Array<{
            name: string;
            path: string;
        }>;
    };
}>;

export class USDViewerHandler {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Create USD viewer container
     */
    createUSDViewerContainer(): void {
        const canvasContainer = document.getElementById('canvas-container');
        if (!canvasContainer) {
            return;
        }

        const usdContainer = document.createElement('div');
        usdContainer.id = 'usd-viewer-container';
        usdContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: none;
            z-index: 3;
            pointer-events: none;
        `;
        canvasContainer.appendChild(usdContainer);
    }

    /**
     * Get or create USD viewer manager (lazy loading)
     */
    async getUSDViewerManager(): Promise<USDViewerManager> {
        if (!this.app.usdViewerManager) {
            const container = document.getElementById('usd-viewer-container');
            if (!container) {
                throw new Error('USD viewer container not found');
            }

            const USDViewerManagerModule = (await import('../../renderer/USDViewerManager.js')).USDViewerManager;
            this.app.usdViewerManager = new USDViewerManagerModule(container);
            this.app.fileHandler.setUSDViewerManager(this.app.usdViewerManager);

            // Listen for loading progress
            this.app.usdViewerManager.on('USD_LOADING_START', (event: USDViewerMessageEvent) => {
                const message = event.data?.message || 'Loading USD...';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = message;
                    statusInfo.className = 'info';
                }
            });

            this.app.usdViewerManager.on('USD_LOADED', (event: USDViewerMessageEvent) => {
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    const meshCount = event.data?.meshCount;
                    statusInfo.textContent = typeof meshCount === 'number'
                        ? `USD file loaded successfully (${meshCount} meshes)`
                        : 'USD file loaded successfully';
                    statusInfo.className = 'success';
                }
            });

            this.app.usdViewerManager.on('USD_ERROR', (event: USDViewerMessageEvent) => {
                const error = event.data?.error || 'Load failed';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = `Load failed: ${error}`;
                    statusInfo.className = 'error';
                }
            });

            this.app.usdViewerManager.on('USD_PRIM_INFO', (event: USDViewerMessageEvent) => {
                this.syncPhysicsInfo(event.data?.primInfo);
            });
        }

        return this.app.usdViewerManager;
    }

    syncPhysicsInfo(primInfo?: USDViewerMessageEvent['data']['primInfo']): void {
        const model = this.app.state.currentModel;
        if (!model?.userData?.isUSDWASM || !primInfo) return;

        model.links.clear();
        model.joints.clear();

        const rootLink = new Link('usd_root');
        rootLink.threeObject = model.threeObject;
        model.addLink(rootLink);
        model.rootLink = rootLink.name;

        primInfo.rigidBodies?.forEach((body) => {
            const link = new Link(body.name || body.path);
            link.threeObject = model.threeObject;
            link.userData = { usdPath: body.path };
            model.addLink(link);
        });

        primInfo.joints?.forEach((item) => {
            if (item.type === 'fixed') return;
            const joint = new Joint(item.name || item.path, item.type || 'revolute');
            joint.parent = item.body0 || rootLink.name;
            joint.child = item.body1 || null;
            joint.axis = {
                xyz: [
                    item.axis?.[0] ?? 0,
                    item.axis?.[1] ?? 0,
                    item.axis?.[2] ?? 1
                ]
            };
            joint.currentValue = 0;
            joint.limits = {
                lower: item.lowerLimit ?? -Math.PI,
                upper: item.upperLimit ?? Math.PI,
                effort: null,
                velocity: null
            };
            joint.threeObject = model.threeObject;
            joint.userData = {
                usdPath: item.path,
                body0: item.body0,
                body1: item.body1
            };
            model.addJoint(joint);
        });

        this.app.jointControlsUI?.setupJointControls(model);
        const currentFile = this.app.fileHandler?.getCurrentModelFile?.() || this.app.fileHandler?.currentModelFile;
        if (currentFile) {
            this.app.modelHandler?.updateModelInfo(model, currentFile);
        }
    }
}
