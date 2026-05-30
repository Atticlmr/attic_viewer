/**
 * USD Viewer Manager
 * Manages USD iframe lifecycle and message communication
 */
type USDViewerMessageType = 'IFRAME_READY' | 'USD_LOADED' | 'USD_LOADING_START' | 'USD_ERROR' | 'USD_TRANSFORM_STATS' | 'USD_PRIM_INFO';

type USDViewerPayload = {
    type: USDViewerMessageType;
    message?: string;
    error?: string;
    meshCount?: number;
    loadedFiles?: number;
    stats?: unknown;
    primInfo?: unknown;
};

type USDViewerMessageHandler = (event: MessageEvent<USDViewerPayload>) => void;
type USDLoadEntry = {
    path: string;
    buffer: ArrayBuffer;
};

const validMessageTypes: USDViewerMessageType[] = [
    'IFRAME_READY',
    'USD_LOADED',
    'USD_LOADING_START',
    'USD_ERROR',
    'USD_TRANSFORM_STATS',
    'USD_PRIM_INFO',
];

export class USDViewerManager {
    container: HTMLElement;
    iframe: HTMLIFrameElement | null;
    isReady: boolean;
    initializationPromise: Promise<void> | null;
    messageHandlers: Map<USDViewerMessageType, USDViewerMessageHandler[]>;
    boundHandleMessage: (event: MessageEvent<USDViewerPayload>) => void;
    lastPrimInfo: unknown;

    constructor(container: HTMLElement) {
        this.container = container;
        this.iframe = null;
        this.isReady = false;
        this.initializationPromise = null;
        this.messageHandlers = new Map();
        this.boundHandleMessage = this.handleMessage.bind(this);
        this.lastPrimInfo = null;

        window.addEventListener('message', this.boundHandleMessage);
    }

