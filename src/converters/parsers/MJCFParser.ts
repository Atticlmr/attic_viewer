import {
    createDefaultTransform,
    createEmptyRobotDocument,
    type ConversionMessage,
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
    type TopologyConstraint,
    type Transform,
    type Vec3,
    type Vec4,
    type XMLNodeSnapshot
} from '../converter.js';

type AngleUnit = 'degree' | 'radian';

type MeshAsset = {
    name: string;
    file?: string;
    resolvedUri?: string | null;
    scale?: Vec3;
};

type MaterialMap = Map<string, MaterialDefinition>;

type DefaultProperties = {
    mesh?: {
        scale?: Vec3;
    };
    geom?: {
        contype?: number | null;
        conaffinity?: number | null;
        group?: number | null;
        density?: number | null;
        type?: string | null;
        material?: string | null;
        rgba?: Vec4 | null;
    };
    joint?: {
        type?: string | null;
        axis?: Vec3 | null;
        range?: [number, number] | null;
        damping?: number | null;
        frictionloss?: number | null;
        stiffness?: number | null;
        armature?: number | null;
    };
};

type BodyParseParams = {
    parentLink: string | null;
    bodyElement: Element;
    document: ReturnType<typeof createEmptyRobotDocument>;
    messages: ConversionMessage[];
    meshAssets: Map<string, MeshAsset>;
    materials: MaterialMap;
    basePath: string;
    fileMap: Map<string, File>;
    angleUnit: AngleUnit;
    jointDefaults: Map<string, DefaultProperties>;
    rootDefaults: DefaultProperties;
    inheritedChildClass: string | null;
    usedNames: Set<string>;
};

type ParsedMJCFActuator = {
    type: string;
    name: string;
    joint?: string;
    tendon?: string;
    site?: string;
    gear?: number[];
    attributes?: Record<string, unknown>;
    children?: XMLNodeSnapshot[];
};

export class MJCFParser implements FormatParser {
    async parse(source: ParseSource, context: ParseContext = {}): Promise<ParseResult> {
        const messages: ConversionMessage[] = [];
        const xml = decodeMJCFContent(source.content);
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        const parserError = doc.querySelector('parsererror');

        if (parserError) {
            throw new Error(`MJCF XML parsing failed: ${parserError.textContent || 'unknown parse error'}`);
        }

        const mujocoEl = doc.documentElement;
        if (!mujocoEl || mujocoEl.tagName !== 'mujoco') {
            throw new Error('MJCF root element <mujoco> not found');
        }

        const robotName = mujocoEl.getAttribute('model') || stripExtension(source.fileName) || 'robot';
        const document = createEmptyRobotDocument(robotName);
        document.metadata.name = robotName;
        document.metadata.sourceFormat = 'mjcf';
        document.metadata.sourceFileName = source.fileName;

        const compilerEl = findDirectChild(mujocoEl, 'compiler');
        const optionEl = findDirectChild(mujocoEl, 'option');
        const angleUnit = compilerEl?.getAttribute('angle') === 'radian' ? 'radian' : 'degree';
        const fileMap = normalizeFileMap(context.fileMap || source.fileMap);
        const sourcePath = normalizePath(source.path || source.fileName || '');
        const basePath = normalizePath(context.basePath || dirname(sourcePath));
        const { classDefaults, rootDefaults } = parseDefaults(mujocoEl, angleUnit);
        const meshAssets = parseMeshAssets(mujocoEl, classDefaults, rootDefaults, fileMap, basePath);
        const materials = parseAssetMaterials(mujocoEl);

        document.semantics.robot.mjcf = {
            compiler: getAttributes(compilerEl),
            options: getAttributes(optionEl),
            defaults: {
                items: collectDirectChildren(mujocoEl, 'default').map(serializeElement)
            },
            actuators: [],
            equality: [],
            originalAttributes: getAttributes(mujocoEl)
        };

        document.materials.materials.push(...materials.values());
        document.materials.materials.forEach(material => {
            document.semantics.materials[material.name] = {
                mjcf: {
                    originalAttributes: {
                        name: material.name
                    }
                }
            };
        });

        const worldbodyEl = findDirectChild(mujocoEl, 'worldbody');
        if (!worldbodyEl) {
            throw new Error('MJCF worldbody element not found');
        }

        const topBodies = collectDirectChildren(worldbodyEl, 'body');
        const worldbodyGeoms = collectDirectChildren(worldbodyEl, 'geom');
        const requireSyntheticRoot =
            worldbodyGeoms.length > 0 ||
            topBodies.length !== 1 ||
            topBodies.some(body => collectDirectChildrenByTags(body, ['joint', 'freejoint']).length > 0) ||
            (topBodies[0] ? !isIdentityTransform(parseTransform(topBodies[0], angleUnit)) : false);

        const usedNames = new Set<string>();
        let rootLinkName: string | null = null;

        if (requireSyntheticRoot) {
            rootLinkName = createUniqueName('worldbody', usedNames);
            document.structure.rootLink = rootLinkName;
            document.structure.links.push({
                name: rootLinkName,
                childJoints: []
            });
            document.semantics.links[rootLinkName] = createMJCFSemanticBag(worldbodyEl);

            const worldRootGeoms = parseGeomCollection({
                elements: worldbodyGeoms,
                linkName: rootLinkName,
                materials,
                document,
                meshAssets,
                fileMap,
                basePath,
                angleUnit,
                inheritedChildClass: null,
                classDefaults,
                rootDefaults,
                rebaseOffset: null,
                messages
            });
            document.geometry.visuals.push(...worldRootGeoms.visuals);
            document.geometry.collisions.push(...worldRootGeoms.collisions);
        }

        topBodies.forEach(bodyElement => {
            parseBody({
                parentLink: rootLinkName,
                bodyElement,
                document,
                messages,
                meshAssets,
                materials,
                basePath,
                fileMap,
                angleUnit,
                jointDefaults: classDefaults,
                rootDefaults,
                inheritedChildClass: null,
                usedNames
            });
        });

        if (!document.structure.rootLink && document.structure.links.length > 0) {
            document.structure.rootLink = document.structure.links[0].name;
        }

        parseEquality(mujocoEl, document);
        parseActuators(mujocoEl, document);

        return {
            document,
            messages
        };
    }
}

