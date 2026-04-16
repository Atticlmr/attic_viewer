import {
    createDefaultTransform,
    createEmptyRobotDocument,
    type FormatParser,
    type GeometryDefinition,
    type GeometryElement,
    type JointDynamics,
    type JointLimits,
    type MaterialDefinition,
    type ParseContext,
    type ParseResult,
    type ParseSource,
    type SemanticExtrasBag,
    type Transform,
    type Vec2,
    type Vec3,
    type Vec4,
    type XMLNodeSnapshot
} from '../converter.js';

export class URDFParser implements FormatParser {
    async parse(source: ParseSource, context: ParseContext = {}): Promise<ParseResult> {
        const messages = [];
        const xml = decodeURDFContent(source.content);
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        const parserError = doc.querySelector('parsererror');

        if (parserError) {
            throw new Error(`URDF XML parsing failed: ${parserError.textContent || 'unknown parse error'}`);
        }

        const robotEl = doc.documentElement;
        if (!robotEl || robotEl.tagName !== 'robot') {
            throw new Error('URDF root element <robot> not found');
        }

        const robotName = robotEl.getAttribute('name') || stripExtension(source.fileName) || 'robot';
        const document = createEmptyRobotDocument(robotName);
        document.metadata.name = robotName;
        document.metadata.sourceFormat = 'urdf';
        document.metadata.sourceFileName = source.fileName;
        const fileMap = normalizeFileMap(context.fileMap || source.fileMap);
        const sourcePath = normalizePath(source.path || source.fileName || '');
        const basePath = normalizePath(context.basePath || dirname(sourcePath));
        const packageMap = context.packageMap || await inferPackageMap(fileMap);

        document.semantics.robot.urdf = {
            version: robotEl.getAttribute('version') || undefined,
            packageMap,
            transmissions: collectElements(robotEl, 'transmission').map(serializeElement),
            gazebo: collectElements(robotEl, 'gazebo').map(serializeElement),
            childElements: collectAllDirectChildren(robotEl).map(serializeElement),
            originalXML: serializeXML(robotEl),
            originalAttributes: getAttributes(robotEl)
        };

        const globalMaterials = new Map<string, MaterialDefinition>();
        const materialUsageCount = new Map<string, number>();

        collectDirectChildren(robotEl, 'material').forEach((materialEl, index) => {
            const material = parseMaterialElement(materialEl, {
                fallbackName: `material_${index}`,
                sourceHint: 'global'
            });

            if (!material.name) {
                messages.push({
                    code: 'urdf_material_missing_name',
                    level: 'warning',
                    message: `Skipped unnamed top-level material at index ${index}`,
                    layer: 'materials'
                });
                return;
            }

            globalMaterials.set(material.name, material);
        });

        const linkElements = collectDirectChildren(robotEl, 'link');
        linkElements.forEach((linkEl, linkIndex) => {
            const linkName = linkEl.getAttribute('name') || `link_${linkIndex}`;

            document.structure.links.push({
                name: linkName,
                childJoints: []
            });
            document.semantics.links[linkName] = createURDFSemanticBag(linkEl);

            collectDirectChildren(linkEl, 'visual').forEach((visualEl, visualIndex) => {
                const parsed = parseGeometryElement({
                    element: visualEl,
                    linkName,
                    fallbackId: `${linkName}:visual:${visualIndex}`,
                    fallbackName: `${linkName}_visual_${visualIndex}`,
                    materialSource: globalMaterials,
                    materialUsageCount,
                    purpose: 'visual',
                    fileMap,
                    basePath,
                    packageMap
                });

                if (!parsed.geometryElement) {
                    messages.push({
                        code: 'urdf_visual_missing_geometry',
                        level: 'warning',
                        message: `Visual geometry on link "${linkName}" was skipped because it has no supported <geometry> child`,
                        layer: 'geometry',
                        entityName: linkName
                    });
                    return;
                }

                appendAssetResolutionMessages(messages, linkName, parsed.assetIssues);
                document.geometry.visuals.push(parsed.geometryElement);
                document.semantics.visuals[parsed.geometryElement.id] = createURDFSemanticBag(visualEl);

                if (parsed.material) {
                    upsertMaterial(document.materials.materials, parsed.material);
                    document.semantics.materials[parsed.material.name] = document.semantics.materials[parsed.material.name] || {};
                    const materialSemantic = createURDFSemanticBag(findDirectChild(visualEl, 'material'));
                    document.semantics.materials[parsed.material.name].urdf = {
                        ...(document.semantics.materials[parsed.material.name].urdf || {}),
                        ...(materialSemantic.urdf || {})
                    };
                }
            });

            collectDirectChildren(linkEl, 'collision').forEach((collisionEl, collisionIndex) => {
                const parsed = parseGeometryElement({
                    element: collisionEl,
                    linkName,
                    fallbackId: `${linkName}:collision:${collisionIndex}`,
                    fallbackName: `${linkName}_collision_${collisionIndex}`,
                    materialSource: globalMaterials,
                    materialUsageCount,
                    purpose: 'collision',
                    fileMap,
                    basePath,
                    packageMap
                });

                if (!parsed.geometryElement) {
                    messages.push({
                        code: 'urdf_collision_missing_geometry',
                        level: 'warning',
                        message: `Collision geometry on link "${linkName}" was skipped because it has no supported <geometry> child`,
                        layer: 'geometry',
                        entityName: linkName
                    });
                    return;
                }

                appendAssetResolutionMessages(messages, linkName, parsed.assetIssues);
                document.geometry.collisions.push(parsed.geometryElement);
                document.semantics.collisions[parsed.geometryElement.id] = createURDFSemanticBag(collisionEl);
            });

            const inertialEl = findDirectChild(linkEl, 'inertial');
            if (inertialEl) {
                document.physics.links.push({
                    name: `${linkName}_physics`,
                    link: linkName,
                    mass: readNumericAttribute(findDirectChild(inertialEl, 'mass'), 'value'),
                    centerOfMass: transformToVec3(parseOrigin(findDirectChild(inertialEl, 'origin')).translation),
                    inertialOrigin: parseOrigin(findDirectChild(inertialEl, 'origin')),
                    inertia: parseInertia(findDirectChild(inertialEl, 'inertia'))
                });
            }
        });

        const jointElements = collectDirectChildren(robotEl, 'joint');
        jointElements.forEach((jointEl, jointIndex) => {
            const jointName = jointEl.getAttribute('name') || `joint_${jointIndex}`;
            const parentLink = findDirectChild(jointEl, 'parent')?.getAttribute('link');
            const childLink = findDirectChild(jointEl, 'child')?.getAttribute('link');

            if (!parentLink || !childLink) {
                messages.push({
                    code: 'urdf_joint_missing_link_ref',
                    level: 'warning',
                    message: `Joint "${jointName}" was skipped because parent/child link references are incomplete`,
                    layer: 'structure',
                    entityName: jointName
                });
                return;
            }

            document.structure.joints.push({
                name: jointName,
                type: jointEl.getAttribute('type') || 'fixed',
                parentLink,
                childLink,
                origin: parseOrigin(findDirectChild(jointEl, 'origin')),
                axis: parseAxis(findDirectChild(jointEl, 'axis')),
                limits: parseJointLimits(findDirectChild(jointEl, 'limit')),
                dynamics: parseJointDynamics(findDirectChild(jointEl, 'dynamics'))
            });

            document.semantics.joints[jointName] = createURDFSemanticBag(jointEl);

            const parentNode = document.structure.links.find(link => link.name === parentLink);
            if (parentNode) {
                parentNode.childJoints.push(jointName);
            }

            const childNode = document.structure.links.find(link => link.name === childLink);
            if (childNode) {
                childNode.parentJoint = jointName;
            }

            const dynamics = parseJointDynamics(findDirectChild(jointEl, 'dynamics'));
            if (hasJointPhysics(dynamics)) {
                document.physics.joints.push({
                    name: `${jointName}_physics`,
                    joint: jointName,
                    damping: dynamics?.damping ?? null,
                    friction: dynamics?.friction ?? null,
                    stiffness: dynamics?.stiffness ?? null
                });
            }
        });

        const childLinks = new Set(document.structure.joints.map(joint => joint.childLink));
        const rootLinks = document.structure.links
            .map(link => link.name)
            .filter(linkName => !childLinks.has(linkName));
        document.structure.rootLink = rootLinks[0] || null;

        if (rootLinks.length > 1) {
            messages.push({
                code: 'urdf_multiple_roots',
                level: 'warning',
                message: `Multiple root links detected: ${rootLinks.join(', ')}`,
                layer: 'structure'
            });
        }

        document.materials.materials = [
            ...document.materials.materials,
            ...Array.from(globalMaterials.values()).filter(material => !document.materials.materials.some(existing => existing.name === material.name))
        ];

        return {
            document,
            messages
        };
    }
}

