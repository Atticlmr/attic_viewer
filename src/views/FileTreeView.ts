/**
 * FileTreeView - File tree view
 * Responsible for displaying and managing file tree structure
 */
import type { AppFileType, LoadableFileInfo } from '../types/app.js';

interface FileTreeFileEntry extends LoadableFileInfo {}

interface FileTreeNode {
    __files?: FileTreeFileEntry[];
    [key: string]: FileTreeNode | FileTreeFileEntry[] | undefined;
}

export class FileTreeView {
    availableModels: LoadableFileInfo[];
    onFileClick: ((fileInfo: LoadableFileInfo) => void) | null;
    onFilesSelected: ((files: File[]) => void | Promise<void>) | null;
    private eventListeners: Array<{ element: Element; type: string; handler: EventListener }> = [];

    constructor() {
        this.availableModels = [];
        this.onFileClick = null;
        this.onFilesSelected = null;
    }

    /**
     * Track event listener for cleanup
     */
    private addTrackedEventListener(element: Element, type: string, handler: EventListener): void {
        element.addEventListener(type, handler);
        this.eventListeners.push({ element, type, handler });
    }

    /**
     * Clear all tracked event listeners
     */
    private clearEventListeners(): void {
        this.eventListeners.forEach(({ element, type, handler }) => {
            element.removeEventListener(type, handler);
        });
        this.eventListeners = [];
    }

    /**
     * Update file tree
     */
    updateFileTree(files: LoadableFileInfo[], fileMap: Map<string, File>, preserveState = false): void {
        this.clearEventListeners();
        
        this.availableModels = files;
        const listContainer = document.getElementById('model-list');
        if (!listContainer) return;

        // Save expanded state
        const expandedPaths = preserveState ? this.saveTreeState() : [];

        listContainer.innerHTML = '';

        if (files.length === 0) {
            this.showLoadButton(listContainer);
            return;
        }

        this.buildFileTree(listContainer, files, fileMap);

        // Restore expanded state
        if (preserveState && expandedPaths.length > 0) {
            setTimeout(() => this.restoreTreeState(expandedPaths), 0);
        }
    }

    /**
     * Show load file/folder button when no files are loaded
     */
    showLoadButton(container: HTMLElement): void {
        const emptyContainer = document.createElement('div');
        emptyContainer.className = 'file-tree-empty-container';
        emptyContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            min-height: 200px;
            padding: 20px;
            gap: 12px;
        `;

        const emptyText = document.createElement('div');
        emptyText.className = 'empty-state';
        emptyText.style.cssText = 'margin: 0; padding: 0; text-align: center; line-height: 1.6;';

        // First line: drag and drop hint
        const line1 = document.createElement('div');
        line1.textContent = window.i18n?.t('dropHint') || 'Drag and drop robot model files or folders anywhere';
        line1.setAttribute('data-i18n', 'dropHint');

        // Second line: or click button
        const line2 = document.createElement('div');
        line2.textContent = window.i18n?.t('orClickButton') || 'or click button to load';
        line2.setAttribute('data-i18n', 'orClickButton');
        line2.style.marginTop = '4px';

        emptyText.appendChild(line1);
        emptyText.appendChild(line2);

        // Create button container for two buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
        `;

        // Load Files Button
        const loadFilesButton = document.createElement('button');
        loadFilesButton.className = 'control-button load-files-btn';
        const loadFilesSpan = document.createElement('span');
        loadFilesSpan.textContent = window.i18n?.t('loadFiles') || 'Load Files';
        loadFilesSpan.setAttribute('data-i18n', 'loadFiles');
        loadFilesButton.appendChild(loadFilesSpan);
        loadFilesButton.style.cssText = `
            padding: 8px 16px;
            font-size: 13px;
            flex: 1;
        `;
        loadFilesButton.title = '选择单个或多个文件';
        this.addTrackedEventListener(loadFilesButton, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.triggerFileLoad(false);
        });