function decodeMJCFContent(content: ParseSource['content']): string {
    if (typeof content === 'string') {
        return content;
    }

    if (content instanceof Uint8Array) {
        return new TextDecoder().decode(content);
    }

    return new TextDecoder().decode(new Uint8Array(content));
}

function parseBody(params: BodyParseParams): void {
    const {
        parentLink,
        bodyElement,
        document,
        messages,
        meshAssets,
        materials,
        basePath,
        fileMap,
        angleUnit,
        jointDefaults,
        rootDefaults,
        inheritedChildClass,
        usedNames
    } = params;

    const rawBodyName = bodyElement.getAttribute('name') || 'body';
    const linkName = createUniqueName(rawBodyName, usedNames);
    const bodyTransform = parseTransform(bodyElement, angleUnit);
    const childClass = bodyElement.getAttribute('childclass') || inheritedChildClass;
    const jointElements = collectDirectChildrenByTags(bodyElement, ['joint', 'freejoint']);
    const jointFrameOffset = jointElements.length > 0
        ? parseJointLocalOffset(jointElements[jointElements.length - 1], angleUnit)
        : null;
    const chainLinkNames = createBodyLinkChain(linkName, jointElements, usedNames);

    chainLinkNames.forEach((chainLinkName, index) => {
        document.structure.links.push({
            name: chainLinkName,
            childJoints: []
        });
        document.semantics.links[chainLinkName] = index === chainLinkNames.length - 1
            ? createMJCFSemanticBag(bodyElement)
            : {
                custom: {
                    synthetic: true,
                    sourceBody: linkName
                }
            };
    });

    if (!parentLink) {
        document.structure.rootLink = document.structure.rootLink || chainLinkNames[0];
    }

    if (parentLink || jointElements.length > 0) {
        const parentChainStart = parentLink;
        if (jointElements.length === 0) {
            const fixedJoint = createFixedJoint(parentLink || chainLinkNames[0], linkName, bodyTransform, usedNames);
            attachJoint(document, fixedJoint, bodyElement);
        } else {
            let previousLink = parentChainStart;
            let previousOffset: Transform | null = null;

            jointElements.forEach((jointElement, index) => {
                const isLastJoint = index === jointElements.length - 1;
                const childLink = isLastJoint ? linkName : chainLinkNames[index];
                const currentParentLink = previousLink || createUniqueName('worldbody', usedNames);
                const joint = parseJointElement({
                    parentLink: currentParentLink,
                    childLink,
                    bodyTransform,
                    jointElement,
                    angleUnit,
                    jointDefaults: resolveJointDefaults(jointElement, childClass, jointDefaults, rootDefaults),
                    messages,
                    usedNames,
                    isFirstJoint: index === 0,
                    previousJointOffset: previousOffset
                });

                attachJoint(document, joint, jointElement);

                if (joint.dynamics && hasJointDynamics(joint.dynamics)) {
                    document.physics.joints.push({
                        name: `${joint.name}_physics`,
                        joint: joint.name,
                        damping: joint.dynamics.damping ?? null,
                        friction: joint.dynamics.friction ?? null,
                        stiffness: joint.dynamics.stiffness ?? null
                    });
                }

                previousLink = childLink;
                previousOffset = parseJointLocalOffset(jointElement, angleUnit);
            });

            if (jointElements.length > 1) {
                messages.push({
                    code: 'mjcf_multiple_joints_expanded',
                    level: 'info',
                    message: `Body "${linkName}" contains ${jointElements.length} joints and was expanded into a synthetic URDF link chain.`,
                    layer: 'structure',
                    entityName: linkName
                });
            }
        }
    }

    const parsedGeoms = parseGeomCollection({
        elements: collectDirectChildren(bodyElement, 'geom'),
        linkName,
        materials,
        document,
        meshAssets,
        fileMap,
        basePath,
        angleUnit,
        inheritedChildClass: childClass,
        classDefaults: jointDefaults,
        rootDefaults,
        rebaseOffset: jointFrameOffset,
        messages
    });

    document.geometry.visuals.push(...parsedGeoms.visuals);
    document.geometry.collisions.push(...parsedGeoms.collisions);

    const inertialElement = findDirectChild(bodyElement, 'inertial');
    if (inertialElement) {
        document.physics.links.push(parseInertial({
            element: inertialElement,
            linkName,
            angleUnit,
            rebaseOffset: jointFrameOffset
        }));
    }

    collectDirectChildren(bodyElement, 'body').forEach(childBody => {
        parseBody({
            ...params,
            parentLink: linkName,
            bodyElement: childBody,
            inheritedChildClass: childClass
        });
    });
}

