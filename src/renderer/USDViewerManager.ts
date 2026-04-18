/**
 * USD Viewer Manager
 * Manages USD iframe lifecycle and message communication
 */
type USDViewerMessageType = 'IFRAME_READY' | 'USD_LOADED' | 'USD_LOADING_START' | 'USD_ERROR';

type USDViewerPayload = {
    type: USDViewerMessageType;
    message?: string;
    error?: string;
};

type USDViewerMessageHandler = (event: MessageEvent<USDViewerPayload>) => void;

export class USDViewerManager {
    container: HTMLElement;
    iframe: HTMLIFrameElement | null;
    isReady: boolean;
    messageHandlers: Map<USDViewerMessageType, USDViewerMessageHandler | USDViewerMessageHandler[]>;
    boundHandleMessage: (event: MessageEvent<USDViewerPayload>) => void;

    constructor(container: HTMLElement) {
        this.container = container;
        this.iframe = null;
        this.isReady = false;
        this.messageHandlers = new Map();
        this.boundHandleMessage = this.handleMessage.bind(this);

        window.addEventListener('message', this.boundHandleMessage);
    }

    /**
     * Initialize USD viewer
     */
    async initialize(): Promise<void> {
        if (this.isReady) return;
        if (this.iframe) return; // Already initializing

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('USD viewer initialization timeout'));
            }, 30000);

            // Listen for IFRAME_READY
            const readyHandler: USDViewerMessageHandler = (event) => {
                if (event.data?.type === 'IFRAME_READY') {
                    clearTimeout(timeout);
                    this.messageHandlers.delete('IFRAME_READY');
                    this.isReady = true;
                    resolve(undefined);
                }
            };

            this.messageHandlers.set('IFRAME_READY', readyHandler);

            // Create iframe
            this.iframe = document.createElement('iframe');
            this.iframe.src = '/usd-iframe.html';
            this.iframe.style.cssText = `
                width: 100%;
                height: 100%;
                border: none;
                display: block;
                pointer-events: all;
            `;
            this.container.appendChild(this.iframe);
        });
    }

    /**
     * Handle messages
     */
    handleMessage(event: MessageEvent<USDViewerPayload>): void {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        const validTypes: USDViewerMessageType[] = ['IFRAME_READY', 'USD_LOADED', 'USD_LOADING_START', 'USD_ERROR'];
        if (!validTypes.includes(data.type)) return;

        const handlers = this.messageHandlers.get(data.type);
        if (handlers) {
            if (typeof handlers === 'function') {
                handlers(event);
            } else if (Array.isArray(handlers)) {
                handlers.forEach(h => h(event));
            }
        }
    }

    /**
     * Register message handler
     */
    on(messageType: USDViewerMessageType, handler: USDViewerMessageHandler): void {
        const existing = this.messageHandlers.get(messageType);
        if (!existing) {
            this.messageHandlers.set(messageType, handler);
        } else if (typeof existing === 'function') {
            this.messageHandlers.set(messageType, [existing, handler]);
        } else {
            existing.push(handler);
        }
    }

    /**
     * Send message
     */
    postMessage(type: string, payload: Record<string, unknown> = {}): void {
        if (!this.iframe) return;
        try {
            this.iframe.contentWindow?.postMessage({ type, ...payload }, '*');
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

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Load timeout')), 60000);

            const loadedHandler = () => {
                clearTimeout(timeout);
                this.messageHandlers.delete('USD_LOADED');
                resolve();
            };

            this.on('USD_LOADED', loadedHandler);
            this.postMessage('USD_LOAD_ENTRIES', { entries, primaryPath: file.name });
        });
    }

    /**
     * Load from file map
     */
    async loadFromFilesMap(filesMap: Record<string, File>, primaryPath: string): Promise<void> {
        await this.initialize();

        const entries: Array<{ path: string; buffer: ArrayBuffer; }> = [];
        for (const [path, file] of Object.entries(filesMap)) {
            try {
                const buffer = await file.arrayBuffer();
                entries.push({ path, buffer });
            } catch (error) {
                console.error(`[USDViewerManager] Failed to read: ${path}`, error);
                // Continue processing other files, don't interrupt
            }
        }

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Load timeout')), 60000);

            const loadedHandler = () => {
                clearTimeout(timeout);
                this.messageHandlers.delete('USD_LOADED');
                resolve();
            };

            this.on('USD_LOADED', loadedHandler);
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
        this.messageHandlers.clear();
    }
}