function decodeURDFContent(content: ParseSource['content']): string {
    if (typeof content === 'string') {
        return content;
    }

    if (content instanceof Uint8Array) {
        return new TextDecoder().decode(content);
    }

    return new TextDecoder().decode(new Uint8Array(content));
}

function appendAssetResolutionMessages(messages, entityName: string, assetIssues: string[]): void {
    assetIssues.forEach(issue => {
        messages.push({
            code: 'urdf_asset_resolution_warning',
            level: 'warning',
            message: issue,
            layer: 'geometry',
            entityName
        });
    });
}

function stripExtension(fileName?: string): string | null {
    if (!fileName) {
        return null;
    }

    return fileName.replace(/\.[^/.]+$/, '');
}

function collectDirectChildren(parent: Element, tagName: string): Element[] {
    return Array.from(parent.children).filter(child => child.tagName === tagName);
}

function collectAllDirectChildren(parent: Element): Element[] {
    return Array.from(parent.children);
}

function collectElements(parent: Element, tagName: string): Element[] {
    return Array.from(parent.getElementsByTagName(tagName));
}

function findDirectChild(parent: Element | null, tagName: string): Element | null {
    if (!parent) {
        return null;
    }

    return collectDirectChildren(parent, tagName)[0] || null;
}

function getAttributes(element: Element | null): Record<string, unknown> | undefined {
    if (!element) {
        return undefined;
    }

    const attrs: Record<string, unknown> = {};
    Array.from(element.attributes).forEach(attr => {
        attrs[attr.name] = attr.value;
    });
    return attrs;
}

