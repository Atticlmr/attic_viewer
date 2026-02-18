/**
 * USD Viewer Handler - Handles USD viewer container and manager
 */
export class USDViewerHandler {
    constructor(app) {
        this.app = app;
    }

    /**
     * Create USD viewer container
     */
    createUSDViewerContainer() {
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
            z-index: 1;
            pointer-events: none;
        `;
        canvasContainer.appendChild(usdContainer);
    }

    /**
     * Get or create USD viewer manager (lazy loading)
     */
    async getUSDViewerManager() {
        if (!this.app.usdViewerManager) {
            const container = document.getElementById('usd-viewer-container');
            if (!container) {
                throw new Error('USD viewer container not found');
            }

            const USDViewerManager = (await import('../../renderer/USDViewerManager.js')).USDViewerManager;
            this.app.usdViewerManager = new USDViewerManager(container);
            this.app.fileHandler.setUSDViewerManager(this.app.usdViewerManager);

            // Listen for loading progress
            this.app.usdViewerManager.on('USD_LOADING_START', (event) => {
                const message = event.data?.message || 'Loading USD...';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = message;
                    statusInfo.className = 'info';
                }
            });

            this.app.usdViewerManager.on('USD_LOADED', () => {
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = 'USD file loaded successfully';
                    statusInfo.className = 'success';
                }
            });

            this.app.usdViewerManager.on('USD_ERROR', (event) => {
                const error = event.data?.error || 'Load failed';
                const statusInfo = document.getElementById('status-info');
                if (statusInfo) {
                    statusInfo.textContent = `Load failed: ${error}`;
                    statusInfo.className = 'error';
                }
            });
        }

        return this.app.usdViewerManager;
    }
}
