export type RobotFormat = 'urdf' | 'mjcf' | 'usd';

export type BinaryContent = string | Uint8Array | ArrayBuffer;

export interface Vec2 {
    x: number;
    y: number;
}

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Vec4 {
    x: number;
    y: number;
    z: number;
    w: number;
}

export interface Transform {
    translation: Vec3;
    rotationRPY?: Vec3;
    rotationQuat?: Vec4;
    scale?: Vec3;
}

export interface NamedEntity {
    name: string;
    displayName?: string;
    notes?: string;
}

export interface LinkNode extends NamedEntity {
    parentJoint?: string | null;
    childJoints: string[];
}

export interface JointLimits {
    lower?: number | null;
    upper?: number | null;
    effort?: number | null;
    velocity?: number | null;
}

export interface JointDynamics {
    damping?: number | null;
    friction?: number | null;
    stiffness?: number | null;
    armature?: number | null;
}

export interface JointNode extends NamedEntity {
    type: 'fixed' | 'revolute' | 'continuous' | 'prismatic' | 'floating' | 'planar' | 'ball' | string;
    parentLink: string;
    childLink: string;
    origin: Transform;
    axis?: Vec3 | null;
    limits?: JointLimits | null;
    dynamics?: JointDynamics | null;
}

export interface TopologyConstraint extends NamedEntity {
    type: string;
    references: string[];
    properties?: Record<string, unknown>;
}

export interface StructureLayer {
    rootLink: string | null;
    links: LinkNode[];
    joints: JointNode[];
    constraints: TopologyConstraint[];
}

export interface PrimitiveGeometry {
    kind: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'plane';
    size?: Vec3;
    radius?: number;
    height?: number;
    length?: number;
    normal?: Vec3;
}

export interface MeshGeometry {
    kind: 'mesh';
    uri: string;
    resolvedUri?: string | null;
    packageUri?: string | null;
    scale?: Vec3;
    submesh?: string;
}

export interface PointCloudGeometry {
    kind: 'point-cloud';
    uri?: string;
    points?: Vec3[];
}

export type GeometryDefinition = PrimitiveGeometry | MeshGeometry | PointCloudGeometry;

export interface GeometryElement extends NamedEntity {
    id: string;
    link: string;
    origin: Transform;
    geometry: GeometryDefinition;
    material?: string | null;
    visible?: boolean;
    purpose?: 'visual' | 'collision' | 'proxy' | 'guide' | string;
    tags?: string[];
}

export interface GeometryLayer {
    visuals: GeometryElement[];
    collisions: GeometryElement[];
}

export interface InertiaTensor {
    ixx: number;
    iyy: number;
    izz: number;
    ixy?: number;
    ixz?: number;
    iyz?: number;
}

export interface LinkPhysics extends NamedEntity {
    link: string;
    mass?: number | null;
    centerOfMass?: Vec3 | null;
    inertialOrigin?: Transform | null;
    inertia?: InertiaTensor | null;
}

export interface JointPhysics extends NamedEntity {
    joint: string;
    damping?: number | null;
    friction?: number | null;
    stiffness?: number | null;
}

export interface PhysicsLayer {
    links: LinkPhysics[];
    joints: JointPhysics[];
}

export interface TextureReference {
    uri: string;
    uvScale?: Vec2;
    uvOffset?: Vec2;
}

export interface ShaderInputValue {
    type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4' | 'string';
    value: number | boolean | string | Vec2 | Vec3 | Vec4;
}

export interface MaterialDefinition extends NamedEntity {
    alpha?: number;
    baseColor?: Vec4;
    emissiveColor?: Vec3;
    metallic?: number;
    roughness?: number;
    specular?: number;
    opacity?: number;
    texture?: TextureReference | null;
    normalTexture?: TextureReference | null;
    shaderModel?: 'phong' | 'pbr' | 'unlit' | string;
    shaderInputs?: Record<string, ShaderInputValue>;
}

export interface MaterialLayer {
    materials: MaterialDefinition[];
}

export interface XMLNodeSnapshot {
    tag: string;
    attributes?: Record<string, unknown>;
    textContent?: string;
    xml?: string;
    children?: XMLNodeSnapshot[];
}

export interface URDFSemanticExtras {
    version?: string;
    originalXML?: string;
    packageMap?: Record<string, string>;
    transmissions?: XMLNodeSnapshot[];
    gazebo?: XMLNodeSnapshot[];
    childElements?: XMLNodeSnapshot[];
    mimic?: XMLNodeSnapshot | null;
    safetyController?: XMLNodeSnapshot | null;
    calibration?: XMLNodeSnapshot | null;
    dynamics?: XMLNodeSnapshot | null;
    limit?: XMLNodeSnapshot | null;
    inertial?: XMLNodeSnapshot | null;
    material?: XMLNodeSnapshot | null;
    originalAttributes?: Record<string, unknown>;
}

export interface MJCFSemanticExtras {
    compiler?: Record<string, unknown>;
    options?: Record<string, unknown>;
    defaults?: Record<string, unknown>;
    actuators?: unknown[];
    equality?: unknown[];
    contacts?: unknown[];
    originalAttributes?: Record<string, unknown>;
}

export interface USDSemanticExtras {
    defaultPrim?: string;
    upAxis?: string;
    metersPerUnit?: number;
    references?: string[];
    payloads?: string[];
    variants?: Record<string, string>;
    primPath?: string;
    originalAttributes?: Record<string, unknown>;
}