function parseJointElement(params: {
    parentLink: string;
    childLink: string;
    bodyTransform: Transform;
    jointElement: Element;
    angleUnit: AngleUnit;
    jointDefaults: DefaultProperties['joint'];
    messages: ConversionMessage[];
    usedNames: Set<string>;
    isFirstJoint: boolean;
    previousJointOffset: Transform | null;
}) {
    const {
        parentLink,
        childLink,
        bodyTransform,
        jointElement,
        angleUnit,
        jointDefaults,
        messages,
        usedNames,
        isFirstJoint,
        previousJointOffset
    } = params;
    const isFreeJoint = jointElement.tagName === 'freejoint';
    const rawJointName = jointElement.getAttribute('name') || `${childLink}_joint`;
    const jointName = createUniqueName(rawJointName, usedNames);
    const localOffset = parseJointLocalOffset(jointElement, angleUnit);
    const typeAttr = jointElement.getAttribute('type') || jointDefaults?.type || (isFreeJoint ? 'free' : 'hinge');
    const range = parseRange(jointElement.getAttribute('range'), angleUnit, typeAttr);
    const axis = parseVec3(jointElement.getAttribute('axis')) || jointDefaults?.axis || null;
    const lower = range?.[0] ?? null;
    const upper = range?.[1] ?? null;
    const mappedType = mapMJCFJointType(typeAttr, range);

    if (typeAttr === 'ball') {
        messages.push({
            code: 'mjcf_ball_joint_preserved',
            level: 'warning',
            message: `Joint "${jointName}" is a MJCF ball joint. URDF serialization will need to approximate it.`,
            layer: 'structure',
            entityName: jointName
        });
    }

    return {
        name: jointName,
        type: mappedType,
        parentLink,
        childLink,
        origin: isFirstJoint
            ? composeTransforms(bodyTransform, localOffset)
            : relativeTransform(localOffset, previousJointOffset),
        axis,
        limits: buildJointLimits(mappedType, lower, upper, jointElement),
        dynamics: buildJointDynamics(jointElement, jointDefaults)
    };
}

function createFixedJoint(parentLink: string, childLink: string, bodyTransform: Transform, usedNames: Set<string>) {
    return {
        name: createUniqueName(`${parentLink}_${childLink}_fixed`, usedNames),
        type: 'fixed',
        parentLink,
        childLink,
        origin: bodyTransform,
        axis: null,
        limits: null,
        dynamics: null
    };
}

function parseGeomCollection(params: {
    elements: Element[];
    linkName: string;
    materials: MaterialMap;
    document: ReturnType<typeof createEmptyRobotDocument>;
    meshAssets: Map<string, MeshAsset>;
    fileMap: Map<string, File>;
    basePath: string;
    angleUnit: AngleUnit;
    inheritedChildClass: string | null;
    classDefaults: Map<string, DefaultProperties>;
    rootDefaults: DefaultProperties;
    rebaseOffset: Transform | null;
    messages: ConversionMessage[];
}): { visuals: GeometryElement[]; collisions: GeometryElement[]; } {
    const {
        elements,
        linkName,
        materials,
        document,
        meshAssets,
        fileMap,
        basePath,
        angleUnit,
        inheritedChildClass,
        classDefaults,
        rootDefaults,
        rebaseOffset,
        messages
    } = params;

    const visuals: GeometryElement[] = [];
    const collisions: GeometryElement[] = [];
    const seenMeshes = new Set<string>();

    elements.forEach((geomElement, index) => {
        const inheritedProps = resolveGeomDefaults(geomElement, inheritedChildClass, rootDefaults, classDefaults);
        const purpose = classifyGeomPurpose(geomElement, inheritedProps, seenMeshes);
        const parsed = parseGeomElement({
            element: geomElement,
            linkName,
            index,
            purpose,
            materials,
            meshAssets,
            fileMap,
            basePath,
            angleUnit,
            inheritedProps
        });

        if (!parsed.geometry) {
            messages.push({
                code: 'mjcf_geom_unsupported',
                level: 'warning',
                message: `Geom "${geomElement.getAttribute('name') || `${linkName}_geom_${index}`}" could not be converted into Robot IR geometry.`,
                layer: 'geometry',
                entityName: linkName
            });
            return;
        }

        const geomId = `${linkName}:${purpose}:${index}`;
        const materialName = parsed.material?.name || parsed.materialName || null;
        const rebasedOrigin = rebaseLocalTransform(parseTransform(geomElement, angleUnit), rebaseOffset);
        const geometryElement: GeometryElement = {
            id: geomId,
            name: geomElement.getAttribute('name') || `${linkName}_${purpose}_${index}`,
            link: linkName,
            origin: rebasedOrigin,
            geometry: parsed.geometry,
            material: materialName,
            visible: purpose === 'visual',
            purpose
        };

        if (parsed.material) {
            upsertMaterial(document.materials.materials, parsed.material);
            document.semantics.materials[parsed.material.name] = {
                mjcf: {
                    originalAttributes: getAttributes(geomElement)
                }
            };
        }

        if (purpose === 'visual') {
            visuals.push(geometryElement);
            document.semantics.visuals[geomId] = createMJCFSemanticBag(geomElement);
        } else {
            collisions.push(geometryElement);
            document.semantics.collisions[geomId] = createMJCFSemanticBag(geomElement);
        }
    });

    return { visuals, collisions };
}

