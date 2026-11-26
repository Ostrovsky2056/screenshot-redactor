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
      unsupported: "请选择 PNG、JPEG 或 WebP 图片。",
      unreadable: "无法打开这张图片。",
      tooLarge: "图片尺寸超出编辑器支持的范围。",
      exporting: "正在生成 PNG…",
      exported: "已生成脱敏 PNG。",
      exportFailed: "浏览器无法导出这张图片。",
      browser: "当前浏览器无法运行图片编辑器。",
    },
  };
  const errors = new Set(["unsupported", "unreadable", "tooLarge", "exportFailed", "browser"]);

  const choose = document.querySelector("#choose");
  const replace = document.querySelector("#replace");
  const undo = document.querySelector("#undo");
  const clear = document.querySelector("#clear");
  const save = document.querySelector("#save");
  const input = document.querySelector("#image-input");
  const toolbar = document.querySelector("#toolbar");
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

  function masks() {
    return history[history.length - 1];
  }

  function refresh() {
    const language = messages[document.documentElement.lang] || messages.en;
    const count = masks().length;
    toolbar.hidden = !bitmap;
    importPanel.hidden = !!bitmap;
    preview.hidden = !bitmap;
    workspace.toggleAttribute("data-loaded", !!bitmap);
    undo.disabled = history.length === 1;
    clear.disabled = !count;
    save.disabled = !count || exporting;
    status.hidden = !notice && !bitmap;
    status.toggleAttribute("data-error", errors.has(notice));
    feedback.textContent = notice ? language[notice] : count ? language.masks(count) : language.ready;
    dimensions.textContent = bitmap ? bitmap.width + " × " + bitmap.height + " px" : "";
  }

  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  if (!context || typeof createImageBitmap !== "function") {
    notice = "browser";
    refresh();
    return;
  }

  function paint(target, image, regions, draft = null) {
    const { width, height } = target.canvas;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.drawImage(image, 0, 0, width, height);
    target.setTransform(width / image.width, 0, 0, height / image.height, 0, 0);
    target.fillStyle = maskColor;
    for (const { x, y, width, height } of regions) {
      target.fillRect(x, y, width, height);
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
      if (bitmap) paint(context, bitmap, masks(), drag && rectangle(drag.start, drag.end));
    });
  }

  function edited() {
    notice = "";
    refresh();
    redraw();
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
      const scale = Math.min(1, previewLimit / Math.max(image.width, image.height));
      preview.width = Math.max(1, Math.round(image.width * scale));
      preview.height = Math.max(1, Math.round(image.height * scale));
      edited();
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
    drag = { id: event.pointerId, start, end: start };
    preview.setPointerCapture(event.pointerId);
  });

  preview.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    drag.end = position(event);
    redraw();
  });

  preview.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const region = rectangle(drag.start, position(event));
    drag = null;
    if (region) history.push([...masks(), region]);
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

  clear.addEventListener("click", () => {
    if (!masks().length) return;
    history.push([]);
    edited();
  });

  save.addEventListener("click", async () => {
    const image = bitmap;
    const regions = masks();
    if (!image || !regions.length || exporting) return;
    const output = document.createElement("canvas");
    exporting = true;
    notice = "exporting";
    refresh();
    try {
      output.width = image.width;
      output.height = image.height;
      const target = output.getContext("2d");
      if (!target) throw new Error("Unavailable export canvas");
      paint(target, image, regions);
      const png = await new Promise(resolve => output.toBlob(resolve, "image/png"));
      if (bitmap !== image || masks() !== regions) return;
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
      if (bitmap === image && masks() === regions) notice = "exportFailed";
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