export interface SemanticExtrasBag {
    urdf?: URDFSemanticExtras;
    mjcf?: MJCFSemanticExtras;
    usd?: USDSemanticExtras;
    custom?: Record<string, unknown>;
}

export interface SemanticLayer {
    robot: SemanticExtrasBag;
    links: Record<string, SemanticExtrasBag>;
    joints: Record<string, SemanticExtrasBag>;
    visuals: Record<string, SemanticExtrasBag>;
    collisions: Record<string, SemanticExtrasBag>;
    materials: Record<string, SemanticExtrasBag>;
}

export interface RobotMetadata {
    name: string;
    sourceFormat?: RobotFormat;
    upAxis?: string;
    units?: {
        linear?: string;
        angular?: string;
        mass?: string;
    };
    sourceFileName?: string;
}

export interface RobotIRDocument {
    metadata: RobotMetadata;
    structure: StructureLayer;
    geometry: GeometryLayer;
    physics: PhysicsLayer;
    materials: MaterialLayer;
    semantics: SemanticLayer;
}

export interface ConversionMessage {
    code: string;
    level: 'info' | 'warning' | 'error';
    message: string;
    layer?: 'structure' | 'geometry' | 'physics' | 'materials' | 'semantics';
    entityName?: string;
}

export interface ConversionLossItem {
    layer: 'structure' | 'geometry' | 'physics' | 'materials' | 'semantics';
    entityName?: string;
    field: string;
    reason: string;
}

export interface ConversionReport {
    sourceFormat: RobotFormat;
    targetFormat: RobotFormat;
    messages: ConversionMessage[];
    losses: ConversionLossItem[];
}

export interface ParseSource {
    format: RobotFormat;
    content: BinaryContent;
    fileName?: string;
    path?: string;
    fileMap?: Map<string, File>;
}

export interface SerializeTarget {
    format: RobotFormat;
    fileName?: string;
}

export interface ParseContext {
    fileMap?: Map<string, File>;
    basePath?: string;
    packageMap?: Record<string, string>;
}

export interface SerializeContext {
    pretty?: boolean;
    inlineAssets?: boolean;
}

export interface ParseResult {
    document: RobotIRDocument;
    messages: ConversionMessage[];
}

export interface GeneratedArtifact {
    fileName: string;
    mimeType: string;
    content?: BinaryContent;
    sourcePath?: string;
}

export interface SerializeResult {
    format: RobotFormat;
    content: BinaryContent;
    mimeType: string;
    messages: ConversionMessage[];
    losses: ConversionLossItem[];
    artifacts?: GeneratedArtifact[];
}

export interface FormatParser {
    parse(source: ParseSource, context?: ParseContext): Promise<ParseResult>;
}

export interface FormatSerializer {
    serialize(document: RobotIRDocument, target: SerializeTarget, context?: SerializeContext): Promise<SerializeResult>;
}

export function createDefaultTransform(): Transform {
    return {
        translation: { x: 0, y: 0, z: 0 },
        rotationRPY: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
    };
}

export function createEmptyRobotDocument(name = 'robot'): RobotIRDocument {
    return {
        metadata: {
            name
        },
        structure: {
            rootLink: null,
            links: [],
            joints: [],
            constraints: []
        },
        geometry: {
            visuals: [],
            collisions: []
        },
        physics: {
            links: [],
            joints: []
        },
        materials: {
            materials: []
        },
        semantics: {
            robot: {},
            links: {},
            joints: {},
            visuals: {},
            collisions: {},
            materials: {}
        }
    };
}

export class RobotConverter {
    private parsers = new Map<RobotFormat, FormatParser>();
    private serializers = new Map<RobotFormat, FormatSerializer>();

    hasParser(format: RobotFormat): boolean {
        return this.parsers.has(format);
    }

    hasSerializer(format: RobotFormat): boolean {
        return this.serializers.has(format);
    }

    registerParser(format: RobotFormat, parser: FormatParser): void {
        this.parsers.set(format, parser);
    }

    registerSerializer(format: RobotFormat, serializer: FormatSerializer): void {
        this.serializers.set(format, serializer);
    }

    async parse(source: ParseSource, context: ParseContext = {}): Promise<ParseResult> {
        const parser = this.parsers.get(source.format);
        if (!parser) {
            throw new Error(`No parser registered for format: ${source.format}`);
        }

        return parser.parse(source, context);
    }

    async serialize(document: RobotIRDocument, target: SerializeTarget, context: SerializeContext = {}): Promise<SerializeResult> {
        const serializer = this.serializers.get(target.format);
        if (!serializer) {
            throw new Error(`No serializer registered for format: ${target.format}`);
        }

        return serializer.serialize(document, target, context);
    }

    async convert(source: ParseSource, target: SerializeTarget, parseContext: ParseContext = {}, serializeContext: SerializeContext = {}): Promise<{ result: SerializeResult; report: ConversionReport; }> {
        const parsed = await this.parse(source, parseContext);
        const serialized = await this.serialize(parsed.document, target, serializeContext);

        return {
            result: serialized,
            report: {
                sourceFormat: source.format,
                targetFormat: target.format,
                messages: [...parsed.messages, ...serialized.messages],
                losses: serialized.losses
            }
        };
    }
}
