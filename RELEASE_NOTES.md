# Attic Viewer v2.0.0

This major release replaces the legacy browser physics package with Google DeepMind's official MuJoCo WebAssembly runtime and fixes physics stepping under lower or irregular frame rates.

## Highlights

- Migrated from `mujoco-js` 0.0.7 to official `@mujoco/mujoco` 3.10.0.
- Uses the canonical `MjModel`, `MjData`, `mj_step`, `mj_resetData`, `mj_forward`, and `mj_applyFT` APIs.
- Emits MuJoCo WASM as an independent, lazy-loaded production asset that works with relative deployment paths.
- Supports both `.xml` and `.mjcf` file extensions across file selection, detection, file trees, and simulation controls.
- Replaced the frame-drop behavior with a bounded fixed-step accumulator, so simulation continues when frames take longer than 35 ms.
- Explicitly deletes Embind-backed `MjData` and `MjModel` objects when a scene is replaced or cleared.

## Validation

- All 34 automated tests pass, together with TypeScript checking and the production build.
- Browser regression tested with `ant.xml` on MuJoCo 3.10.0: load, play, physics time advancement, pause, reset, and resource release all pass without console errors.

## 中文说明

该大版本将网页物理引擎从旧版 `mujoco-js` 迁移到 Google DeepMind 官方 `@mujoco/mujoco` 3.10.0，统一使用正式 API 和独立 WASM 资源。同时修复帧间隔超过 35ms 时仿真不再步进的问题，并完整支持 `.mjcf` 后缀。已验证 MJCF 加载、播放、时间步进、暂停、重置和资源释放。
