/**
 * FileHandler - File handling module
 * Handles file drag-drop, loading, type detection, etc.
 */
import * as THREE from 'three';
import { ModelLoaderFactory } from '../loaders/ModelLoaderFactory.js';
import {
    readFileContent,
    getFileFromEntry,
    getFileTypeFromExtension,
    type FileSystemDirectoryEntryLike,
    type FileSystemEntryLike,
    type FileSystemFileEntryLike
} from '../utils/FileUtils.js';
import type { AppFileType, FileWithPath, LoadableFileInfo, ViewerModel } from '../types/app.js';
import type { USDViewerManager } from '../renderer/USDViewerManager.js';
import { GeometryType, Link, UnifiedRobotModel, VisualGeometry } from '../models/UnifiedRobotModel.js';
import { disposeViewerModel } from '../utils/ThreeDisposal.js';

type ModelLoadedCallback = (model: ViewerModel, file: File, isMesh?: boolean, snapshot?: HTMLElement | null) => void | Promise<void>;
type FilesLoadedCallback = (files: LoadableFileInfo[]) => void;

export class FileHandler {
    fileMap: Map<string, File>;
    availableModels: LoadableFileInfo[];
    currentModelFile: File | null;
    onModelLoaded: ModelLoadedCallback | null;
    onFilesLoaded: FilesLoadedCallback | null;
    usdViewerManager: USDViewerManager | null;
    usdViewerInitializer: (() => Promise<USDViewerManager>) | null;
    loadGeneration: number;

    constructor() {
        this.fileMap = new Map();
        this.availableModels = [];
        this.currentModelFile = null;
        this.onModelLoaded = null; // Callback function
        this.onFilesLoaded = null; // Callback for when files are loaded
        this.usdViewerManager = null; // USD viewer manager (lazy loaded)
        this.usdViewerInitializer = null;
        this.loadGeneration = 0;
    }

    beginLoad(file: File): number {
        this.currentModelFile = file;
        this.loadGeneration += 1;
        return this.loadGeneration;
    }

    isCurrentLoad(loadGeneration: number): boolean {
        return loadGeneration === this.loadGeneration;
    }

    disposeStaleModel(model: ViewerModel): void {
        const envMap = window.app?.sceneManager?.environmentManager?.getEnvironmentMap?.();
        disposeViewerModel(model, envMap ? new Set([envMap]) : undefined);
    }

    /**
     * Set USD viewer manager
     */
    setUSDViewerManager(manager: USDViewerManager): void {
        this.usdViewerManager = manager;
    }

    /**
     * Set USD viewer initializer callback (for lazy loading)
     */
    setUSDViewerInitializer(initializer: () => Promise<USDViewerManager>): void {
        this.usdViewerInitializer = initializer;
    }

