/**
 * USD Adapter
 * All USD formats use OpenUSD WASM loader (rendered in separate iframe)
 */
import { UnifiedRobotModel, Link, VisualGeometry, GeometryType } from '../models/UnifiedRobotModel.js';
import * as THREE from 'three';

interface USDViewerManagerLike {
    loadFromFilesMap(files: Record<string, File>, primaryPath: string): Promise<void>;
    loadFromFile(file: File): Promise<void>;
    setJointAngle?(jointName: string, value: number): void;
}

interface USDParseOptions {
    usdViewerManager?: USDViewerManagerLike;
}

type GeometryWithParameters = THREE.BufferGeometry & {
    type?: string;
    parameters?: {
        width?: number;
        height?: number;
        depth?: number;
        radius?: number;
        radiusTop?: number;
    };
};

export class USDAdapter {
    /**
     * Parse USD content and convert to unified model
     * @param {string|ArrayBuffer} content - USD content
     * @param {Map} fileMap - File map
     * @param {File} file - Original file object
     * @param {Object} options - Options
     * @param {Object} options.usdViewerManager - USD viewer manager
     * @returns {Promise<UnifiedRobotModel>}
     */
    static async parse(
        _content: string | ArrayBuffer,
        fileMap: Map<string, File> | null = null,
        file: File | null = null,
        options: USDParseOptions = {}
    ): Promise<UnifiedRobotModel> {
        if (!options.usdViewerManager) {
            throw new Error('USD viewer not initialized');
        }

        return await this.parseWithWASM(file, fileMap, options.usdViewerManager);
    }

    /**
     * Load USD file using WASM (all formats)
     * @param {File} file - USD file
     * @param {Map} fileMap - File map
     * @param {Object} usdViewerManager - USD viewer manager
     * @returns {Promise<UnifiedRobotModel>}
     */
    static async parseWithWASM(
        file: File,
        fileMap: Map<string, File> | null = null,
        usdViewerManager: USDViewerManagerLike
    ): Promise<UnifiedRobotModel> {
        try {
            if (fileMap && fileMap.size > 1) {
                const filesMapObj: Record<string, File> = {};
                for (const [path, f] of fileMap.entries()) {
                    filesMapObj[path] = f;
                }
                let primaryPath = file.name;
                for (const [path, mappedFile] of fileMap.entries()) {
                    if (mappedFile === file) {
                        primaryPath = path;
                        break;
                    }
                }
                await usdViewerManager.loadFromFilesMap(filesMapObj, primaryPath);
            } else {
                await usdViewerManager.loadFromFile(file);
            }

            const model = new UnifiedRobotModel();
            model.name = file.name.replace(/\.(usdz|usdc|usd|usda)$/i, '');
            model.userData = model.userData || {};
            model.userData.isUSDWASM = true;
            model.userData.usdViewerManager = usdViewerManager;
            model.threeObject = this.createUSDProxyScene(model.name, usdViewerManager);
            model.threeObject.userData.type = 'usd';

            return model;

        } catch (error) {
            console.error('USD loading failed:', error);
            throw error;
        }
    }

    /**
     * Create a lightweight main-scene proxy so existing UI code has a model object
     * to attach controls to while the real USD render stays in the iframe.
     */
    static createUSDProxyScene(name: string, usdViewerManager: USDViewerManagerLike): THREE.Group {
        const root = new THREE.Group();
        root.name = name;
        root.userData = {
            type: 'usd',
            isUSDProxy: true,
            usdViewerManager
        };
        root.visible = false;
        return root;
    }

    static setJointAngle(joint: any, angle: number): void {
        joint.currentValue = angle;
        const modelRoot = joint.threeObject as THREE.Object3D & {
            userData?: {
                usdViewerManager?: USDViewerManagerLike;
            };
        };
        modelRoot?.userData?.usdViewerManager?.setJointAngle?.(joint.name, angle);
    }

