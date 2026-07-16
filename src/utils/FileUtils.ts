/**
 * File operation utility functions
 */

export interface FileSystemEntryLike {
    isFile: boolean;
    isDirectory: boolean;
    fullPath?: string;
    name: string;
}

export interface FileSystemFileEntryLike extends FileSystemEntryLike {
    isFile: true;
    isDirectory: false;
    file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

export interface FileSystemDirectoryReaderLike {
    readEntries: (
        successCallback: (entries: FileSystemEntryLike[]) => void,
        errorCallback?: (error: DOMException) => void
    ) => void;
}

export interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
    isFile: false;
    isDirectory: true;
    createReader: () => FileSystemDirectoryReaderLike;
}

/**
 * Read file content as text
 */
export function readFileContent(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

/**
 * Get File object from file system entry
 */
export function getFileFromEntry(entry: FileSystemFileEntryLike): Promise<File> {
    return new Promise((resolve, reject) => {
        entry.file(resolve, reject);
    });
}

/**
 * Recursively read directory
 */
export async function readDirectory(dirEntry: FileSystemDirectoryEntryLike, fileMap: Map<string, File>): Promise<File[]> {
    const files: File[] = [];

    return new Promise((resolve, reject) => {
        const reader = dirEntry.createReader();

        function readEntries() {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) {
                    resolve(files);
                    return;
                }

                for (const entry of entries) {
                    if (entry.isFile) {
                        const file = await getFileFromEntry(entry as FileSystemFileEntryLike);
                        const path = entry.fullPath || entry.name;
                        fileMap.set(path, file);
                        files.push(file);
                    } else if (entry.isDirectory) {
                        const subFiles = await readDirectory(entry as FileSystemDirectoryEntryLike, fileMap);
                        files.push(...subFiles);
                    }
                }

                readEntries();
            }, reject);
        }

        readEntries();
    });
}

/**
 * Get file type from extension
 */
export function getFileTypeFromExtension(ext: string): 'urdf' | 'xacro' | 'mjcf' | 'usd' | 'unknown' {
    const typeMap: Record<string, 'urdf' | 'xacro' | 'mjcf' | 'usd'> = {
        'urdf': 'urdf',
        'xacro': 'xacro',
        'xml': 'mjcf',
        'mjcf': 'mjcf',
        'usd': 'usd',
        'usda': 'usd',
        'usdc': 'usd',
        'usdz': 'usd'
    };
    return typeMap[ext as keyof typeof typeMap] || 'unknown';
}

/**
 * Get file display type
 */
export function getFileDisplayType(ext: string, _fileName: string): 'model' | 'mesh' | 'file' {
    const modelExts = ['urdf', 'xacro', 'xml', 'mjcf', 'usd', 'usda', 'usdc', 'usdz'];
    const meshExts = ['dae', 'stl', 'obj', 'collada'];

    if (modelExts.includes(ext)) {
        return 'model';
    } else if (meshExts.includes(ext)) {
        return 'mesh';
    }
    return 'file';
}

/**
 * Normalize path
 */
export function normalizePath(path: string): string {
    if (!path) return '';
    return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}