function parseGeomElement(params: {
    element: Element;
    linkName: string;
    index: number;
    purpose: 'visual' | 'collision';
    materials: MaterialMap;
    meshAssets: Map<string, MeshAsset>;
    fileMap: Map<string, File>;
    basePath: string;
    angleUnit: AngleUnit;
    inheritedProps: DefaultProperties['geom'];
}): { geometry: GeometryDefinition | null; material?: MaterialDefinition; materialName?: string | null; } {
    const { element, linkName, index, purpose, materials, meshAssets, fileMap, basePath, inheritedProps } = params;
    const meshRef = element.getAttribute('mesh');
    const geomType = element.getAttribute('type') || inheritedProps?.type || (meshRef ? 'mesh' : 'sphere');
    const size = splitNumbers(element.getAttribute('size'));
    const materialName = element.getAttribute('material') || inheritedProps?.material || null;
    const rgba = parseVec4(element.getAttribute('rgba')) || inheritedProps?.rgba || undefined;
    let geometry: GeometryDefinition | null = null;

    switch (geomType) {
        case 'box':
            geometry = {
                kind: 'box',
                size: size.length >= 3 ? { x: size[0] * 2, y: size[1] * 2, z: size[2] * 2 } : undefined
            };
            break;
        case 'sphere':
            geometry = {
                kind: 'sphere',
                radius: size[0]
            };
            break;
        case 'cylinder':
            geometry = {
                kind: 'cylinder',
                radius: size[0],
                height: size.length >= 2 ? size[1] * 2 : undefined
            };
            break;
        case 'capsule':
            geometry = {
                kind: 'capsule',
                radius: size[0],
                height: size.length >= 2 ? size[1] * 2 : undefined
            };
            break;
        case 'plane':
            geometry = {
                kind: 'plane',
                size: size.length >= 2 ? { x: size[0] * 2, y: size[1] * 2, z: size[2] || 0.01 } : undefined,
                normal: parseVec3(element.getAttribute('normal'))
            };
            break;
        case 'mesh': {
            const asset = meshRef ? meshAssets.get(meshRef) : null;
            const uri = asset?.file || meshRef;
            const resolvedUri = uri ? resolveAssetUri(uri, fileMap, basePath) : null;
            if (!uri) {
                geometry = null;
                break;
            }
            geometry = {
                kind: 'mesh',
                uri,
                resolvedUri,
                packageUri: uri.startsWith('package://') ? uri : null,
                scale: asset?.scale
            };
            break;
        }
        default:
            geometry = null;
            break;
    }

    if (purpose !== 'visual') {
        return { geometry, materialName };
    }

    if (materialName && materials.has(materialName)) {
        return {
            geometry,
            material: materials.get(materialName),
            materialName
        };
    }

    if (rgba) {
        return {
            geometry,
            material: {
                name: createInlineMaterialName(linkName, element.getAttribute('name') || `${purpose}_${index}`),
                baseColor: rgba,
                alpha: rgba.w,
                opacity: rgba.w,
                shaderModel: 'phong'
            }
        };
    }

    return { geometry, materialName };
}

function parseInertial(params: {
    element: Element;
    linkName: string;
    angleUnit: AngleUnit;
    rebaseOffset: Transform | null;
}) {
    const { element, linkName, angleUnit, rebaseOffset } = params;
    const origin = rebaseLocalTransform(parseTransform(element, angleUnit), rebaseOffset);
    const fullInertia = splitNumbers(element.getAttribute('fullinertia'));
    const diagInertia = splitNumbers(element.getAttribute('diaginertia'));

    let inertia = null;
    if (fullInertia.length >= 6) {
        inertia = {
            ixx: fullInertia[0],
            iyy: fullInertia[1],
            izz: fullInertia[2],
            ixy: fullInertia[3],
            ixz: fullInertia[4],
            iyz: fullInertia[5]
        };
    } else if (diagInertia.length >= 3) {
        inertia = {
            ixx: diagInertia[0],
            iyy: diagInertia[1],
            izz: diagInertia[2],
            ixy: 0,
            ixz: 0,
            iyz: 0
        };
    }

    return {
        name: `${linkName}_physics`,
        link: linkName,
        mass: readNumber(element.getAttribute('mass')),
        centerOfMass: origin.translation,
        inertialOrigin: origin,
        inertia
    };
}

