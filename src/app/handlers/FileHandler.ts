/**
 * File Handler - Handles file click events
 */
export class FileHandler {
    app: any;

    constructor(app: any) {
        this.app = app;
    }

    /**
     * Detect file type from extension
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
     * Handle file click
     */
    handleFileClick(fileInfo) {
        const ext = fileInfo.ext;
        const modelExts = ['urdf', 'xacro', 'xml', 'usd', 'usda', 'usdc', 'usdz'];
        const meshExts = ['dae', 'stl', 'obj', 'collada'];

        if (modelExts.includes(ext)) {
            // Robot model file, load model and load into editor
            this.app.fileHandler.loadFile(fileInfo.file);

            // If editor is open, auto-load file into editor
            const editorPanel = document.getElementById('code-editor-panel');
            if (editorPanel && editorPanel.classList.contains('visible') && this.app.codeEditorManager) {
                this.app.codeEditorManager.loadFile(fileInfo.file);
            }
        } else if (meshExts.includes(ext)) {
            // Mesh file, load as standalone model only, don't load into editor
            this.app.fileHandler.loadMeshAsModel(fileInfo.file, fileInfo.name);
        }
    }

    /**
     * Handle file loaded from VSCode
     */
    async handleVSCodeFile(fileInfo) {
        try {
            console.log('Loading model from VSCode:', fileInfo.name);

            // Create a File-like object from the content
            const blob = new Blob([fileInfo.content], { type: 'text/plain' });
            const file = new File([blob], fileInfo.name, { type: 'text/plain' });

            // Store file info for resolving relative paths
            file.vscodeDirectory = fileInfo.directory;
            file.vscodePath = fileInfo.path;

            // Add to file map
            this.app.fileHandler.fileMap.set(fileInfo.name, file);
            this.app.fileHandler.fileMap.set(fileInfo.path, file);
            this.app.state.vscodeFileMap.set(fileInfo.name, fileInfo);

            // Load the model
            await this.app.fileHandler.loadFile(file);

            // Update file tree
            const loadableFiles = [{
                file: file,
                name: fileInfo.name,
                type: this.detectFileType(fileInfo.name),
                path: fileInfo.path,
                category: 'model',
                ext: fileInfo.name.split('.').pop().toLowerCase()
            }];

            this.app.fileHandler.availableModels = loadableFiles;
            if (this.app.fileTreeView) {
                this.app.fileTreeView.updateFileTree(loadableFiles, this.app.fileHandler.fileMap);
            }

            // Use VSCode adapter if available
            if (typeof window.vscodeAdapter !== 'undefined') {
                window.vscodeAdapter.log(`Model loaded successfully: ${fileInfo.name}`);
            }
        } catch (error) {
            console.error('Failed to load model from VSCode:', error);
            if (typeof window.vscodeAdapter !== 'undefined') {
                window.vscodeAdapter.showError(`Failed to load model: ${error.message}`);
            }
        }
    }
}
