# 截图脱敏

[English](README.md) · **简体中文**

**全程在浏览器本地处理，无需上传截图。** 截图和识别出的文字始终留在你的设备上。

打开截图后，工具会自动框选头像、昵称和疑似敏感文字。核对并按需调整，即可复制脱敏图片或导出与原图同尺寸的 PNG。[在线使用](https://ostrovsky2056.github.io/screenshot-redactor/)

## 试用示例

这段虚构聊天展示了头像、昵称和邮箱从自动框选到脱敏导出的效果。[一键试用示例](https://ostrovsky2056.github.io/screenshot-redactor/?example=chat)

![聊天原图、自动框选和带发言人代号的脱敏导出效果](docs/chat-example.zh-CN.webp)

## 使用方法

1. 选择、拖入或粘贴一张 PNG、JPEG 或 WebP 截图。编辑器会查找头像、人脸和中英文敏感文字。
2. 核对虚线框。朱红色表示已选中遮挡，灰色表示可选，琥珀色提示姓名范围待核对。点按虚线框可切换选择，拖动已选框的角点可调整大小，拖动空白处可补画。调整可以撤销。清空遮挡后，识别出的框仍可点击。
3. 选择遮挡样式和不透明度。使用高斯模糊时还可以调节强度。开启「按发言人区分」后，同一发言人的原头像会被同一张本地生成的头像替换。在「发言人头像」中可从设备选择 PNG、JPEG 或 WebP，也可恢复默认头像。匹配到发言人的引用署名会同步显示替换后的头像。头像旁已选中的昵称默认用附近的背景色覆盖。预览后可复制脱敏图片或导出与原图同尺寸的 PNG。

文字识别覆盖常见网址、邮箱、电话号码、身份证号、银行卡号、密钥和姓名。编辑器会结合头像、文字气泡以及图片、视频、链接、小程序和文件卡片的位置识别发言人，也会在正文及引用回复中查找人名和昵称。高度相近的自动单行文字遮挡会在空间允许时对齐，导出前可点击或拖动修正。

## 本地处理

图片、识别出的文字和遮挡区域都在当前浏览器的内存中处理。首次扫描时，浏览器从本站加载模型和 WebAssembly 文件。遮挡效果直接写入复制或导出的 PNG。使用模糊或降低不透明度时，仍可能看出原图细节。

遇到中英文混排或姓名边界不明确时，编辑器会从原图裁出对应文字行，用 Tesseract.js 再识别一次。能确认姓名对应的字符时，就用复识得到的字符框定位。

首轮漏读高亮提及时，编辑器会尝试单独识别高亮区域并框选昵称。聊天布局还能帮助找回只露出一部分的重复头像，并统一同一张截图里完整头像的框选尺寸。

## 本地开发

在仓库根目录运行 `python3 -m http.server 8000`，然后打开 `http://127.0.0.1:8000/`。GitHub Pages 从 `main` 分支根目录部署静态站点。

编辑器跟随浏览器使用英语或简体中文，缺少翻译时回退到英语。手动切换语言会保存语言偏好。

聊天布局使用小型本地模型，根据色块、边缘位置、间距和 OCR 的文字分布给头像与气泡的配对打分。模型使用程序生成的布局样本训练。运行 `node scripts/train-chat-layout.cjs` 可重新生成模型权重。运行 `node --test` 可执行测试。

## 许可证

项目采用 MIT 许可证，Barlow Condensed 字体采用 SIL Open Font License。[项目许可](LICENSE) · [字体许可](assets/barlow-condensed-ofl.txt)

- OCR 使用 Tesseract.js 6.0.1、Tesseract.js Core 6.0.0 和 tessdata_fast 4.1.0 的英语及简体中文模型。[Tesseract.js](https://github.com/naptha/tesseract.js/tree/v6.0.1) · [模型](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) · [许可证](assets/ocr)
- 人脸检测使用 MediaPipe Tasks Vision 0.10.21 与 BlazeFace Short Range v1。[MediaPipe](https://github.com/google-ai-edge/mediapipe/tree/v0.10.21) · [模型卡](https://huggingface.co/litert-community/MediaPipe-FaceDetector-BlazeFace-Short-Range) · [许可证](assets/vision/LICENSE)