function parseEquality(root: Element, document: ReturnType<typeof createEmptyRobotDocument>): void {
    const equalityEl = findDirectChild(root, 'equality');
    if (!equalityEl) {
        return;
    }

    const equalityItems: unknown[] = [];
    collectDirectChildren(equalityEl, 'joint').forEach((jointEl, index) => {
        const joint1 = jointEl.getAttribute('joint1');
        const joint2 = jointEl.getAttribute('joint2');
        if (!joint1 || !joint2) {
            return;
        }

        const polycoef = splitNumbers(jointEl.getAttribute('polycoef'));
        const item = {
            type: 'joint',
            name: jointEl.getAttribute('name') || `joint_equality_${index}`,
            joint1,
            joint2,
            polycoef: polycoef.length > 0 ? polycoef : [0, 1]
        };
        equalityItems.push(item);

        const constraint: TopologyConstraint = {
            name: item.name,
            type: 'mjcf-equality-joint',
            references: [joint1, joint2],
            properties: item as unknown as Record<string, unknown>
        };
        document.structure.constraints.push(constraint);
    });

    document.semantics.robot.mjcf = {
        ...(document.semantics.robot.mjcf || {}),
        equality: equalityItems
    };
}

function parseActuators(root: Element, document: ReturnType<typeof createEmptyRobotDocument>): void {
    const actuatorEl = findDirectChild(root, 'actuator');
    if (!actuatorEl) {
        return;
    }

    const actuators: ParsedMJCFActuator[] = Array.from(actuatorEl.children).map((actuatorNode, index) => ({
        type: actuatorNode.tagName,
        name: actuatorNode.getAttribute('name') || `${actuatorNode.tagName}_${index}`,
        joint: actuatorNode.getAttribute('joint') || undefined,
        tendon: actuatorNode.getAttribute('tendon') || undefined,
        site: actuatorNode.getAttribute('site') || undefined,
        gear: splitNumbers(actuatorNode.getAttribute('gear')),
        attributes: getAttributes(actuatorNode),
        children: Array.from(actuatorNode.children).map(serializeElement)
    }));

    document.semantics.robot.mjcf = {
        ...(document.semantics.robot.mjcf || {}),
        actuators
    };
}

function parseDefaults(root: Element, angleUnit: AngleUnit): {
    classDefaults: Map<string, DefaultProperties>;
    rootDefaults: DefaultProperties;
} {
    const classDefaults = new Map<string, DefaultProperties>();
    const rootDefaults: DefaultProperties = {};

    const parseDefaultElement = (defaultElement: Element, parentDefaults: DefaultProperties): void => {
        const defaults = cloneDefaults(parentDefaults);

        const meshEl = findDirectChild(defaultElement, 'mesh');
        if (meshEl) {
            defaults.mesh = defaults.mesh || {};
            defaults.mesh.scale = parseScale(meshEl.getAttribute('scale')) || defaults.mesh.scale;
        }

        const geomEl = findDirectChild(defaultElement, 'geom');
        if (geomEl) {
            defaults.geom = defaults.geom || {};
            defaults.geom.type = geomEl.getAttribute('type') || defaults.geom.type || null;
            defaults.geom.material = geomEl.getAttribute('material') || defaults.geom.material || null;
            defaults.geom.group = parseIntegerAttribute(geomEl, 'group') ?? defaults.geom.group ?? null;
            defaults.geom.contype = parseIntegerAttribute(geomEl, 'contype') ?? defaults.geom.contype ?? null;
            defaults.geom.conaffinity = parseIntegerAttribute(geomEl, 'conaffinity') ?? defaults.geom.conaffinity ?? null;
            defaults.geom.density = readNumber(geomEl.getAttribute('density')) ?? defaults.geom.density ?? null;
            defaults.geom.rgba = parseVec4(geomEl.getAttribute('rgba')) || defaults.geom.rgba || null;
        }

        const jointEl = findDirectChild(defaultElement, 'joint');
        if (jointEl) {
            defaults.joint = defaults.joint || {};
            defaults.joint.type = jointEl.getAttribute('type') || defaults.joint.type || null;
            defaults.joint.axis = parseVec3(jointEl.getAttribute('axis')) || defaults.joint.axis || null;
            defaults.joint.range = parseRange(jointEl.getAttribute('range'), angleUnit, defaults.joint.type || 'hinge') || defaults.joint.range || null;
            defaults.joint.damping = readNumber(jointEl.getAttribute('damping')) ?? defaults.joint.damping ?? null;
            defaults.joint.frictionloss = readNumber(jointEl.getAttribute('frictionloss')) ?? defaults.joint.frictionloss ?? null;
            defaults.joint.stiffness = readNumber(jointEl.getAttribute('stiffness')) ?? defaults.joint.stiffness ?? null;
            defaults.joint.armature = readNumber(jointEl.getAttribute('armature')) ?? defaults.joint.armature ?? null;
        }

        const className = defaultElement.getAttribute('class');
        if (className) {
            classDefaults.set(className, defaults);
        } else {
            Object.assign(rootDefaults, defaults);
        }

        collectDirectChildren(defaultElement, 'default').forEach(childDefault => {
            parseDefaultElement(childDefault, defaults);
        });
    };

    collectDirectChildren(root, 'default').forEach(defaultElement => {
        parseDefaultElement(defaultElement, {});
    });

    return { classDefaults, rootDefaults };
}

