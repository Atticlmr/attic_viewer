import { RobotConverter, type BinaryContent, type GeneratedArtifact, type ParseSource, type RobotFormat } from '../converters/converter.js';
import { URDFParser } from '../converters/parsers/URDFParser.js';
import { MJCFParser } from '../converters/parsers/MJCFParser.js';
import { MJCFSerializer } from '../converters/serializers/MJCFSerializer.js';
import { URDFSerializer } from '../converters/serializers/URDFSerializer.js';
import { createZipArchive, toUint8Array } from '../converter/archive.js';
import { normalizePath } from '../utils/FileUtils.js';

type ExportEntry = {
    path: string;
    content: Uint8Array;
    mimeType: string;
};

type SourceFormat = RobotFormat | 'xacro' | 'usd' | 'unknown';

interface EditorSnapshotState {
    currentFile: File | null;
    currentContent: string;
}

interface ConversionAppContext {
    fileHandler?: {
        getCurrentModelFile?: () => File | null;
        currentModelFile?: File | null;
        getFileMap?: () => Map<string, File>;
        fileMap?: Map<string, File>;
    };
    codeEditorManager?: {
        editorState?: EditorSnapshotState;
    };
}

interface CurrentSourceInfo {
    file: File;
    format: SourceFormat;
    fileMap: Map<string, File>;
    basePath: string;
    sourcePath: string;
    sourceContent: BinaryContent | null;
}

export class ModelConversionController {
    app: ConversionAppContext;
    converter: RobotConverter;
    dialogEl: HTMLDivElement | null;
    closeBtn: HTMLButtonElement | null;
    cancelBtn: HTMLButtonElement | null;
    exportBtn: HTMLButtonElement | null;
    pickPathBtn: HTMLButtonElement | null;
    formatSelect: HTMLSelectElement | null;
    pathInput: HTMLInputElement | null;
    statusEl: HTMLElement | null;
    selectedDirectoryHandle: FileSystemDirectoryHandle | null;

    constructor(app: ConversionAppContext) {
        this.app = app;
        this.converter = new RobotConverter();
        this.converter.registerParser('urdf', new URDFParser());
        this.converter.registerParser('mjcf', new MJCFParser());
        this.converter.registerSerializer('mjcf', new MJCFSerializer());
        this.converter.registerSerializer('urdf', new URDFSerializer());

        this.dialogEl = document.getElementById('conversion-export-dialog') as HTMLDivElement | null;
        this.closeBtn = document.getElementById('conversion-dialog-close-btn') as HTMLButtonElement | null;
        this.cancelBtn = document.getElementById('conversion-dialog-cancel-btn') as HTMLButtonElement | null;
        this.exportBtn = document.getElementById('conversion-dialog-export-btn') as HTMLButtonElement | null;
        this.pickPathBtn = document.getElementById('conversion-dialog-path-btn') as HTMLButtonElement | null;
        this.formatSelect = document.getElementById('conversion-dialog-format') as HTMLSelectElement | null;
        this.pathInput = document.getElementById('conversion-dialog-path') as HTMLInputElement | null;
        this.statusEl = document.getElementById('conversion-dialog-status');
        this.selectedDirectoryHandle = null;
    }

    init(): void {
        if (!this.dialogEl) {
            return;
        }

        this.closeBtn?.addEventListener('click', () => this.closeDialog());
        this.cancelBtn?.addEventListener('click', () => this.closeDialog());
        this.dialogEl.addEventListener('click', event => {
            if (event.target === this.dialogEl) {
                this.closeDialog();
            }
        });

        this.pickPathBtn?.addEventListener('click', async () => {
            await this.pickExportDirectory();
        });

        this.formatSelect?.addEventListener('change', () => {
            this.renderStatus('');
        });

        this.exportBtn?.addEventListener('click', async () => {
            await this.exportCurrentModel();
        });
    }

