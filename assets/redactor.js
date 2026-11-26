(() => {
  const maskColor = "#191a16";
  const previewLimit = 1600;
  const maxSide = 16_384;
  const maxPixels = 40_000_000;
  const messages = {
    en: {
      loading: "Opening the screenshot…",
      ready: "Drag on the image to cover a region.",
      masks: count => count + (count === 1 ? " region covered" : " regions covered"),
      reviewed: count => count + " selected. Click a box to toggle it, or drag to add another.",
      ocrLoading: "Loading the on-device recognition models…",
      ocrRunning: "Recognizing text on this device…",
      visionRunning: "Looking for avatars and faces on this device…",
      noMatches: "No matching regions found. Drag to cover any sensitive details you see.",
      scanPartial: "Part of the scan could not finish. Review the boxes and add missing masks.",
      ocrFailed: "Recognition failed. Try scanning again or draw your own masks.",
      unsupported: "Choose a PNG, JPEG, or WebP image.",
      unreadable: "This image could not be opened.",
      tooLarge: "The image exceeds this editor’s size limit.",
      exporting: "Preparing the PNG…",
      exported: "Redacted PNG ready.",
      exportFailed: "The browser could not export this image.",
      browser: "This browser can’t run the image editor.",
    },
    "zh-CN": {
      loading: "正在打开截图…",
      ready: "在图上拖出矩形，遮挡敏感区域。",
      masks: count => "已遮挡 " + count + " 处",
      reviewed: count => "已框选 " + count + " 处。点击框可取消或恢复，拖动可补画。",
      ocrLoading: "正在加载本地识别模型…",
      ocrRunning: "正在浏览器本地识别…",
      visionRunning: "正在本地查找头像和人脸…",
      noMatches: "未找到符合规则的内容。可拖动补画需要遮挡的区域。",
      scanPartial: "部分识别没有完成。请核对框选结果并补画遗漏的区域。",
      ocrFailed: "识别失败，可重新识别或手动补画。",
      unsupported: "请选择 PNG、JPEG 或 WebP 图片。",
      unreadable: "无法打开这张图片。",
      tooLarge: "图片尺寸超出编辑器支持的范围。",
      exporting: "正在生成 PNG…",
      exported: "已生成脱敏 PNG。",
      exportFailed: "浏览器无法导出这张图片。",
      browser: "当前浏览器无法运行图片编辑器。",
    },
  };
  const errors = new Set(["unsupported", "unreadable", "tooLarge", "exportFailed", "ocrFailed", "scanPartial", "browser"]);

  const choose = document.querySelector("#choose");
  const replace = document.querySelector("#replace");
  const scan = document.querySelector("#scan");
  const undo = document.querySelector("#undo");
  const clear = document.querySelector("#clear");
  const save = document.querySelector("#save");
  const input = document.querySelector("#image-input");
  const toolbar = document.querySelector("#toolbar");
  const styleBar = document.querySelector("#style-bar");
  const style = document.querySelector("#mask-style");
  const previewMasks = document.querySelector("#mask-preview");
  const workspace = document.querySelector("#workspace");
  const importPanel = document.querySelector("#import-panel");
  const preview = document.querySelector("#preview");
  const status = document.querySelector("#editor-status");
  const feedback = document.querySelector("#feedback");
  const dimensions = document.querySelector("#dimensions");
  const context = preview.getContext("2d");

  let bitmap = null;
  let history = [[]];
  let drag = null;
  let notice = "";
  let loadVersion = 0;
  let previewFrame = 0;
  let exporting = false;
  let workerPromise;
  let scanQueue = Promise.resolve();
  let scanVersion = 0;
  let scanStatus = "";
  let showMasks = false;

  function masks() {
    return history[history.length - 1];
  }

  function refresh() {
    const language = messages[document.documentElement.lang] || messages.en;
    const regions = masks();
    const count = regions.filter(region => region.enabled !== false).length;
    const message = notice === "loading" ? notice : scanStatus || notice;
    toolbar.hidden = !bitmap;
    styleBar.hidden = !bitmap;
    previewMasks.setAttribute("aria-pressed", String(showMasks));
    importPanel.hidden = !!bitmap;
    preview.hidden = !bitmap;
    workspace.toggleAttribute("data-loaded", !!bitmap);
    scan.disabled = !!scanStatus || exporting;
    undo.disabled = history.length === 1;
    clear.disabled = !regions.length;
    save.disabled = !count || exporting || !!scanStatus;
    status.hidden = !message && !bitmap;
    status.toggleAttribute("data-error", errors.has(message));
    const summary = showMasks ? language.masks(count) : language.reviewed(count);
    feedback.textContent = message ? language[message] : regions.length ? summary : language.ready;
    dimensions.textContent = bitmap ? bitmap.width + " × " + bitmap.height + " px" : "";
  }

  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  if (!context || typeof createImageBitmap !== "function") {
    notice = "browser";
    refresh();
    return;
  }

  function coverRegion(target, { x, y, width, height }, appearance) {
    target.fillStyle = appearance === "paper" ? "#f4f1e9" : maskColor;
    target.fillRect(x, y, width, height);
    if (appearance !== "pixels") return;
    // The pattern is drawn from solid colors, independent of the original pixels.
    const palette = ["#191a16", "#635e53", "#9b9485", "#d4cdbf"];
    const size = Math.max(7, Math.ceil(Math.max(width, height) / 80), Math.floor(Math.min(width, height) / 4));
    for (let row = 0; row * size < height; row++) {
      for (let col = 0; col * size < width; col++) {
        const left = col * size;
        const top = row * size;
        target.fillStyle = palette[(11 * col + 17 * row + (col * row) % 5) % palette.length];
        target.fillRect(x + left, y + top, Math.min(size, width - left), Math.min(size, height - top));
      }
    }
  }

  function paint(target, image, regions, appearance, review = false, draft = null) {
    const { width, height } = target.canvas;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.drawImage(image, 0, 0, width, height);
    target.setTransform(width / image.width, 0, 0, height / image.height, 0, 0);
    for (const region of regions) {
      const { x, y, width: w, height: h, enabled } = region;
      if (review) {
        target.save();
        const unit = image.width / width;
        target.strokeStyle = enabled === false ? "#5d5b53" : "#a73925";
        target.lineWidth = 1.7 * unit;
        if (enabled === false) {
          target.setLineDash([4 * unit, 3 * unit]);
        } else {
          target.fillStyle = "#a7392536";
          target.fillRect(x, y, w, h);
        }
        target.strokeRect(x, y, w, h);
        target.restore();
      } else if (enabled !== false) {
        coverRegion(target, region, appearance);
      }
    }
    if (draft) {
      target.fillStyle = "#191a16bb";
      target.fillRect(draft.x, draft.y, draft.width, draft.height);
    }
  }

  function rectangle(start, end) {
    if (Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) return null;
    const x = Math.floor(Math.min(start.x, end.x));
    const y = Math.floor(Math.min(start.y, end.y));
    return {
      x,
      y,
      width: Math.ceil(Math.max(start.x, end.x)) - x,
      height: Math.ceil(Math.max(start.y, end.y)) - y,
    };
  }

  function redraw() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (bitmap) paint(context, bitmap, masks(), style.value, !showMasks, drag && rectangle(drag.start, drag.end));
    });
  }

  function edited() {
    notice = "";
    refresh();
    redraw();
  }

  function getWorker() {
    if (!workerPromise) {
      const assets = new URL("assets/ocr/", document.baseURI);
      workerPromise = Tesseract.createWorker(["eng", "chi_sim"], Tesseract.OEM.LSTM_ONLY, {
        workerPath: new URL("worker.min.js", assets).href,
        corePath: new URL("tesseract-core-lstm.wasm.js", assets).href,
        langPath: new URL("lang", assets).href,
        workerBlobURL: false,
        cacheMethod: "none",
      }).then(async worker => {
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
        return worker;
      }).catch(error => {
        workerPromise = undefined;
        throw error;
      });
    }
    return workerPromise;
  }

  function contains(outer, inner) {
    return outer.x <= inner.x && outer.y <= inner.y &&
      outer.x + outer.width >= inner.x + inner.width &&
      outer.y + outer.height >= inner.y + inner.height;
  }

  function scanCurrent() {
    const image = bitmap;
    if (!image) return;
    const version = ++scanVersion;
    scanStatus = "ocrLoading";
    refresh();

    // A single worker handles one image at a time. Stale scans never change the editor.
    scanQueue = scanQueue.then(async () => {
      if (version !== scanVersion) return;
      const sample = document.createElement("canvas");
      try {
        const scale = Math.min(1, 4096 / Math.max(image.width, image.height), Math.sqrt(6_000_000 / (image.width * image.height)));
        sample.width = Math.max(1, Math.round(image.width * scale));
        sample.height = Math.max(1, Math.round(image.height * scale));
        const sampleContext = sample.getContext("2d");
        sampleContext.fillStyle = "#fff";
        sampleContext.fillRect(0, 0, sample.width, sample.height);
        sampleContext.drawImage(image, 0, 0, sample.width, sample.height);
        const model = LocalVision.loadModel().catch(() => null);
        const text = await getWorker().then(async worker => {
          if (version !== scanVersion) return null;
          scanStatus = "ocrRunning";
          refresh();
          const { data } = await worker.recognize(sample, {}, { text: false, blocks: true });
          return SensitiveText.readLines(data.blocks);
        }).catch(() => null);
        if (version !== scanVersion) return;
        scanStatus = "visionRunning";
        refresh();
        const visual = await LocalVision.findRegions(sample, text || [], await model, () => version === scanVersion);
        if (version !== scanVersion) return;

        const previous = masks();
        const manual = previous.filter(region => !region.type);
        const candidates = SensitiveText.findRegions(text || [], image, sample);
        for (const box of visual.avatars) {
          const region = SensitiveText.scaleBox(box, "avatar", image, sample, 4);
          if (region) candidates.push(region);
        }
        for (const box of visual.associatedNames) {
          const region = SensitiveText.scaleBox(box, "name", image, sample);
          if (region && !candidates.some(existing => contains(existing, region) || contains(region, existing))) {
            candidates.push(region);
          }
        }
        const detected = candidates.filter(region => !manual.some(mask => contains(mask, region)));
        if (detected.length || manual.length !== previous.length) {
          history.push([...manual, ...detected]);
          redraw();
        }
        notice = !text || visual.faceScanIncomplete ? "scanPartial" : detected.length ? "" : "noMatches";
      } catch {
        if (version === scanVersion) notice = "ocrFailed";
      } finally {
        sample.width = 0;
        sample.height = 0;
        if (version === scanVersion) {
          scanStatus = "";
          refresh();
        }
      }
    });
  }

  async function supportedFormat(file) {
    const first = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = first.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => first[i] === byte);
    const jpeg = first[0] === 255 && first[1] === 216 && first[2] === 255;
    const webp = String.fromCharCode(...first.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...first.slice(8, 12)) === "WEBP";
    return png || jpeg || webp;
  }

  async function openImage(file) {
    const version = ++loadVersion;
    notice = "loading";
    refresh();
    try {
      const supported = await supportedFormat(file);
      if (version !== loadVersion) return;
      if (!supported) {
        notice = "unsupported";
        return;
      }
      const image = await createImageBitmap(file);
      if (version !== loadVersion) {
        image.close();
        return;
      }
      if (Math.max(image.width, image.height) > maxSide || image.width * image.height > maxPixels) {
        image.close();
        notice = "tooLarge";
        return;
      }
      bitmap?.close();
      bitmap = image;
      history = [[]];
      drag = null;
      showMasks = false;
      const scale = Math.min(1, previewLimit / Math.max(image.width, image.height));
      preview.width = Math.max(1, Math.round(image.width * scale));
      preview.height = Math.max(1, Math.round(image.height * scale));
      edited();
      scanCurrent();
    } catch {
      if (version === loadVersion) notice = "unreadable";
    } finally {
      if (version === loadVersion) refresh();
    }
  }

  function position(event) {
    const bounds = preview.getBoundingClientRect();
    const clamp = fraction => Math.min(1, Math.max(0, fraction));
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width) * bitmap.width,
      y: clamp((event.clientY - bounds.top) / bounds.height) * bitmap.height,
    };
  }

  preview.addEventListener("pointerdown", event => {
    if (!bitmap || drag || event.button !== 0) return;
    const start = position(event);
    drag = { id: event.pointerId, start, end: start, clientX: event.clientX, clientY: event.clientY };
    preview.setPointerCapture(event.pointerId);
  });

  preview.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    drag.end = position(event);
    redraw();
  });

  preview.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const end = position(event);
    const isClick = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4;
    if (isClick) {
      const regions = masks();
      const point = { ...end, width: 0, height: 0 };
      let hit = regions.length - 1;
      while (hit >= 0 && !contains(regions[hit], point)) hit--;
      if (hit !== -1) history.push(regions.map((region, index) => index === hit ? { ...region, enabled: region.enabled === false } : region));
    } else {
      const region = rectangle(drag.start, end);
      if (region) history.push([...masks(), region]);
    }
    drag = null;
    edited();
  });

  function cancelDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    redraw();
  }

  preview.addEventListener("pointercancel", cancelDrag);
  preview.addEventListener("lostpointercapture", cancelDrag);

  choose.addEventListener("click", () => input.click());
  replace.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    if (file) openImage(file);
  });

  window.addEventListener("dragover", event => {
    if (!event.dataTransfer?.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    workspace.toggleAttribute("data-dragging", workspace.contains(event.target));
  });

  workspace.addEventListener("dragleave", event => {
    if (!workspace.contains(event.relatedTarget)) workspace.removeAttribute("data-dragging");
  });

  window.addEventListener("drop", event => {
    workspace.removeAttribute("data-dragging");
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    openImage(file);
  });

  window.addEventListener("paste", event => {
    const items = Array.from(event.clipboardData?.items || []);
    const image = items.find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
    const file = image || event.clipboardData?.files[0];
    if (!file) return;
    event.preventDefault();
    openImage(file);
  });

  undo.addEventListener("click", () => {
    if (history.length === 1) return;
    history.pop();
    edited();
  });

  scan.addEventListener("click", scanCurrent);

  previewMasks.addEventListener("click", () => {
    showMasks = !showMasks;
    edited();
  });

  style.addEventListener("change", () => {
    showMasks = true;
    edited();
  });

  clear.addEventListener("click", () => {
    if (!masks().length) return;
    history.push([]);
    edited();
  });

  save.addEventListener("click", async () => {
    const image = bitmap;
    const snapshot = masks();
    const regions = snapshot.filter(region => region.enabled !== false);
    const appearance = style.value;
    if (!image || !regions.length || exporting || scanStatus) return;
    const output = document.createElement("canvas");
    exporting = true;
    notice = "exporting";
    refresh();
    try {
      output.width = image.width;
      output.height = image.height;
      const target = output.getContext("2d");
      if (!target) throw new Error("Unavailable export canvas");
      paint(target, image, regions, appearance);
      const png = await new Promise(resolve => output.toBlob(resolve, "image/png"));
      if (bitmap !== image || masks() !== snapshot || style.value !== appearance) return;
      if (!png) throw new Error("PNG encoding failed");

      const url = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = url;
      link.download = "redacted.png";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      notice = "exported";
    } catch {
      if (bitmap === image && masks() === snapshot) notice = "exportFailed";
    } finally {
      output.width = 0;
      output.height = 0;
      exporting = false;
      refresh();
    }
  });

  choose.disabled = false;
  refresh();
})();