function serializeElement(element: Element): XMLNodeSnapshot {
    return {
        tag: element.tagName,
        attributes: getAttributes(element),
        textContent: getTextContent(element),
        xml: serializeXML(element),
        children: collectAllDirectChildren(element).map(serializeElement)
    };
}

function createURDFSemanticBag(element: Element | null): SemanticExtrasBag {
    if (!element) {
        return {};
    }

    return {
        urdf: {
            originalXML: serializeXML(element),
            childElements: collectAllDirectChildren(element).map(serializeElement),
            mimic: serializeOptionalChild(element, 'mimic'),
            safetyController: serializeOptionalChild(element, 'safety_controller'),
            calibration: serializeOptionalChild(element, 'calibration'),
            dynamics: serializeOptionalChild(element, 'dynamics'),
            limit: serializeOptionalChild(element, 'limit'),
            inertial: serializeOptionalChild(element, 'inertial'),
            material: serializeOptionalChild(element, 'material'),
            originalAttributes: getAttributes(element)
        }
    };
}

function serializeOptionalChild(parent: Element, tagName: string): XMLNodeSnapshot | null {
    const child = findDirectChild(parent, tagName);
    return child ? serializeElement(child) : null;
}

function serializeXML(element: Element): string {
    return new XMLSerializer().serializeToString(element);
}

function getTextContent(element: Element): string | undefined {
    const text = element.textContent?.trim();
    return text ? text : undefined;
}

function parseOrigin(originEl: Element | null): Transform {
    const transform = createDefaultTransform();
    if (!originEl) {
        return transform;
    }

    const xyz = parseVec3(originEl.getAttribute('xyz'));
    const rpy = parseVec3(originEl.getAttribute('rpy'));

    if (xyz) {
        transform.translation = xyz;
    }
    if (rpy) {
        transform.rotationRPY = rpy;
    }

    return transform;
}

