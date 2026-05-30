import {
  Vector3,
  Box3,
  PerspectiveCamera,
  Scene,
  Group,
  WebGLRenderer,
  SRGBColorSpace,
  NeutralToneMapping,
  VSMShadowMap,
  PMREMGenerator,
  EquirectangularReflectionMapping,
  AmbientLight,
  DirectionalLight,
  AxesHelper,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  Matrix4,
  Quaternion,
  Euler,
} from "three";
import { ThreeRenderDelegateInterface } from "./hydra/ThreeJsRenderDelegate.js";
import { clearHydraWarnings } from "./hydra/HydraPrimitives.js";
import {
  shouldInclude,
  isUsdFile,
  getFileFromHandle,
  parseFilePath,
  safeCall,
  getEntryFile,
} from "./usdUtils.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import "./bindings/emHdBindings.js";

const getUsdModule = globalThis["NEEDLE:USD:GET"];
const USD_VIEWER_BASE_URL = new URL("./", import.meta.url);
const getUsdViewerUrl = (path) => new URL(path, USD_VIEWER_BASE_URL).toString();
const toUsdFsPath = (path) => {
  if (!path) return "/";
  const normalized = String(path).replace(/\\/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const SKIP_DIRS = [
  ".git",
  "node_modules",
  "__pycache__",
  ".vscode",
  ".idea",
  "build",
  "dist",
  ".next",
];
const SKIP_FILES = [
  ".gitignore",
  "README.md",
  "LICENSE",
  "package.json",
  ".DS_Store",
  ".env",
];
const SYS_DIRS = ["/dev/", "/proc/", "/home/", "/tmp/", "/usd/"];

export function init(options = { container: null, hdrPath: null }) {
  return new Promise((resolveInit) => {
    if (!options?.container) {
      throw new Error("init: options.container is required");
    }
    options.hdrPath ||= getUsdViewerUrl("environments/neutral.hdr");

    let handle = null;

    const run = () => {
      let USD;
      let resolveUsdReady;
      const usdReady = new Promise((resolve) => {
        resolveUsdReady = resolve;
      });

      // Install a lightweight fetch rewrite so requests to "/host/..." are
      // mapped to the current asset base directory of the last loaded URL
      function installFetchRewrite() {
        if (window.__usdFetchRewritten) return;
        const origFetch = window.fetch.bind(window);
        window.fetch = (input, init) => {
          try {
            const url = typeof input === "string" ? input : input?.url;
            if (url?.startsWith("/host/") && window.__usdAssetBase) {
              const mapped = window.__usdAssetBase + url.substring(6);
              return origFetch(mapped, init);
            }
          } catch {}
          return origFetch(input, init);
        };
        window.__usdFetchRewritten = true;
      }

      let currentDisplayFilename = "";
      const displayOptions = {
        visual: true,
        collision: false,
        com: false,
        inertia: false,
        axes: false,
        jointAxes: false,
      };
      const usdHelpers = {
        axes: new Group(),
        jointAxes: new Group(),
        com: new Group(),
        inertia: new Group(),
        collision: new Group(),
      };
      let usdLinkAxes = [];
      let usdPhysicsInfo = {
        physicsAvailable: false,
        joints: [],
        rigidBodies: [],
        collisions: [],
      };
      const initPromise = setup();

      console.log("Loading USD Module...");
      try {
        Promise.all([
          getUsdModule({
            mainScriptUrlOrBlob: getUsdViewerUrl("bindings/emHdBindings.js"),
            locateFile: (file) => {
              return getUsdViewerUrl("bindings/" + file);
            },
            // Suppress noisy OpenUSD discovery warnings that don't affect functionality
            printErr: (text) => {
              try {
                const s = String(text || "");
                if (
                  s.includes("_FindAndInstantiateDiscoveryPlugins") ||
                  s.includes("/ndr/registry.cpp") ||
                  s.includes("Failed verification: ' pluginFactory '") ||
                  // Harmless when loading packaged USDZ read-only; USD attempts to save are blocked
                  s.includes("_WriteToFile") ||
                  s.includes("/sdf/layer.cpp") ||
                  s.includes(
                    "writing package usdz layer is not allowed through this API"
                  )
                ) {
                  return;
                }
              } catch {}
              // Fallback to standard error output for everything else
              try {
                console.error(text);
              } catch {}
            },
          }),
          initPromise,
        ]).then(async ([Usd]) => {
          USD = Usd;
          if (resolveUsdReady) resolveUsdReady(USD);
          animate();
        });
      } catch (error) {
        if (error.toString().indexOf("SharedArrayBuffer") >= 0) {
          console.log(
            error,
            "Your current browser doesn't support SharedArrayBuffer which is required for USD."
          );
        } else {
          console.log(
            "Your current browser doesn't support USD-for-web. Error during initialization: " +
              error
          );
        }
      }

      let timeout = 40;
      let endTimeCode = 1;
      let ready = false;

      const usdzExportBtn = document.getElementById("export-usdz");
      if (usdzExportBtn)
        usdzExportBtn.addEventListener("click", () => {
          alert("usdz");
        });

      const gltfExportBtn = document.getElementById("export-gltf");
      if (gltfExportBtn)
        gltfExportBtn.addEventListener("click", (evt) => {
          const exporter = new GLTFExporter();
          console.log("EXPORTING GLTF", window.usdRoot);
          exporter.parse(
            window.usdRoot,
            function (gltf) {
              const blob = new Blob([gltf], {
                type: "application/octet-stream",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              let filename = currentDisplayFilename;
              // strip extension, strip path
              filename =
                filename.split("/").pop()?.split(".")[0].split("?")[0] ||
                "export";
              a.download = filename + ".glb";
              a.click();
              URL.revokeObjectURL(url);
            },
            function (error) {
              console.error(error);
            },
            {
              binary: true,
              // not possible right now since USD controls animation bindings,
              // it's not a three.js clip
              animations: [
                // window.usdRoot.animations[0]
              ],
            }
          );
          evt.preventDefault();
        });

      function getAllLoadedFiles() {
        const filePaths = [];

        getAllLoadedFilePaths("/", filePaths);

        return filePaths;
      }

      function getAllLoadedFilePaths(currentPath, paths) {
        const files = USD.FS_readdir(currentPath);
        for (const file of files) {
          if (file === "." || file === "..") continue;
          const newPath = currentPath + file + "/";
          const data = USD.FS_analyzePath(currentPath + file + "/");
          if (data.object.node_ops.readdir) {
            if (!SYS_DIRS.includes(newPath))
              getAllLoadedFilePaths(newPath, paths);
          } else {
            paths.push(data.path);
          }
        }
      }

      // safeCall imported

      function clearStage() {
        if (!USD) {
          console.warn("USD not ready; skipping clearStage.");
          return;
        }
        for (const group of Object.values(usdHelpers)) {
          clearHelperGroup(group);
          if (group.parent) group.parent.remove(group);
        }
        usdLinkAxes.forEach((helper) => {
          if (helper.parent) helper.parent.remove(helper);
        });
        usdLinkAxes = [];
        usdPhysicsInfo = {
          physicsAvailable: false,
          joints: [],
          rigidBodies: [],
          collisions: [],
        };
        clearHydraWarnings();
        // Try to dispose the driver/stage first to avoid any layer save attempts
        if (!safeCall(window.driver, "Dispose")) {
          safeCall(window.driver, "Destroy");
        }
        // Clear the rendered scene graph before touching the virtual FS
        safeCall(window.usdRoot, "clear");

        // Then unlink files from the in-memory FS, but keep .usdz packages to
        // avoid triggering writes to packaged layers
        const allFilePaths = getAllLoadedFiles();
        for (const file of allFilePaths) {
          if (String(file).toLowerCase().endsWith(".usdz")) {
            continue;
          }
          USD.FS_unlink(file, true);
        }
      }

      function addPath(root, path) {
        const files = USD.FS_readdir(path);
        for (const file of files) {
          if (file === "." || file === "..") continue;
          const newPath = path + file + "/";
          const data = USD.FS_analyzePath(path + file + "/");
          if (data.object.node_ops.readdir) {
            if (!SYS_DIRS.includes(newPath)) {
              root[file] = {};
              addPath(root[file], newPath);
            }
          } else {
            root[file] = data;
          }
        }
      }

      async function loadUsdFile(directory, filename, path, isRootFile = true) {
        currentDisplayFilename = filename;
        ready = false;

        // should be loaded last
        if (!isRootFile) return;

        let driver = null;
        const delegateConfig = {
          usdRoot: window.usdRoot,
          paths: [],
          driver: () => driver,
        };

        const renderInterface = (window.renderInterface =
          new ThreeRenderDelegateInterface(delegateConfig));
        driver = new USD.HdWebSyncDriver(renderInterface, path);
        if (driver instanceof Promise) {
          driver = await driver;
        }
        window.driver = driver;
        window.driver.Draw();

        let stage = window.driver.GetStage();
        if (stage instanceof Promise) {
          stage = await stage;
          stage = window.driver.GetStage();
        }
        window.usdStage = stage;
        if (stage.GetEndTimeCode) {
          endTimeCode = stage.GetEndTimeCode();
          timeout = 1000 / stage.GetTimeCodesPerSecond();
        }

        // if up axis is z, rotate, otherwise make sure rotation is 0, in case we rotated in the past and need to undo it
        window.usdRoot.rotation.x =
          String.fromCharCode(stage.GetUpAxis()) === "z" ? -Math.PI / 2 : 0;

        const meshCount = window.usdRoot.children.length;
        fitCameraToSelection(window.camera, window._controls, [window.usdRoot]);
        render();
        ready = true;

        logHydraTransformStats(renderInterface);
        await buildUsdHelpers(renderInterface);

        console.log('[USD Viewer] Loading complete! Scene state:');
        console.log('  - usdRoot.children:', meshCount);
        console.log('  - camera.position:', window.camera.position);
        console.log('  - renderer.domElement size:', {
            width: window.renderer.domElement.width,
            height: window.renderer.domElement.height,
            clientWidth: window.renderer.domElement.clientWidth,
            clientHeight: window.renderer.domElement.clientHeight
        });

        const root = {};
        addPath(root, "/");

        return {
          meshCount,
          loadedFiles: Object.keys(root).length,
        };
      }

      function logHydraTransformStats(renderInterface) {
        const meshes = Object.values(renderInterface?.meshes || {});
        window.usdRoot.updateMatrixWorld(true);

        const translatedMeshes = meshes.filter((mesh) => {
          const elements = mesh._mesh?.matrix?.elements;
          return elements && Math.abs(elements[12]) + Math.abs(elements[13]) + Math.abs(elements[14]) > 1e-9;
        });
        const transformedMeshes = meshes.filter((mesh) => (mesh._transformUpdates || 0) > 0);
        const nonIdentityInputs = meshes.filter((mesh) => {
          const values = mesh._lastTransformValues;
          if (!values?.length) return false;

          const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          return values.some((value, index) => Math.abs(value - identity[index]) > 1e-9);
        });
        const sample = meshes.slice(0, 12).map((mesh) => {
          const elements = mesh._mesh?.matrix?.elements || [];
          const worldElements = mesh._mesh?.matrixWorld?.elements || [];
          return {
            id: mesh._id,
            instancerId: mesh._instancerId,
            transformUpdates: mesh._transformUpdates || 0,
            inputTranslation: [
              mesh._lastTransformValues?.[3],
              mesh._lastTransformValues?.[7],
              mesh._lastTransformValues?.[11],
              mesh._lastTransformValues?.[12],
              mesh._lastTransformValues?.[13],
              mesh._lastTransformValues?.[14],
            ],
            localTranslation: [elements[12], elements[13], elements[14]],
            worldTranslation: [worldElements[12], worldElements[13], worldElements[14]],
          };
        });

        const transformStats = {
          meshCount: meshes.length,
          transformUpdateCount: transformedMeshes.length,
          nonIdentityInputCount: nonIdentityInputs.length,
          translatedMeshCount: translatedMeshes.length,
          instancedMeshCount: meshes.filter((mesh) => mesh._instancerId).length,
          sample,
        };
        window.__usdHydraTransformStats = transformStats;
        console.log('[USD Viewer] Hydra transform stats:', window.__usdHydraTransformStats);
        post("USD_TRANSFORM_STATS", { stats: transformStats });
      }

      function isCollisionObject(object) {
        const path = normalizeUsdPath(object.userData?.usdPath || object.name || "");
        return usdPhysicsInfo.collisions.some((collision) =>
          pathMatchesUsdPath(path, collision.path)
        );
      }

      function applyDisplayOptions(nextOptions = {}) {
        Object.assign(displayOptions, nextOptions);

        window.usdRoot?.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          if (object.userData?.isUsdHelper) return;
          object.visible = isCollisionObject(object)
            ? displayOptions.collision
            : displayOptions.visual;
        });

        usdHelpers.axes.visible = displayOptions.axes;
        usdLinkAxes.forEach((helper) => {
          helper.visible = displayOptions.axes;
        });
        usdHelpers.jointAxes.visible = displayOptions.jointAxes;
        usdHelpers.com.visible = displayOptions.com;
        usdHelpers.inertia.visible = displayOptions.inertia;
        usdHelpers.collision.visible = displayOptions.collision;
        render();
      }

      function clearHelperGroup(group) {
        while (group.children.length) {
          group.remove(group.children[0]);
        }
      }

      function createAxisHelper(size) {
        const helper = new AxesHelper(size);
        helper.userData.isUsdHelper = true;
        helper.traverse((child) => {
          child.userData.isUsdHelper = true;
          if (child.material) {
            child.material.depthTest = false;
            child.material.depthWrite = false;
          }
          child.renderOrder = 1000;
          child.raycast = () => {};
        });
        return helper;
      }

      function getRootLocalBox(object) {
        const worldBox = new Box3().setFromObject(object);
        if (worldBox.isEmpty()) return worldBox;

        const points = [
          new Vector3(worldBox.min.x, worldBox.min.y, worldBox.min.z),
          new Vector3(worldBox.min.x, worldBox.min.y, worldBox.max.z),
          new Vector3(worldBox.min.x, worldBox.max.y, worldBox.min.z),
          new Vector3(worldBox.min.x, worldBox.max.y, worldBox.max.z),
          new Vector3(worldBox.max.x, worldBox.min.y, worldBox.min.z),
          new Vector3(worldBox.max.x, worldBox.min.y, worldBox.max.z),
          new Vector3(worldBox.max.x, worldBox.max.y, worldBox.min.z),
          new Vector3(worldBox.max.x, worldBox.max.y, worldBox.max.z),
        ];

        const localBox = new Box3();
        localBox.makeEmpty();
        points.forEach((point) => localBox.expandByPoint(worldToUsdRootLocal(point)));
        return localBox;
      }

      function createArrowHelper(axis, size) {
        const group = new Group();
        group.userData.isUsdHelper = true;
        const material = new MeshBasicMaterial({
          color: 0xff3838,
          depthTest: false,
          depthWrite: false,
        });
        const shaft = new Mesh(
          new CylinderGeometry(size * 0.04, size * 0.04, size * 0.85, 16),
          material
        );
        shaft.position.y = size * 0.425;
        const head = new Mesh(
          new ConeGeometry(size * 0.13, size * 0.32, 20),
          material
        );
        head.position.y = size * 1.01;
        group.add(shaft, head);
        const q = new Quaternion().setFromUnitVectors(
          new Vector3(0, 1, 0),
          axis.clone().normalize()
        );
        group.quaternion.copy(q);
        group.renderOrder = 1000;
        group.traverse((child) => {
          child.userData.isUsdHelper = true;
          child.renderOrder = 1000;
        });
        group.raycast = () => {};
        return group;
      }

      function getMeshCenterAndSize(mesh) {
        mesh.updateMatrixWorld(true);
        mesh.geometry?.computeBoundingBox?.();
        const box = new Box3().setFromObject(mesh);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        return { box, center, size, maxDim: Math.max(size.x, size.y, size.z) };
      }

      function worldToUsdRootLocal(point) {
        window.usdRoot.updateMatrixWorld(true);
        return window.usdRoot.worldToLocal(point.clone());
      }

      function toArray(value) {
        if (value == null) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === "string") return [value];
        if (typeof value === "number") return [value];
        if (typeof value[Symbol.iterator] === "function") return Array.from(value);
        if (typeof value.size === "function" && typeof value.get === "function") {
          const result = [];
          for (let i = 0; i < value.size(); i++) result.push(value.get(i));
          return result;
        }
        if (typeof value.length === "number") return Array.from(value);
        if (typeof value.values === "function") {
          try {
            return Array.from(value.values());
          } catch {}
        }
        if (typeof value.next === "function") {
          const result = [];
          for (let i = 0; i < 100000; i++) {
            const next = value.next();
            if (!next || next.done) break;
            result.push(next.value);
          }
          return result;
        }
        return [];
      }

      function toNumberArray(value) {
        if (value == null) return [];
        if (typeof value === "string") {
          return value.match(/-?(?:Infinity|inf|\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
        }
        if (typeof value === "number") return [value];
        if (value && typeof value === "object") {
          const vectorValues = [value.x, value.y, value.z, value.w].filter((item) => item !== undefined);
          if (vectorValues.length) return vectorValues.map(Number);
        }
        const arr = toArray(value);
        if (arr.length) {
          const numbers = arr.map((item) => {
            if (typeof item === "number") return item;
            const parsed = Number(tokenToString(item));
            return parsed;
          });
          if (numbers.every(Number.isFinite)) return numbers;
        }
        return String(value ?? "").match(/-?(?:Infinity|inf|\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) || [];
      }

      function toFiniteVec3(value, fallback = [0, 0, 0]) {
        const arr = toNumberArray(value).slice(0, 3).map((item) => Number(item));
        if (arr.length < 3 || arr.some((item) => !Number.isFinite(item))) return fallback.slice();
        return arr;
      }

      function tokenToString(value) {
        if (value == null) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
          return cleanTokenString(String(value));
        }
        const methods = ["GetString", "getString", "GetText", "getText", "GetPathString", "GetAsString", "ToString"];
        for (const method of methods) {
          try {
            if (typeof value[method] === "function") {
              const result = value[method]();
              if (result != null && result !== value) return tokenToString(result);
            }
          } catch {}
        }
        const props = ["pathString", "name", "value", "token", "text", "path"];
        for (const prop of props) {
          try {
            if (value[prop] != null && value[prop] !== value) return tokenToString(value[prop]);
          } catch {}
        }
        return cleanTokenString(String(value));
      }

      function cleanTokenString(value) {
        let result = String(value ?? "").trim().replace(/^['"]|['"]$/g, "");
        const wrapped = result.match(/^(?:TfToken|SdfPath)\((.*)\)$/);
        if (wrapped) result = wrapped[1].trim().replace(/^['"]|['"]$/g, "");
        return result;
      }

      function normalizeUsdPath(path) {
        const normalized = tokenToString(path).replace(/\\/g, "/").replace(/\/+$/g, "");
        if (!normalized || normalized === "/") return normalized;
        return normalized.startsWith("/") ? normalized : `/${normalized}`;
      }

      function pathMatchesUsdPath(path, targetPath) {
        const normalizedPath = normalizeUsdPath(path);
        const normalizedTarget = normalizeUsdPath(targetPath);
        return Boolean(
          normalizedTarget &&
          (normalizedPath === normalizedTarget || normalizedPath.startsWith(`${normalizedTarget}/`))
        );
      }

      function findMeshForUsdPath(meshes, usdPath) {
        return meshes.find((mesh) => pathMatchesUsdPath(mesh.userData?.usdPath || "", usdPath));
      }

      function serializeRigidBody(body) {
        return {
          path: body.path,
          name: body.name,
          mass: body.mass,
          centerOfMass: body.centerOfMass,
          diagonalInertia: body.diagonalInertia,
          principalAxes: body.principalAxes,
          inferred: Boolean(body.inferred),
        };
      }

      function getBodyCenterOfMassRootLocal(body, bodyMesh) {
        const localCom = new Vector3(...body.centerOfMass);
        if (body.worldMatrix) return localCom.applyMatrix4(body.worldMatrix);
        const bodyMatrix = bodyMesh?.matrixWorld;
        return bodyMatrix
          ? worldToUsdRootLocal(localCom.applyMatrix4(bodyMatrix))
          : localCom;
      }

      function getBodyRootRotation(body, bodyMesh) {
        const matrix = body.worldMatrix || bodyMesh?.matrixWorld;
        return matrix ? new Quaternion().setFromRotationMatrix(matrix) : new Quaternion();
      }

      function getInertiaPrincipalAxes(body) {
        if (body.principalAxes && body.principalAxes.length >= 4) {
          return new Quaternion(
            body.principalAxes[1],
            body.principalAxes[2],
            body.principalAxes[3],
            body.principalAxes[0]
          ).normalize();
        }
        return new Quaternion();
      }

      function computeInertiaBoxFromUsd(body) {
        const diag = body.diagonalInertia || [];
        if (diag.length < 3 || diag.some((value) => !Number.isFinite(value))) return null;

        const [ixx, iyy, izz] = diag;
        const mass = Number.isFinite(Number(body.mass)) && Number(body.mass) > 0
          ? Number(body.mass)
          : 1;

        const inertiaThreshold = 1e-9;
        if (Math.abs(ixx) < inertiaThreshold && Math.abs(iyy) < inertiaThreshold && Math.abs(izz) < inertiaThreshold) {
          return null;
        }

        const factor = 6.0 / mass;
        const widthSquared = factor * (iyy + izz - ixx);
        const heightSquared = factor * (ixx + izz - iyy);
        const depthSquared = factor * (ixx + iyy - izz);
        if (![widthSquared, heightSquared, depthSquared].every((value) => Number.isFinite(value) && value > 0)) {
          return null;
        }

        const minSize = 0.01;
        return {
          width: Math.max(Math.sqrt(widthSquared), minSize),
          height: Math.max(Math.sqrt(heightSquared), minSize),
          depth: Math.max(Math.sqrt(depthSquared), minSize),
        };
      }

      function getMeshRootLocalBox(mesh) {
        mesh.updateMatrixWorld(true);
        const worldBox = new Box3().setFromObject(mesh);
        const localBox = new Box3();
        localBox.makeEmpty();
        if (worldBox.isEmpty()) return localBox;

        [
          new Vector3(worldBox.min.x, worldBox.min.y, worldBox.min.z),
          new Vector3(worldBox.min.x, worldBox.min.y, worldBox.max.z),
          new Vector3(worldBox.min.x, worldBox.max.y, worldBox.min.z),
          new Vector3(worldBox.min.x, worldBox.max.y, worldBox.max.z),
          new Vector3(worldBox.max.x, worldBox.min.y, worldBox.min.z),
          new Vector3(worldBox.max.x, worldBox.min.y, worldBox.max.z),
          new Vector3(worldBox.max.x, worldBox.max.y, worldBox.min.z),
          new Vector3(worldBox.max.x, worldBox.max.y, worldBox.max.z),
        ].forEach((point) => localBox.expandByPoint(worldToUsdRootLocal(point)));
        return localBox;
      }

      function pathLooksCollision(path) {
        return /(^|[/_:.-])(collision|collisions|collider|colliders|col|colgeom)([/_:.-]|$)/i.test(path);
      }

      function pathLooksVisual(path) {
        return /(^|[/_:.-])(visual|visuals|render|mesh|meshes)([/_:.-]|$)/i.test(path);
      }

      function inferBodyPathFromMeshPath(path) {
        const normalized = normalizeUsdPath(path);
        const parts = normalized.split("/").filter(Boolean);
        while (parts.length > 1) {
          const last = parts[parts.length - 1].toLowerCase();
          if (
            pathLooksCollision(last) ||
            pathLooksVisual(last) ||
            /^(geom|geometry|shape|mesh|visual|collision)[_\-.]?\d*$/i.test(last)
          ) {
            parts.pop();
            continue;
          }
          break;
        }
        return parts.length ? `/${parts.join("/")}` : normalized;
      }

      function inferPhysicsInfoFromMeshes(meshes, physicsInfo) {
        const collisions = physicsInfo.collisions.slice();
        const hasCollision = new Set(collisions.map((item) => normalizeUsdPath(item.path)));

        meshes.forEach((mesh) => {
          const path = normalizeUsdPath(mesh.userData?.usdPath || mesh.name || "");
          if (!path) return;
          if (pathLooksCollision(path) && !hasCollision.has(path)) {
            collisions.push({ path, name: path.split("/").pop(), inferred: true });
            hasCollision.add(path);
          }
        });

        if (!collisions.length) {
          meshes.forEach((mesh) => {
            const path = normalizeUsdPath(mesh.userData?.usdPath || mesh.name || "");
            if (!path || pathLooksVisual(path)) return;
            if (/(^|[/_:.-])(collision|collider|colgeom)([/_:.-]|\d|$)/i.test(path) && !hasCollision.has(path)) {
              collisions.push({ path, name: path.split("/").pop(), inferred: true });
              hasCollision.add(path);
            }
          });
        }

        return {
          ...physicsInfo,
          physicsAvailable: physicsInfo.physicsAvailable || collisions.length > 0,
          collisions,
        };
      }

      function mergePhysicsInfo(primary, fallback) {
        const jointsByPath = new Map(primary.joints.map((item) => [normalizeUsdPath(item.path), item]));
        const bodiesByPath = new Map(primary.rigidBodies.map((item) => [normalizeUsdPath(item.path), item]));
        const collisionsByPath = new Map(primary.collisions.map((item) => [normalizeUsdPath(item.path), item]));

        fallback.joints.forEach((item) => {
          const path = normalizeUsdPath(item.path);
          if (path && !jointsByPath.has(path)) jointsByPath.set(path, item);
        });
        fallback.rigidBodies.forEach((item) => {
          const path = normalizeUsdPath(item.path);
          if (path && !bodiesByPath.has(path)) bodiesByPath.set(path, item);
        });
        fallback.collisions.forEach((item) => {
          const path = normalizeUsdPath(item.path);
          if (path && !collisionsByPath.has(path)) collisionsByPath.set(path, item);
        });

        return {
          physicsAvailable: primary.physicsAvailable || fallback.physicsAvailable,
          joints: Array.from(jointsByPath.values()),
          rigidBodies: Array.from(bodiesByPath.values()),
          collisions: Array.from(collisionsByPath.values()),
        };
      }

      function createEmptyPhysicsInfo() {
        return {
          physicsAvailable: false,
          joints: [],
          rigidBodies: [],
          collisions: [],
        };
      }

      function readMountedTextFile(path) {
        try {
          const text = USD.FS_readFile(path, { encoding: "utf8" });
          if (typeof text === "string" && text.includes("physics:")) return text;
        } catch {}

        try {
          const bytes = USD.FS_readFile(path);
          if (!bytes || bytes.length === 0) return "";
          const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
          if (text.includes("\u0000") || !text.includes("physics:")) return "";
          return text;
        } catch {}

        return "";
      }

      function getRecord(records, path) {
        const normalized = normalizeUsdPath(path);
        if (!normalized || normalized === "/") return null;
        if (!records.has(normalized)) {
          records.set(normalized, {
            path: normalized,
            name: normalized.split("/").pop(),
            parentPath: getParentPath(normalized),
            typeName: "",
            appliedSchemas: [],
            attrs: {},
            relationships: {
              body0: [],
              body1: [],
            },
            localMatrix: new Matrix4(),
            worldMatrix: null,
          });
        }
        return records.get(normalized);
      }

      function parseUsdPrimSpec(line) {
        const match = line.match(/\b(?:def|over|class)\s+(?:(\w+)\s+)?"([^"]+)"/);
        if (!match) return null;
        return {
          typeName: match[1] || "",
          name: match[2],
        };
      }

      function parseUsdRelationshipTarget(value) {
        const match = String(value || "").match(/<([^>]+)>/);
        return match ? normalizeUsdPath(match[1]) : "";
      }

      function parseUsdPhysicsLayerText(text, sourcePath) {
        const records = new Map();
        const stack = [];
        let pendingPath = "";
        let pendingTypeName = "";

        const getCurrentRecord = () => {
          const target = pendingPath || (stack.length ? stack[stack.length - 1] : "");
          return target ? getRecord(records, target) : null;
        };

        text.split(/\r?\n/).forEach((rawLine) => {
          const line = rawLine.replace(/#.*/, "").trim();
          if (!line) return;

          const primSpec = parseUsdPrimSpec(line);
          if (primSpec) {
            const parent = stack.length ? stack[stack.length - 1] : "";
            pendingPath = normalizeUsdPath(`${parent}/${primSpec.name}`);
            pendingTypeName = primSpec.typeName;
            const record = getRecord(records, pendingPath);
            if (record) record.typeName = primSpec.typeName || record.typeName;
          }

          const schemaMatch = line.match(/apiSchemas\s*=\s*\[([^\]]*)\]/);
          if (schemaMatch) {
            const record = getCurrentRecord();
            if (record) {
              const schemas = schemaMatch[1]
                .split(",")
                .map((item) => cleanTokenString(item.trim()))
                .filter(Boolean);
              record.appliedSchemas.push(...schemas.filter((schema) => !record.appliedSchemas.includes(schema)));
            }
          }

          const relMatch = line.match(/rel\s+(physics:body[01])\s*=\s*(.+)$/);
          if (relMatch) {
            const record = getCurrentRecord();
            const target = parseUsdRelationshipTarget(relMatch[2]);
            if (record && target) {
              if (relMatch[1] === "physics:body0") record.relationships.body0 = [target];
              if (relMatch[1] === "physics:body1") record.relationships.body1 = [target];
            }
          }

          const attrMatch = line.match(/\b(physics:[A-Za-z0-9_:]+|xformOp:[A-Za-z0-9_:]+)\s*=\s*(.+)$/);
          if (attrMatch) {
            const record = getCurrentRecord();
            if (record) record.attrs[attrMatch[1]] = attrMatch[2].replace(/,$/, "").trim();
          }

          if (line.includes("{") && pendingPath) {
            stack.push(pendingPath);
            pendingPath = "";
            pendingTypeName = "";
          }

          const closeCount = (line.match(/}/g) || []).length;
          for (let i = 0; i < closeCount; i++) {
            stack.pop();
          }
        });

        Array.from(records.values())
          .sort((a, b) => a.path.length - b.path.length)
          .forEach((record) => {
            const hasXform = Object.keys(record.attrs).some((name) => name.startsWith("xformOp:"));
            record.localMatrix = hasXform ? getLocalTransform(record) : new Matrix4();
            const parent = records.get(record.parentPath);
            if (hasXform || parent?.worldMatrix) {
              record.worldMatrix = parent?.worldMatrix
                ? parent.worldMatrix.clone().multiply(record.localMatrix)
                : record.localMatrix.clone();
            }
          });

        return collectUsdPhysicsInfoFromRecords(records, sourcePath);
      }

      function collectUsdPhysicsInfoFromMountedFiles() {
        const files = getAllLoadedFiles()
          .filter((path) => /\.(usd|usda)$/i.test(path))
          .filter((path) => !String(path).toLowerCase().endsWith(".usdz"));
        const merged = {
          physicsAvailable: false,
          joints: [],
          rigidBodies: [],
          collisions: [],
        };
        const parsedFiles = [];

        files.forEach((path) => {
          const text = readMountedTextFile(path);
          if (!text) return;
          const info = parseUsdPhysicsLayerText(text, path);
          if (!info.physicsAvailable) return;
          parsedFiles.push(path);
          const next = mergePhysicsInfo(merged, info);
          merged.physicsAvailable = next.physicsAvailable;
          merged.joints = next.joints;
          merged.rigidBodies = next.rigidBodies;
          merged.collisions = next.collisions;
        });

        if (parsedFiles.length) {
          console.log("[USD Physics] Parsed mounted physics layers:", parsedFiles);
        }

        return merged;
      }

      async function openMountedPhysicsStage(path) {
        const triedPaths = [];
        const candidatePaths = Array.from(new Set([
          path,
          String(path).replace(/^\//, ""),
        ].filter(Boolean)));

        for (const candidatePath of candidatePaths) {
          let tempDriver = null;
          const tempRoot = new Group();
          const tempRenderInterface = new ThreeRenderDelegateInterface({
            usdRoot: tempRoot,
            paths: [],
            driver: () => tempDriver,
          });

          try {
            triedPaths.push(candidatePath);
            tempDriver = new USD.HdWebSyncDriver(tempRenderInterface, candidatePath);
            if (tempDriver instanceof Promise) {
              tempDriver = await tempDriver;
            }

            safeCall(tempDriver, "Draw");
            let stage = safeCall(tempDriver, "GetStage");
            if (stage instanceof Promise) {
              stage = await stage;
              stage = safeCall(tempDriver, "GetStage");
            }

            const info = collectUsdPhysicsInfo(stage);
            if (info.physicsAvailable) {
              return { info, openedPath: candidatePath, triedPaths };
            }
          } catch (error) {
            console.warn("[USD Physics] Failed to open mounted physics stage:", candidatePath, error);
          } finally {
            if (tempDriver) {
              if (!safeCall(tempDriver, "Dispose")) {
                safeCall(tempDriver, "Destroy");
              }
            }
            tempRoot.clear();
          }
        }

        return { info: createEmptyPhysicsInfo(), openedPath: "", triedPaths };
      }

      async function collectUsdPhysicsInfoFromMountedStages() {
        const files = getAllLoadedFiles()
          .filter((path) => /\.(usd|usda|usdc)$/i.test(path))
          .filter((path) => !String(path).toLowerCase().endsWith(".usdz"))
          .filter((path) => /physics/i.test(path));
        const merged = createEmptyPhysicsInfo();
        const openedFiles = [];

        for (const path of files) {
          const { info, openedPath } = await openMountedPhysicsStage(path);
          if (!info.physicsAvailable) continue;
          openedFiles.push(openedPath || path);
          const next = mergePhysicsInfo(merged, info);
          merged.physicsAvailable = next.physicsAvailable;
          merged.joints = next.joints;
          merged.rigidBodies = next.rigidBodies;
          merged.collisions = next.collisions;
        }

        if (files.length && !openedFiles.length) {
          console.warn("[USD Physics] Mounted physics files found but no physics prims were readable:", files);
        } else if (openedFiles.length) {
          console.log("[USD Physics] Parsed mounted physics stages:", openedFiles);
        }

        return merged;
      }

      function createCollisionOverlay(mesh, material) {
        if (!mesh.geometry) return null;
        window.usdRoot.updateMatrixWorld(true);
        mesh.updateMatrixWorld(true);

        const overlay = new Mesh(mesh.geometry, material);
        const rootInverse = new Matrix4().copy(window.usdRoot.matrixWorld).invert();
        overlay.matrix.copy(rootInverse.multiply(mesh.matrixWorld));
        overlay.matrixAutoUpdate = false;
        overlay.userData.isUsdHelper = true;
        overlay.renderOrder = 1040;
        overlay.raycast = () => {};
        return overlay;
      }

      function toFiniteNumber(value, fallback = 0) {
        const arr = toNumberArray(value);
        const number = Number(arr.length ? arr[0] : value);
        return Number.isFinite(number) ? number : fallback;
      }

      function axisTokenToVector(axis) {
        const token = tokenToString(axis).toUpperCase();
        if (token === "X") return new Vector3(1, 0, 0);
        if (token === "Y") return new Vector3(0, 1, 0);
        return new Vector3(0, 0, 1);
      }

      function quaternionFromUsd(value) {
        const arr = toNumberArray(value).slice(0, 4).map(Number);
        if (arr.length < 4 || arr.some((item) => !Number.isFinite(item))) {
          return new Quaternion();
        }
        return new Quaternion(arr[1], arr[2], arr[3], arr[0]).normalize();
      }

      function callMaybe(object, method, ...args) {
        try {
          if (object && typeof object[method] === "function") {
            return object[method](...args);
          }
        } catch (error) {
          console.warn(`[USD Viewer] ${method} failed`, error);
        }
        return undefined;
      }

      function vectorLikeToArray(value) {
        const arr = toNumberArray(value);
        if (arr.length) return arr;
        if (value && typeof value === "object") {
          return [value.x, value.y, value.z].filter((item) => item !== undefined);
        }
        return [];
      }

      function getPrimPath(prim) {
        const path = callMaybe(prim, "GetPath");
        return normalizeUsdPath(path ?? callMaybe(prim, "GetName") ?? "");
      }

      function getPrimType(prim) {
        return tokenToString(callMaybe(prim, "GetTypeName"));
      }

      function getAppliedSchemas(prim) {
        return toArray(callMaybe(prim, "GetAppliedSchemas")).map(tokenToString);
      }

      function getAttrValue(prim, name) {
        const attr = callMaybe(prim, "GetAttribute", name);
        return callMaybe(attr, "Get");
      }

      function getRelationshipTargets(prim, name) {
        const rel = callMaybe(prim, "GetRelationship", name);
        return toArray(callMaybe(rel, "GetTargets")).map(normalizeUsdPath);
      }

      function collectStagePrims(stage) {
        const traversed = callMaybe(stage, "Traverse");
        const prims = toArray(traversed);
        if (prims.length) return prims;

        const pseudoRoot = callMaybe(stage, "GetPseudoRoot");
        const result = [];
        const visit = (prim) => {
          if (!prim) return;
          result.push(prim);
          toArray(callMaybe(prim, "GetChildren")).forEach(visit);
        };
        visit(pseudoRoot);
        return result;
      }

      function getParentPath(path) {
        const index = path.lastIndexOf("/");
        return index > 0 ? path.slice(0, index) : "";
      }

      function getLocalTransform(record) {
        const matrixValues = toNumberArray(record.attrs["xformOp:transform"]).map(Number);
        if (matrixValues.length >= 16 && matrixValues.every(Number.isFinite)) {
          return new Matrix4().fromArray(matrixValues);
        }

        const matrix = new Matrix4();
        const translate = toFiniteVec3(record.attrs["xformOp:translate"]);
        const scale = toFiniteVec3(record.attrs["xformOp:scale"], [1, 1, 1]);
        const quaternion = quaternionFromUsd(record.attrs["xformOp:orient"]);
        const rotateXYZ = toFiniteVec3(record.attrs["xformOp:rotateXYZ"]);
        if (rotateXYZ.some((value) => value !== 0)) {
          const euler = rotateXYZ.map((value) => value * Math.PI / 180);
          quaternion.multiply(new Quaternion().setFromEuler(new Euler(euler[0], euler[1], euler[2], "XYZ")));
        }
        matrix.compose(
          new Vector3(...translate),
          quaternion,
          new Vector3(...scale)
        );
        return matrix;
      }

      function collectUsdPhysicsInfoFromRecords(records, sourcePath = "") {
        const rigidBodies = [];
        const collisions = [];
        const joints = [];

        for (const record of records.values()) {
          const schemas = record.appliedSchemas.join(" ");
          const hasMassAttr = record.attrs["physics:mass"] !== undefined;
          const hasCenterOfMassAttr = record.attrs["physics:centerOfMass"] !== undefined;
          const hasDiagonalInertiaAttr = record.attrs["physics:diagonalInertia"] !== undefined;
          const hasCollisionAttr = record.attrs["physics:collisionEnabled"] !== undefined;
          const isRigidBody = schemas.includes("PhysicsRigidBodyAPI") ||
            schemas.includes("PhysicsMassAPI") ||
            hasMassAttr ||
            hasCenterOfMassAttr ||
            hasDiagonalInertiaAttr;
          const isCollision = schemas.includes("PhysicsCollisionAPI") ||
            record.typeName.includes("Collision") ||
            hasCollisionAttr;

          if (isRigidBody) {
            rigidBodies.push({
              path: record.path,
              name: record.name,
              mass: toFiniteNumber(record.attrs["physics:mass"], 0),
              centerOfMass: toFiniteVec3(record.attrs["physics:centerOfMass"]),
              diagonalInertia: toFiniteVec3(record.attrs["physics:diagonalInertia"]),
              principalAxes: toNumberArray(record.attrs["physics:principalAxes"]).slice(0, 4),
              worldMatrix: record.worldMatrix?.clone?.() || null,
              sourcePath,
            });
          }

          if (isCollision) {
            collisions.push({ path: record.path, name: record.name, sourcePath });
          }

          if (record.typeName.includes("Physics") && record.typeName.includes("Joint")) {
            const body0 = record.relationships.body0[0] || "";
            const body1 = record.relationships.body1[0] || "";
            const body0Record = records.get(body0);
            const localPos0 = toFiniteVec3(record.attrs["physics:localPos0"]);
            const localRot0 = quaternionFromUsd(record.attrs["physics:localRot0"]);
            const axisLocal = axisTokenToVector(record.attrs["physics:axis"]);
            const baseMatrix = body0Record?.worldMatrix || record.worldMatrix || new Matrix4();
            const originWorld = new Vector3(...localPos0).applyMatrix4(baseMatrix);
            const bodyRotation = new Quaternion().setFromRotationMatrix(baseMatrix);
            const axisWorld = axisLocal.clone().applyQuaternion(localRot0).applyQuaternion(bodyRotation).normalize();
            const lower = toFiniteNumber(record.attrs["physics:lowerLimit"], NaN);
            const upper = toFiniteNumber(record.attrs["physics:upperLimit"], NaN);
            const typeName = record.typeName;
            joints.push({
              path: record.path,
              name: record.name,
              type: typeName.includes("Fixed") ? "fixed" : (typeName.includes("Prismatic") ? "prismatic" : "revolute"),
              body0,
              body1,
              axis: [axisWorld.x, axisWorld.y, axisWorld.z],
              origin: [originWorld.x, originWorld.y, originWorld.z],
              lowerLimit: Number.isFinite(lower) ? lower : null,
              upperLimit: Number.isFinite(upper) ? upper : null,
              sourcePath,
            });
          }
        }

        return {
          physicsAvailable: joints.length > 0 || rigidBodies.length > 0 || collisions.length > 0,
          joints,
          rigidBodies,
          collisions,
        };
      }

      function collectUsdPhysicsInfo(stage) {
        const prims = collectStagePrims(stage);
        const records = new Map();

        prims.forEach((prim) => {
          const path = getPrimPath(prim);
          if (!path || path === "/") return;
          const typeName = getPrimType(prim);
          const appliedSchemas = getAppliedSchemas(prim);
          const attrs = {};
          [
            "xformOp:translate",
            "xformOp:orient",
            "xformOp:rotateXYZ",
            "xformOp:scale",
            "xformOp:transform",
            "physics:axis",
            "physics:localPos0",
            "physics:localPos1",
            "physics:localRot0",
            "physics:localRot1",
            "physics:lowerLimit",
            "physics:upperLimit",
            "physics:centerOfMass",
            "physics:diagonalInertia",
            "physics:principalAxes",
            "physics:mass",
            "physics:collisionEnabled",
          ].forEach((name) => {
            const value = getAttrValue(prim, name);
            if (value !== undefined) attrs[name] = value;
          });
          records.set(path, {
            prim,
            path,
            name: path.split("/").pop(),
            parentPath: getParentPath(path),
            typeName,
            appliedSchemas,
            attrs,
            relationships: {
              body0: getRelationshipTargets(prim, "physics:body0"),
              body1: getRelationshipTargets(prim, "physics:body1"),
            },
            localMatrix: new Matrix4(),
            worldMatrix: new Matrix4(),
          });
        });

        Array.from(records.values())
          .sort((a, b) => a.path.length - b.path.length)
          .forEach((record) => {
            record.localMatrix = getLocalTransform(record);
            const parent = records.get(record.parentPath);
            record.worldMatrix = parent
              ? parent.worldMatrix.clone().multiply(record.localMatrix)
              : record.localMatrix.clone();
          });

        return collectUsdPhysicsInfoFromRecords(records);
      }

      async function buildUsdHelpers(renderInterface) {
        for (const group of Object.values(usdHelpers)) {
          clearHelperGroup(group);
          if (!group.parent) window.usdRoot.add(group);
        }
        usdLinkAxes.forEach((helper) => {
          if (helper.parent) helper.parent.remove(helper);
        });
        usdLinkAxes = [];

        const hydraMeshes = Object.values(renderInterface?.meshes || {});
        const meshes = hydraMeshes
          .map((hydraMesh) => {
            const mesh = hydraMesh._mesh;
            if (!mesh) return null;
            mesh.userData.usdPath = hydraMesh._id;
            return mesh;
          })
          .filter(Boolean);

        if (!meshes.length) return;

        const rootBox = getRootLocalBox(window.usdRoot);
        const rootSize = rootBox.getSize(new Vector3());
        const modelSize = Math.max(rootSize.x, rootSize.y, rootSize.z, 0.1);
        const axisSize = Math.max(0.08, Math.min(modelSize * 0.18, 0.9));

        const stagePhysicsInfo = collectUsdPhysicsInfo(window.usdStage);
        const mountedStagePhysicsInfo = stagePhysicsInfo.rigidBodies.length
          ? createEmptyPhysicsInfo()
          : await collectUsdPhysicsInfoFromMountedStages();
        const mountedTextPhysicsInfo = (stagePhysicsInfo.rigidBodies.length || mountedStagePhysicsInfo.rigidBodies.length)
          ? createEmptyPhysicsInfo()
          : collectUsdPhysicsInfoFromMountedFiles();
        const extractedPhysicsInfo = mergePhysicsInfo(
          mergePhysicsInfo(stagePhysicsInfo, mountedStagePhysicsInfo),
          mountedTextPhysicsInfo
        );
        usdPhysicsInfo = inferPhysicsInfoFromMeshes(meshes, extractedPhysicsInfo);
        const physicalRigidBodies = usdPhysicsInfo.rigidBodies.filter((body) => !body.inferred);

        const collisionMaterial = new MeshBasicMaterial({
          color: 0x00ff44,
          transparent: true,
          opacity: 0.45,
          wireframe: true,
          depthWrite: false,
        });
        meshes.forEach((mesh) => {
          if (!isCollisionObject(mesh)) return;
          const overlay = createCollisionOverlay(mesh, collisionMaterial);
          if (overlay) usdHelpers.collision.add(overlay);
        });

        meshes.forEach((mesh) => {
          if (isCollisionObject(mesh)) return;
          const { maxDim } = getMeshCenterAndSize(mesh);
          if (maxDim <= 1e-6) return;
          const helper = createAxisHelper(Math.max(0.08, Math.min(maxDim * 0.8, axisSize)));
          mesh.add(helper);
          usdLinkAxes.push(helper);
        });

        usdPhysicsInfo.joints
          .filter((joint) => joint.type !== "fixed")
          .forEach((joint) => {
          const arrow = createArrowHelper(joint.axis, axisSize * 1.8);
          arrow.position.copy(new Vector3(...joint.origin));
          usdHelpers.jointAxes.add(arrow);
        });

        const comGeometry = new SphereGeometry(Math.max(Math.min(modelSize * 0.012, 0.035), 0.008), 24, 16);
        const comMaterial = new MeshBasicMaterial({
          color: 0x36e8ff,
          depthTest: false,
          depthWrite: false,
        });
        physicalRigidBodies.forEach((body) => {
          if (!body.centerOfMass.every(Number.isFinite) || !(body.mass > 0)) return;
          const com = new Mesh(comGeometry, comMaterial);
          const bodyMesh = findMeshForUsdPath(meshes, body.path);
          com.position.copy(getBodyCenterOfMassRootLocal(body, bodyMesh));
          com.userData.isUsdHelper = true;
          com.renderOrder = 1100;
          com.raycast = () => {};
          usdHelpers.com.add(com);
        });

        const inertiaMaterial = new MeshPhongMaterial({
          transparent: true,
          opacity: 0.35,
          shininess: 2.5,
          premultipliedAlpha: true,
          color: 0x4a9eff,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          depthWrite: false,
        });
        physicalRigidBodies.forEach((body) => {
          const boxData = computeInertiaBoxFromUsd(body);
          if (!boxData) return;

          const bodyMesh = findMeshForUsdPath(meshes, body.path);
          const inertia = new Mesh(
            new BoxGeometry(boxData.width, boxData.height, boxData.depth),
            inertiaMaterial
          );
          inertia.position.copy(getBodyCenterOfMassRootLocal(body, bodyMesh));
          inertia.quaternion.copy(getBodyRootRotation(body, bodyMesh).multiply(getInertiaPrincipalAxes(body)));
          inertia.userData.isUsdHelper = true;
          inertia.renderOrder = 1050;
          inertia.raycast = () => {};
          usdHelpers.inertia.add(inertia);
        });

        console.log("[USD Physics] Extracted:", {
          primPhysicsAvailable: extractedPhysicsInfo.physicsAvailable,
          stageJointCount: stagePhysicsInfo.joints.length,
          stageRigidBodyCount: stagePhysicsInfo.rigidBodies.length,
          stageCollisionCount: stagePhysicsInfo.collisions.length,
          mountedStageJointCount: mountedStagePhysicsInfo.joints.length,
          mountedStageRigidBodyCount: mountedStagePhysicsInfo.rigidBodies.length,
          mountedStageCollisionCount: mountedStagePhysicsInfo.collisions.length,
          mountedTextJointCount: mountedTextPhysicsInfo.joints.length,
          mountedTextRigidBodyCount: mountedTextPhysicsInfo.rigidBodies.length,
          mountedTextCollisionCount: mountedTextPhysicsInfo.collisions.length,
          mountedJointCount: mountedStagePhysicsInfo.joints.length + mountedTextPhysicsInfo.joints.length,
          mountedRigidBodyCount: mountedStagePhysicsInfo.rigidBodies.length + mountedTextPhysicsInfo.rigidBodies.length,
          mountedCollisionCount: mountedStagePhysicsInfo.collisions.length + mountedTextPhysicsInfo.collisions.length,
          finalRigidBodyCount: usdPhysicsInfo.rigidBodies.length,
          finalCollisionCount: usdPhysicsInfo.collisions.length,
          rigidBodiesWithInertia: physicalRigidBodies.filter((body) => computeInertiaBoxFromUsd(body)).length,
          renderedInertiaCount: usdHelpers.inertia.children.length,
          sampleCollisions: usdPhysicsInfo.collisions.slice(0, 8),
          sampleRigidBodies: physicalRigidBodies.slice(0, 8).map(serializeRigidBody),
        });

        applyDisplayOptions();
        post("USD_PRIM_INFO", {
          primInfo: {
            meshCount: meshes.length,
            physicsAvailable: usdPhysicsInfo.physicsAvailable,
            jointCount: usdPhysicsInfo.joints.length,
            collisionMeshCount: usdPhysicsInfo.collisions.length,
            comCount: usdHelpers.com.children.length,
            inertiaCount: usdHelpers.inertia.children.length,
            collisionHelperCount: usdHelpers.collision.children.length,
            jointAxisCount: usdHelpers.jointAxes.children.length,
            inferredRigidBodyCount: usdPhysicsInfo.rigidBodies.filter((body) => body.inferred).length,
            inferredCollisionCount: usdPhysicsInfo.collisions.filter((collision) => collision.inferred).length,
            joints: usdPhysicsInfo.joints,
            rigidBodies: usdPhysicsInfo.rigidBodies.map(serializeRigidBody),
            collisions: usdPhysicsInfo.collisions,
          },
        });
      }

      function setUsdJoint(jointName, value) {
        const joint = usdPhysicsInfo.joints.find((item) => item.name === jointName || item.path === jointName);
        if (!joint) return;

        const body1Path = joint.body1;
        const targetMeshes = Object.values(window.renderInterface?.meshes || {})
          .map((hydraMesh) => hydraMesh._mesh)
          .filter((mesh) => {
            return body1Path && pathMatchesUsdPath(mesh?.userData?.usdPath || "", body1Path);
          });
        const matrix = new Matrix4().makeRotationAxis(new Vector3(...joint.axis).normalize(), value || 0);
        const rootOrigin = new Vector3(...joint.origin);
        targetMeshes.forEach((mesh) => {
          if (!mesh.userData.usdBaseMatrix) {
            mesh.userData.usdBaseMatrix = mesh.matrix.clone();
          }
          mesh.matrix.copy(mesh.userData.usdBaseMatrix);
          const pivotToOrigin = new Matrix4().makeTranslation(-rootOrigin.x, -rootOrigin.y, -rootOrigin.z);
          const pivotBack = new Matrix4().makeTranslation(rootOrigin.x, rootOrigin.y, rootOrigin.z);
          mesh.matrix.premultiply(pivotToOrigin);
          mesh.matrix.premultiply(matrix);
          mesh.matrix.premultiply(pivotBack);
          mesh.matrixAutoUpdate = false;
        });
        render();
      }

      // from https://discourse.threejs.org/t/camera-zoom-to-fit-object/936/24
      function fitCameraToSelection(
        camera,
        controls,
        selection,
        fitOffset = 1.5
      ) {
        const size = new Vector3();
        const center = new Vector3();
        const box = new Box3();

        box.makeEmpty();
        for (const object of selection) {
          box.expandByObject(object);
        }

        box.getSize(size);
        box.getCenter(center);

        if (
          Number.isNaN(size.x) ||
          Number.isNaN(size.y) ||
          Number.isNaN(size.z) ||
          Number.isNaN(center.x) ||
          Number.isNaN(center.y) ||
          Number.isNaN(center.z)
        ) {
          console.warn(
            "Fit Camera failed: NaN values found, some objects may not have any mesh data.",
            selection,
            size
          );
          if (controls) controls.update();
          return;
        }

        if (!controls) {
          console.warn(
            "No camera controls object found, something went wrong."
          );
          return;
        }

        const maxSize = Math.max(size.x, size.y, size.z);
        const fitHeightDistance =
          maxSize / (2 * Math.atan((Math.PI * camera.fov) / 360));
        const fitWidthDistance = fitHeightDistance / camera.aspect;
        const distance =
          fitOffset * Math.max(fitHeightDistance, fitWidthDistance);

        if (distance == 0) {
          console.warn(
            "Fit Camera failed: distance is 0, some objects may not have any mesh data."
          );
          return;
        }

        const direction = controls.target
          .clone()
          .sub(camera.position)
          .normalize()
          .multiplyScalar(distance);

        controls.maxDistance = distance * 10;
        controls.target.copy(center);

        camera.near = distance / 100;
        camera.far = distance * 100;

        camera.updateProjectionMatrix();

        camera.position.copy(controls.target).sub(direction);
        controls.update();
      }

      async function setup() {
        // Use container size instead of window size
        const width = options.container.clientWidth || window.innerWidth || 800;
        const height = options.container.clientHeight || window.innerHeight || 600;
        const aspect = width / height;
        console.log('[USD Viewer] Setup - container size:', { width, height, aspect });

        const camera = (window.camera = new PerspectiveCamera(
          27,
          aspect,
          1,
          3500
        ));
        camera.position.z = 7;
        camera.position.y = 7;
        camera.position.x = 0;

        const scene = (window.scene = new Scene());

        const usdRoot = (window.usdRoot = new Group());
        usdRoot.name = "USD Root";
        scene.add(usdRoot);

        const ambientLight = new AmbientLight(0xffffff, 1.2);
        scene.add(ambientLight);

        const keyLight = new DirectionalLight(0xffffff, 2.5);
        keyLight.position.set(4, 6, 8);
        scene.add(keyLight);

        const renderer = (window.renderer = new WebGLRenderer({
          antialias: true,
          alpha: true,
        }));
        renderer.setPixelRatio(window.devicePixelRatio);

        // Use previously declared width and height
        console.log('[USD Viewer] Set renderer size:', { width, height });
        renderer.setSize(width, height);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NeutralToneMapping;
        renderer.toneMappingExposure = 1.4;
        renderer.shadowMap.enabled = false;
        renderer.shadowMap.type = VSMShadowMap;
        // Use transparent background, inherit parent page style
        renderer.setClearColor(0x000000, 0);

        console.log('[USD Viewer] Renderer created:', {
            domElement: renderer.domElement,
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            parent: renderer.domElement.parentElement
        });

        const envMapPromise = new Promise((resolve) => {
          const pmremGenerator = new PMREMGenerator(renderer);
          pmremGenerator.compileCubemapShader();

          new RGBELoader().load(
            options.hdrPath,
            (texture) => {
              const hdrRenderTarget =
                pmremGenerator.fromEquirectangular(texture);

              texture.mapping = EquirectangularReflectionMapping;
              texture.needsUpdate = true;
              scene.environment = hdrRenderTarget.texture;
              resolve();
            },
            undefined,
            (err) => {
              console.error(
                "An error occurred loading the HDR environment map.",
                err
              );
              resolve();
            }
          );
        });

        console.log('[USD Viewer] Add renderer canvas to container:', options.container);
        options.container.appendChild(renderer.domElement);
        console.log('[USD Viewer] Canvas added, canvas element:', renderer.domElement);
        const controls = (window._controls = new OrbitControls(
          camera,
          renderer.domElement
        ));
        controls.enableDamping = true;
        controls.dampingFactor = 0.2;
        controls.update();

        window.addEventListener("resize", onWindowResize);

        render();
        return envMapPromise;
      }

      // Optional: pause helper removed to avoid global DOM coupling

      async function animate() {
        window._controls.update();
        let secs = new Date().getTime() / 1000;
        await new Promise((resolve) => setTimeout(resolve, 10));
        const time = (secs * (1000 / timeout)) % endTimeCode;
        if (
          window.driver &&
          window.driver.SetTime &&
          window.driver.Draw &&
          ready
        ) {
          window.driver.SetTime(time);
          window.driver.Draw();
          render();
        }
        requestAnimationFrame(animate);
      }

      function onWindowResize() {
        const width = options.container?.clientWidth || window.innerWidth;
        const height = options.container?.clientHeight || window.innerHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        console.log('[USD Viewer] Resize:', { width, height });
      }

      function render() {
        // const time = Date.now() * 0.001;
        if (window.renderer.render && window.scene) {
          window.renderer.render(window.scene, window.camera);
        }
      }

      // getFileFromHandle imported

      // parseFilePath imported

      async function loadFile(
        fileOrHandle,
        isRootFile = true,
        fullPath = undefined
      ) {
        try {
          const file = await getFileFromHandle(fileOrHandle);
          const { fileName, directory } = parseFilePath(fullPath, file.name);

          const reader = new FileReader();
          const loadingPromise = new Promise((resolve, reject) => {
            reader.onloadend = resolve;
            reader.onerror = reject;
          });

          reader.onload = async function (event) {
            // Ensure USD module is initialized before filesystem operations
            if (!USD) await usdReady;

            USD.FS_createPath("", directory, true, true);
            // Mount file as read-only to prevent USD from attempting write-backs to packages
            USD.FS_createDataFile(
              directory,
              fileName,
              new Uint8Array(event.target.result),
              true /* canRead */,
              false /* canWrite */,
              true /* canOwn */
            );

            await loadUsdFile(directory, fileName, fullPath, isRootFile);
          };

          reader.readAsArrayBuffer(file);
          await loadingPromise;
        } catch (ex) {
          console.warn("Error loading file", fileOrHandle, ex);
        }
      }

      // isUsdFile imported

      function testAndLoadFile(file) {
        if (isUsdFile(file.name)) {
          clearStage();
          loadFile(file);
        }
      }

      /**
       * @param {FileSystemDirectoryEntry} directory
       */
      async function readDirectory(directory) {
        let entries = [];

        let getAllDirectoryEntries = async (dirReader) => {
          let entries = [];
          let readEntries = async () => {
            let result = await new Promise((resolve, reject) =>
              dirReader.readEntries(resolve, reject)
            );
            if (result.length === 0) return entries;
            else return entries.concat(result, await readEntries());
          };
          return await readEntries();
        };

        /**
         * @param {FileSystemDirectoryReader} dirReader
         * @param {FileSystemDirectoryEntry} directory
         * @returns {Promise<number>}
         */
        let getEntries = async (directory) => {
          let dirReader = directory.createReader();
          await new Promise(async (resolve) => {
            // Call the reader.readEntries() until no more results are returned.

            const results = await getAllDirectoryEntries(dirReader);

            if (results.length) {
              // entries = entries.concat(results);
              for (let entry of results) {
                if (entry.isDirectory) {
                  const foundFiles = await getEntries(entry);
                  if (foundFiles === 100)
                    console.warn(
                      "Found more than 100 files in directory",
                      entry
                    );
                } else {
                  entries.push(entry);
                }
              }
            }
            resolve(results.length);
          });
        };

        await getEntries(directory);
        return entries;
      }

      /**
       * @param {FileSystemEntry[]} entries
       */
      async function handleFilesystemEntries(entries) {
        const allFiles = [];

        for (let entry of entries) {
          if (entry.isFile) {
            if (shouldInclude(entry.name)) allFiles.push(entry);
          } else if (entry.isDirectory) {
            if (SKIP_DIRS.includes(entry.name)) continue;
            const files = await readDirectory(entry);
            allFiles.push(...files.filter((file) => shouldInclude(file.name)));
          }
        }

        // clear current set of files
        clearStage();

        // Find root file candidates
        const usdFiles = allFiles.filter((file) => isUsdFile(file.name));
        const usdaFiles = usdFiles.filter((file) =>
          file.name.endsWith(".usda")
        );

        // Prefer .usda files, otherwise use first USD file
        let rootFile = usdaFiles[0] || usdFiles[0];

        if (rootFile) {
          allFiles.splice(allFiles.indexOf(rootFile), 1);
        } else {
          console.warn("No USD file found");
          return;
        }

        const getFile = getEntryFile;

        // Mount all non-root files concurrently; order doesn't matter as we load the root last

        // Load all non-root files into memory
        const loadPromises = allFiles.map(async (file) => {
          const fileObj = await getFile(file);
          if (fileObj) await loadFile(fileObj, false, file.fullPath);
        });
        await Promise.all(loadPromises);

        // Load the root file last
        if (rootFile) {
          if (!isUsdFile(rootFile.name)) {
            console.error("Not a supported file format:", rootFile.name);
          } else {
            const rootFileObj = await getFile(rootFile);
            if (rootFileObj) loadFile(rootFileObj, true, rootFile.fullPath);
          }
        }
      }

      /**
       * @param {DataTransfer} dataTransfer
       */
      function processDataTransfer(dataTransfer) {
        if (dataTransfer.items) {
          /** @type {FileSystemEntry[]} */
          const allEntries = [];

          let haveGetAsEntry = false;
          if (dataTransfer.items.length > 0)
            haveGetAsEntry =
              "getAsEntry" in dataTransfer.items[0] ||
              "webkitGetAsEntry" in dataTransfer.items[0];

          if (haveGetAsEntry) {
            for (const item of dataTransfer.items) {
              /** @type {FileSystemEntry} */
              const entry =
                "getAsEntry" in item
                  ? item.getAsEntry()
                  : item.webkitGetAsEntry();
              allEntries.push(entry);
            }
            handleFilesystemEntries(allEntries);
            return;
          }

          for (const item of dataTransfer.items) {
            // API when there's no "getAsEntry" support
            console.log(item.kind, item);
            if (item.kind === "file") {
              var file = item.getAsFile();
              testAndLoadFile(file);
            }
            // could also be a directory
            else if (item.kind === "directory") {
              var dirReader = item.createReader();
              dirReader.readEntries(function (entries) {
                for (var i = 0; i < entries.length; i++) {
                  console.log(entries[i].name);
                  var entry = entries[i];
                  if (entry.isFile) {
                    entry.file(function (file) {
                      testAndLoadFile(file);
                    });
                  }
                }
              });
            }
          }
        } else {
          for (const file of dataTransfer.files) {
            testAndLoadFile(file);
          }
        }
      }

      // Provide a minimal imperative API to the host (capturing the local scope)
      handle = {
        // Load a USD file from a URL
        loadFromURL: async (url) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const parts = url.split("/");
            const fileNameOnly = parts[parts.length - 1];
            // For packaged usdz, mount read-only to avoid write attempts
            if (fileNameOnly.toLowerCase().endsWith(".usdz")) {
              const res = await fetch(url, { cache: "no-store" });
              if (!res.ok) throw new Error("Failed to fetch " + url);
              const buffer = await res.arrayBuffer();
              const mountDir = "/host/";
              USD.FS_createPath("", mountDir, true, true);
              // If a previous package exists at the same path, remove it now that the stage is cleared
              try {
                const existing = USD.FS_analyzePath(mountDir + fileNameOnly);
                if (existing?.exists) {
                  USD.FS_unlink(mountDir + fileNameOnly);
                }
              } catch {}
              USD.FS_createDataFile(
                mountDir,
                fileNameOnly,
                new Uint8Array(buffer),
                true /* canRead */,
                false /* canWrite */,
                true /* canOwn */
              );
              return await loadUsdFile(
                mountDir,
                fileNameOnly,
                mountDir + fileNameOnly,
                true
              );
            } else {
              // For usd/usda/usdc, keep URL so relative asset paths resolve via HTTP
              try {
                const base = new URL(url, window.location.origin);
                // ensure base URL ends with '/'
                const baseDir = base.href.substring(
                  0,
                  base.href.lastIndexOf("/") + 1
                );
                window.__usdAssetBase = baseDir;
                installFetchRewrite();
              } catch {}
              return await loadUsdFile(undefined, fileNameOnly, url, true);
            }
          } catch (e) {
            console.warn("loadFromURL error", e);
            throw e;
          }
        },
        // Load from array buffer entries mounted into the in-memory FS
        loadFromEntries: async (entries, primaryPath) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            if (!entries?.length) {
              throw new Error("No USD files were provided");
            }
            // Mount all entries first (order doesn't matter since we load the root explicitly last)
            const list = (entries || []).slice();
            for (const { path, buffer } of list) {
              const fileName = path.split("/").pop();
              if (!fileName) continue;
              let dir = path.slice(0, path.length - (fileName?.length || 0));
              // Ensure dir is at least "/", cannot be empty string
              if (!dir || dir === "") {
                dir = "/";
              }
              // Remove trailing slash (if present)
              if (dir.length > 1 && dir.endsWith("/")) {
                dir = dir.slice(0, -1);
              }
              console.log('[USD] Mount file:', { path, fileName, dir });
              USD.FS_createPath("", dir, true, true);
              const mountedPath = dir === "/" ? `/${fileName}` : toUsdFsPath(`${dir}/${fileName}`);
              const existing = USD.FS_analyzePath(mountedPath);
              if (existing?.exists) {
                USD.FS_unlink(mountedPath, true);
              }
              USD.FS_createDataFile(
                dir,
                fileName,
                new Uint8Array(buffer),
                true /* canRead */,
                false /* canWrite */,
                true /* canOwn */
              );
            }
            // Determine root
            let root = primaryPath;
            if (root) {
              // primaryPath may only be filename, need to find full path in list
              const foundEntry = list.find((e) => e.path.endsWith(root) || e.path === root);
              if (foundEntry) {
                root = foundEntry.path;
                console.log('[USD] primaryPath matched to full path:', root);
              } else {
                console.warn('[USD] primaryPath not found:', primaryPath);
              }
            }
            if (!root) {
              // Prefer .usda, else any USD
              root =
                list.find((e) => e.path.endsWith(".usda"))?.path ||
                list.find((e) => isUsdFile(e.path))?.path;
              console.log('[USD] Auto-detected root file:', root);
            }
            if (!root) {
              throw new Error("No USD root file found");
            }

            const fileNameOnly = root.split("/").pop();
            if (!fileNameOnly) {
              throw new Error(`Invalid USD root path: ${root}`);
            }

            let dir = root.slice(0, root.length - fileNameOnly.length);
            if (!dir || dir === "") {
              dir = "/";
            }
            if (dir.length > 1 && dir.endsWith("/")) {
              dir = dir.slice(0, -1);
            }
            const rootPath = toUsdFsPath(root);
            console.log('[USD] Load root file:', { root, rootPath, dir, fileNameOnly });
            return await loadUsdFile(dir, fileNameOnly, rootPath, true);
          } catch (e) {
            console.warn("loadFromEntries error", e);
            throw e;
          }
        },
        // Load from a DataTransfer (e.g., from a drag/drop event)
        loadFromDataTransfer: async (dataTransfer) => {
          try {
            if (!USD) await usdReady;
            processDataTransfer(dataTransfer);
          } catch (e) {
            console.warn("loadFromDataTransfer error", e);
          }
        },
        // Load directly from a FileList or array of File
        loadFromFiles: async (files) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const fileArray = Array.from(files);
            for (const file of fileArray) testAndLoadFile(file);
          } catch (e) {
            console.warn("loadFromFiles error", e);
          }
        },
        // Load from a map of virtual paths -> File, with an optional primary root file path
        loadFromFilesMap: async (filesMap, primaryPath) => {
          try {
            if (!USD) await usdReady;
            clearStage();
            const entries = Object.entries(filesMap).filter(([p]) => {
              const name = p.split("/").pop() || p;
              return (
                !SKIP_FILES.includes(name) &&
                !name.startsWith("._") &&
                shouldInclude(name)
              );
            });
            // Load all non-root files first
            for (const [fullPath, file] of entries) {
              if (primaryPath && fullPath === primaryPath) continue;
              await loadFile(file, false, fullPath);
            }
            // Then load the primary/root if provided, else try to detect
            if (primaryPath && filesMap[primaryPath]) {
              await loadFile(filesMap[primaryPath], true, primaryPath);
              return;
            }
            // Detect a reasonable root (prefer .usda)
            const usdaRoot = entries.find(([p]) => p.endsWith(".usda"));
            const anyUsdRoot = entries.find(([p]) => isUsdFile(p));
            const root = usdaRoot || anyUsdRoot;
            if (root) {
              await loadFile(root[1], true, root[0]);
            }
          } catch (e) {
            console.warn("loadFromFilesMap error", e);
          }
        },
        setDisplayOptions: (options) => {
          applyDisplayOptions(options || {});
        },
        setJoint: (jointName, value) => {
          setUsdJoint(jointName, value);
        },
        // Clear the current stage
        clear: () => {
          try {
            clearStage();
          } catch (e) {
            console.warn("clear error", e);
          }
        },
        // Dispose the viewer and remove listeners/canvas
        dispose: () => {
          try {
            window.removeEventListener("resize", onWindowResize);
            if (window.renderer && window.renderer.domElement) {
              if (options.container.contains(window.renderer.domElement)) {
                options.container.removeChild(window.renderer.domElement);
              }
              if (window.renderer.dispose) window.renderer.dispose();
            }
          } catch (e) {
            console.warn("dispose error", e);
          }
        },
      };
    };

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          run();
          try {
            if (resolveInit) resolveInit(handle);
          } catch {}
        },
        { once: true }
      );
    } else {
      run();
      try {
        if (resolveInit) resolveInit(handle);
      } catch {}
    }
  });
}

