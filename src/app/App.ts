/**
 * Application main class
 * Refactored from main.js with separated handlers
 */
import * as THREE from 'three';
import * as d3 from 'd3';
import { SceneManager } from '../renderer/SceneManager.js';
import { UIController } from '../ui/UIController.js';
import { FileHandler as FileHandlerController } from '../controllers/FileHandler.js';
import { JointControlsUI } from '../ui/JointControlsUI.js';
import { PanelManager } from '../ui/PanelManager.js';
import { ModelGraphView } from '../views/ModelGraphView.js';
import { FileTreeView } from '../views/FileTreeView.js';
import { CodeEditorManager } from '../controllers/CodeEditorManager.js';
import { MeasurementController } from '../controllers/MeasurementController.js';
import { USDViewerManager } from '../renderer/USDViewerManager.js';
import { MujocoSimulationManager } from '../renderer/MujocoSimulationManager.js';
import { i18n } from '../utils/i18n.js';
import { AppState } from './AppState.js';
import { ModelHandler } from './handlers/ModelHandler.js';
import { FileHandler } from './handlers/FileHandler.js';
import { ThemeHandler } from './handlers/ThemeHandler.js';
import { SimulationHandler } from './handlers/SimulationHandler.js';
import { CanvasHandler } from './handlers/CanvasHandler.js';
import { ModelTreeHandler } from './handlers/ModelTreeHandler.js';
import { USDViewerHandler } from './handlers/USDViewerHandler.js';

// Expose d3 globally for PanelManager
window.d3 = d3;

// Expose i18n globally
window.i18n = i18n;

/**
 * Main Application Class
 */
export class App {
    // State
    state: any;

    // Managers
    sceneManager: any;
    uiController: any;
    fileHandler: any;
    jointControlsUI: any;
    panelManager: any;
    modelGraphView: any;
    fileTreeView: any;
    codeEditorManager: any;
    measurementController: any;
    usdViewerManager: any;
    mujocoSimulationManager: any;

    // Handlers
    modelHandler: any;
    fileHandlerModule: any;
    themeHandler: any;
    simulationHandler: any;
    canvasHandler: any;
    modelTreeHandler: any;
    usdViewerHandler: any;

    // VSCode file map
    vscodeFileMap: any;

    constructor() {
        // State
        this.state = new AppState();

        // Managers
        this.sceneManager = null;
        this.uiController = null;
        this.fileHandler = null;
        this.jointControlsUI = null;
        this.panelManager = null;
        this.modelGraphView = null;
        this.fileTreeView = null;
        this.codeEditorManager = null;
        this.measurementController = null;
        this.usdViewerManager = null;
        this.mujocoSimulationManager = null;

        // Handlers
        this.modelHandler = null;
        this.fileHandlerModule = null;
        this.themeHandler = null;
        this.simulationHandler = null;
        this.canvasHandler = null;
        this.modelTreeHandler = null;
        this.usdViewerHandler = null;

        // VSCode file map
        this.vscodeFileMap = new Map();
    }

    /**
     * Load model from VSCode extension
     * @param {Object} fileInfo - File info from VSCode {name, path, content, directory}
     */
    async loadModelFromVSCode(fileInfo) {
        if (this.fileHandlerModule) {
            await this.fileHandlerModule.handleVSCodeFile(fileInfo);
        }
    }

    /**
     * Detect file type from filename
     */
    detectFileType(filename) {
        const ext = filename.split('.').pop().toLowerCase();
        if (['urdf', 'xacro'].includes(ext)) return 'urdf';
        if (['mjcf', 'xml'].includes(ext)) return 'mjcf';
        if (['usd', 'usda', 'usdc', 'usdz'].includes(ext)) return 'usd';
        if (['obj', 'stl', 'dae', 'gltf', 'glb'].includes(ext)) return 'mesh';
        return 'unknown';
    }