    /**
     * Normalize FileSystemEntry paths without duplicating recursive base paths.
     */
    normalizeEntryPath(entry: FileSystemEntryLike, basePath = ''): string {
        const entryPath = (entry.fullPath || entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
        if (entry.fullPath) {
            return entryPath;
        }

        return basePath
            ? `${basePath.replace(/\/+$/, '')}/${entryPath}`
            : entryPath;
    }

    /**
     * Pick the most likely root model when a folder contains multiple loadable files.
     */
    getDefaultLoadableFile(loadableFiles: LoadableFileInfo[]): LoadableFileInfo | null {
        if (loadableFiles.length === 0) {
            return null;
        }

        const score = (fileInfo: LoadableFileInfo): number => {
            const path = fileInfo.path.replace(/\\/g, '/').toLowerCase();
            const name = fileInfo.name.toLowerCase();
            let value = 0;

            if (fileInfo.category === 'model') value += 1000;
            if (['urdf', 'xacro', 'mjcf'].includes(fileInfo.type)) value += 300;
            if (fileInfo.type === 'usd') value += 200;
            if (fileInfo.category === 'mesh') value += 50;

            if (['urdf', 'xacro', 'xml', 'usda', 'usd', 'usdc', 'usdz'].includes(fileInfo.ext)) value += 20;
            if (name === 'robot.urdf' || name === 'model.urdf') value += 120;
            if (name === 'scene.usd' || name === 'scene.usda' || name === 'root.usd' || name === 'root.usda') value += 100;
            if (fileInfo.type === 'usd') {
                const segments = path.split('/');
                const parentName = segments.length > 1 ? segments[segments.length - 2] : '';
                const stem = name.replace(/\.(usd|usda|usdc|usdz)$/i, '');

                if (stem && parentName && stem === parentName.toLowerCase()) value += 180;
                if (path.includes('/configuration/')) value -= 120;
            }
            if (name.includes('robot') || name.includes('model')) value += 60;
            if (name.includes('scene') || name.includes('root')) value += 40;

            if (path.includes('/.thumbs/') || path.includes('/thumbs/') || path.includes('/thumbnail')) value -= 500;
            if (path.includes('/props/') || path.includes('/materials/') || path.includes('/textures/')) value -= 250;
            if (path.includes('/meshes/') || path.includes('/mesh/')) value -= 120;

            // Prefer shallower files; nested USD assets are often references, not the root stage.
            value -= path.split('/').length * 5;

            return value;
        };

        return loadableFiles.slice().sort((a, b) => {
            const scoreDiff = score(b) - score(a);
            if (scoreDiff !== 0) return scoreDiff;
            return a.name.localeCompare(b.name);
        })[0];
    }

    /**
     * Setup file drag-drop
     */
    setupFileDrop(): void {
        const body = document.body;

        const preventDefaults = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
        };

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            body.addEventListener(eventName, preventDefaults, false);
        });

        let dragCounter = 0;
        body.addEventListener('dragenter', () => {
            dragCounter++;
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) dropZone.classList.add('drag-over');
        }, false);

        body.addEventListener('dragleave', () => {
            dragCounter--;
            if (dragCounter === 0) {
                const dropZone = document.getElementById('drop-zone');
                if (dropZone) dropZone.classList.remove('drag-over');
            }
        }, false);

        body.addEventListener('drop', (e: DragEvent) => {
            dragCounter = 0;
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) dropZone.classList.remove('drag-over');
            void this.handleDrop(e);
        }, false);
    }


    /**
     * Handle file drop
     */
    async handleDrop(e: DragEvent): Promise<void> {
        const items = e.dataTransfer?.items;
        if (!items || items.length === 0) return;

        this.fileMap.clear();

        const entries: FileSystemEntryLike[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.webkitGetAsEntry) {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    entries.push(entry);
                }
            }
        }

        if (entries.length > 0) {
            await this.processEntries(entries);
        } else {
            const files = e.dataTransfer?.files;
            if (!files) {
                return;
            }
            if (files.length > 0) {
                for (const file of files) {
                    // Convert backslash to forward slash for cross-platform compatibility
                    const path = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
                    this.fileMap.set(path, file);
                    // Only add file.name as a separate key if there's no webkitRelativePath
                    // This prevents duplicate entries in the file tree
                    if (!file.webkitRelativePath) {
                        this.fileMap.set(file.name, file);
                    }
                }

                const loadableFiles = await this.findAllLoadableFiles(Array.from(files));

                if (loadableFiles.length > 0) {
                    this.availableModels = loadableFiles;
                    this.onFilesLoaded?.(loadableFiles);
                    const defaultFile = this.getDefaultLoadableFile(loadableFiles);
                    if (defaultFile) {
                        await this.loadFileOrMesh(defaultFile);
                    }
                }
            }
        }
    }

    /**
     * Process file system entries
     */
    async processEntries(entries: FileSystemEntryLike[], basePath = ''): Promise<void> {
        const files: FileWithPath[] = [];

        for (const entry of entries) {
            if (entry.isFile) {
                const file = await getFileFromEntry(entry as FileSystemFileEntryLike);
                const normalizedPath = this.normalizeEntryPath(entry, basePath);
                this.fileMap.set(normalizedPath, file);
                files.push({ file, path: normalizedPath });
            } else if (entry.isDirectory) {
                const normalizedDirPath = this.normalizeEntryPath(entry, basePath);
                const dirFiles = await this.readDirectory(entry as FileSystemDirectoryEntryLike, normalizedDirPath);
                files.push(...dirFiles);
            }
        }

        if (files.length === 0) return;

        const loadableFiles = await this.findAllLoadableFiles(files);

        if (loadableFiles.length === 0) {
            this.onFilesLoaded?.([]);
            return;
        }

        this.availableModels = loadableFiles;
        this.onFilesLoaded?.(loadableFiles);

        if (loadableFiles.length > 0) {
            const defaultFile = this.getDefaultLoadableFile(loadableFiles);
            if (defaultFile) {
                await this.loadFileOrMesh(defaultFile);
            }
        }
    }

    /**
     * Recursively read directory
     */
    async readDirectory(dirEntry: FileSystemDirectoryEntryLike, basePath = ''): Promise<FileWithPath[]> {
        const files: FileWithPath[] = [];

        return new Promise((resolve, reject) => {
            const reader = dirEntry.createReader();

            const readEntries = () => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }

                    for (const entry of entries) {
                        if (entry.isFile) {
                            const file = await getFileFromEntry(entry as FileSystemFileEntryLike);
                            // Normalize path to prevent duplicates and ensure consistency
                            const normalizedPath = this.normalizeEntryPath(entry, basePath);
                            
                            // Check for duplicates before adding
                            if (!this.fileMap.has(normalizedPath)) {
                                this.fileMap.set(normalizedPath, file);
                                files.push({ file, path: normalizedPath });
                            }
                        } else if (entry.isDirectory) {
                            const normalizedDirPath = this.normalizeEntryPath(entry, basePath);
                            const subFiles = await this.readDirectory(entry as FileSystemDirectoryEntryLike, normalizedDirPath);
                            files.push(...subFiles);
                        }
                    }

                    readEntries();
                }, reject);
            };

            readEntries();
        });
    }

    /**
     * Find all loadable files
     * @param files - Array of File objects or {file, path} objects
     */
    async findAllLoadableFiles(files: Array<File | FileWithPath>): Promise<LoadableFileInfo[]> {
        const supportedExtensions = {
            model: ['urdf', 'xacro', 'xml', 'usd', 'usda', 'usdc', 'usdz'],
            mesh: ['dae', 'stl', 'obj', 'collada']
        };
        const loadableFiles: LoadableFileInfo[] = [];

        const checkPromises: Array<Promise<LoadableFileInfo | null>> = files.map(async (fileInput) => {
            // Handle both File objects and {file, path} objects
            const file = fileInput instanceof File ? fileInput : fileInput.file;
            const providedPath = fileInput instanceof File ? undefined : fileInput.path;
            // Convert backslash to forward slash for cross-platform compatibility
            const webkitPath = (file.webkitRelativePath || '').replace(/\\/g, '/');
            const ext = file.name.toLowerCase().split('.').pop();
            if (!ext) {
                return null;
            }

            if (supportedExtensions.model.includes(ext)) {
                if (ext === 'xml') {
                    try {
                        const content = await readFileContent(file);
                        const fileType = ModelLoaderFactory.detectFileType(file.name, content);

                        if (!fileType) {
                            return null;
                        }

                        return {
                            file,
                            name: file.name,
                            type: fileType,
                            path: providedPath || webkitPath || file.name,
                            category: 'model',
                            ext
                        } satisfies LoadableFileInfo;
                    } catch (error) {
                        console.error(`Failed to read XML file: ${file.name}`, error);
                        return null;
                    }
                } else {
                    const fileType = getFileTypeFromExtension(ext);
                    return {
                        file,
                        name: file.name,
                        type: fileType,
                        path: providedPath || webkitPath || file.name,
                        category: 'model',
                        ext
                    } satisfies LoadableFileInfo;
                }
            } else if (supportedExtensions.mesh.includes(ext)) {
                return {
                    file,
                    name: file.name,
                    type: 'mesh',
                    path: providedPath || webkitPath || file.name,
                    category: 'mesh',
                    ext
                } satisfies LoadableFileInfo;
            }

            return null;
        });

        const results = await Promise.all(checkPromises);

        results.forEach(result => {
            if (result) {
                loadableFiles.push(result);
            }
        });

        loadableFiles.sort((a, b) => {
            if (a.category !== b.category) {
                return a.category === 'model' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return loadableFiles;
    }

    /**
     * Load file or mesh
     */
    async loadFileOrMesh(fileInfo: LoadableFileInfo): Promise<void> {
        if (fileInfo.category === 'model') {
            await this.loadFile(fileInfo.file);
        } else if (fileInfo.category === 'mesh') {
            await this.loadMeshAsModel(fileInfo.file, fileInfo.name);
        }
    }

    /**
     * Load model file
     */
    async loadFile(file: File): Promise<void> {
        const loadGeneration = this.beginLoad(file);

        try {
            const fileName = file.name.toLowerCase();

            // Get the full path from fileMap
            let fullPath = file.name;
            for (const [path, f] of this.fileMap.entries()) {
                if (f === file) {
                    fullPath = path;
                    break;
                }
            }

            // Handle USD format files (all USD formats use WASM)
            const isUSD = fileName.endsWith('.usd') || fileName.endsWith('.usda') ||
                         fileName.endsWith('.usdc') || fileName.endsWith('.usdz');
            if (isUSD) {
                // Ensure USD viewer is initialized
                if (!this.usdViewerManager && this.usdViewerInitializer) {
                    try {
                        await this.usdViewerInitializer();
                        if (!this.isCurrentLoad(loadGeneration)) return;
                    } catch (error) {
                        console.error('USD viewer initialization failed:', error);
                        return;
                    }
                }

                if (this.fileMap.size === 0) {
                    this.fileMap.set(file.name, file);
                }

                // USD files need File object passed
                const model = await ModelLoaderFactory.loadModel(
                    'usd',
                    null,
                    fullPath,
                    this.fileMap,
                    file,
                    { usdViewerManager: this.usdViewerManager }
                );

                if (!this.isCurrentLoad(loadGeneration)) {
                    this.disposeStaleModel(model as ViewerModel);
                    return;
                }

                await this.onModelLoaded?.(model as ViewerModel, file, false, null);
                if (!this.isCurrentLoad(loadGeneration)) return;
                document.getElementById('drop-zone')?.classList.remove('show');
                document.getElementById('drop-zone')?.classList.remove('drag-over');
                return;
            }

            // For other files, read text content
            const content = await readFileContent(file);
            if (!this.isCurrentLoad(loadGeneration)) return;

            // Detect if USDC binary format (based on content)
            if (this.isUSDCBinaryContent(content)) {
                console.error('Cannot load USDC binary format, please convert to USDZ or USDA');
                return;
            }

            const fileType = ModelLoaderFactory.detectFileType(file.name, content);

            if (!fileType) {
                console.error(`${window.i18n.t('unsupportedFormat')}: ${file.name}`);
                return;
            }

            if (this.fileMap.size === 0) {
                this.fileMap.set(file.name, file);
            }

            const model = await ModelLoaderFactory.loadModel(
                fileType,
                content,
                fullPath,  // Use full path instead of just file.name
                this.fileMap,
                file,
                { usdViewerManager: this.usdViewerManager }
            );

            if (!this.isCurrentLoad(loadGeneration)) {
                this.disposeStaleModel(model as ViewerModel);
                return;
            }

            // Notify model loaded (pass null as snapshot, let main.js create it)
            await this.onModelLoaded?.(model as ViewerModel, file, false, null);
            if (!this.isCurrentLoad(loadGeneration)) return;

            document.getElementById('drop-zone')?.classList.remove('show');
            document.getElementById('drop-zone')?.classList.remove('drag-over');

        } catch (error) {
            if (!this.isCurrentLoad(loadGeneration)) return;
            console.error('Failed to load file:', error);
            const message = error instanceof Error ? error.message : String(error);

            // If error message contains USDC related content
            if (message.includes('USDC') || message.includes('binary format')) {
                console.error('Cannot load USDC binary format, please convert to USDZ or USDA');
            } else {
                console.error(`${window.i18n.t('loadFailed')}: ${message}`);
            }

            // Remove snapshot if exists
            const snapshot = document.getElementById('canvas-snapshot');
            if (snapshot?.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }
    }

    /**
     * Detect if file content is USDC binary format
     */
    isUSDCBinaryContent(content: string): boolean {
        if (!content || typeof content !== 'string') {
            return false;
        }

        // Detect USDC binary format characteristics
        // 1. Starts with "PXR-USDC" (USDC file magic bytes)
        if (content.startsWith('PXR-USDC')) {
            return true;
        }

        // 2. Check first 100 bytes, if contains many null bytes, likely binary
        const firstBytes = content.substring(0, 100);
        const nullCount = (firstBytes.match(/\x00/g) || []).length;
        if (nullCount > 10) {
            return true;
        }

        // 3. Check if valid ASCII USD file
        // Valid USDA files usually start with #usda or contain def keywords
        if (content.includes('#usda') ||
            (content.includes('def ') && content.includes('{'))) {
            return false;
        }

        // 4. File starts with non-printable characters (excluding newline, carriage return, tab, space)
        const firstChar = content.charCodeAt(0);
        if (firstChar < 32 && firstChar !== 10 && firstChar !== 13 && firstChar !== 9 && firstChar !== 32) {
            return true;
        }

        return false;
    }

    /**
     * Create loading snapshot
     */
    createLoadingSnapshot(): HTMLDivElement | null {
        const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
        if (!canvas) return null;

        try {
            const dataURL = canvas.toDataURL('image/png');
            const snapshot = document.createElement('div');
            snapshot.id = 'canvas-snapshot';
            snapshot.style.cssText = `
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
                canvasContainer.appendChild(snapshot);
            }

            return snapshot;
        } catch (error) {
            console.error('Failed to create snapshot:', error);
            return null;
        }
    }

    /**
     * Remove loading snapshot
     */
    removeLoadingSnapshot(snapshot: HTMLElement | null): void {
        if (!snapshot || !snapshot.parentNode) return;

        snapshot.style.transition = 'opacity 0.3s ease';
        snapshot.style.opacity = '0';

        setTimeout(() => {
            if (snapshot.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }, 300);
    }

    /**
     * Load single mesh file as model
     */
    async loadMeshAsModel(file: File, fileName: string): Promise<void> {
        const loadGeneration = this.beginLoad(file);
        try {
            const meshObject = await ModelLoaderFactory.loadMeshFileDirect(file, fileName);

            if (!meshObject) {
                throw new Error(window.i18n.t('cannotLoadMesh'));
            }

            if (!this.isCurrentLoad(loadGeneration)) {
                disposeViewerModel({ threeObject: meshObject });
                return;
            }

            // Ensure mesh materials support lighting and shadows
            meshObject.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    if (child.material?.type === 'MeshBasicMaterial') {
                        const oldMaterial = child.material;
                        child.material = new THREE.MeshPhongMaterial({
                            color: oldMaterial.color,
                            map: oldMaterial.map,
                            transparent: oldMaterial.transparent,
                            opacity: oldMaterial.opacity,
                            side: oldMaterial.side,
                            shininess: 30
                        });
                        oldMaterial.dispose();
                        if (child.material.map) {
                            child.material.map.colorSpace = THREE.SRGBColorSpace;
                        }
                    }
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            const simpleMeshModel: ViewerModel = new UnifiedRobotModel();
            simpleMeshModel.name = fileName;
            simpleMeshModel.rootLink = 'mesh_root';
            simpleMeshModel.threeObject = meshObject;

            const meshLink = new Link('mesh_root');
            meshLink.threeObject = meshObject;

            const visual = new VisualGeometry();
            visual.threeObject = meshObject;
            visual.geometry = new GeometryType('mesh');
            visual.geometry.filename = fileName;
            meshLink.visuals.push(visual);

            simpleMeshModel.links.set(meshLink.name, meshLink);

            if (!this.isCurrentLoad(loadGeneration)) {
                this.disposeStaleModel(simpleMeshModel);
                return;
            }

            await this.onModelLoaded?.(simpleMeshModel, file, true, null);

        } catch (error) {
            if (!this.isCurrentLoad(loadGeneration)) return;
            console.error('Failed to load mesh file:', error);

            const snapshot = document.getElementById('canvas-snapshot');
            if (snapshot?.parentNode) {
                snapshot.parentNode.removeChild(snapshot);
            }
        }
    }

    /**
     * Get file map
     */
    getFileMap(): Map<string, File> {
        return this.fileMap;
    }

    /**
     * Get available models list
     */
    getAvailableModels(): LoadableFileInfo[] {
        return this.availableModels;
    }

    /**
     * Get current model file
     */
    getCurrentModelFile(): File | null {
        return this.currentModelFile;
    }
}