    /**
     * [Deprecated] Use Three.js USDZLoader
     */
    static async parseUSDZ_OLD(file: File, _fileMap: Map<string, File> | null = null): Promise<UnifiedRobotModel> {
        // Dynamically import USDZLoader
        const { USDZLoader } = await import('three/examples/jsm/loaders/USDZLoader.js');
        const loader = new USDZLoader();

        // Create Blob URL
        const blobUrl = URL.createObjectURL(file);

        try {
            // Load USDZ file
            const group = await new Promise<THREE.Group>((resolve, reject) => {
                loader.load(
                    blobUrl,
                    resolve,
                    undefined,
                    (error) => {
                        console.error('USDZ loading failed:', error);
                        reject(error);
                    }
                );
            });

            URL.revokeObjectURL(blobUrl);

            // Convert Three.js Group to UnifiedRobotModel
            return this.convertThreeGroupToModel(group, file.name);

        } catch (error) {
            URL.revokeObjectURL(blobUrl);
            throw error;
        }
    }

    /**
     * Convert Three.js Group to UnifiedRobotModel
     */
    static convertThreeGroupToModel(group: THREE.Group, fileName: string): UnifiedRobotModel {
        const model = new UnifiedRobotModel();
        model.name = fileName.replace(/\.(usdz|usdc|usd|usda)$/i, '');
        model.threeObject = group;

        // Extract all meshes as links
        let linkIndex = 0;
        group.traverse((child) => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
                const linkName = child.name || `link_${linkIndex++}`;
                const link = new Link(linkName);
                link.threeObject = child;

                // If mesh, create visual geometry
                if (child instanceof THREE.Mesh) {
                    const visual = new VisualGeometry();
                    visual.name = child.name || linkName;
                    visual.threeObject = child;

                    // Try to extract geometry information
                    if (child.geometry) {
                        visual.geometry = this.extractGeometryInfo(child.geometry);
                    }

                    link.visuals.push(visual);
                }

                model.addLink(link);
            }
        });

        return model;
    }

    /**
     * Extract geometry information
     */
    static extractGeometryInfo(geometry: GeometryWithParameters): GeometryType {
        const geometryType = new GeometryType('mesh');

        // Try to identify geometry type
        if (geometry.type === 'BoxGeometry') {
            geometryType.type = 'box';
            geometryType.size = {
                x: geometry.parameters?.width || 1,
                y: geometry.parameters?.height || 1,
                z: geometry.parameters?.depth || 1
            };
        } else if (geometry.type === 'SphereGeometry') {
            geometryType.type = 'sphere';
            geometryType.size = {
                radius: geometry.parameters?.radius || 0.5
            };
        } else if (geometry.type === 'CylinderGeometry') {
            geometryType.type = 'cylinder';
            geometryType.size = {
                radius: geometry.parameters?.radiusTop || 0.5,
                height: geometry.parameters?.height || 1
            };
        }

        return geometryType;
    }

    /**
     * [Removed] Old parsing method
     */
    static parseASCIIUSD_DEPRECATED(content: string, _fileMap: Map<string, File> | null = null): UnifiedRobotModel {
        const model = new UnifiedRobotModel();
        model.name = 'usd_model';

        // Detect if valid USDA format
        if (!content.includes('#usda') && !content.includes('def ')) {
            console.warn('File may not be valid USD ASCII format');
        }

        // USD ASCII format parsing
        // Example format:
        // def Xform "base_link" {
        //     def Mesh "visual" { ... }
        //     def Cylinder "collision" { ... }
        // }

        // Simple USD parser (for basic use cases)
        // Full implementation requires more complex parsing logic

        const lines = content.split('\n');

        let currentPrim: string | null = null;
        let currentLink: Link | null = null;
        const stack: Array<{ type: string; obj: Link | VisualGeometry }> = [];
        let defMatchCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (!line || line.startsWith('#')) continue;

            // Match def definitions
            const defMatch = line.match(/def\s+(\w+)\s+"([^"]+)"\s*\{/);
            if (defMatch) {
                defMatchCount++;
                const type = defMatch[1];
                const name = defMatch[2];

                if (type === 'Xform' || type === 'Mesh' || type === 'Cube' || type === 'Sphere' || type === 'Cylinder') {
                    // If Xform, might be link
                    if (type === 'Xform' && !currentLink) {
                        currentLink = new Link(name);
                        model.addLink(currentLink);
                        stack.push({ type: 'link', obj: currentLink });
                    } else if (currentLink) {
                        // Child geometry
                        const visual = new VisualGeometry();
                        visual.name = name;
                        visual.geometry = this.parseUSDGeometry(type, lines, i);
                        currentLink.visuals.push(visual);
                        stack.push({ type: 'visual', obj: visual });
                    }
                }
                continue;
            }

            // Match attributes
            if (currentLink && line.includes('=')) {
                const attrMatch = line.match(/(\w+)\s*=\s*(.+)/);
                if (attrMatch) {
                    const attrName = attrMatch[1];
                    const attrValue = attrMatch[2].trim();

                    // Parse common attributes
                    if (attrName === 'xformOp:translate') {
                        const values = this.parseUSDArray(attrValue);
                        if (values.length >= 3) {
                            // Apply to current visual
                            const visual = currentLink.visuals[currentLink.visuals.length - 1];
                            if (visual) {
                                visual.origin.xyz = values.slice(0, 3);
                            }
                        }
                    }
                }
            }

            // Match closing brace
            if (line === '}') {
                if (stack.length > 0) {
                    const popped = stack.pop();
                    if (popped.type === 'link') {
                        currentLink = null;
                    }
                }
            }
        }

        // Create Three.js objects
        this.createThreeObject(model);

        return model;
    }

    /**
     * Parse USD geometry type
     */
    static parseUSDGeometry(type, lines, startIndex) {
        const geometry = new GeometryType(type.toLowerCase());

        // Find geometry attributes
        for (let i = startIndex; i < Math.min(startIndex + 20, lines.length); i++) {
            const line = lines[i].trim();
            if (line === '}') break;

            const attrMatch = line.match(/(\w+)\s*=\s*(.+)/);
            if (attrMatch) {
                const attrName = attrMatch[1];
                const attrValue = attrMatch[2].trim();

                switch (type) {
                    case 'Cube':
                        if (attrName === 'size') {
                            const size = parseFloat(attrValue);
                            geometry.size = { x: size, y: size, z: size };
                        }
                        break;
                    case 'Sphere':
                        if (attrName === 'radius') {
                            geometry.size = { radius: parseFloat(attrValue) };
                        }
                        break;
                    case 'Cylinder':
                        if (attrName === 'radius') {
                            const radius = parseFloat(attrValue);
                            geometry.size = { radius, height: radius * 2 };
                        }
                        if (attrName === 'height') {
                            if (!geometry.size) geometry.size = {};
                            geometry.size.height = parseFloat(attrValue);
                        }
                        break;
                }
            }
        }

        return geometry;
    }

    /**
     * Parse USD array format
     */
    static parseUSDArray(value) {
        // Remove parentheses and spaces
        value = value.replace(/[()]/g, '').trim();
        return value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
    }

    /**
     * Create Three.js objects
     */
    static createThreeObject(model) {
        const group = new THREE.Group();
        group.name = model.name;

        model.links.forEach((link, name) => {
            const linkGroup = new THREE.Group();
            linkGroup.name = name;

            link.visuals.forEach(visual => {
                const mesh = this.createGeometryMesh(visual.geometry);
                if (mesh) {
                    mesh.position.set(visual.origin.xyz[0], visual.origin.xyz[1], visual.origin.xyz[2]);
                    mesh.rotation.set(visual.origin.rpy[0], visual.origin.rpy[1], visual.origin.rpy[2]);
                    mesh.name = visual.name;
                    linkGroup.add(mesh);
                    visual.threeObject = mesh;
                }
            });

            link.threeObject = linkGroup;
            group.add(linkGroup);
        });

        model.threeObject = group;
    }

    /**
     * Create Three.js Mesh based on geometry type
     */
    static createGeometryMesh(geometry) {
        let threeGeometry = null;

        switch (geometry.type) {
            case 'cube':
                if (geometry.size) {
                    const size = geometry.size.x || 0.1;
                    threeGeometry = new THREE.BoxGeometry(size, size, size);
                }
                break;
            case 'sphere':
                if (geometry.size && geometry.size.radius) {
                    threeGeometry = new THREE.SphereGeometry(geometry.size.radius, 32, 32);
                }
                break;
            case 'cylinder':
                if (geometry.size) {
                    threeGeometry = new THREE.CylinderGeometry(
                        geometry.size.radius || 0.1,
                        geometry.size.radius || 0.1,
                        geometry.size.height || 0.1,
                        32
                    );
                }
                break;
        }

        if (!threeGeometry) return null;

        const material = new THREE.MeshStandardMaterial({ color: 0x888888 });
        return new THREE.Mesh(threeGeometry, material);
    }

}
