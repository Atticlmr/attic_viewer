/**
 * Model Handler - Handles model loading and UI updates
 */
import * as d3 from 'd3';

export class ModelHandler {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Check if file is MJCF format
     */
    isMJCF(file, model) {
        const fileExt = file.name.split('.').pop().toLowerCase();
        return fileExt === 'xml' && model?.userData?.type === 'mjcf';
    }

    /**
     * Setup MJCF simulation controls visibility
     */
    setupMJCFSimulationControls(file, model) {
        const isMJCF = this.isMJCF(file, model);

        const simulationBar = document.getElementById('mujoco-simulation-bar');
        const resetBtn = document.getElementById('mujoco-reset-btn-bar');
        const simulateBtn = document.getElementById('mujoco-simulate-btn-bar');

        if (isMJCF && model.joints && model.joints.size > 0) {
            this.app.state.currentMJCFFile = file;
            this.app.state.currentMJCFModel = model;
            this.showSimulationBar(simulationBar, resetBtn, simulateBtn);
        } else {
            this.hideSimulationBar(simulationBar);
            this.app.state.currentMJCFFile = null;
            this.app.state.currentMJCFModel = null;
        }
    }

    /**
     * Show simulation control bar
     */
    showSimulationBar(simulationBar, resetBtn, simulateBtn) {
        if (simulationBar) {
            simulationBar.style.display = 'flex';
        }

        if (resetBtn) {
            resetBtn.disabled = false;
            resetBtn.style.opacity = '1';
            resetBtn.style.cursor = 'pointer';
            const resetSpan = resetBtn.querySelector('span');
            if (resetSpan) {
                resetSpan.textContent = window.i18n?.t('mujocoReset') || 'Reset';
            }
        }

        if (simulateBtn) {
            simulateBtn.disabled = false;
            simulateBtn.style.opacity = '1';
            simulateBtn.style.cursor = 'pointer';
            simulateBtn.classList.remove('active');
            const span = simulateBtn.querySelector('span');
            if (span) {
                span.textContent = window.i18n?.t('mujocoSimulate') || 'Simulate';
            }
        }
    }

    /**
     * Hide simulation control bar
     */
    hideSimulationBar(simulationBar) {
        if (simulationBar) {
            simulationBar.style.display = 'none';
        }
    }

    /**
     * Handle USD WASM model
     */
    handleUSDWASMModel(model, file) {
        const canvas = document.getElementById('canvas');
        const usdContainer = document.getElementById('usd-viewer-container');

        if (canvas && usdContainer) {
            canvas.style.display = 'none';
            usdContainer.style.display = 'block';
        }

        this.hideJointControls();
        this.hideGraphPanel();

        this.app.state.currentModel = model;
        this.updateModelInfo(model, file);

        const snapshot = document.getElementById('canvas-snapshot');
        if (snapshot?.parentNode) {
            snapshot.parentNode.removeChild(snapshot);
        }

        return true;
    }

    /**
     * Hide joint controls panel
     */
    hideJointControls() {
        const jointPanel = document.getElementById('joint-controls-panel');
        if (jointPanel) {
            jointPanel.style.display = 'none';
        }
    }

    /**
     * Hide graph panel
     */
    hideGraphPanel() {
        const graphPanel = document.getElementById('graph-panel');
        if (graphPanel) {
            graphPanel.style.display = 'none';
        }
    }

    /**
     * Restore joint controls and graph display
     */
    restorePanels() {
        const jointPanel = document.getElementById('joint-controls-panel');
        const graphPanel = document.getElementById('graph-panel');
        if (jointPanel) jointPanel.style.display = '';
        if (graphPanel) graphPanel.style.display = '';
    }

