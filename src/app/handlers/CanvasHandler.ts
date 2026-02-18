/**
 * Canvas Handler - Handles canvas click events
 */
export class CanvasHandler {
    constructor(app) {
        this.app = app;
    }

    /**
     * Setup canvas click handler
     */
    setupCanvasClickHandler(canvas) {
        let mouseDownPos = null;
        let mouseDownTime = 0;

        canvas.addEventListener('mousedown', (event) => {
            if (event.button === 0) {
                mouseDownPos = { x: event.clientX, y: event.clientY };
                mouseDownTime = Date.now();
            }
        }, true);

        canvas.addEventListener('mouseup', (event) => {
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
    handleCanvasClick(canvas, event) {
        // Dynamically import THREE to avoid issues in test environment
        const THREE = window.THREE || require('three');
        if (!THREE) return;

        const Raycaster = THREE.Raycaster || window.THREE?.Raycaster;
        if (!Raycaster) return;

        const raycaster = new Raycaster();
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
            return obj.isMesh && obj.visible;
        });

        if (modelIntersects.length === 0) {
            this.app.sceneManager.highlightManager.clearHighlight();

            // Clear selection in graph
            if (this.app.modelGraphView) {
                const svg = d3.select('#model-graph-svg');
                this.app.modelGraphView.clearAllSelections(svg);
            }

            // Clear measurement state
            if (this.app.measurementController) {
                this.app.measurementController.clearMeasurement();
            }
        }
    }
}
