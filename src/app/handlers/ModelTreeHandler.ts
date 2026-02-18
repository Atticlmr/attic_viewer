/**
 * Model Tree Handler - Handles model tree panel events
 */
import * as d3 from 'd3';

export class ModelTreeHandler {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Setup model tree panel
     */
    setupModelTreePanel() {
        const toggleBtn = document.getElementById('toggle-model-tree');
        const floatingPanel = document.getElementById('floating-model-tree');

        if (toggleBtn && floatingPanel) {
            floatingPanel.style.display = 'flex';
            toggleBtn.classList.add('active');
        }

        if (floatingPanel) {
            // Click blank area to deselect
            floatingPanel.addEventListener('click', (event) => {
                const target = event.target as HTMLElement;

                if (target === floatingPanel ||
                    target.classList?.contains('graph-controls-hint') ||
                    target.classList?.contains('empty-state') ||
                    target.id === 'floating-model-tree') {

                    if (this.app.modelGraphView) {
                        const svg = d3.select('#model-graph-svg');
                        this.app.modelGraphView.clearAllSelections(svg);
                    }

                    if (this.app.measurementController) {
                        this.app.measurementController.clearMeasurement();
                    }

                    if (this.app.sceneManager) {
                        this.app.sceneManager.highlightManager.clearHighlight();
                    }
                }
            });
        }
    }
}
