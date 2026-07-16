# Changelog

## 1.3.3

- 修复异步模型加载竞态，快速切换文件时只允许最后一次请求更新场景，并等待模型安装完成后再结束加载状态。
- 合并重复的动画循环，恢复按需渲染；静止场景不再持续提交 WebGL 帧。
- 新增统一的 Three.js 资源释放流程，覆盖模型、材质、纹理、坐标轴、惯性、约束、测量和 MuJoCo 场景，避免切换大型模型时 GPU 内存累积。
- 为静态部署加入跨源隔离 Service Worker 兜底，改善 GitHub Pages 等无法配置 COOP/COEP 响应头的平台上的 USD WASM 可用性。
- 加强 USD iframe 消息来源校验，并在缺少 `SharedArrayBuffer` 时快速返回明确错误。
- 对齐 Three.js 运行时与类型版本，修复 USDZLoader 类型差异，并升级存在安全公告的 YAML 传递依赖。
- 增加加载竞态和资源释放回归测试，在部署与发布工作流中加入类型检查和测试门禁。

### Next: 1.4.0

- 计划将 MuJoCo WebAssembly 依赖从旧包名 `mujoco-js` 迁移到 Google DeepMind 官方正式包 `@mujoco/mujoco`。
- 迁移将覆盖独立 WASM 资源加载、正式 TypeScript 类型、MJCF 兼容性、仿真步进、拖拽交互和资源释放回归验证。

## 1.3.2

- 修复 MJCF 匿名 `body` 下关节绑定错误，解决 `ant.xml` 中 `ankle_*` 关节拖动时模型不动的问题。
- 完善 MJCF 默认类继承与几何解析，修复部分模型的 mesh / primitive 不显示、尺寸异常和姿态错误。
- 补齐 MJCF 角度单位与方向属性处理，改进 `fromto`、`axisangle`、`xyaxes`、`zaxis` 等解析兼容性。