    openDialog(): void {
        if (!this.dialogEl) {
            return;
        }

        const sourceInfo = this.getCurrentSourceInfo();
        this.selectedDirectoryHandle = null;

        if (this.formatSelect) {
            this.configureFormatOptions(sourceInfo?.format || null);
        }

        if (this.pathInput) {
            this.pathInput.value = '';
            this.pathInput.placeholder = this.supportsDirectoryPicker()
                ? '尚未选择导出目录'
                : '当前浏览器将在导出时选择 ZIP 保存位置';
        }

        if (!sourceInfo) {
            this.renderStatus('当前没有可转换的模型文件。请先加载 URDF 或 MJCF 文件。', 'error');
            if (this.exportBtn) {
                this.exportBtn.disabled = true;
            }
        } else if (!['urdf', 'mjcf'].includes(sourceInfo.format)) {
            this.renderStatus(`当前文件格式 "${sourceInfo.format}" 暂不支持转换导出。仅支持 URDF 或 MJCF。`, 'warning');
            if (this.exportBtn) {
                this.exportBtn.disabled = true;
            }
        } else {
            const suggestion = sourceInfo.format === 'urdf' ? 'mjcf' : 'urdf';
            this.renderStatus(`当前已识别源格式为 ${sourceInfo.format.toUpperCase()}。建议导出为 ${suggestion.toUpperCase()}。`, 'info');
            if (this.exportBtn) {
                this.exportBtn.disabled = false;
            }
        }

        this.dialogEl.classList.add('show');
        document.body.classList.add('dialog-open');
    }

    closeDialog(): void {
        if (!this.dialogEl) {
            return;
        }

        this.dialogEl.classList.remove('show');
        document.body.classList.remove('dialog-open');
    }

