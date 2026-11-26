# Screenshot Redactor

**English** · [简体中文](README.zh-CN.md)

**Redact screenshots in your browser without uploading them.** Your screenshots and recognized text stay on your device.

Open a screenshot and the editor automatically selects avatars and likely sensitive text. Review the boxes, adjust them if needed, and export a PNG. [Open Screenshot Redactor](https://ostrovsky2056.github.io/screenshot-redactor/)

## Using the editor

1. Choose, drop, or paste a PNG, JPEG, or WebP screenshot. The editor looks for avatars, faces, and sensitive text in English and Simplified Chinese.
2. Review the dashed boxes. Red boxes are selected for masking and gray boxes are available to select. Click a box to toggle it, drag to add one, or undo a change. Clearing the selection keeps the detected boxes available.
3. Preview and export a PNG at the original dimensions. When the editor recognizes chat speakers, it defaults to giving each speaker a consistent color and letter across their avatars, nicknames, and matching quote attributions. Ink black, paper white, and pixel pattern masks are also available.

Text recognition covers common email addresses, phone numbers, IDs, payment card numbers, credentials, and names. In chat, the editor uses the positions of avatars, bubbles, and text to find speakers. It looks for names and nicknames inside messages and quoted replies and masks the recognized names. Review and adjust suggestions before export.

## On-device processing

Images, recognized text, and mask regions are processed in browser memory. On the first scan, the browser loads the models and WebAssembly files from this site. Exported masks use generated, opaque colors, including those in the pixel pattern.

## Local development

Run `python3 -m http.server 8000` from the repository root and open `http://127.0.0.1:8000/`. GitHub Pages deploys the static site from the root of the `main` branch.

The editor follows the browser’s language for English and Simplified Chinese. English is used when a translation is unavailable. Changing the language manually saves the language preference.

A small local chat-layout model scores avatar and message-bubble pairs using surface color, edge positions, spacing, and where OCR found text. It is trained on generated layouts. Run `node scripts/train-chat-layout.cjs` to regenerate its weights and `node --test tests/*.test.cjs` to test avatar, speaker, quote, and name detection.

## License

The project uses the MIT license. Barlow Condensed uses the SIL Open Font License. [Project license](LICENSE) · [Font license](assets/barlow-condensed-ofl.txt)

- OCR uses Tesseract.js 6.0.1, Tesseract.js Core 6.0.0, and the English and Simplified Chinese tessdata_fast 4.1.0 models. [Tesseract.js](https://github.com/naptha/tesseract.js/tree/v6.0.1) · [Models](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) · [Licenses](assets/ocr)
- Face detection uses MediaPipe Tasks Vision 0.10.21 and BlazeFace Short Range v1. [MediaPipe](https://github.com/google-ai-edge/mediapipe/tree/v0.10.21) · [Model card](https://huggingface.co/litert-community/MediaPipe-FaceDetector-BlazeFace-Short-Range) · [License](assets/vision/LICENSE)