    /**
     * Setup regular model (non-USD)
     */
    async setupRegularModel(model, file, isMesh) {
        // Clear simulation if any
        if (this.app.mujocoSimulationManager?.hasScene()) {
            this.app.mujocoSimulationManager.clearScene();
        }

        // Hide USD viewer, show canvas
        this.showCanvas();

        // Clear USD viewer if running
        if (this.app.usdViewerManager) {
            this.app.usdViewerManager.clear();
            this.app.usdViewerManager.hide();
        }

        // Restore panels
        this.restorePanels();

        // Clear old model
        if (this.app.state.currentModel) {
            this.app.sceneManager.removeModel(this.app.state.currentModel);
            this.app.state.currentModel = null;
        }

        this.app.state.currentModel = model;

        // Force render
        this.app.sceneManager.redraw();
        this.app.sceneManager.render();

        // Create loading snapshot
        await this.createLoadingSnapshot();

        // Add model to scene
        this.app.sceneManager.addModel(model);

        // Hide drop zone
        this.hideDropZone();

        // Setup based on model type
        if (!isMesh) {
            this.setupRobotModel(model);
        } else {
            await this.setupMeshModel(model);
        }

        // Update file tree
        this.updateFileTree(file);

        // Auto-open editor for robot models
        if (!this.app.state.isReloading() && !isMesh) {
            this.openEditor(file);
        }

        // Update UI
        this.app.updateEditorButtonVisibility();
        this.updateModelInfo(model, file);
    }

    /**
     * Show canvas, hide USD viewer
     */
    showCanvas() {
        const canvas = document.getElementById('canvas');
        const usdContainer = document.getElementById('usd-viewer-container');
        if (canvas && usdContainer) {
            canvas.style.display = 'block';
            usdContainer.style.display = 'none';
        }
    }