function parseVec2(value: string | null): Vec2 | undefined {
    if (!value) {
        return undefined;
    }

    const parts = splitNumbers(value);
    if (parts.length < 2) {
        return undefined;
    }

    return {
        x: parts[0],
        y: parts[1]
    };
}

function parseVec3(value: string | null): Vec3 | undefined {
    if (!value) {
        return undefined;
    }

    const parts = splitNumbers(value);
    if (parts.length < 3) {
        return undefined;
    }

    return {
        x: parts[0],
        y: parts[1],
        z: parts[2]
    };
}

function parseVec4(value: string | null): Vec4 | undefined {
    if (!value) {
        return undefined;
    }

    const parts = splitNumbers(value);
    if (parts.length < 4) {
        return undefined;
    }

    return {
        x: parts[0],
        y: parts[1],
        z: parts[2],
        w: parts[3]
    };
}

function splitNumbers(value: string): number[] {
    return value
        .trim()
        .split(/\s+/)
        .map(part => Number.parseFloat(part))
        .filter(part => !Number.isNaN(part));
}

function parseAxis(axisEl: Element | null): Vec3 | null {
    return parseVec3(axisEl?.getAttribute('xyz') || null) || null;
}

function parseJointLimits(limitEl: Element | null): JointLimits | null {
    if (!limitEl) {
        return null;
    }

    return {
        lower: readNumericAttribute(limitEl, 'lower'),
        upper: readNumericAttribute(limitEl, 'upper'),
        effort: readNumericAttribute(limitEl, 'effort'),
        velocity: readNumericAttribute(limitEl, 'velocity')
    };
}

function parseJointDynamics(dynamicsEl: Element | null): JointDynamics | null {
    if (!dynamicsEl) {
        return null;
    }

    return {
        damping: readNumericAttribute(dynamicsEl, 'damping'),
        friction: readNumericAttribute(dynamicsEl, 'friction')
    };
}

function hasJointPhysics(dynamics: JointDynamics | null): boolean {
    return Boolean(
        dynamics &&
        (dynamics.damping !== undefined ||
            dynamics.friction !== undefined ||
            dynamics.stiffness !== undefined ||
            dynamics.armature !== undefined)
    );
}

function parseInertia(inertiaEl: Element | null) {
    if (!inertiaEl) {
        return null;
    }

    return {
        ixx: readNumericAttribute(inertiaEl, 'ixx') || 0,
        iyy: readNumericAttribute(inertiaEl, 'iyy') || 0,
        izz: readNumericAttribute(inertiaEl, 'izz') || 0,
        ixy: readNumericAttribute(inertiaEl, 'ixy') || 0,
        ixz: readNumericAttribute(inertiaEl, 'ixz') || 0,
        iyz: readNumericAttribute(inertiaEl, 'iyz') || 0
    };
}

function transformToVec3(value: Vec3): Vec3 {
    return {
        x: value.x,
        y: value.y,
        z: value.z
    };
}

function readNumericAttribute(element: Element | null, attributeName: string): number | null {
    const raw = element?.getAttribute(attributeName);
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }

    const parsed = Number.parseFloat(raw);
    return Number.isNaN(parsed) ? null : parsed;
}

function parseGeometryElement(params: {
    element: Element;
    linkName: string;
    fallbackId: string;
    fallbackName: string;
    materialSource: Map<string, MaterialDefinition>;
    materialUsageCount: Map<string, number>;
    purpose: 'visual' | 'collision';
    fileMap: Map<string, File>;
    basePath: string;
    packageMap: Record<string, string>;
}): { geometryElement: GeometryElement | null; material?: MaterialDefinition; assetIssues: string[]; } {
    const geometryEl = findDirectChild(params.element, 'geometry');
    const { geometry, issues } = parseGeometry(geometryEl, params.fileMap, params.basePath, params.packageMap);

    if (!geometry) {
        return { geometryElement: null, assetIssues: issues };
    }

    const name = params.element.getAttribute('name') || params.fallbackName;
    const materialEl = findDirectChild(params.element, 'material');
    const material = params.purpose === 'visual'
        ? resolveMaterial(materialEl, params.materialSource, params.materialUsageCount, params.linkName, name)
        : undefined;

    return {
        geometryElement: {
            id: params.fallbackId,
            name,
            link: params.linkName,
            origin: parseOrigin(findDirectChild(params.element, 'origin')),
            geometry,
            material: material?.name || materialEl?.getAttribute('name') || null,
            visible: true,
            purpose: params.purpose
        },
        material,
        assetIssues: issues
    };
}

