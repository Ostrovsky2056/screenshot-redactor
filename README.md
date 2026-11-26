# Screenshot Redactor · 截图脱敏

[在浏览器里使用](https://ostrovsky2056.github.io/screenshot-redactor/)

选择、拖入或粘贴一张 PNG、JPEG 或 WebP 截图。在图上拖出矩形遮盖敏感信息，可以撤销或清空遮挡。导出时，遮挡会作为不透明色块写入一张与原图尺寸相同的新 PNG。

图片读取、绘制和导出都在当前浏览器内完成。处理过程没有网络上传、遥测或浏览器持久化。GitHub Pages 只提供页面代码、样式、字体和站点图标。

Choose, drop, or paste a PNG, JPEG, or WebP screenshot. Drag rectangles over private details, then export a flattened PNG at the original dimensions. Screenshot data is processed in memory on your device.

## 本地开发

在仓库根目录运行 `python3 -m http.server 8000`，然后打开 `http://127.0.0.1:8000/`。项目是静态站点，GitHub Pages 从 `main` 分支根目录发布。

站点跟随浏览器匹配简体中文或英语，其他语言使用英语。手动设置只会记录语言偏好。

## 许可证

项目代码使用 [MIT 许可证](LICENSE)。Barlow Condensed 字体使用 [SIL Open Font License](assets/barlow-condensed-ofl.txt)。