function parseMeshAssets(
    root: Element,
    classDefaults: Map<string, DefaultProperties>,
    rootDefaults: DefaultProperties,
    fileMap: Map<string, File>,
    basePath: string
): Map<string, MeshAsset> {
    const assets = new Map<string, MeshAsset>();
    const assetEl = findDirectChild(root, 'asset');
    if (!assetEl) {
        return assets;
    }

    collectDirectChildren(assetEl, 'mesh').forEach((meshEl, index) => {
        const name = meshEl.getAttribute('name') || `mesh_${index}`;
        const className = meshEl.getAttribute('class');
        const inheritedScale = className ? classDefaults.get(className)?.mesh?.scale : rootDefaults.mesh?.scale;
        const file = meshEl.getAttribute('file') || undefined;
        assets.set(name, {
            name,
            file,
            resolvedUri: file ? resolveAssetUri(file, fileMap, basePath) : null,
            scale: parseScale(meshEl.getAttribute('scale')) || inheritedScale
        });
    });

    return assets;
}

function parseAssetMaterials(root: Element): MaterialMap {
    const materials = new Map<string, MaterialDefinition>();
    const assetEl = findDirectChild(root, 'asset');
    if (!assetEl) {
        return materials;
    }

    collectDirectChildren(assetEl, 'material').forEach((materialEl, index) => {
        const name = materialEl.getAttribute('name') || `material_${index}`;
        const rgba = parseVec4(materialEl.getAttribute('rgba'));
        const shininess = readNumber(materialEl.getAttribute('shininess'));

        materials.set(name, {
            name,
            baseColor: rgba,
            alpha: rgba?.w,
            opacity: rgba?.w,
            specular: readNumber(materialEl.getAttribute('specular')) ?? undefined,
            roughness: shininess !== null && shininess !== undefined ? Math.max(0, 1 - shininess) : undefined,
            shaderModel: 'phong'
        });
    });

    return materials;
}

function resolveGeomDefaults(
    element: Element | null,
    inheritedChildClass: string | null,
    rootDefaults: DefaultProperties,
    classDefaults?: Map<string, DefaultProperties>
): DefaultProperties['geom'] {
    const className = element?.getAttribute('class') || inheritedChildClass;
    const base = cloneDefaults(rootDefaults).geom || {};
    if (className && classDefaults?.has(className)) {
        Object.assign(base, cloneDefaults(classDefaults.get(className) || {}).geom || {});
    }
    return base;
}

function resolveJointDefaults(
    element: Element | null,
    inheritedChildClass: string | null,
    classDefaults: Map<string, DefaultProperties>,
    rootDefaults: DefaultProperties
): DefaultProperties['joint'] {
    const className = element?.getAttribute('class') || inheritedChildClass;
    const base = cloneDefaults(rootDefaults).joint || {};
    if (className && classDefaults.has(className)) {
        Object.assign(base, cloneDefaults(classDefaults.get(className) || {}).joint || {});
    }
    return base;
}

function classifyGeomPurpose(
    geomElement: Element,
    inheritedProps: DefaultProperties['geom'],
    seenMeshes: Set<string>
): 'visual' | 'collision' {
    const meshRef = geomElement.getAttribute('mesh');
    const hasRgba = Boolean(geomElement.getAttribute('rgba') || inheritedProps?.rgba);
    const materialRef = geomElement.getAttribute('material') || inheritedProps?.material;
    const group = parseIntegerAttribute(geomElement, 'group') ?? inheritedProps?.group ?? null;
    const contype = parseIntegerAttribute(geomElement, 'contype') ?? inheritedProps?.contype ?? null;
    const conaffinity = parseIntegerAttribute(geomElement, 'conaffinity') ?? inheritedProps?.conaffinity ?? null;
    const density = readNumber(geomElement.getAttribute('density')) ?? inheritedProps?.density ?? null;
    const name = (geomElement.getAttribute('name') || '').toLowerCase();

    if (contype === 0 && conaffinity === 0) {
        if (meshRef) {
            seenMeshes.add(meshRef);
        }
        return 'visual';
    }

    if (group === 3) {
        return 'collision';
    }

    if (group === 1 || group === 2) {
        if (meshRef) {
            seenMeshes.add(meshRef);
        }
        return 'visual';
    }

    if (name.includes('collision')) {
        return 'collision';
    }

    if (!meshRef) {
        return hasRgba || materialRef || density === 0 ? 'visual' : 'collision';
    }

    if (seenMeshes.has(meshRef) && !(hasRgba || materialRef)) {
        return 'collision';
    }

    if (density === 0 || hasRgba || materialRef) {
        seenMeshes.add(meshRef);
        return 'visual';
    }

    seenMeshes.add(meshRef);
    return 'visual';
}

function buildJointLimits(
    jointType: string,
    lower: number | null,
    upper: number | null,
    jointElement: Element
): JointLimits | null {
    if (!['revolute', 'prismatic', 'continuous', 'planar'].includes(jointType)) {
        return null;
    }

    return {
        lower,
        upper,
        effort: readNumber(jointElement.getAttribute('actuatorfrcrange')?.split(/\s+/)[1] || null),
        velocity: readNumber(jointElement.getAttribute('actuatorvelrange')?.split(/\s+/)[1] || null)
    };
}

function buildJointDynamics(jointElement: Element, defaults?: DefaultProperties['joint']): JointDynamics | null {
    const damping = readNumber(jointElement.getAttribute('damping')) ?? defaults?.damping ?? null;
    const friction = readNumber(jointElement.getAttribute('frictionloss')) ?? defaults?.frictionloss ?? null;
    const stiffness = readNumber(jointElement.getAttribute('stiffness')) ?? defaults?.stiffness ?? null;
    const armature = readNumber(jointElement.getAttribute('armature')) ?? defaults?.armature ?? null;

    if ([damping, friction, stiffness, armature].every(value => value === null || value === undefined)) {
        return null;
    }

    return {
        damping,
        friction,
        stiffness,
        armature
    };
}