        // Load Folder Button
        const loadFolderButton = document.createElement('button');
        loadFolderButton.className = 'control-button load-folder-btn';
        const loadFolderSpan = document.createElement('span');
        loadFolderSpan.textContent = window.i18n?.t('loadFolder') || 'Load Folder';
        loadFolderSpan.setAttribute('data-i18n', 'loadFolder');
        loadFolderButton.appendChild(loadFolderSpan);
        loadFolderButton.style.cssText = `
            padding: 8px 16px;
            font-size: 13px;
            flex: 1;
        `;
        loadFolderButton.title = '选择整个文件夹';
        this.addTrackedEventListener(loadFolderButton, 'click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.triggerFileLoad(true);
        });

        buttonContainer.appendChild(loadFilesButton);
        buttonContainer.appendChild(loadFolderButton);

        emptyContainer.appendChild(emptyText);
        emptyContainer.appendChild(buttonContainer);
        container.appendChild(emptyContainer);
    }

    /**
     * Trigger file/folder loading dialog
     */
    triggerFileLoad(isFolder = false): void {
        // Create a temporary file input to allow file selection
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.webkitdirectory = isFolder;
        input.style.display = 'none';

        if (!isFolder) {
            input.setAttribute('accept', '.urdf,.xacro,.xml,.dae,.stl,.obj,.collada,.usd,.usda,.usdc,.usdz');
        }

        input.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            const files = Array.from(target.files || []);
            if (files && files.length > 0 && this.onFilesSelected) {
                // Pass files directly to callback instead of simulating drop event
                // This preserves webkitRelativePath information
                this.onFilesSelected(files);
            }
            // Clean up
            document.body.removeChild(input);
        });

        // Add to DOM temporarily and trigger click
        document.body.appendChild(input);
        input.click();
    }

    /**
     * Save file tree state
     */
    saveTreeState(): string[] {
        const expandedPaths: string[] = [];
        document.querySelectorAll('.tree-item.folder:not(.collapsed)').forEach(folder => {
            const nameSpan = folder.querySelector('.name');
            if (nameSpan) {
                expandedPaths.push(nameSpan.textContent);
            }
        });
        return expandedPaths;
    }

    /**
     * Restore file tree state
     */
    restoreTreeState(expandedPaths: string[]): void {
        if (!expandedPaths || expandedPaths.length === 0) return;

        document.querySelectorAll('.tree-item.folder').forEach(folder => {
            const nameSpan = folder.querySelector('.name');
            if (nameSpan && expandedPaths.includes(nameSpan.textContent)) {
                folder.classList.remove('collapsed');
            }
        });
    }

    /**
     * Mark current active file
     */
    markActiveFile(file: File): void {
        document.querySelectorAll('.tree-item.selected').forEach(item => {
            item.classList.remove('selected');
        });

        const allTreeItems = document.querySelectorAll('#model-list .tree-item');
        allTreeItems.forEach(item => {
            const nameSpan = item.querySelector('.name');
            if (nameSpan && nameSpan.textContent === file.name) {
                item.classList.add('selected');
                item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    }

    /**
     * Expand folder containing file and scroll to file position
     */
    expandAndScrollToFile(file: File | null, fileMap: Map<string, File>): void {
        if (!file) return;

        // Find file's full path in fileMap
        let filePath: string | null = null;
        fileMap.forEach((f, path) => {
            if (f === file) {
                filePath = path;
            }
        });

        if (!filePath) {
            return;
        }

        // Get all folders in path
        const pathParts = filePath.split('/').filter(p => p);
        const folderPaths: string[] = [];

        // Build folder paths for each level
        for (let i = 0; i < pathParts.length - 1; i++) {
            folderPaths.push(pathParts[i]);
        }


        // Expand all parent folders
        const allFolders = document.querySelectorAll('#model-list .tree-item.folder');
        allFolders.forEach(folder => {
            const nameSpan = folder.querySelector('.name');
            if (nameSpan && folderPaths.includes(nameSpan.textContent)) {
                folder.classList.remove('collapsed');
            }
        });

        // Delay scrolling to ensure DOM is updated
        setTimeout(() => {
            const allTreeItems = document.querySelectorAll('#model-list .tree-item');
            let targetItem: Element | null = null;

            allTreeItems.forEach(item => {
                const nameSpan = item.querySelector('.name');
                if (nameSpan && nameSpan.textContent === file.name) {
                    const parent = item.parentElement;
                    if (parent) {
                        targetItem = item;
                    }
                }
            });

            if (targetItem) {
                targetItem.classList.add('selected');
                targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 100);
    }

    /**
     * Check if XML file is a model file (URDF/MJCF)
     */
    isModelXML(fileName: string): boolean {
        const lowerName = fileName.toLowerCase();
        // Exclude common non-model XML files
        const excludePatterns = ['package', 'launch', 'config', 'scene', 'ros'];
        return !excludePatterns.some(pattern => lowerName.includes(pattern));
    }

    /**
     * Build file tree
     */
    buildFileTree(container: HTMLElement, _files: LoadableFileInfo[], fileMap: Map<string, File>): void {
        const fileStructure: FileTreeNode = {};

        fileMap.forEach((file, path) => {
            const ext = file.name.split('.').pop()?.toLowerCase();
            const supportedExtensions = ['urdf', 'xacro', 'xml', 'dae', 'stl', 'obj', 'collada', 'usd', 'usda', 'usdc'];

            if (!ext) return;
            if (!supportedExtensions.includes(ext)) return;

            // If XML file, check if it's a model file
            if (ext === 'xml' && !this.isModelXML(file.name)) {
                return;
            }

            const parts = path.split('/').filter(p => p);
            let current: FileTreeNode = fileStructure;

            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    if (!current.__files) current.__files = [];
                    current.__files.push({
                        name: part,
                        file,
                        path,
                        ext,
                        type: mapExtensionToFileType(ext),
                        category: isModelExtension(ext) ? 'model' : 'mesh'
                    });
                } else {
                    if (!current[part] || Array.isArray(current[part])) {
                        current[part] = {};
                    }
                    current = current[part] as FileTreeNode;
                }
            });
        });

        this.renderFileTreeStructure(fileStructure, container);
    }

    /**
     * Render file tree structure
     */
    renderFileTreeStructure(structure: FileTreeNode, container: HTMLElement): void {
        const folders: string[] = [];
        const files: FileTreeFileEntry[] = [];

        Object.keys(structure).forEach(key => {
            if (key === '__files') {
                const fileEntries = structure[key];
                if (Array.isArray(fileEntries)) {
                    files.push(...fileEntries);
                }
            } else {
                folders.push(key);
            }
        });

        folders.sort().forEach(folderName => {
            const folder = this.createTreeFolder(folderName);
            const folderChildren = folder.querySelector('.tree-children');
            if (folderChildren && !Array.isArray(structure[folderName])) {
                this.renderFileTreeStructure((structure[folderName] as FileTreeNode) || {}, folderChildren as HTMLElement);
            }
            container.appendChild(folder);
        });

        if (files.length > 0) {
            this.renderFiles(files, container);
        }
    }

    /**
     * Create folder node
     */
    createTreeFolder(name: string): HTMLDivElement {
        const folder = document.createElement('div');
        folder.className = 'tree-item folder collapsed';

        const header = document.createElement('div');
        header.className = 'tree-item-header';

        const leftContent = document.createElement('div');
        leftContent.className = 'tree-item-left';

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';

        const icon = document.createElement('span');
        icon.className = 'icon';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = name;

        leftContent.appendChild(arrow);
        leftContent.appendChild(icon);
        leftContent.appendChild(nameSpan);
        header.appendChild(leftContent);

        const children = document.createElement('div');
        children.className = 'tree-children';

        folder.appendChild(header);
        folder.appendChild(children);

        header.addEventListener('click', (e) => {
            e.stopPropagation();
            folder.classList.toggle('collapsed');
        });

        return folder;
    }

    /**
     * Render file list
     */
    renderFiles(files: FileTreeFileEntry[], container: HTMLElement): void {
        files.sort((a, b) => {
            const modelExts = ['urdf', 'xacro', 'xml', 'usd', 'usda', 'usdc'];
            const aIsModel = modelExts.includes(a.ext);
            const bIsModel = modelExts.includes(b.ext);

            if (aIsModel && !bIsModel) return -1;
            if (!aIsModel && bIsModel) return 1;
            return a.name.localeCompare(b.name);
        });

        files.forEach(fileInfo => {
            const item = this.createTreeItem(fileInfo.name, fileInfo.ext);
            const clickHandler: EventListener = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.tree-item.selected').forEach(elem => {
                    elem.classList.remove('selected');
                });
                item.classList.add('selected');
                this.onFileClick?.(fileInfo);
            };
            this.addTrackedEventListener(item, 'click', clickHandler);
            container.appendChild(item);
        });
    }

    /**
     * Create file node
     */
    createTreeItem(name: string, _ext: string): HTMLDivElement {
        const item = document.createElement('div');
        item.className = 'tree-item';

        const header = document.createElement('div');
        header.className = 'tree-item-header';

        const leftContent = document.createElement('div');
        leftContent.className = 'tree-item-left';

        const icon = document.createElement('span');
        icon.className = 'icon';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = name;

        leftContent.appendChild(icon);
        leftContent.appendChild(nameSpan);
        header.appendChild(leftContent);

        // Add type label (e.g., URDF, XACRO, STL, etc.)
        if (name && name.includes('.')) {
            const extUpper = name.split('.').pop().toUpperCase();
            const displayExtensions = ['URDF', 'XACRO', 'XML', 'DAE', 'STL', 'OBJ', 'USD', 'USDA', 'USDC', 'USDZ'];
            if (displayExtensions.includes(extUpper)) {
                const badge = document.createElement('span');
                badge.className = 'type-badge';
                badge.textContent = extUpper;
            header.appendChild(badge);
            }
        }

        item.appendChild(header);

        return item;
    }

    dispose(): void {
        this.clearEventListeners();
        this.onFileClick = null;
        this.onFilesSelected = null;
    }
}

function isModelExtension(ext: string): boolean {
    return ['urdf', 'xacro', 'xml', 'usd', 'usda', 'usdc', 'usdz'].includes(ext);
}

function mapExtensionToFileType(ext: string): AppFileType {
    if (['urdf', 'xacro'].includes(ext)) return ext as AppFileType;
    if (['xml'].includes(ext)) return 'mjcf';
    if (['usd', 'usda', 'usdc', 'usdz'].includes(ext)) return 'usd';
    if (['dae', 'stl', 'obj', 'collada'].includes(ext)) return 'mesh';
    return 'unknown';
}