    /**
     * Initialize application
     */
    async init() {
        try {
            // Initialize internationalization
            i18n.init();

            // Initialize scene manager
            const canvas = document.getElementById('canvas');
            if (!canvas) {
                console.error('Canvas element not found');
                return;
            }

            this.sceneManager = new SceneManager(canvas);
            window.sceneManager = this.sceneManager;

            // Create USD viewer container
            this.usdViewerHandler = new USDViewerHandler(this);
            this.usdViewerHandler.createUSDViewerContainer();

            // Initialize file handler
            this.fileHandler = new FileHandlerController();
            this.fileHandler.setupFileDrop();

            // Set USD viewer lazy loading
            this.fileHandler.setUSDViewerInitializer(async () => {
                return await this.usdViewerHandler.getUSDViewerManager();
            });

            this.fileHandler.onFilesLoaded = (files) => {
                if (this.fileTreeView) {
                    this.fileTreeView.updateFileTree(files, this.fileHandler.getFileMap());
                }
            };

            this.fileHandler.onModelLoaded = (model, file, isMesh = false, snapshot = null) => {
                this.handleModelLoaded(model, file, isMesh, snapshot);
            };

            // Initialize joint controls UI
            this.jointControlsUI = new JointControlsUI(this.sceneManager);

            // Initialize model graph view
            this.modelGraphView = new ModelGraphView(this.sceneManager);

            // Initialize file tree view
            this.fileTreeView = new FileTreeView();
            this.fileTreeView.onFileClick = (fileInfo) => {
                this.handleFileClick(fileInfo);
            };

            // Initialize file tree with empty state
            this.fileTreeView.updateFileTree([], new Map());

            // Initialize panel manager
            this.panelManager = new PanelManager();
            this.panelManager.initAllPanels();

            // Pass ModelGraphView reference to PanelManager
            if (this.modelGraphView) {
                this.panelManager.setModelGraphView(this.modelGraphView);
            }

            // Initialize UI controller
            this.uiController = new UIController(this.sceneManager);
            this.uiController.setupAll({
                onThemeChanged: (theme) => this.handleThemeChanged(theme),
                onAngleUnitChanged: (unit) => this.handleAngleUnitChanged(unit),
                onIgnoreLimitsChanged: (ignore) => this.handleIgnoreLimitsChanged(ignore),
                onLanguageChanged: (lang) => this.handleLanguageChanged(lang),
                onResetJoints: () => this.handleResetJoints(),
                onMujocoReset: () => this.handleMujocoReset(),
                onMujocoToggleSimulate: () => this.handleMujocoToggleSimulate()
            });

            // Set measurement update callback
            this.sceneManager.onMeasurementUpdate = () => {
                if (this.measurementController) {
                    this.measurementController.updateMeasurement();
                }
            };

            // Setup canvas click handler
            this.canvasHandler = new CanvasHandler(this);
            this.canvasHandler.setupCanvasClickHandler(canvas);

            // Initialize code editor manager
            this.codeEditorManager = new CodeEditorManager();
            this.codeEditorManager.init(this.fileHandler.getFileMap());

            // Set code editor manager to joint controls UI
            if (this.jointControlsUI) {
                this.jointControlsUI.setCodeEditorManager(this.codeEditorManager);
            }

            // Set code editor manager to model graph view
            if (this.modelGraphView) {
                this.modelGraphView.setCodeEditorManager(this.codeEditorManager);
            }

            this.codeEditorManager.onReload = async (file, skipTreeUpdate = false) => {
                if (skipTreeUpdate) {
                    this.state.setReloading(true);
                }

                this.fileHandler.currentModelFile = file;
                await this.fileHandler.loadFile(file);

                this.state.setReloading(false);
            };

            // Save as callback
            this.codeEditorManager.onSaveAs = (newFile) => {
                const newFileInfo = {
                    file: newFile,
                    name: newFile.name,
                    type: this.detectFileType(newFile.name),
                    path: newFile.name,
                    category: 'model',
                    ext: newFile.name.split('.').pop().toLowerCase()
                };

                const models = this.fileHandler.getAvailableModels();
                if (!models.find(m => m.name === newFile.name)) {
                    models.push(newFileInfo);
                }

                if (this.fileTreeView) {
                    this.fileTreeView.updateFileTree(
                        models,
                        this.fileHandler.getFileMap(),
                        true
                    );
                    setTimeout(() => {
                        this.fileTreeView.markActiveFile(newFile);
                    }, 100);
                }
            };

            // Initialize measurement controller
            this.measurementController = new MeasurementController(this.sceneManager);

            if (this.modelGraphView) {
                this.modelGraphView.setMeasurementController(this.measurementController);
            }

            // Initialize MuJoCo simulation manager
            this.mujocoSimulationManager = new MujocoSimulationManager(this.sceneManager);

            // Initialize handlers
            this.modelHandler = new ModelHandler(this);
            this.fileHandlerModule = new FileHandler(this);
            this.themeHandler = new ThemeHandler(this);
            this.simulationHandler = new SimulationHandler(this);
            this.modelTreeHandler = new ModelTreeHandler(this);

            // Setup model tree panel
            this.modelTreeHandler.setupModelTreePanel();

            // Update editor button visibility
            this.updateEditorButtonVisibility();

            // Start render loop
            this.animate();

        } catch (error) {
            console.error('Initialization error:', error);
        }
    }

