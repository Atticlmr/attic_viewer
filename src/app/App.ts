/**
 * Application main class
 * Refactored from main.js with separated handlers
 */
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
import { ModelConversionController } from '../controllers/ModelConversionController.js';
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
import type { AppFileType, LoadableFileInfo, ViewerModel, VSCodeFileInfo } from '../types/app.js';

type AngleUnit = 'rad' | 'deg';
type SupportedLanguage = 'zh-CN' | 'en-US';

// Expose d3 globally for PanelManager
window.d3 = d3;

// Expose i18n globally
window.i18n = i18n;

/**
 * Main Application Class
 */
export class App {
    // State
    state: AppState;

    // Managers
    sceneManager: SceneManager | null;
    uiController: UIController | null;
    fileHandler: FileHandlerController | null;
    jointControlsUI: JointControlsUI | null;
    panelManager: PanelManager | null;
    modelGraphView: ModelGraphView | null;
    fileTreeView: FileTreeView | null;
    codeEditorManager: CodeEditorManager | null;
    measurementController: MeasurementController | null;
    modelConversionController: ModelConversionController | null;
    usdViewerManager: USDViewerManager | null;
    mujocoSimulationManager: MujocoSimulationManager | null;

    // Handlers
    modelHandler: ModelHandler | null;
    fileHandlerModule: FileHandler | null;
    themeHandler: ThemeHandler | null;
    simulationHandler: SimulationHandler | null;
    canvasHandler: CanvasHandler | null;
    modelTreeHandler: ModelTreeHandler | null;
    usdViewerHandler: USDViewerHandler | null;