// Auto-initialize when loaded as a module
let handle = null;

// Create container dynamically with proper size
const container = document.createElement("div");
container.style.cssText = `
    width: 100%;
    height: 100vh;
    position: absolute;
    top: 0;
    left: 0;
`;
document.body.appendChild(container);

function post(type, payload = {}) {
  try {
    parent.postMessage({ type, ...payload }, window.location.origin);
  } catch {}
}

async function bootstrap() {
  try {
    handle = await init({
      container,
      hdrPath: getUsdViewerUrl("environments/neutral.hdr"),
    });
  } catch (e) {
    console.warn("[USD Iframe] init error", e);
  } finally {
    post("IFRAME_READY");
  }
}

// helper to load entries [{ path, buffer(ArrayBuffer) }, ...]
async function loadFromEntries(entries, primaryPath) {
  try {
    if (!handle?.loadFromEntries) {
      throw new Error("USD viewer is not initialized");
    }
    return await handle.loadFromEntries(entries, primaryPath);
  } catch (e) {
    console.warn("[USD Iframe] loadFromEntries error", e);
    throw e;
  }
}

window.addEventListener("message", async (evt) => {
  if (evt.origin !== window.location.origin) return;

  const data = evt.data;
  if (!data || typeof data !== "object") return;
  try {
    switch (data.type) {
      case "USD_LOAD_URL":
        post("USD_LOADING_START");
        post("USD_LOADED", await handle?.loadFromURL?.(data.url));
        break;
      case "USD_CLEAR":
        await handle?.clear?.();
        break;
      case "USD_LOAD_ENTRIES":
        post("USD_LOADING_START");
        post("USD_LOADED", await loadFromEntries(data.entries || [], data.primaryPath));
        break;
      case "USD_SET_DISPLAY_OPTIONS":
        handle?.setDisplayOptions?.(data.options || {});
        break;
      case "USD_SET_JOINT":
        handle?.setJoint?.(data.jointName, data.value);
        break;
      default:
        break;
    }
  } catch (e) {
    console.warn("[USD Iframe] message error", e);
    post("USD_ERROR", { error: e?.message || String(e) });
  }
});

bootstrap();