function mapMJCFJointType(type: string, range: [number, number] | null): string {
    switch (type) {
        case 'hinge':
            return range ? 'revolute' : 'continuous';
        case 'slide':
            return 'prismatic';
        case 'free':
            return 'floating';
        case 'ball':
            return 'ball';
        default:
            return 'fixed';
    }
}

function parseJointLocalOffset(jointElement: Element, angleUnit: AngleUnit): Transform {
    const offset = createDefaultTransform();
    const pos = parseVec3(jointElement.getAttribute('pos'));
    if (pos) {
        offset.translation = pos;
    }

    const euler = parseEuler(jointElement.getAttribute('euler'), angleUnit);
    if (euler) {
        offset.rotationRPY = euler;
    }

    const quat = parseQuat(jointElement.getAttribute('quat'));
    if (quat) {
        offset.rotationQuat = quat;
        delete offset.rotationRPY;
    }

    return offset;
}

function parseTransform(element: Element, angleUnit: AngleUnit): Transform {
    const transform = createDefaultTransform();
    const pos = parseVec3(element.getAttribute('pos'));
    const quat = parseQuat(element.getAttribute('quat'));
    const euler = parseEuler(element.getAttribute('euler'), angleUnit);

    if (pos) {
        transform.translation = pos;
    }
    if (quat) {
        transform.rotationQuat = quat;
        delete transform.rotationRPY;
    } else if (euler) {
        transform.rotationRPY = euler;
    }

    return transform;
}

function composeTransforms(base: Transform, local: Transform): Transform {
    const result = createDefaultTransform();
    result.translation = {
        x: base.translation.x + local.translation.x,
        y: base.translation.y + local.translation.y,
        z: base.translation.z + local.translation.z
    };
    result.rotationQuat = base.rotationQuat || local.rotationQuat ? (local.rotationQuat || base.rotationQuat) : undefined;
    result.rotationRPY = base.rotationRPY || local.rotationRPY
        ? {
            x: (base.rotationRPY?.x || 0) + (local.rotationRPY?.x || 0),
            y: (base.rotationRPY?.y || 0) + (local.rotationRPY?.y || 0),
            z: (base.rotationRPY?.z || 0) + (local.rotationRPY?.z || 0)
        }
        : undefined;
    return result;
}

function relativeTransform(current: Transform, previous: Transform | null): Transform {
    if (!previous) {
        return current;
    }

    const relative = createDefaultTransform();
    relative.translation = {
        x: current.translation.x - previous.translation.x,
        y: current.translation.y - previous.translation.y,
        z: current.translation.z - previous.translation.z
    };

    if (current.rotationRPY && previous.rotationRPY) {
        relative.rotationRPY = {
            x: current.rotationRPY.x - previous.rotationRPY.x,
            y: current.rotationRPY.y - previous.rotationRPY.y,
            z: current.rotationRPY.z - previous.rotationRPY.z
        };
    } else if (current.rotationRPY) {
        relative.rotationRPY = current.rotationRPY;
    }

    if (current.rotationQuat && !previous.rotationQuat) {
        relative.rotationQuat = current.rotationQuat;
    }

    return relative;
}

function rebaseLocalTransform(local: Transform, offset: Transform | null): Transform {
    if (!offset) {
        return local;
    }

    const rebased = {
        ...local,
        translation: {
            x: local.translation.x - offset.translation.x,
            y: local.translation.y - offset.translation.y,
            z: local.translation.z - offset.translation.z
        }
    };
    return rebased;
}

function isIdentityTransform(transform: Transform): boolean {
    const translation = transform.translation;
    const rotation = transform.rotationRPY;
    const quat = transform.rotationQuat;

    return translation.x === 0 &&
        translation.y === 0 &&
        translation.z === 0 &&
        (!rotation || (rotation.x === 0 && rotation.y === 0 && rotation.z === 0)) &&
        (!quat || (quat.x === 0 && quat.y === 0 && quat.z === 0 && quat.w === 1));
}

function hasJointDynamics(dynamics: JointDynamics): boolean {
    return Boolean(
        dynamics.damping !== undefined ||
        dynamics.friction !== undefined ||
        dynamics.stiffness !== undefined ||
        dynamics.armature !== undefined
    );
}

function createInlineMaterialName(linkName: string, geomName: string): string {
    return `${sanitizeName(linkName)}_${sanitizeName(geomName)}_material`;
}

function createBodyLinkChain(bodyLinkName: string, jointElements: Element[], usedNames: Set<string>): string[] {
    if (jointElements.length <= 1) {
        return [bodyLinkName];
    }

    const syntheticLinks = jointElements.slice(0, -1).map((jointElement, index) => {
        const jointName = jointElement.getAttribute('name') || `joint_${index}`;
        return createUniqueName(`${bodyLinkName}_${jointName}_link`, usedNames);
    });

    return [...syntheticLinks, bodyLinkName];
}