    // VSCode file map
    vscodeFileMap: Map<string, VSCodeFileInfo>;
    animationFrameId: number | null;
    disposed: boolean;

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
        this.modelConversionController = null;
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
        this.animationFrameId = null;
        this.disposed = false;
    }

    /**
     * Load model from VSCode extension
     * @param {Object} fileInfo - File info from VSCode {name, path, content, directory}
     */
    async loadModelFromVSCode(fileInfo: VSCodeFileInfo): Promise<void> {
        if (this.fileHandlerModule) {
            await this.fileHandlerModule.handleVSCodeFile(fileInfo);
        }
    }

    /**
     * Detect file type from filename
     */
    detectFileType(filename: string): AppFileType {
        const ext = filename.split('.').pop()?.toLowerCase();
        if (!ext) return 'unknown';
        if (['urdf', 'xacro'].includes(ext)) return 'urdf';
        if (['mjcf', 'xml'].includes(ext)) return 'mjcf';
        if (['usd', 'usda', 'usdc', 'usdz'].includes(ext)) return 'usd';
        if (['obj', 'stl', 'dae', 'gltf', 'glb'].includes(ext)) return 'mesh';
        return 'unknown';
    }

    /**
     * Initialize application
     */
    async init(): Promise<void> {
        try {
            // Initialize internationalization
            i18n.init();

            // Initialize scene manager
            const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
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

            this.fileHandler.onFilesLoaded = (files: LoadableFileInfo[]) => {
                if (this.fileTreeView) {
                    this.fileTreeView.updateFileTree(files, this.fileHandler.getFileMap());
                }
            };

            this.fileHandler.onModelLoaded = async (model: ViewerModel, file: File, isMesh = false, snapshot = null) => {
                await this.handleModelLoaded(model, file, isMesh, snapshot);
            };

            // Initialize joint controls UI
            this.jointControlsUI = new JointControlsUI(this.sceneManager);

            // Initialize model graph view
            this.modelGraphView = new ModelGraphView(this.sceneManager);

            // Initialize file tree view
            this.fileTreeView = new FileTreeView();
            this.fileTreeView.onFileClick = (fileInfo: LoadableFileInfo) => {
                this.handleFileClick(fileInfo);
            };
            this.fileTreeView.onFilesSelected = async (files: File[]) => {
                // Handle selected files directly using fileHandler
                // This preserves webkitRelativePath information
                this.fileHandler.fileMap.clear();
                for (const file of files) {
                    const path = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
                    this.fileHandler.fileMap.set(path, file);
                    if (!file.webkitRelativePath) {
                        this.fileHandler.fileMap.set(file.name, file);
                    }
                }
                const loadableFiles = await this.fileHandler.findAllLoadableFiles(files);
                if (loadableFiles.length > 0) {
                    this.fileHandler.availableModels = loadableFiles;
                    this.fileHandler.onFilesLoaded?.(loadableFiles);
                    const defaultFile = this.fileHandler.getDefaultLoadableFile(loadableFiles);
                    if (defaultFile) {
                        await this.fileHandler.loadFileOrMesh(defaultFile);
                    }
                }
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
                onMujocoToggleSimulate: () => this.handleMujocoToggleSimulate(),
                onReloadFolder: () => this.fileTreeView?.triggerFileLoad(true),
                onOpenConverterDialog: () => this.modelConversionController?.openDialog()
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

            this.codeEditorManager.onReload = async (file: File, skipTreeUpdate = false) => {
                if (skipTreeUpdate) {
                    this.state.setReloading(true);
                }

                try {
                    await this.fileHandler.loadFile(file);
                } finally {
                    this.state.setReloading(false);
                }
            };

            // Save as callback
            this.codeEditorManager.onSaveAs = (newFile: File) => {
                const newFileInfo = {
                    file: newFile,
                    name: newFile.name,
                    type: this.detectFileType(newFile.name),
                    path: newFile.name,
                    category: 'model',
                    ext: newFile.name.split('.').pop()?.toLowerCase() || ''
                } satisfies LoadableFileInfo;

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
            this.modelConversionController = new ModelConversionController(this);
            this.modelConversionController.init();

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
    async handleModelLoaded(model: ViewerModel, file: File, isMesh = false, snapshot: HTMLElement | null = null): Promise<void> {
        // Setup MJCF simulation controls
        this.modelHandler?.setupMJCFSimulationControls(file, model);

        // Handle the model
        await this.modelHandler?.handleModelLoaded(model, file, isMesh);
    }

    /**
     * Handle file click
     */
    handleFileClick(fileInfo: LoadableFileInfo): void {
        if (this.fileHandlerModule) {
            this.fileHandlerModule.handleFileClick(fileInfo);
        }
    }

    /**
     * Handle theme change
     */
    handleThemeChanged(theme: string): void {
        this.themeHandler?.handleThemeChanged(theme);
    }

    /**
     * Handle angle unit change
     */
    handleAngleUnitChanged(unit: AngleUnit): void {
        this.state.setAngleUnit(unit);
        if (this.jointControlsUI) {
            this.jointControlsUI.setAngleUnit(unit);
        }
    }

    /**
     * Handle reset joints button
     */
    handleResetJoints(): void {
        if (this.state.currentModel && this.jointControlsUI) {
            this.jointControlsUI.resetAllJoints(this.state.currentModel);
        }
    }

    /**
     * Handle ignore limits toggle
     */
    handleIgnoreLimitsChanged(ignore: boolean): void {
        if (this.jointControlsUI && this.state.currentModel) {
            this.jointControlsUI.updateAllSliderLimits(this.state.currentModel, ignore);
        }
    }

    /**
     * Handle language change
     */
    handleLanguageChanged(lang: SupportedLanguage): void {
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
    setAxesButtonState(show: boolean): void {
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
    updateEditorButtonVisibility(): void {
        const openEditorBtn = document.getElementById('open-editor-btn');
        if (openEditorBtn) {
            openEditorBtn.classList.add('visible');
        }
    }

    /**
     * Handle MuJoCo reset
     */
    handleMujocoReset(): void {
        this.simulationHandler?.handleMujocoReset();
    }

    /**
     * Handle MuJoCo simulation toggle
     */
    async handleMujocoToggleSimulate(): Promise<boolean | undefined> {
        return await this.simulationHandler?.handleMujocoToggleSimulate();
    }

    /**
     * Animation loop
     */
    animate(time = performance.now()): void {
        if (this.disposed) return;
        this.animationFrameId = requestAnimationFrame(nextTime => this.animate(nextTime));
        if (this.sceneManager) {
            this.sceneManager.update();

            if (this.mujocoSimulationManager?.isSimulationRunning()) {
                this.mujocoSimulationManager.update(time);
                this.sceneManager.redraw();
            }

            this.sceneManager.renderIfNeeded();
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.fileTreeView?.dispose();
        this.usdViewerManager?.dispose();
        this.mujocoSimulationManager?.clearScene();
        this.sceneManager?.dispose();
    }
}
