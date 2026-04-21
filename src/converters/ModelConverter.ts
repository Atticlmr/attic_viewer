/**
 * Model Converter
 * Converts UnifiedRobotModel to URDF or MJCF format and packages as ZIP
 */
import JSZip from 'jszip';
import { UnifiedRobotModel } from '../models/UnifiedRobotModel.js';
import { URDFGenerator, URDFExportOptions } from './URDFGenerator.js';
import { MJCFGenerator, MJCFExportOptions } from './MJCFGenerator.js';

export interface ExportOptions {
    model: UnifiedRobotModel;
    filename?: string;
    meshFiles?: Map<string, File>;
    modelName?: string;
    packageName?: string;
}

export interface ModelFileInfo {
    name: string;
    path: string;
    type: string;
}

export interface MeshFileInfo {
    name: string;
    data: ArrayBuffer | Blob;
    path: string;
}

export class ModelConverter {
    static async exportAsURDF(options: ExportOptions): Promise<Blob> {
        const { model, filename, meshFiles, modelName, packageName } = options;

        // Extract just the filename without path
        let baseName = filename || model.name || 'robot';
        const pathParts = baseName.split('/');
        baseName = pathParts[pathParts.length - 1];
        // Remove extension
        baseName = baseName.replace(/\.[^/.]+$/, '');
        
        const urdfFilename = baseName + '.urdf';

        const zip = new JSZip();

        // Generate URDF XML with options
        const urdfOptions: URDFExportOptions = {
            modelName: modelName,
            packageName: packageName
        };
        const urdfXml = URDFGenerator.generate(model, urdfOptions);
        zip.file(urdfFilename, urdfXml);

        // Add mesh files to assets folder
        const assetsFolder = zip.folder('assets');
        if (assetsFolder && meshFiles && meshFiles.size > 0) {
            for (const [path, file] of meshFiles) {
                const fileName = path.split('/').pop() || path;
                assetsFolder.file(fileName, file);
            }
        } else {
            await this.addMeshFilesFromModel(zip, model, meshFiles, 'assets');
        }

        return zip.generateAsync({ type: 'blob' });
    }

    static async exportAsMJCF(options: ExportOptions): Promise<Blob> {
        const { model, filename, meshFiles, modelName } = options;

        // Extract just the filename without path
        let baseName = filename || model.name || 'robot';
        const pathParts = baseName.split('/');
        baseName = pathParts[pathParts.length - 1];
        // Remove extension
        baseName = baseName.replace(/\.[^/.]+$/, '');
        
        // MJCF files should have .xml extension
        const mjcfFilename = baseName + '.xml';

        const zip = new JSZip();

        // Generate MJCF XML with options
        const mjcfOptions: MJCFExportOptions = {
            modelName: modelName
        };
        const mjcfXml = MJCFGenerator.generate(model, mjcfOptions);
        zip.file(mjcfFilename, mjcfXml);

        // Add mesh files to assets folder (flat, no subfolders)
        const assetsFolder = zip.folder('assets');
        if (assetsFolder && meshFiles && meshFiles.size > 0) {
            for (const [path, file] of meshFiles) {
                const fileName = path.split('/').pop() || path;
                assetsFolder.file(fileName, file);
            }
        } else {
            await this.addMeshFilesFromModel(zip, model, meshFiles, 'assets');
        }

        return zip.generateAsync({ type: 'blob' });
    }

    private static async addMeshFilesFromModel(
        zip: JSZip,
        model: UnifiedRobotModel,
        existingMeshFiles?: Map<string, File>,
        folderName: string = 'assets'
    ): Promise<void> {
        const folder = folderName ? zip.folder(folderName) : zip;
        if (!folder) return;

        const meshPaths = new Set<string>();

        for (const [name, link] of model.links) {
            for (const visual of link.visuals) {
                if (visual.geometry && visual.geometry.filename) {
                    meshPaths.add(visual.geometry.filename);
                }
            }
            for (const collision of link.collisions) {
                if (collision.geometry && collision.geometry.filename) {
                    meshPaths.add(collision.geometry.filename);
                }
            }
        }

        if (meshPaths.size === 0) return;

        if (existingMeshFiles && existingMeshFiles.size > 0) {
            for (const meshPath of meshPaths) {
                const baseName = meshPath.split('/').pop() || meshPath;
                const file = this.findMeshFile(meshPath, existingMeshFiles);
                if (file) {
                    folder.file(baseName, file);
                }
            }
        } else {
            console.warn('Mesh files not available for export. Add them to assets folder manually.');
        }
    }

    private static findMeshFile(meshPath: string, meshFiles: Map<string, File>): File | null {
        const baseName = meshPath.split('/').pop() || meshPath;

        if (meshFiles.has(meshPath)) {
            return meshFiles.get(meshPath) || null;
        }

        if (meshFiles.has(baseName)) {
            return meshFiles.get(baseName) || null;
        }

        for (const [key, file] of meshFiles) {
            if (key.endsWith(baseName) || key === baseName) {
                return file;
            }
        }

        return null;
    }

    static downloadZip(blob: Blob, filename: string): void {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    static async exportAndDownloadURDF(options: ExportOptions): Promise<void> {
        // Extract just the filename without path
        let baseName = options.filename || options.model.name || 'robot';
        const pathParts = baseName.split('/');
        baseName = pathParts[pathParts.length - 1];
        baseName = baseName.replace(/\.[^/.]+$/, '');
        
        const zipFilename = baseName + '.zip';

        const blob = await this.exportAsURDF(options);
        this.downloadZip(blob, zipFilename);
    }

    static async exportAndDownloadMJCF(options: ExportOptions): Promise<void> {
        // Extract just the filename without path
        let baseName = options.filename || options.model.name || 'robot';
        const pathParts = baseName.split('/');
        baseName = pathParts[pathParts.length - 1];
        baseName = baseName.replace(/\.[^/.]+$/, '');
        
        const zipFilename = baseName + '.zip';

        const blob = await this.exportAsMJCF(options);
        this.downloadZip(blob, zipFilename);
    }
}
