/**
 * Canvas Handler - Handles canvas click events
 */
import * as THREE from 'three';
import * as d3 from 'd3';
import type { App } from '../App.js';

export class CanvasHandler {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Setup canvas click handler
     */
    setupCanvasClickHandler(canvas: HTMLCanvasElement): void {
        let mouseDownPos: { x: number; y: number; } | null = null;
        let mouseDownTime = 0;

        canvas.addEventListener('mousedown', (event: MouseEvent) => {
            if (event.button === 0) {
                mouseDownPos = { x: event.clientX, y: event.clientY };
                mouseDownTime = Date.now();
            }
        }, true);

        canvas.addEventListener('mouseup', (event: MouseEvent) => {
            if (event.button !== 0 || !this.app.sceneManager || !mouseDownPos) return;

            const dx = event.clientX - mouseDownPos.x;
            const dy = event.clientY - mouseDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const duration = Date.now() - mouseDownTime;

            if (distance < 5 && duration < 300) {
                this.handleCanvasClick(canvas, event);
            }

            mouseDownPos = null;
        }, true);
    }

    /**
     * Handle canvas click
     */
    handleCanvasClick(canvas: HTMLCanvasElement, event: MouseEvent): void {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const rect = canvas.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, this.app.sceneManager.camera);
        const intersects = raycaster.intersectObjects(this.app.sceneManager.scene.children, true);

        const modelIntersects = intersects.filter(intersect => {
            const obj = intersect.object;
            let current = obj;
            while (current) {
                const name = current.name || '';
                if (name.includes('jointAxis') || name.includes('helper') ||
                    name.includes('grid') || name.includes('Ground') ||
                    name === 'groundPlane') {
                    return false;
                }
                current = current.parent;
            }
            return obj instanceof THREE.Mesh && obj.visible;
        });

        if (modelIntersects.length === 0) {
            this.app.sceneManager.highlightManager.clearHighlight();

            // Clear selection in graph
            if (this.app.modelGraphView) {
                const svg = d3.select<SVGSVGElement, unknown>('#model-graph-svg');
                this.app.modelGraphView.clearAllSelections(svg);
            }

            // Clear measurement state
            if (this.app.measurementController) {
                this.app.measurementController.clearMeasurement();
            }
        }
    }
}
