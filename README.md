# Screenshot Redactor · 截图脱敏

[在浏览器里使用](https://ostrovsky2056.github.io/screenshot-redactor/)

1. 选择、拖入或粘贴一张 PNG、JPEG 或 WebP 截图。工具会自动分析头像、人脸和中英文文字。
2. 核对虚线框。朱红色表示已选中遮挡，灰色表示可选。点按任一框可切换选择，拖动可补画。清空遮挡后，虚线框仍可点击。
3. 识别出发言人时，默认用颜色和字母代号区分他们。同一人的头像、昵称和能对应上的引用署名会使用相同代号。也可以选墨黑、纸白或像素纹理。预览后导出，选中区域会被不透明图案覆盖并生成与原图同尺寸的 PNG。

文字检测覆盖常见邮箱、电话号码、身份证号、银行卡号、密钥和姓名等字段。聊天截图会结合头像、气泡和文字的位置识别发言人，也会在聊天正文和带引用线的回复里查找人名、昵称和称呼。正文里的名字按字符位置单独框选。工具会结合已识别的昵称和上下文判断，仍可点击或拖动修正遗漏。

图片、识别出的文字和遮挡区域都在当前浏览器内存中处理。首次分析时，浏览器从本站加载模型和 WASM 文件。像素纹理由纯色块生成，导出的遮挡区域只包含生成的颜色。

Import a PNG, JPEG, or WebP. The editor preselects likely private details, including names mentioned in chat and quoted replies. The speaker style gives each recognized speaker a consistent color and letter. Click any dashed box to toggle it, drag to add masks, choose a style, and export a PNG at the original dimensions. Image data stays on your device.

## 本地开发

在仓库根目录运行 `python3 -m http.server 8000`，然后打开 `http://127.0.0.1:8000/`。项目是静态站点，GitHub Pages 从 `main` 分支根目录发布。

站点跟随浏览器匹配简体中文或英语，其他语言使用英语。手动设置只会记录语言偏好。

聊天布局使用一个小型本地分类模型给头像与气泡的配对打分。输入包括色块的平坦程度、边缘位置、间距和 OCR 文字分布。训练使用程序生成的布局样本。运行 `node scripts/train-chat-layout.cjs` 可以重新生成模型权重。运行 `node --test tests/*.test.cjs` 可验证头像、昵称、引用布局和正文名字的框选。

## 许可证

项目代码使用 [MIT 许可证](LICENSE)。Barlow Condensed 字体使用 [SIL Open Font License](assets/barlow-condensed-ofl.txt)。

- OCR 使用 Tesseract.js 6.0.1、Tesseract.js Core 6.0.0 和 tessdata_fast 4.1.0 的简体中文及英语模型。[Tesseract.js](https://github.com/naptha/tesseract.js/tree/v6.0.1) · [模型](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) · [许可证](assets/ocr)
- 人脸检测使用 MediaPipe Tasks Vision 0.10.21 与 BlazeFace Short Range v1。[MediaPipe](https://github.com/google-ai-edge/mediapipe/tree/v0.10.21) · [模型卡](https://huggingface.co/litert-community/MediaPipe-FaceDetector-BlazeFace-Short-Range) · [许可证](assets/vision/LICENSE)