    /**
     * Handle model loaded
     */
    async handleModelLoaded(model, file, isMesh = false, snapshot = null) {
        // Setup MJCF simulation controls
        this.modelHandler.setupMJCFSimulationControls(file, model);

        // Handle the model
        await this.modelHandler.handleModelLoaded(model, file, isMesh);
    }

    /**
     * Handle file click
     */
    handleFileClick(fileInfo) {
        if (this.fileHandlerModule) {
            this.fileHandlerModule.handleFileClick(fileInfo);
        }
    }

    /**
     * Handle theme change
     */
    handleThemeChanged(theme) {
        this.themeHandler.handleThemeChanged(theme);
    }

    /**
     * Handle angle unit change
     */
    handleAngleUnitChanged(unit) {
        this.state.setAngleUnit(unit);
        if (this.jointControlsUI) {
            this.jointControlsUI.setAngleUnit(unit);
        }
    }

    /**
     * Handle reset joints button
     */
    handleResetJoints() {
        if (this.state.currentModel && this.jointControlsUI) {
            this.jointControlsUI.resetAllJoints(this.state.currentModel);
        }
    }

    /**
     * Handle ignore limits toggle
     */
    handleIgnoreLimitsChanged(ignore) {
        if (this.jointControlsUI && this.state.currentModel) {
            this.jointControlsUI.updateAllSliderLimits(this.state.currentModel, ignore);
        }
    }

    /**
     * Handle language change
     */
    handleLanguageChanged(lang) {
        i18n.setLanguage(lang);

        if (this.codeEditorManager) {
            this.codeEditorManager.updateEditorSaveStatus();
        }

        if (this.state.currentModel && this.jointControlsUI) {
            this.jointControlsUI.setupJointControls(this.state.currentModel);
        }

        if (this.state.currentModel && this.modelGraphView) {
            this.modelGraphView.drawModelGraph(this.state.currentModel);
        }

        if (this.fileTreeView && this.fileHandler) {
            this.fileTreeView.updateFileTree(
                this.fileHandler.getAvailableModels(),
                this.fileHandler.getFileMap(),
                true
            );
        }

        const simulateBtn = document.getElementById('mujoco-simulate-btn-bar');
        if (simulateBtn) {
            const span = simulateBtn.querySelector('span');
            if (span) {
                const isActive = simulateBtn.classList.contains('active');
                const key = isActive ? 'mujocoPause' : 'mujocoSimulate';
                span.textContent = i18n.t(key);
                span.setAttribute('data-i18n', key);
            }
        }
    }

    /**
     * Set axes button state
     */
    setAxesButtonState(show) {
        const axesBtn = document.getElementById('toggle-axes-btn');
        if (!axesBtn) return;

        axesBtn.setAttribute('data-checked', show.toString());
        if (show) {
            axesBtn.classList.add('active');
            if (this.sceneManager) {
                this.sceneManager.axesManager.showAllAxes();
            }
        } else {
            axesBtn.classList.remove('active');
            if (this.sceneManager) {
                this.sceneManager.axesManager.hideAllAxes();
            }
        }
    }

    /**
     * Update editor button visibility
     */
    updateEditorButtonVisibility() {
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (openEditorBtn) {
            openEditorBtn.classList.add('visible');
        }
    }

    /**
     * Handle MuJoCo reset
     */
    handleMujocoReset() {
        this.simulationHandler.handleMujocoReset();
    }

    /**
     * Handle MuJoCo simulation toggle
     */
    async handleMujocoToggleSimulate() {
        return await this.simulationHandler.handleMujocoToggleSimulate();
    }

    /**
     * Animation loop
     */
    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.sceneManager) {
            this.sceneManager.update();

            if (this.mujocoSimulationManager && this.mujocoSimulationManager.hasScene()) {
                this.mujocoSimulationManager.update(performance.now());
            }

            this.sceneManager.render();
        }
    }
}