function parseGeometry(
    geometryEl: Element | null,
    fileMap: Map<string, File>,
    basePath: string,
    packageMap: Record<string, string>
): { geometry: GeometryDefinition | null; issues: string[]; } {
    const issues: string[] = [];
    if (!geometryEl) {
        return { geometry: null, issues };
    }

    const boxEl = findDirectChild(geometryEl, 'box');
    if (boxEl) {
        return {
            geometry: {
                kind: 'box',
                size: parseVec3(boxEl.getAttribute('size'))
            },
            issues
        };
    }

    const sphereEl = findDirectChild(geometryEl, 'sphere');
    if (sphereEl) {
        return {
            geometry: {
                kind: 'sphere',
                radius: readNumericAttribute(sphereEl, 'radius') || undefined
            },
            issues
        };
    }

    const cylinderEl = findDirectChild(geometryEl, 'cylinder');
    if (cylinderEl) {
        return {
            geometry: {
                kind: 'cylinder',
                radius: readNumericAttribute(cylinderEl, 'radius') || undefined,
                height: readNumericAttribute(cylinderEl, 'length') || undefined
            },
            issues
        };
    }

    const meshEl = findDirectChild(geometryEl, 'mesh');
    if (meshEl) {
        const uri = meshEl.getAttribute('filename');
        if (!uri) {
            return { geometry: null, issues };
        }

        const resolvedUri = resolveAssetUri(uri, fileMap, basePath, packageMap);
        if (!resolvedUri) {
            issues.push(`Asset "${uri}" could not be resolved from base path "${basePath || '.'}"`);
        }

        return {
            geometry: {
                kind: 'mesh',
                uri,
                packageUri: uri.startsWith('package://') ? uri : null,
                resolvedUri,
                scale: parseVec3(meshEl.getAttribute('scale'))
            },
            issues
        };
    }

    return { geometry: null, issues };
}

function resolveMaterial(
    materialEl: Element | null,
    globalMaterials: Map<string, MaterialDefinition>,
    materialUsageCount: Map<string, number>,
    linkName: string,
    elementName: string
): MaterialDefinition | undefined {
    if (!materialEl) {
        return undefined;
    }

    const materialName = materialEl.getAttribute('name');
    const hasInlineData = Boolean(
        findDirectChild(materialEl, 'color') ||
        findDirectChild(materialEl, 'texture')
    );

    if (materialName && !hasInlineData) {
        return globalMaterials.get(materialName);
    }

    const baseMaterial = parseMaterialElement(materialEl, {
        fallbackName: materialName || `${linkName}_${elementName}_material`,
        sourceHint: 'inline'
    });

    if (!baseMaterial.name) {
        return undefined;
    }

    if (materialName && globalMaterials.has(materialName) && !hasInlineData) {
        return globalMaterials.get(materialName);
    }

    const usage = materialUsageCount.get(baseMaterial.name) || 0;
    materialUsageCount.set(baseMaterial.name, usage + 1);

    if (usage === 0) {
        return baseMaterial;
    }

    return {
        ...baseMaterial,
        name: `${baseMaterial.name}_${usage}`
    };
}

function parseMaterialElement(
    materialEl: Element,
    options: { fallbackName: string; sourceHint: 'global' | 'inline'; }
): MaterialDefinition {
    const name = materialEl.getAttribute('name') || options.fallbackName;
    const color = parseVec4(findDirectChild(materialEl, 'color')?.getAttribute('rgba') || null);
    const textureFilename = findDirectChild(materialEl, 'texture')?.getAttribute('filename') || null;

    return {
        name,
        baseColor: color,
        alpha: color?.w,
        opacity: color?.w,
        texture: textureFilename ? { uri: textureFilename } : null,
        shaderModel: 'phong'
    };
}