    async pickExportDirectory(): Promise<void> {
        if (!this.supportsDirectoryPicker()) {
            this.renderStatus('当前浏览器不支持预先选择目录。导出时会改用 ZIP 文件保存选择器。', 'warning');
            return;
        }

        try {
            if (!window.showDirectoryPicker) {
                this.renderStatus('当前浏览器不支持目录选择。', 'warning');
                return;
            }

            this.selectedDirectoryHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            if (this.pathInput) {
                this.pathInput.value = this.selectedDirectoryHandle?.name || '';
            }
            this.renderStatus(`已选择导出目录：${this.selectedDirectoryHandle?.name || ''}`, 'success');
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }
            this.renderStatus(`选择导出目录失败：${error instanceof Error ? error.message : 'unknown error'}`, 'error');
        }
    }

    async exportCurrentModel(): Promise<void> {
        const sourceInfo = this.getCurrentSourceInfo();
        if (!sourceInfo || !['urdf', 'mjcf'].includes(sourceInfo.format)) {
            this.renderStatus('当前没有可导出的 URDF/MJCF 模型。', 'error');
            return;
        }

        const targetFormat = (this.formatSelect?.value as RobotFormat) || 'mjcf';
        if (!this.converter.hasSerializer(targetFormat)) {
            this.renderStatus(`目标格式 ${targetFormat.toUpperCase()} 目前不可导出。`, 'error');
            return;
        }

        if (targetFormat === sourceInfo.format) {
            this.renderStatus(`当前模型已经是 ${targetFormat.toUpperCase()}，仍可继续导出。`, 'warning');
        }

        if (this.exportBtn) {
            this.exportBtn.disabled = true;
        }

        try {
            this.renderStatus('正在转换并打包导出文件…', 'info');

            const parseSource: ParseSource = {
                format: sourceInfo.format as RobotFormat,
                fileName: sourceInfo.file.name,
                path: sourceInfo.sourcePath,
                content: sourceInfo.sourceContent ?? await sourceInfo.file.arrayBuffer(),
                fileMap: sourceInfo.fileMap
            };

            const parsed = await this.converter.parse(parseSource, {
                fileMap: sourceInfo.fileMap,
                basePath: sourceInfo.basePath
            });
            const targetFileName = `${parsed.document.metadata.name || stripExtension(sourceInfo.file.name) || 'robot'}${getDefaultExtension(targetFormat)}`;
            const serialized = await this.converter.serialize(parsed.document, {
                format: targetFormat,
                fileName: targetFileName
            }, {
                pretty: true
            });

            const entries = await this.buildExportEntries(targetFileName, serialized.content, serialized.mimeType, serialized.artifacts || [], sourceInfo.fileMap);
            const finalPayload = {
                fileName: `${stripExtension(targetFileName) || 'robot'}-${targetFormat}.zip`,
                mimeType: 'application/zip',
                content: createZipArchive(entries.map(entry => ({
                    path: entry.path,
                    content: entry.content
                })))
            };

            await this.writeExportPayload(finalPayload.fileName, finalPayload.mimeType, finalPayload.content);

            this.renderStatus(`导出完成，已打包为 ${finalPayload.fileName}`, 'success');
        } catch (error) {
            this.renderStatus(`导出失败：${error instanceof Error ? error.message : 'unknown error'}`, 'error');
        } finally {
            if (this.exportBtn) {
                this.exportBtn.disabled = false;
            }
        }
    }

    getCurrentSourceInfo(): CurrentSourceInfo | null {
        const currentFile = this.app.fileHandler?.getCurrentModelFile?.() || this.app.fileHandler?.currentModelFile;
        if (!currentFile) {
            return null;
        }

        const fileMap = this.app.fileHandler?.getFileMap?.() || this.app.fileHandler?.fileMap || new Map<string, File>();
        const sourcePath = this.findFilePath(currentFile, fileMap);
        const editorSnapshot = this.getEditorSnapshot(currentFile);
        const fileName = currentFile.name || 'robot';
        const format = detectSourceFormat(fileName);

        return {
            file: currentFile,
            format,
            fileMap,
            basePath: dirname(sourcePath),
            sourcePath,
            sourceContent: editorSnapshot?.content ?? null
        };
    }

    getEditorSnapshot(currentFile: File): { content: string; } | null {
        const editorManager = this.app.codeEditorManager;
        const editorState = editorManager?.editorState;
        if (!editorState?.currentFile || !editorState.currentContent) {
            return null;
        }

        const sameFile = editorState.currentFile === currentFile || editorState.currentFile.name === currentFile.name;
        if (!sameFile) {
            return null;
        }

        return {
            content: editorState.currentContent
        };
    }

    findFilePath(file: File, fileMap: Map<string, File>): string {
        let fallback = file.webkitRelativePath || file.name;
        let longestMatch = fallback;

        for (const [path, mappedFile] of fileMap.entries()) {
            if (mappedFile === file || path === file.name || path.endsWith(`/${file.name}`)) {
                if (path.length > longestMatch.length) {
                    longestMatch = path;
                }
            }
        }

        return normalizePath(longestMatch);
    }

    configureFormatOptions(sourceFormat: SourceFormat | null): void {
        if (!this.formatSelect) {
            return;
        }

        Array.from(this.formatSelect.options).forEach(option => {
            const target = option.value as RobotFormat;
            option.disabled = target === 'usd';
        });

        if (sourceFormat === 'urdf') {
            this.formatSelect.value = 'mjcf';
        } else if (sourceFormat === 'mjcf') {
            this.formatSelect.value = 'urdf';
        }
    }

    async buildExportEntries(
        primaryFileName: string,
        primaryContent: BinaryContent,
        primaryMimeType: string,
        artifacts: GeneratedArtifact[],
        workspaceFiles: Map<string, File>
    ): Promise<ExportEntry[]> {
        const entries: ExportEntry[] = [{
            path: primaryFileName,
            content: await resolveBinaryContent(primaryContent),
            mimeType: primaryMimeType
        }];

        for (const artifact of artifacts) {
            const artifactContent = await this.resolveArtifactContent(artifact, workspaceFiles);
            if (!artifactContent) {
                continue;
            }

            const exportPath = sanitizeExportPath(artifact.fileName);
            if (!exportPath) {
                continue;
            }

            entries.push({
                path: exportPath,
                content: artifactContent,
                mimeType: artifact.mimeType
            });
        }

        return entries;
    }

    async resolveArtifactContent(artifact: GeneratedArtifact, workspaceFiles: Map<string, File>): Promise<Uint8Array | null> {
        if (artifact.content !== undefined) {
            return await resolveBinaryContent(artifact.content);
        }

        const sourceFile = findFileInMap(artifact.sourcePath || '', workspaceFiles)
            || findFileInMap(artifact.fileName || '', workspaceFiles);
        if (!sourceFile) {
            return null;
        }

        return await resolveBinaryContent(sourceFile);
    }

    async writeExportPayload(fileName: string, mimeType: string, content: Uint8Array): Promise<void> {
        if (this.selectedDirectoryHandle) {
            const fileHandle = await this.selectedDirectoryHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(copyToArrayBuffer(content));
            await writable.close();
            return;
        }

        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: mimeType,
                    accept: {
                        [mimeType]: [getExtensionFromName(fileName)]
                    }
                }]
            });
            const writable = await handle.createWritable();
            await writable.write(copyToArrayBuffer(content));
            await writable.close();
            return;
        }

        downloadBlob(content, fileName, mimeType);
    }

    supportsDirectoryPicker(): boolean {
        return typeof window.showDirectoryPicker === 'function';
    }

    renderStatus(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
        if (!this.statusEl) {
            return;
        }

        this.statusEl.textContent = message;
        this.statusEl.className = `conversion-dialog-status ${level}`;
    }
}