    /**
     * Hide drop zone
     */
    hideDropZone() {
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) {
            dropZone.classList.remove('show');
            dropZone.classList.remove('drag-over');
        }
    }

    /**
     * Setup robot model (URDF, Xacro, MJCF)
     */
    setupRobotModel(model) {
        this.app.sceneManager.setGroundVisible(true);
        this.app.jointControlsUI.setupJointControls(model);

        if (this.app.modelGraphView) {
            this.app.modelGraphView.drawModelGraph(model);
        }

        const graphPanel = document.getElementById('model-graph-panel');
        if (graphPanel) graphPanel.style.display = 'block';

        const jointsPanel = document.getElementById('joints-panel');
        if (jointsPanel) jointsPanel.style.display = 'block';

        // Hide axes by default
        this.app.setAxesButtonState(false);
    }

    /**
     * Setup mesh model
     */
    async setupMeshModel(model) {
        this.app.sceneManager.setGroundVisible(false);

        // Clear graph
        if (this.app.modelGraphView) {
            const svg = d3.select('#model-graph-svg');
            svg.selectAll('*:not(defs)').remove();
            const emptyState = document.getElementById('graph-empty-state');
            if (emptyState) {
                emptyState.classList.remove('hidden');
            }
        }

        const graphPanel = document.getElementById('model-graph-panel');
        if (graphPanel) graphPanel.style.display = 'none';

        // Clear joint controls
        const jointContainer = document.getElementById('joint-controls');
        if (jointContainer) {
            jointContainer.innerHTML = '';
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = window.i18n.t('noModel');
            jointContainer.appendChild(emptyState);
        }

        const jointsPanel = document.getElementById('joints-panel');
        if (jointsPanel) jointsPanel.style.display = 'none';

        // Show axes by default for mesh
        this.app.setAxesButtonState(true);

        // Clear editor
        if (this.app.codeEditorManager) {
            this.app.codeEditorManager.clearEditor();
        }
    }

    /**
     * Create loading snapshot
     */
    async createLoadingSnapshot() {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
        if (!canvas) return null;

        try {
            const dataURL = canvas.toDataURL('image/png');

            const loadingSnapshot = document.createElement('div');
            loadingSnapshot.id = 'canvas-snapshot';
            loadingSnapshot.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-image: url(${dataURL});
                background-size: cover;
                background-position: center;
                background-color: var(--bg-primary);
                background-repeat: no-repeat;
                z-index: 2;
                pointer-events: none;
            `;

            const canvasContainer = document.getElementById('canvas-container');
            if (canvasContainer) {
                canvasContainer.appendChild(loadingSnapshot);
            } else {
                document.body.appendChild(loadingSnapshot);
            }

            // Setup removal logic
            this.setupSnapshotRemoval(loadingSnapshot);

            return loadingSnapshot;
        } catch (error) {
            console.error('Failed to create snapshot:', error);
            return null;
        }
    }

    /**
     * Setup snapshot removal with timeout
     */
    setupSnapshotRemoval(loadingSnapshot) {
        let snapshotRemoving = false;
        const removeSnapshot = () => {
            if (loadingSnapshot && loadingSnapshot.parentNode && !snapshotRemoving) {
                snapshotRemoving = true;
                loadingSnapshot.style.transition = 'opacity 0.3s ease';
                loadingSnapshot.style.opacity = '0';

                setTimeout(() => {
                    if (loadingSnapshot && loadingSnapshot.parentNode) {
                        loadingSnapshot.parentNode.removeChild(loadingSnapshot);
                    }
                }, 300);
            }
        };

        // Safety timeout
        const timeoutId = setTimeout(() => {
            if (loadingSnapshot?.parentNode) {
                console.error('Model loading timeout (5000ms)');
                removeSnapshot();
                this.app.sceneManager.off('modelReady', onModelReady);
            }
        }, 5000);

        const onModelReady = () => {
            clearTimeout(timeoutId);
            removeSnapshot();
            this.app.sceneManager.off('modelReady', onModelReady);
        };

        this.app.sceneManager.on('modelReady', onModelReady);
    }

    /**
     * Update file tree
     */
    updateFileTree(file) {
        if (this.app.fileTreeView && !this.app.state.isReloading()) {
            this.app.fileTreeView.updateFileTree(
                this.app.fileHandler.getAvailableModels(),
                this.app.fileHandler.getFileMap(),
                true
            );
            this.app.fileTreeView.expandAndScrollToFile(file, this.app.fileHandler.getFileMap());
        }
    }

    /**
     * Open code editor
     */
    openEditor(file) {
        const editorPanel = document.getElementById('code-editor-panel');
        if (editorPanel && this.app.codeEditorManager) {
            editorPanel.classList.add('visible');
            const openEditorBtn = document.getElementById('open-editor-btn');
            if (openEditorBtn) {
                openEditorBtn.classList.add('active');
            }
            this.app.codeEditorManager.loadFile(file);
        }
    }

    /**
     * Update model info display
     */
    updateModelInfo(model, file) {
        const statusInfo = document.getElementById('status-info');
        if (!statusInfo || !model) return;

        let info = `<strong>${file.name}</strong><br>`;

        const fileType = file.name.split('.').pop().toLowerCase();
        info += `Type: ${fileType.toUpperCase()}<br>`;

        if (model.links) {
            info += `Links: ${model.links.size}<br>`;
        }

        if (model.joints) {
            const controllableJoints = Array.from(model.joints.values() as any[])
                .filter((j: any) => j.type !== 'fixed').length;
            info += `Joints: ${model.joints.size} (${controllableJoints} controllable)<br>`;
        }

        // Show constraint info
        if (model.constraints && model.constraints.size > 0) {
            info += `<span style="color: #00aaff; font-weight: bold;">Constraints: ${model.constraints.size}</span><br>`;

            const constraintTypes = {};
            model.constraints.forEach((constraint) => {
                constraintTypes[constraint.type] = (constraintTypes[constraint.type] || 0) + 1;
            });

            const typeLabels = {
                'connect': 'Connect',
                'weld': 'Weld',
                'joint': 'Joint Coupling',
                'distance': 'Distance'
            };

            const typeDetails = Object.entries(constraintTypes)
                .map(([type, count]) => `${typeLabels[type] || type}: ${count}`)
                .join(', ');

            info += `<span style="font-size: 11px; color: #888;">${typeDetails}</span><br>`;
        }

        if (model.rootLink) {
            info += `Root Link: ${model.rootLink}`;
        }

        statusInfo.innerHTML = info;
        statusInfo.className = 'success';
    }

    /**
     * Main handler - handle model loaded
     */
    async handleModelLoaded(model, file, isMesh = false) {
        // Clear simulation
        if (this.app.mujocoSimulationManager?.hasScene()) {
            this.app.mujocoSimulationManager.clearScene();
        }

        // Check if USD WASM model
        if (model?.userData?.isUSDWASM) {
            return this.handleUSDWASMModel(model, file);
        }

        // Regular model
        await this.setupRegularModel(model, file, isMesh);
    }
}