function upsertMaterial(materials: MaterialDefinition[], material: MaterialDefinition): void {
    const existingIndex = materials.findIndex(existing => existing.name === material.name);
    if (existingIndex >= 0) {
        materials[existingIndex] = {
            ...materials[existingIndex],
            ...material
        };
        return;
    }

    materials.push(material);
}

function normalizeFileMap(fileMap?: Map<string, File>): Map<string, File> {
    const normalized = new Map<string, File>();
    if (!fileMap) {
        return normalized;
    }

    fileMap.forEach((file, key) => {
        normalized.set(normalizePath(key), file);
    });

    return normalized;
}

function normalizePath(path: string): string {
    if (!path) {
        return '';
    }

    const replaced = path.replace(/\\/g, '/');
    const absolute = replaced.startsWith('/');
    const parts = replaced.split('/').filter(Boolean);
    const stack: string[] = [];

    parts.forEach(part => {
        if (part === '.') {
            return;
        }
        if (part === '..') {
            if (stack.length > 0) {
                stack.pop();
            }
            return;
        }
        stack.push(part);
    });

    return `${absolute ? '/' : ''}${stack.join('/')}`;
}

function dirname(path: string): string {
    if (!path || !path.includes('/')) {
        return '';
    }

    return path.slice(0, path.lastIndexOf('/'));
}

function joinPath(...parts: string[]): string {
    return normalizePath(parts.filter(Boolean).join('/'));
}

function resolveAssetUri(
    uri: string,
    fileMap: Map<string, File>,
    basePath: string,
    packageMap: Record<string, string>
): string | null {
    const normalizedUri = uri.replace(/\\/g, '/');

    if (normalizedUri.startsWith('package://')) {
        const packageReference = normalizedUri.replace(/^package:\/\//, '');
        const slashIndex = packageReference.indexOf('/');
        const packageName = slashIndex >= 0 ? packageReference.slice(0, slashIndex) : packageReference;
        const relativePath = slashIndex >= 0 ? packageReference.slice(slashIndex + 1) : '';
        const packageRoot = packageMap[packageName];
        if (!packageRoot) {
            return null;
        }

        return findExistingPath(joinPath(packageRoot, relativePath), fileMap);
    }

    const candidates = [
        normalizePath(normalizedUri),
        joinPath(basePath, normalizedUri)
    ];

    for (const candidate of candidates) {
        const existing = findExistingPath(candidate, fileMap);
        if (existing) {
            return existing;
        }
    }

    return null;
}

function findExistingPath(candidate: string, fileMap: Map<string, File>): string | null {
    const normalizedCandidate = normalizePath(candidate);
    if (fileMap.has(normalizedCandidate)) {
        return normalizedCandidate;
    }

    for (const key of fileMap.keys()) {
        if (key === normalizedCandidate || key.endsWith(`/${normalizedCandidate}`)) {
            return key;
        }
    }

    return null;
}

async function inferPackageMap(fileMap: Map<string, File>): Promise<Record<string, string>> {
    const packageMap: Record<string, string> = {};

    for (const [path, file] of fileMap.entries()) {
        if (!path.endsWith('/package.xml')) {
            continue;
        }

        const packageRoot = dirname(path);
        const packageName = await extractPackageName(file, packageRoot);
        if (packageName) {
            packageMap[packageName] = packageRoot;
        }
    }

    return packageMap;
}

async function extractPackageName(file: File, fallbackPath: string): Promise<string> {
    const fallbackName = fallbackPath.split('/').filter(Boolean).pop() || fallbackPath;
    const cached = (file as File & { __packageName?: string; }).__packageName;
    if (cached) {
        return cached;
    }

    try {
        const xml = await file.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const parserError = doc.querySelector('parsererror');
        if (!parserError) {
            const packageName = doc.querySelector('package > name')?.textContent?.trim();
            if (packageName) {
                (file as File & { __packageName?: string; }).__packageName = packageName;
                return packageName;
            }
        }
    } catch {
        // Fall back to directory name when package.xml cannot be parsed.
    }

    return fallbackName;
}