    /**
     * Initialize USD viewer
     */
    async initialize(): Promise<void> {
        if (this.isReady) return;
        if (this.initializationPromise) return this.initializationPromise;

        this.initializationPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.off('IFRAME_READY', readyHandler);
                if (this.iframe?.parentNode) {
                    this.iframe.parentNode.removeChild(this.iframe);
                }
                this.iframe = null;
                this.initializationPromise = null;
                reject(new Error('USD viewer initialization timeout'));
            }, 30000);

            // Listen for IFRAME_READY
            const readyHandler: USDViewerMessageHandler = (event) => {
                if (event.data?.type === 'IFRAME_READY') {
                    clearTimeout(timeout);
                    this.off('IFRAME_READY', readyHandler);
                    this.isReady = true;
                    this.initializationPromise = null;
                    resolve(undefined);
                }
            };

            this.on('IFRAME_READY', readyHandler);

            // Create iframe
            this.iframe = document.createElement('iframe');
            this.iframe.src = new URL('usd-iframe.html', window.location.href).toString();
            this.iframe.style.cssText = `
                width: 100%;
                height: 100%;
                border: none;
                display: block;
                pointer-events: all;
            `;
            this.container.appendChild(this.iframe);
        });

        return this.initializationPromise;
    }

    /**
     * Handle messages
     */
    handleMessage(event: MessageEvent<USDViewerPayload>): void {
        if (event.origin !== window.location.origin) return;

        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (!validMessageTypes.includes(data.type)) return;

        if (data.type === 'USD_TRANSFORM_STATS') {
            (window as any).__usdHydraTransformStats = data.stats;
        }
        if (data.type === 'USD_PRIM_INFO') {
            (window as any).__usdPrimInfo = data.primInfo;
            this.lastPrimInfo = data.primInfo;
        }

        const handlers = this.messageHandlers.get(data.type);
        if (handlers) {
            handlers.slice().forEach(h => h(event));
        }
    }

    /**
     * Register message handler
     */
    on(messageType: USDViewerMessageType, handler: USDViewerMessageHandler): void {
        const existing = this.messageHandlers.get(messageType);
        if (!existing) {
            this.messageHandlers.set(messageType, [handler]);
        } else {
            existing.push(handler);
        }
    }

    /**
     * Remove message handler
     */
    off(messageType: USDViewerMessageType, handler: USDViewerMessageHandler): void {
        const existing = this.messageHandlers.get(messageType);
        if (!existing) return;

        const next = existing.filter(h => h !== handler);
        if (next.length > 0) {
            this.messageHandlers.set(messageType, next);
        } else {
            this.messageHandlers.delete(messageType);
        }
    }

    /**
     * Send message
     */
    postMessage(type: string, payload: Record<string, unknown> = {}): void {
        if (!this.iframe) return;
        try {
            this.iframe.contentWindow?.postMessage({ type, ...payload }, window.location.origin);
        } catch (e) {
            console.error('[USDViewerManager] Failed to send message:', e);
        }
    }

    /**
     * Load USD from file
     */
    async loadFromFile(file: File): Promise<void> {
        await this.initialize();

        const buffer = await file.arrayBuffer();
        const entries = [{ path: file.name, buffer }];

        return this.loadFromEntries(entries, file.name);
    }

    /**
     * Load from file map
     */
    async loadFromFilesMap(filesMap: Record<string, File>, primaryPath: string): Promise<void> {
        await this.initialize();

        const entries: USDLoadEntry[] = [];
        for (const [path, file] of Object.entries(filesMap)) {
            try {
                const buffer = await file.arrayBuffer();
                entries.push({ path, buffer });
            } catch (error) {
                console.error(`[USDViewerManager] Failed to read: ${path}`, error);
                // Continue processing other files, don't interrupt
            }
        }

        return this.loadFromEntries(entries, primaryPath);
    }

    /**
     * Send mounted file entries to the iframe and wait for success or failure.
     */
    async loadFromEntries(entries: USDLoadEntry[], primaryPath: string): Promise<void> {
        await this.initialize();

        return new Promise<void>((resolve, reject) => {
            let settled = false;
            const cleanup = () => {
                clearTimeout(timeout);
                this.off('USD_LOADED', loadedHandler);
                this.off('USD_ERROR', errorHandler);
            };

            const settle = (callback: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback();
            };

            const timeout = setTimeout(() => {
                settle(() => reject(new Error('USD load timeout')));
            }, 60000);

            const loadedHandler: USDViewerMessageHandler = (event) => {
                const meshCount = event.data?.meshCount;
                if (meshCount === 0) {
                    settle(() => reject(new Error('USD loaded but no renderable meshes were found')));
                    return;
                }

                settle(() => resolve());
            };

            const errorHandler: USDViewerMessageHandler = (event) => {
                const error = event.data?.error || event.data?.message || 'USD load failed';
                settle(() => reject(new Error(error)));
            };

            this.on('USD_LOADED', loadedHandler);
            this.on('USD_ERROR', errorHandler);
            this.postMessage('USD_LOAD_ENTRIES', { entries, primaryPath });
        });
    }

    /**
     * Clear scene
     */
    clear(): void {
        if (!this.isReady) return;
        this.postMessage('USD_CLEAR');
    }

    /**
     * Update USD iframe display helpers.
     */
    setDisplayOptions(options: Record<string, boolean>): void {
        if (!this.isReady) return;
        this.postMessage('USD_SET_DISPLAY_OPTIONS', { options });
    }

    /**
     * Drive a USD physics joint in the iframe.
     */
    setJointAngle(jointName: string, value: number): void {
        if (!this.isReady) return;
        this.postMessage('USD_SET_JOINT', { jointName, value });
    }

    getLastPrimInfo(): unknown {
        return this.lastPrimInfo;
    }

    /**
     * Show
     */
    show(): void {
        if (this.container) {
            this.container.style.display = 'block';
        }
    }

    /**
     * Hide
     */
    hide(): void {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }

    /**
     * Dispose
     */
    dispose(): void {
        window.removeEventListener('message', this.boundHandleMessage);
        if (this.iframe?.parentNode) {
            this.iframe.parentNode.removeChild(this.iframe);
        }
        this.iframe = null;
        this.isReady = false;
        this.initializationPromise = null;
        this.messageHandlers.clear();
    }
}