function attachJoint(
    document: ReturnType<typeof createEmptyRobotDocument>,
    joint: ReturnType<typeof parseJointElement> | ReturnType<typeof createFixedJoint>,
    semanticsSource: Element
): void {
    document.structure.joints.push(joint);
    document.semantics.joints[joint.name] = createMJCFSemanticBag(semanticsSource);

    const parentNode = document.structure.links.find(link => link.name === joint.parentLink);
    if (parentNode) {
        parentNode.childJoints.push(joint.name);
    }

    const childNode = document.structure.links.find(link => link.name === joint.childLink);
    if (childNode) {
        childNode.parentJoint = joint.name;
    }
}

function createUniqueName(name: string, usedNames: Set<string>): string {
    const base = sanitizeName(name) || 'node';
    if (!usedNames.has(base)) {
        usedNames.add(base);
        return base;
    }

    let index = 1;
    while (usedNames.has(`${base}_${index}`)) {
        index += 1;
    }

    const unique = `${base}_${index}`;
    usedNames.add(unique);
    return unique;
}

function sanitizeName(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
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

function cloneDefaults(defaults: DefaultProperties): DefaultProperties {
    return JSON.parse(JSON.stringify(defaults || {}));
}

function createMJCFSemanticBag(element: Element | null): SemanticExtrasBag {
    if (!element) {
        return {};
    }

    return {
        mjcf: {
            originalAttributes: getAttributes(element)
        }
    };
}

function collectDirectChildren(parent: Element, tagName: string): Element[] {
    return Array.from(parent.children).filter(child => child.tagName === tagName);
}

function collectDirectChildrenByTags(parent: Element, tagNames: string[]): Element[] {
    const tags = new Set(tagNames);
    return Array.from(parent.children).filter(child => tags.has(child.tagName));
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

    const attributes: Record<string, unknown> = {};
    Array.from(element.attributes).forEach(attribute => {
        attributes[attribute.name] = attribute.value;
    });
    return attributes;
}

function serializeElement(element: Element): XMLNodeSnapshot {
    return {
        tag: element.tagName,
        attributes: getAttributes(element),
        textContent: getTextContent(element),
        xml: new XMLSerializer().serializeToString(element),
        children: Array.from(element.children).map(child => serializeElement(child))
    };
}

function getTextContent(element: Element): string | undefined {
    const text = element.textContent?.trim();
    return text ? text : undefined;
}

function parseScale(value: string | null): Vec3 | undefined {
    const numbers = splitNumbers(value);
    if (numbers.length === 1) {
        return { x: numbers[0], y: numbers[0], z: numbers[0] };
    }
    if (numbers.length >= 3) {
        return { x: numbers[0], y: numbers[1], z: numbers[2] };
    }
    return undefined;
}

function parseVec3(value: string | null): Vec3 | undefined {
    const numbers = splitNumbers(value);
    if (numbers.length < 3) {
        return undefined;
    }

    return {
        x: numbers[0],
        y: numbers[1],
        z: numbers[2]
    };
}

function parseVec4(value: string | null): Vec4 | undefined {
    const numbers = splitNumbers(value);
    if (numbers.length < 4) {
        return undefined;
    }

    return {
        x: numbers[0],
        y: numbers[1],
        z: numbers[2],
        w: numbers[3]
    };
}

function parseQuat(value: string | null): Vec4 | undefined {
    const numbers = splitNumbers(value);
    if (numbers.length < 4) {
        return undefined;
    }

    return {
        x: numbers[1],
        y: numbers[2],
        z: numbers[3],
        w: numbers[0]
    };
}

function parseEuler(value: string | null, angleUnit: AngleUnit): Vec3 | undefined {
    const euler = parseVec3(value);
    if (!euler) {
        return undefined;
    }

    if (angleUnit === 'radian') {
        return euler;
    }

    return {
        x: degreesToRadians(euler.x),
        y: degreesToRadians(euler.y),
        z: degreesToRadians(euler.z)
    };
}

function parseRange(value: string | null, angleUnit: AngleUnit, jointType: string): [number, number] | null {
    const numbers = splitNumbers(value);
    if (numbers.length < 2) {
        return null;
    }

    if (jointType === 'hinge' && angleUnit === 'degree') {
        return [degreesToRadians(numbers[0]), degreesToRadians(numbers[1])];
    }

    return [numbers[0], numbers[1]];
}

function splitNumbers(value: string | null): number[] {
    if (!value) {
        return [];
    }

    return value
        .trim()
        .split(/\s+/)
        .map(part => Number.parseFloat(part))
        .filter(part => !Number.isNaN(part));
}

function parseIntegerAttribute(element: Element, attributeName: string): number | null {
    const raw = element.getAttribute(attributeName);
    if (raw === null || raw === '') {
        return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function readNumber(value: string | null): number | null {
    if (value === null || value === '') {
        return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function degreesToRadians(value: number): number {
    return value * (Math.PI / 180);
}

function stripExtension(fileName?: string): string | null {
    if (!fileName) {
        return null;
    }

    return fileName.replace(/\.[^/.]+$/, '');
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

function resolveAssetUri(uri: string, fileMap: Map<string, File>, basePath: string): string | null {
    const normalized = normalizePath(uri);
    const candidates = [
        normalized,
        joinPath(basePath, normalized)
    ];

    for (const candidate of candidates) {
        if (fileMap.has(candidate)) {
            return candidate;
        }
    }

    return candidates[1] || normalized || null;
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