function detectSourceFormat(fileName: string): SourceFormat {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
        case 'urdf':
            return 'urdf';
        case 'xml':
        case 'mjcf':
            return 'mjcf';
        case 'xacro':
            return 'xacro';
        case 'usd':
        case 'usda':
        case 'usdc':
        case 'usdz':
            return 'usd';
        default:
            return 'unknown';
    }
}

function getDefaultExtension(format: RobotFormat): string {
    switch (format) {
        case 'mjcf':
            return '.xml';
        case 'urdf':
            return '.urdf';
        case 'usd':
            return '.usd';
        default:
            return `.${format}`;
    }
}

function stripExtension(fileName: string): string {
    return fileName.replace(/\.[^/.]+$/, '');
}

function dirname(path: string): string {
    if (!path || !path.includes('/')) {
        return '';
    }

    return path.slice(0, path.lastIndexOf('/'));
}

function getExtensionFromName(fileName: string): string {
    const match = fileName.match(/(\.[^/.]+)$/);
    return match ? match[1] : '';
}

function sanitizeExportPath(path: string): string {
    return normalizePath(path).replace(/^\/+/, '');
}

function findFileInMap(path: string, fileMap: Map<string, File>): File | null {
    const normalizedCandidate = sanitizeExportPath(path);
    if (!normalizedCandidate) {
        return null;
    }

    const exactMatch = fileMap.get(normalizedCandidate) || fileMap.get(normalizePath(path));
    if (exactMatch) {
        return exactMatch;
    }

    const fileName = normalizedCandidate.split('/').pop();
    for (const [key, file] of fileMap.entries()) {
        const normalizedKey = sanitizeExportPath(key);
        if (
            normalizedKey === normalizedCandidate ||
            normalizedKey.endsWith(`/${normalizedCandidate}`) ||
            normalizedCandidate.endsWith(`/${normalizedKey}`) ||
            (fileName && normalizedKey.split('/').pop() === fileName)
        ) {
            return file;
        }
    }

    return null;
}

async function resolveBinaryContent(content: BinaryContent | File): Promise<Uint8Array> {
    if (content instanceof File) {
        return new Uint8Array(await content.arrayBuffer());
    }

    return await Promise.resolve(toUint8Array(content));
}

function downloadBlob(content: Uint8Array, fileName: string, mimeType: string): void {
    const blob = new Blob([copyToArrayBuffer(content)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
}
