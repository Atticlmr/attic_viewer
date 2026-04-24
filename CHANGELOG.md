# Changelog

## 1.3.2

- 修复 MJCF 匿名 `body` 下关节绑定错误，解决 `ant.xml` 中 `ankle_*` 关节拖动时模型不动的问题。
- 完善 MJCF 默认类继承与几何解析，修复部分模型的 mesh / primitive 不显示、尺寸异常和姿态错误。
- 补齐 MJCF 角度单位与方向属性处理，改进 `fromto`、`axisangle`、`xyaxes`、`zaxis` 等解析兼容性。
