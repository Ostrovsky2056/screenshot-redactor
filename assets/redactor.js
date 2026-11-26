(() => {
  const maskColor = "#191a16";
  const speakerColors = ["#355665", "#7b4a35", "#395840", "#51466d", "#69404f", "#465674"];
  const previewLimit = 1600;
  const ocrLanguages = ["eng", "chi_sim"];
  const avatarAssetSize = 112;
  const avatarUploadSize = 512;
  const maxSide = 16_384;
  const maxPixels = 40_000_000;
  const corners = [
    { right: false, bottom: false, cursor: "nwse" },
    { right: true, bottom: false, cursor: "nesw" },
    { right: false, bottom: true, cursor: "nesw" },
    { right: true, bottom: true, cursor: "nwse" },
  ];
  const messages = {
    en: {
      loading: "Opening the screenshot…",
      exampleLoading: "Opening the example…",
      exampleFailed: "Couldn’t open the example. Try again.",
      handoffFailed: "Couldn’t open the screenshot from the homepage. Choose it again here.",
      ready: "Drag on the image to cover a region.",
      masks: count => count + (count === 1 ? " region covered" : " regions covered"),
      reviewed: (count, total) => count + " of " + total + " selected. Click to toggle. Drag a corner of a selected box to resize it, or drag elsewhere to add a box.",
      pendingNames: count => count === 1 ? "1 name box needs review (amber)." : count + " name boxes need review (amber).",
      ocrLoading: "Loading the on-device recognition models…",
      ocrRunning: "Recognizing text on this device…",
      ocrRefining: "Checking name boundaries on this device…",
      visionRunning: "Looking for avatars and faces on this device…",
      noMatches: "No regions detected. Drag to cover any details yourself.",
      scanPartial: "Part of the scan could not finish. Review the boxes and add missing masks.",
      ocrFailed: "Recognition failed. Try scanning again or draw your own masks.",
      unsupported: "Choose a PNG, JPEG, or WebP image.",
      unreadable: "This image could not be opened.",
      tooLarge: "The image exceeds this editor’s size limit.",
      copying: "Copying the redacted image…",
      copied: "Image copied to the clipboard.",
      copyFailed: "Couldn’t copy the image. Use Export PNG to save it.",
      exporting: "Preparing the PNG…",
      exported: "Redacted PNG ready.",
      exportFailed: "The browser could not export this image.",
      browser: "This browser can’t run the image editor.",
      avatarName: label => "Speaker " + label,
      avatarUpload: "Choose image",
      avatarUploadFor: label => "Choose an avatar for speaker " + label,
      avatarReset: "Use default",
      avatarResetFor: label => "Restore the default avatar for speaker " + label,
      avatarReading: "Reading image…",
      avatarFormat: "Choose a PNG, JPEG, or WebP avatar.",
      avatarFailed: "Couldn’t open the avatar image.",
      avatarTooLarge: "The avatar image exceeds the size limit.",
    },
    "zh-CN": {
      loading: "正在打开截图…",
      exampleLoading: "正在打开示例…",
      exampleFailed: "无法打开示例，请重试。",
      handoffFailed: "无法打开从首页选中的截图，请在这里重新选择。",
      ready: "在图上拖出矩形，遮挡敏感区域。",
      masks: count => "已遮挡 " + count + " 处",
      reviewed: (count, total) => "已框选 " + count + " 处，共 " + total + " 个候选。点击虚线框切换选择，拖动已选框的角点可调整大小，拖动空白处可补画。",
      pendingNames: count => "另有 " + count + " 处姓名范围待核对（琥珀色虚线）。",
      ocrLoading: "正在加载本地识别模型…",
      ocrRunning: "正在浏览器本地识别…",
      ocrRefining: "正在本地复核姓名边界…",
      visionRunning: "正在本地查找头像和人脸…",
      noMatches: "未识别出可框选的区域，可以拖动补画。",
      scanPartial: "部分识别没有完成。请核对框选结果并补画遗漏的区域。",
      ocrFailed: "识别失败，可重新识别或手动补画。",
      unsupported: "请选择 PNG、JPEG 或 WebP 图片。",
      unreadable: "无法打开这张图片。",
      tooLarge: "图片尺寸超出编辑器支持的范围。",
      copying: "正在复制脱敏图片…",
      copied: "已复制脱敏图片，可直接粘贴。",
      copyFailed: "无法复制图片，请使用「导出 PNG」。",
      exporting: "正在生成 PNG…",
      exported: "已生成脱敏 PNG。",
      exportFailed: "浏览器无法导出这张图片。",
      browser: "当前浏览器无法运行图片编辑器。",
      avatarName: label => "发言人 " + label,
      avatarUpload: "上传头像",
      avatarUploadFor: label => "上传发言人 " + label + " 的头像",
      avatarReset: "恢复默认",
      avatarResetFor: label => "恢复发言人 " + label + " 的默认头像",
      avatarReading: "正在读取…",
      avatarFormat: "请选择 PNG、JPEG 或 WebP 格式的头像。",
      avatarFailed: "无法打开这张头像图片。",
      avatarTooLarge: "头像图片尺寸超出支持范围。",
    },
  };
  const errors = new Set(["unsupported", "unreadable", "tooLarge", "exampleFailed", "handoffFailed", "copyFailed", "exportFailed", "ocrFailed", "scanPartial", "browser",
    "avatarFormat", "avatarFailed", "avatarTooLarge"]);

  const choose = document.querySelector("#choose");
  const tryExample = document.querySelector("#try-example");
  const exampleImage = "assets/chat-example.png?v=1";
  const { supportedFormat, take } = window.screenshotHandoff;
  const replace = document.querySelector("#replace");
  const scan = document.querySelector("#scan");
  const undo = document.querySelector("#undo");
  const clear = document.querySelector("#clear");
  const copy = document.querySelector("#copy");
  const save = document.querySelector("#save");
  const input = document.querySelector("#image-input");
  const toolbar = document.querySelector("#toolbar");
  const styleBar = document.querySelector("#style-bar");
  const style = document.querySelector("#mask-style");
  const opacity = document.querySelector("#mask-opacity");
  const opacityValue = document.querySelector("#mask-opacity-value");
  const blurControl = document.querySelector("#blur-strength-control");
  const blurStrength = document.querySelector("#blur-strength");
  const blurValue = document.querySelector("#blur-strength-value");
  const markSpeakers = document.querySelector("#mark-speakers");
  const avatarPanel = document.querySelector("#speaker-avatars");
  const avatarList = document.querySelector("#speaker-avatar-list");
  const avatarTemplate = document.querySelector("#speaker-avatar-template");
  const avatarInput = document.querySelector("#avatar-image-input");
  const hideAvatarNames = document.querySelector("#hide-avatar-names");
  const previewMasks = document.querySelector("#mask-preview");
  const workspace = document.querySelector("#workspace");
  const importPanel = document.querySelector("#import-panel");
  const preview = document.querySelector("#preview");
  const status = document.querySelector("#editor-status");
  const feedback = document.querySelector("#feedback");
  const dimensions = document.querySelector("#dimensions");
  // Match the compositing settings of the preview and the PNG canvas.
  const renderContextOptions = { willReadFrequently: true };
  const context = preview.getContext("2d", renderContextOptions);
  const backgroundColors = new WeakMap();
  const generatedAvatars = new Map();
  const avatarOverrides = new Map();
  const avatarUploads = new Map();
  const avatarRows = new Map();

  let nextSpeakerId = 0;
  let avatarChoice = null;
  let backgroundSampler;
  let blurCache = null;
  let blurTile = null;
  let bitmap = null;
  let history = [[]];
  let drag = null;
  let notice = "";
  let loadVersion = 0;
  let previewFrame = 0;
  let outputBusy = false;
  let workerPromise;
  let scanQueue = Promise.resolve();
  let scanVersion = 0;
  let scanStatus = "";
  let showMasks = false;
  let settingsVersion = 0;

  function masks() {
    return history[history.length - 1];
  }

  function refresh() {
    const language = messages[document.documentElement.lang] || messages.en;
    const regions = masks();
    const count = regions.filter(region => region.enabled !== false).length;
    const uncertain = regions.filter(region => region.pending && !region.reviewed).length;
    const hasSpeakers = regions.some(region => region.speaker !== undefined);
    const opening = notice === "loading" || notice === "exampleLoading";
    const message = opening ? notice : scanStatus || notice;
    if (tryExample) tryExample.disabled = choose.disabled || opening;
    toolbar.hidden = !bitmap;
    styleBar.hidden = !bitmap;
    markSpeakers.disabled = !hasSpeakers;
    blurControl.hidden = style.value !== "blur";
    opacityValue.value = opacity.value + "%";
    opacity.setAttribute("aria-valuetext", opacityValue.value);
    blurValue.value = blurStrength.value;
    previewMasks.setAttribute("aria-pressed", String(showMasks));
    importPanel.hidden = !!bitmap;
    preview.hidden = !bitmap;
    workspace.toggleAttribute("data-loaded", !!bitmap);
    scan.disabled = opening || !!scanStatus || outputBusy;
    undo.disabled = history.length === 1;
    clear.disabled = !count;
    const outputDisabled = opening || !count || outputBusy || !!scanStatus || avatarUploads.size > 0;
    save.disabled = outputDisabled;
    copy.disabled = outputDisabled;
    status.hidden = !message && !bitmap;
    status.toggleAttribute("data-error", errors.has(message));
    const summary = showMasks ? language.masks(count) : language.reviewed(count, regions.length);
    const details = message ? language[message] : regions.length ? summary : language.ready;
    feedback.textContent = details + (uncertain && !scanStatus && !opening ? " " + language.pendingNames(uncertain) : "");
    dimensions.textContent = bitmap ? bitmap.width + " × " + bitmap.height + " px" : "";
    refreshAvatarPanel(regions, language, opening);
  }

  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  if (!context || typeof createImageBitmap !== "function") {
    notice = "browser";
    refresh();
    return;
  }

  function speakerLabel(index) {
    let label = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      label = String.fromCharCode(65 + (value - 1) % 26) + label;
    }
    return label;
  }

  function roundedBox(x, y, width, height, radius) {
    const path = new Path2D();
    const right = x + width;
    const bottom = y + height;
    path.moveTo(x + radius, y);
    path.arcTo(right, y, right, bottom, radius);
    path.arcTo(right, bottom, x, bottom, radius);
    path.arcTo(x, bottom, x, y, radius);
    path.arcTo(x, y, right, y, radius);
    path.closePath();
    return path;
  }

  function generateAvatar(speaker) {
    const portrait = document.createElement("canvas");
    portrait.width = portrait.height = avatarAssetSize;
    const target = portrait.getContext("2d", renderContextOptions);
    if (!target) return null;

    const background = speakerColors[speaker % speakerColors.length];
    const skin = ["#edbd8d", "#b87b63", "#d99c6f", "#efc6a3", "#965d49", "#c0845e"][speaker % 6];
    const knit = ["#f1e2b8", "#dce9dc", "#e2dcc9", "#ebcdbb"][speaker % 4];
    const hair = ["#263432", "#342523", "#263339", "#48352c"][speaker % 4];
    target.fillStyle = background;
    target.fillRect(0, 0, avatarAssetSize, avatarAssetSize);
    const sheen = target.createLinearGradient(10, 8, 106, 112);
    sheen.addColorStop(0, "#ffffff39");
    sheen.addColorStop(1, "#1018152e");
    target.fillStyle = sheen;
    target.fillRect(0, 0, avatarAssetSize, avatarAssetSize);

    target.fillStyle = "#faf7ef26";
    target.beginPath();
    target.ellipse(49, 50, 32, 34, -.34, 0, 2 * Math.PI);
    target.fill();

    target.fillStyle = knit;
    target.beginPath();
    target.moveTo(8, 112);
    target.quadraticCurveTo(11, 78, 39, 76);
    target.lineTo(58, 76);
    target.quadraticCurveTo(86, 79, 90, 112);
    target.closePath();
    target.fill();

    target.fillStyle = skin;
    target.fillRect(38, 67, 22, 17);
    target.beginPath();
    target.ellipse(49, 52, 21, 24, 0, 0, 2 * Math.PI);
    target.fill();

    target.fillStyle = hair;
    target.beginPath();
    target.moveTo(28, 53);
    target.bezierCurveTo(19, 31, 35, 23, 49, 23);
    target.bezierCurveTo(64, 23, 75, 34, 70, 53);
    target.quadraticCurveTo(66, 49, 62, 38);
    if (speaker % 2 === 0) target.quadraticCurveTo(47, 50, 29, 46);
    else target.quadraticCurveTo(48, 34, 32, 49);
    target.closePath();
    target.fill();
    for (const eye of [42, 57]) {
      target.beginPath();
      target.arc(eye, 55, 1.65, 0, 2 * Math.PI);
      target.fill();
    }
    target.strokeStyle = hair;
    target.lineWidth = 1.5;
    target.lineCap = "round";
    target.beginPath();
    target.moveTo(45, 64);
    target.quadraticCurveTo(49, 67, 53, 64);
    target.stroke();

    target.fillStyle = "#191f1ddb";
    target.fill(roundedBox(65, 70, 42, 36, 7));
    target.fillStyle = "#faf7ef";
    target.font = "800 28px system-ui, sans-serif";
    target.textAlign = "center";
    target.textBaseline = "middle";
    target.fillText(speakerLabel(speaker), 86, 88, 34);
    return portrait;
  }

  function speakerAvatar(speaker) {
    const custom = avatarOverrides.get(speaker);
    if (custom) return custom;
    if (!generatedAvatars.has(speaker)) generatedAvatars.set(speaker, generateAvatar(speaker));
    return generatedAvatars.get(speaker);
  }

  function drawAvatar(target, portrait, x, y, side) {
    target.save();
    target.clip(roundedBox(x, y, side, side, .18 * side));
    if (portrait) {
      target.drawImage(portrait, x, y, side, side);
    } else {
      target.fillStyle = maskColor;
      target.fillRect(x, y, side, side);
    }
    target.restore();
  }

  function paintAvatars(target, image, regions) {
    for (const region of regions) {
      const { x, y, width, height, clipped, speaker, quoteSender } = region;
      const slot = clipped ? width : Math.min(width, height);
      const inset = clipped ? 0 : Math.min(4, Math.floor(slot * .07));
      const side = Math.max(1, slot - 2 * inset);
      const left = quoteSender ? x + width - side - inset : x + (width - side) / 2;
      const top = clipped ? (y < image.height / 2 ? y + height - side : y) : y + (height - side) / 2;
      target.save();
      target.beginPath();
      target.rect(x, y, width, height);
      target.clip();
      drawAvatar(target, speakerAvatar(speaker), left, top, side);
      target.restore();
    }
  }

  function refreshAvatarPanel(regions, language, opening) {
    const speakers = [...new Set(regions.filter(region => region.type === "avatar" && region.speaker !== undefined)
      .map(region => region.speaker))].sort((a, b) => a - b);
    avatarPanel.hidden = !markSpeakers.checked || !speakers.length;
    if (avatarPanel.hidden) return;

    const visible = new Set(speakers);
    for (const [speaker, row] of avatarRows) {
      if (visible.has(speaker)) continue;
      row.element.remove();
      avatarRows.delete(speaker);
    }
    for (const speaker of speakers) {
      let row = avatarRows.get(speaker);
      if (!row) {
        const element = avatarTemplate.content.firstElementChild.cloneNode(true);
        const canvas = element.querySelector("canvas");
        const name = element.querySelector(".speaker-avatar-name");
        const upload = element.querySelector("[data-avatar-upload]");
        const reset = element.querySelector("[data-avatar-reset]");
        upload.addEventListener("click", () => {
          avatarChoice = { speaker, version: loadVersion };
          avatarInput.click();
        });
        reset.addEventListener("click", () => {
          avatarOverrides.delete(speaker);
          updateAppearance();
          upload.focus();
        });
        row = { element, canvas, name, upload, reset };
        const next = speakers.find(id => id > speaker && avatarRows.has(id));
        avatarList.insertBefore(element, avatarRows.get(next)?.element ?? null);
        avatarRows.set(speaker, row);
      }
      const label = speakerLabel(speaker);
      row.name.textContent = language.avatarName(label);
      row.upload.textContent = avatarUploads.has(speaker) ? language.avatarReading : language.avatarUpload;
      row.upload.setAttribute("aria-label", language.avatarUploadFor(label));
      row.upload.disabled = opening;
      row.upload.setAttribute("aria-busy", String(avatarUploads.has(speaker)));
      row.reset.textContent = language.avatarReset;
      row.reset.setAttribute("aria-label", language.avatarResetFor(label));
      row.reset.hidden = !avatarOverrides.has(speaker);
      row.reset.disabled = opening || avatarUploads.has(speaker);

      const portrait = speakerAvatar(speaker);
      if (row.portrait === portrait) continue;
      const target = row.canvas.getContext("2d", renderContextOptions);
      if (target) {
        target.clearRect(0, 0, row.canvas.width, row.canvas.height);
        drawAvatar(target, portrait, 0, 0, row.canvas.width);
      }
      row.portrait = portrait;
    }
  }

  function paintSpeakerMarkers(target, regions) {
    target.save();
    target.textAlign = "center";
    target.textBaseline = "middle";
    for (const { x, y, width, height, speaker } of regions) {
      if (speaker === undefined) continue;
      const label = speakerLabel(speaker);
      const markerHeight = Math.max(1, Math.round(height * .9));
      const size = Math.max(1, Math.floor(Math.min(markerHeight * .7, width / (label.length * .77 + .25))));
      target.font = "750 " + size + "px system-ui, sans-serif";
      const textWidth = target.measureText(label).width + markerHeight * .29;
      const markerWidth = Math.min(width, Math.ceil(textWidth));
      const left = x + (width - markerWidth) / 2;
      const top = y + (height - markerHeight) / 2;
      const right = left + markerWidth;
      const bottom = top + markerHeight;
      const radius = Math.min(markerWidth, markerHeight) * .24;

      const marker = roundedBox(left, top, markerWidth, markerHeight, radius);
      target.fillStyle = speakerColors[speaker % speakerColors.length];
      target.fill(marker);
      const shading = target.createLinearGradient(left, top, right, bottom);
      shading.addColorStop(0, "#ffffff28");
      shading.addColorStop(.55, "#ffffff00");
      shading.addColorStop(1, "#12171826");
      target.fillStyle = shading;
      target.fill(marker);
      if (size >= 7) {
        target.fillStyle = "#faf7ef";
        target.fillText(label, x + width / 2, y + height / 2, markerWidth * .84);
      }
    }
    target.restore();
  }

  function paintPixelPattern(target, { x, y, width, height }) {
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

  function paintPixelMasks(target, regions) {
    for (const [index, region] of regions.entries()) {
      if (target.globalAlpha === 1) {
        paintPixelPattern(target, region);
        continue;
      }
      target.save();
      for (let i = index + 1; i < regions.length; i++) {
        const next = regions[i];
        const x = Math.max(region.x, next.x);
        const y = Math.max(region.y, next.y);
        const right = Math.min(region.x + region.width, next.x + next.width);
        const bottom = Math.min(region.y + region.height, next.y + next.height);
        if (x >= right || y >= bottom) continue;
        // Each pixel takes the pattern and opacity of the top mask.
        target.beginPath();
        target.rect(region.x, region.y, region.width, region.height);
        target.rect(x, y, right - x, bottom - y);
        target.clip("evenodd");
      }
      paintPixelPattern(target, region);
      target.restore();
    }
  }

  function applyGaussianBlur(target, sigma) {
    const { width, height } = target.canvas;
    const pixels = target.getImageData(0, 0, width, height);
    const { data } = pixels;
    const source = new Float32Array(data.length);
    const horizontal = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      source[i] = data[i] * alpha;
      source[i + 1] = data[i + 1] * alpha;
      source[i + 2] = data[i + 2] * alpha;
      source[i + 3] = data[i + 3];
    }

    const radius = Math.ceil(3 * sigma);
    const weights = Array.from({ length: radius * 2 + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < weights.length; i++) weights[i] /= weightSum;

    // Convolve along one axis at a time using premultiplied color.
    function convolve(input, output, length, lineCount, step, lineStep) {
      for (let line = 0; line < lineCount; line++) {
        const start = line * lineStep;
        for (let position = 0; position < length; position++) {
          let red = 0, green = 0, blue = 0, alpha = 0;
          for (let tap = 0; tap < weights.length; tap++) {
            const sample = Math.max(0, Math.min(length - 1, position + tap - radius));
            const offset = start + sample * step;
            const weight = weights[tap];
            red += input[offset] * weight;
            green += input[offset + 1] * weight;
            blue += input[offset + 2] * weight;
            alpha += input[offset + 3] * weight;
          }
          const offset = start + position * step;
          output[offset] = red;
          output[offset + 1] = green;
          output[offset + 2] = blue;
          output[offset + 3] = alpha;
        }
      }
    }
    convolve(source, horizontal, width, height, 4, width * 4);
    convolve(horizontal, source, height, width, width * 4, 4);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = source[i + 3];
      const normalize = alpha > 0 ? 255 / alpha : 0;
      data[i] = source[i] * normalize;
      data[i + 1] = source[i + 1] * normalize;
      data[i + 2] = source[i + 2] * normalize;
      data[i + 3] = alpha;
    }
    target.putImageData(pixels, 0, 0);
  }

  function blurredImage(image, strength, removed) {
    if (blurCache?.image === image && blurCache.strength === strength &&
        removed.length === blurCache.removed.length &&
        removed.every((region, i) => region === blurCache.removed[i])) return blurCache.canvas;

    // Blur a bounded working image and reuse it for preview, copy, and export.
    const scale = Math.min(1, 900 / Math.max(image.width, image.height), 3 / strength);
    const canvas = blurCache?.canvas ?? document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const target = canvas.getContext("2d", { willReadFrequently: true });
    if (!target) return null;
    target.drawImage(image, 0, 0, canvas.width, canvas.height);
    const sx = canvas.width / image.width;
    const sy = canvas.height / image.height;
    // Clear original avatars before blurring nearby pixels.
    for (const region of removed) {
      const padding = region.type === "avatar" ? 1 : 0;
      const x = Math.floor(region.x * sx) - padding;
      const y = Math.floor(region.y * sy) - padding;
      const right = Math.ceil((region.x + region.width) * sx) + padding;
      const bottom = Math.ceil((region.y + region.height) * sy) + padding;
      eraseRegion(target, { x, y, width: right - x, height: bottom - y }, replacementBackground(image, region));
    }
    applyGaussianBlur(target, strength * scale);
    blurCache = { image, strength, removed, canvas };
    return canvas;
  }

  function featherGradient(gradient) {
    gradient.addColorStop(0, "#000");
    gradient.addColorStop(.25, "#000000d7");
    gradient.addColorStop(.5, "#00000080");
    gradient.addColorStop(.75, "#00000028");
    gradient.addColorStop(1, "#00000000");
    return gradient;
  }

  function paintBlurMatte(target, region, featherX, featherY) {
    const { x, y, width, height } = region;
    const right = x + width;
    const bottom = y + height;
    target.fillStyle = "#000";
    target.fillRect(x, y, width, height);

    const edges = [
      { gradient: [x, y, x - featherX, y], band: [x - featherX, y, featherX, height] },
      { gradient: [right, y, right + featherX, y], band: [right, y, featherX, height] },
      { gradient: [x, y, x, y - featherY], band: [x, y - featherY, width, featherY] },
      { gradient: [x, bottom, x, bottom + featherY], band: [x, bottom, width, featherY] },
    ];
    for (const { gradient, band } of edges) {
      target.fillStyle = featherGradient(target.createLinearGradient(...gradient));
      target.fillRect(...band);
    }
    for (const corner of corners) {
      const point = cornerPoint(region, corner);
      target.save();
      target.translate(point.x, point.y);
      target.scale(featherX, featherY);
      target.fillStyle = featherGradient(target.createRadialGradient(0, 0, 0, 0, 0, 1));
      target.fillRect(corner.right ? 0 : -1, corner.bottom ? 0 : -1, 1, 1);
      target.restore();
    }
  }

  function paintFeatheredBlur(target, image, blur, regions, core) {
    const tile = blurTile ??= document.createElement("canvas");
    const matte = tile.getContext("2d", renderContextOptions);
    if (target.globalAlpha === 1) {
      // Replace the entire selected core even when the source contains transparency.
      target.save();
      target.clip(core);
      target.clearRect(0, 0, image.width, image.height);
      target.restore();
    }
    if (!matte) {
      target.clip(core);
      target.drawImage(blur, 0, 0, image.width, image.height);
      return;
    }

    const { width, height } = target.canvas;
    const sx = width / image.width;
    const sy = height / image.height;
    const bounds = regions.map(region => {
      const { x, y, width, height } = region;
      const featherY = Math.min(10, Math.max(2, Math.round(Math.min(width, height) * .19)));
      const fullWidthFeather = region.type === "avatar" || width >= 6 * height;
      const featherX = fullWidthFeather ? featherY : Math.max(2, Math.round(featherY * .48));
      return {
        region, featherX, featherY,
        left: (x - featherX) * sx, right: (x + width + featherX) * sx,
        top: (y - featherY) * sy, bottom: (y + height + featherY) * sy,
      };
    });

    // A shared matte applies opacity once per pixel. Tiles bound export memory.
    const tileSize = 1024;
    target.setTransform(1, 0, 0, 1, 0, 0);
    for (let top = 0; top < height; top += tileSize) {
      for (let left = 0; left < width; left += tileSize) {
        const right = Math.min(left + tileSize, width);
        const bottom = Math.min(top + tileSize, height);
        const visible = bounds.filter(box => box.left < right && box.right > left && box.top < bottom && box.bottom > top);
        if (!visible.length) continue;
        if (tile.width !== right - left) tile.width = right - left;
        if (tile.height !== bottom - top) tile.height = bottom - top;
        matte.setTransform(1, 0, 0, 1, 0, 0);
        matte.clearRect(0, 0, tile.width, tile.height);
        matte.globalCompositeOperation = "source-over";
        matte.setTransform(sx, 0, 0, sy, -left, -top);
        for (const { region, featherX, featherY } of visible) paintBlurMatte(matte, region, featherX, featherY);
        matte.globalCompositeOperation = "source-in";
        matte.drawImage(blur, 0, 0, image.width, image.height);
        target.drawImage(tile, left, top);
      }
    }
  }

  function paintMaskEffects(target, image, regions, removed, settings) {
    if (!regions.length || settings.opacity === 0) return;
    target.save();
    target.globalAlpha = settings.opacity;
    if (settings.appearance === "pixels") {
      paintPixelMasks(target, regions);
    } else {
      const core = new Path2D();
      for (const { x, y, width, height } of regions) core.rect(x, y, width, height);
      const blur = settings.appearance === "blur" ? blurredImage(image, settings.blurStrength, removed) : null;
      if (blur) {
        paintFeatheredBlur(target, image, blur, regions, core);
      } else {
        target.fillStyle = settings.appearance === "paper" ? "#f4f1e9" : maskColor;
        target.fill(core);
      }
    }
    target.restore();
  }

  function renderSettings() {
    return {
      appearance: style.value,
      opacity: Number(opacity.value) / 100,
      blurStrength: Number(blurStrength.value),
      speakers: markSpeakers.checked,
      hideNicknames: hideAvatarNames.checked,
    };
  }

  function sampleBackground(image, { x, y, width, height }) {
    const limit = 96;
    if (!backgroundSampler) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = limit;
      backgroundSampler = canvas.getContext("2d", { willReadFrequently: true });
      if (!backgroundSampler) return null;
      backgroundSampler.imageSmoothingEnabled = false;
    }
    const right = x + width;
    const bottom = y + height;
    const padding = Math.max(2, Math.min(6, Math.round(height / 5)));
    const bands = [
      [x, Math.max(0, y - padding), width, Math.min(y, padding)],
      [x, bottom, width, Math.min(image.height - bottom, padding)],
      [Math.max(0, x - padding), y, Math.min(x, padding), height],
      [right, y, Math.min(image.width - right, padding), height],
    ];
    // Sample the original image just outside the mask and fill with an opaque color.
    const colors = new Map();
    let dominant = null;
    for (const [left, top, w, h] of bands) {
      if (w <= 0 || h <= 0) continue;
      const sampleWidth = Math.min(w, limit);
      const sampleHeight = Math.min(h, limit);
      backgroundSampler.clearRect(0, 0, sampleWidth, sampleHeight);
      backgroundSampler.drawImage(image, left, top, w, h, 0, 0, sampleWidth, sampleHeight);
      const { data } = backgroundSampler.getImageData(0, 0, sampleWidth, sampleHeight);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 255) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let bin = colors.get(key);
        if (!bin) {
          bin = { count: 0, red: 0, green: 0, blue: 0 };
          colors.set(key, bin);
        }
        bin.count++;
        bin.red += r;
        bin.green += g;
        bin.blue += b;
        if (!dominant || bin.count > dominant.count) dominant = bin;
      }
    }
    if (!dominant) return null;
    const channels = [dominant.red, dominant.green, dominant.blue].map(value => Math.round(value / dominant.count));
    return "rgb(" + channels.join(", ") + ")";
  }

  function cornerPoint(region, { right, bottom }) {
    return { x: right ? region.x + region.width : region.x, y: bottom ? region.y + region.height : region.y };
  }

  function paintHandles(target, image, regions) {
    const { canvas } = target;
    const unitX = image.width / (canvas.clientWidth || canvas.width);
    const unitY = image.height / (canvas.clientHeight || canvas.height);
    for (const region of regions) {
      if (region.enabled === false) continue;
      const size = Math.min(7, .45 * region.width / unitX, .45 * region.height / unitY);
      const border = Math.min(1, .25 * size);
      for (const corner of corners) {
        const { x, y } = cornerPoint(region, corner);
        target.fillStyle = "#f4f1e9";
        target.fillRect(x - size * unitX / 2, y - size * unitY / 2, size * unitX, size * unitY);
        target.fillStyle = "#a73925";
        const inner = size - 2 * border;
        target.fillRect(x - inner * unitX / 2, y - inner * unitY / 2, inner * unitX, inner * unitY);
      }
    }
  }

  function replacementBackground(image, region) {
    if (!backgroundColors.has(region)) backgroundColors.set(region, sampleBackground(image, region));
    return backgroundColors.get(region) || (region.type === "avatar" || region.quoteSender ? null : maskColor);
  }

  function eraseRegion(target, { x, y, width, height }, background) {
    if (background) {
      target.fillStyle = background;
      target.fillRect(x, y, width, height);
    } else {
      target.clearRect(x, y, width, height);
    }
  }

  function paint(target, image, regions, settings, review = false, draft = null) {
    const { width, height } = target.canvas;
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.clearRect(0, 0, width, height);
    target.drawImage(image, 0, 0, width, height);
    target.setTransform(width / image.width, 0, 0, height / image.height, 0, 0);
    const ordered = review ? [...regions].sort((a, b) => area(b) - area(a)) : regions;
    const regularMasks = [];
    const removed = [];
    const avatars = [];
    if (review) {
      const unit = image.width / (target.canvas.clientWidth || width);
      target.setLineDash([4 * unit, 3 * unit]);
      target.lineWidth = 1.3 * unit;
    }
    for (const region of ordered) {
      const { x, y, width: w, height: h, enabled, pending, reviewed } = region;
      if (review) {
        target.strokeStyle = pending && !reviewed ? "#906628" : enabled === false ? "#5d5b5399" : "#a73925";
        if (enabled !== false) {
          target.fillStyle = "#a739252c";
          target.fillRect(x, y, w, h);
        }
        target.strokeRect(x, y, w, h);
      } else if (enabled !== false) {
        const replaceWithAvatar = settings.speakers && region.speaker !== undefined &&
          (region.type === "avatar" || region.quoteSender);
        if (replaceWithAvatar || (settings.hideNicknames && region.avatarNickname)) {
          eraseRegion(target, region, replacementBackground(image, region));
          removed.push(region);
          if (replaceWithAvatar) avatars.push(region);
        } else {
          regularMasks.push(region);
        }
      }
    }
    if (review) {
      target.setLineDash([]);
      paintHandles(target, image, ordered);
    } else {
      paintMaskEffects(target, image, regularMasks, removed, settings);
      if (settings.speakers) paintSpeakerMarkers(target, regularMasks);
      paintAvatars(target, image, avatars);
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

  function resizedBounds({ handle: { region, corner }, start }, end) {
    const dx = Math.round(end.x - start.x);
    const dy = Math.round(end.y - start.y);
    const right = region.x + region.width;
    const bottom = region.y + region.height;
    const x0 = corner.right ? region.x : Math.max(0, Math.min(right - 1, region.x + dx));
    const y0 = corner.bottom ? region.y : Math.max(0, Math.min(bottom - 1, region.y + dy));
    const x1 = corner.right ? Math.min(bitmap.width, Math.max(x0 + 1, right + dx)) : right;
    const y1 = corner.bottom ? Math.min(bitmap.height, Math.max(y0 + 1, bottom + dy)) : bottom;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  function redraw() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      if (!bitmap) return;
      const regions = masks();
      const resized = drag?.handle && resizedBounds(drag, drag.end);
      const displayed = resized ? regions.map(region => region === drag.handle.region ? { ...region, ...resized } : region) : regions;
      const draft = drag && !drag.handle && rectangle(drag.start, drag.end);
      paint(context, bitmap, displayed, renderSettings(), !showMasks, draft);
    });
  }

  function edited() {
    notice = "";
    refresh();
    redraw();
  }

  new ResizeObserver(redraw).observe(preview);

  function getWorker() {
    if (!workerPromise) {
      const assets = new URL("assets/ocr/", document.baseURI);
      workerPromise = Tesseract.createWorker(ocrLanguages, Tesseract.OEM.LSTM_ONLY, {
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

  async function readCrops(image, sample, boxes, current, {
    highlighted = false, language, messages = [], participants = [],
  } = {}) {
    const worker = await getWorker();
    const readings = new Map();
    const crop = document.createElement("canvas");
    const target = crop.getContext("2d");
    const sx = image.width / sample.width;
    const sy = image.height / sample.height;
    const marginX = highlighted ? 0 : 4;
    const marginY = highlighted ? 0 : 3;
    try {
      if (language) await worker.reinitialize(language, Tesseract.OEM.LSTM_ONLY);
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE });
      for (const box of boxes) {
        if (!current()) break;
        const x = Math.floor(Math.max(0, box.x0 - marginX) * sx);
        const y = Math.floor(Math.max(0, box.y0 - marginY) * sy);
        const width = Math.ceil(Math.min(sample.width, box.x1 + marginX) * sx) - x;
        const height = Math.ceil(Math.min(sample.height, box.y1 + marginY) * sy) - y;
        if (width <= 0 || height <= 0) continue;
        const desiredHeight = highlighted && !box.outlined && !box.addressPrefix ? 112 : 60;
        const scale = Math.min(4, 4096 / width, Math.max(1, desiredHeight / height));
        crop.width = Math.ceil(width * scale) + 16;
        crop.height = Math.ceil(height * scale) + 20;
        target.fillStyle = "#fff";
        target.fillRect(0, 0, crop.width, crop.height);
        target.drawImage(image, x, y, width, height, 8, 10, width * scale, height * scale);
        const intoSample = bounds => ({
          x0: (x + (bounds.x0 - 8) / scale) / sx,
          y0: (y + (bounds.y0 - 10) / scale) / sy,
          x1: (x + (bounds.x1 - 8) / scale) / sx,
          y1: (y + (bounds.y1 - 10) / scale) / sy,
        });
        const inMessage = highlighted && !box.outlined && messages.some(message => overlappingName(message, box));
        const ink = highlighted && HighlightMentions.cleanCrop(target, 8, 10,
          Math.floor(width * scale), Math.floor(height * scale), box.outlined, box.addressPrefix);
        const clause = inMessage && !box.addressPrefix && HighlightMentions.firstClause(ink);
        const prefix = clause && { ...intoSample(clause.box), addressPrefix: true };
        const { data } = await worker.recognize(crop, {}, { text: false, blocks: true });
        const lines = SensitiveText.readLines(data.blocks);
        if (lines.length !== 1) {
          if (prefix) readings.set(box, { prefix, confidence: 0 });
          continue;
        }
        const line = lines[0];
        const confidence = line.confidence ?? data.confidence;
        const name = ink && HighlightMentions.readName(line, confidence, ink, {
          clause, participants: inMessage ? participants : undefined, includeEmoji: inMessage && !box.addressPrefix,
        });
        line.box = intoSample(line.box);
        line.spans = line.spans.map(span => ({ ...span, box: span.box && intoSample(span.box) }));
        readings.set(box, { line, confidence, prefix,
          name: name && { ...intoSample(name), includesEmoji: name.includesEmoji } });
      }
    } finally {
      crop.width = 0;
      crop.height = 0;
      try {
        if (language) await worker.reinitialize(ocrLanguages, Tesseract.OEM.LSTM_ONLY);
        await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT });
      } catch (error) {
        workerPromise = undefined;
        await worker.terminate();
        throw error;
      }
    }
    return readings;
  }

  function contains(outer, inner) {
    return outer.x <= inner.x && outer.y <= inner.y &&
      outer.x + outer.width >= inner.x + inner.width &&
      outer.y + outer.height >= inner.y + inner.height;
  }

  function area(region) {
    return region.width * region.height;
  }

  function regionBounds({ x, y, width, height }) {
    return { x, y, width, height };
  }

  function similar(a, b) {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 && w * h >= .8 * Math.max(area(a), area(b));
  }

  function overlappingName(a, b) {
    const width = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const height = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    return width > 0 && height > 0 && width * height >= .83 * smaller;
  }

  function detections(lines, visual, inlineNames, image, sample) {
    const stickers = visual.stickers;
    const regions = SensitiveText.findRegions(lines, image, sample, stickers);
    function add(box, type, margin, {
      enabled = true, pending = false, avatarNickname = false, quoteSender = false, preserveBounds = false,
    } = {}) {
      const region = SensitiveText.scaleBox(box, type, image, sample, margin);
      if (!region) return;
      if (type === "avatar" && box.topLimit !== undefined) {
        const top = Math.max(region.y, Math.floor(box.topLimit * image.height / sample.height));
        region.height -= top - region.y;
        region.y = top;
      }
      if (quoteSender && box.rightLimit !== undefined) {
        const limit = Math.floor(box.rightLimit * image.width / sample.width);
        region.width = Math.min(region.width, limit - region.x);
      }
      const speaker = visual.speakerIds.get(box);
      // A pending OCR suggestion must not block a later confirmed mask.
      const existing = regions.find(other => (!enabled || !other.pending) &&
        (similar(other, region) || (contains(other, region) &&
          (type === "name" || other.enabled !== false || (type === "graphic" && other.type === "text")))));
      if (existing) {
        if (existing.type === type) {
          if (speaker !== undefined) existing.speaker ??= speaker;
          if (similar(existing, region)) {
            if (avatarNickname) existing.avatarNickname = true;
            if (quoteSender) existing.quoteSender = true;
          }
        }
        return;
      }
      regions.push({ ...region, enabled, speaker, pending, avatarNickname, quoteSender, preserveBounds, clipped: !!box.clipped });
    }
    if (visual.groupTitle) add(visual.groupTitle, "name", 0);
    if (visual.groupTitle && visual.header?.count) add(visual.header.count, "name", 1);
    for (const box of visual.avatars) add(box, "avatar", box.clipped ? 0 : 4);
    const quoteSenders = new Set(visual.quoteSenders.map(({ box }) => box));
    for (const box of visual.associatedNames) {
      const quoteSender = quoteSenders.has(box);
      add(box, "name", 2, { avatarNickname: !quoteSender, quoteSender });
    }
    for (const { box, pending, preserveBounds } of inlineNames) {
      add(box, "name", 0, { enabled: !pending, pending, preserveBounds });
    }
    const quoteStarts = new Map(visual.quoteBodies.map(({ line, start }) => [line, start]));
    const nicknames = visual.profiles.map(profile => profile.name).filter(name => name?.line);
    const knownRegions = [...visual.avatars, ...visual.associatedNames, ...stickers,
      ...inlineNames.filter(({ pending }) => !pending).map(({ box }) => box)];
    if (visual.groupTitle) knownRegions.push(visual.groupTitle);
    for (const line of lines) {
      const quoteStart = quoteStarts.get(line) ?? 0;
      for (const { box, start, end } of SensitiveText.runs(line, knownRegions, { skipSeparators: true })) {
        if (end <= quoteStart) continue;
        if (nicknames.some(name => name.line === line && start >= name.start && end <= name.end)) continue;
        const textBox = start < quoteStart ? SensitiveText.boxForRange(line, quoteStart, end) : box;
        if (textBox) add(textBox, "text", 0, { enabled: false });
      }
    }
    for (const box of visual.messages) add(box, "bubble", 0, { enabled: false });
    for (const box of [...stickers, ...visual.graphics]) add(box, "graphic", 0, { enabled: false });
    SensitiveText.alignMaskHeights(regions.filter(region => !region.preserveBounds), lines, visual.messages, image, sample);
    return SensitiveText.avoidStickers(regions, stickers, image, sample);
  }

  function stabilizeSpeakerIds(regions, previous) {
    const previousAvatars = previous.filter(region => region.type === "avatar" && region.speaker !== undefined);
    const matches = new Map();
    for (const region of regions) {
      if (region.speaker === undefined) continue;
      if (!matches.has(region.speaker)) matches.set(region.speaker, new Set());
      if (region.type !== "avatar") continue;
      for (const prior of previousAvatars) {
        if (similar(prior.originalBounds || prior, region)) matches.get(region.speaker).add(prior.speaker);
      }
    }

    const claims = new Map();
    for (const candidates of matches.values()) {
      for (const speaker of candidates) claims.set(speaker, (claims.get(speaker) ?? 0) + 1);
    }
    const ids = new Map();
    for (const [speaker, candidates] of [...matches].sort(([a], [b]) => a - b)) {
      const prior = candidates.values().next().value;
      // Require an unambiguous match before carrying an uploaded avatar into a new scan.
      ids.set(speaker, candidates.size === 1 && claims.get(prior) === 1 ? prior : nextSpeakerId++);
    }
    for (const region of regions) {
      if (region.speaker !== undefined) region.speaker = ids.get(region.speaker);
    }
    return regions;
  }

  function scanCurrent() {
    const image = bitmap;
    if (!image) return;
    const version = ++scanVersion;
    notice = "";
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
        const current = () => version === scanVersion;
        const read = boxes => readCrops(image, sample, boxes, current);
        const readNicknames = async boxes => {
          const readings = await read(boxes);
          return new Map([...readings].filter(([, reading]) => reading.confidence >= 45)
            .map(([box, { line }]) => [box, line.text.trim()]));
        };
        const lines = text || [];
        const visual = await LocalVision.findRegions(sample, lines, await model, current, text && readNicknames, text && read);
        if (version !== scanVersion) return;
        const messageReadings = [];
        const inlineNames = await ChatMentions.refineRegions(lines, visual, sample, async boxes => {
          scanStatus = "ocrRefining";
          refresh();
          const readings = await read(boxes).catch(() => new Map());
          messageReadings.push(...readings);
          return readings;
        });
        if (version !== scanVersion) return;
        if (text) {
          const covered = [...visual.avatars, ...visual.associatedNames];
          if (visual.groupTitle) covered.push(visual.groupTitle);
          const alreadyRead = inlineNames.filter(name => !name.pending).map(({ box }) => box);
          const cropped = HighlightMentions.unreadCrops(visual.colorCrops, covered).filter(box =>
            (!box.outlined && visual.messages.some(message => overlappingName(message, box))) ||
            HighlightMentions.unreadCrops([box], alreadyRead).length);
          if (cropped.length) {
            scanStatus = "ocrRefining";
            refresh();
            const participants = ChatMentions.participantLabels(lines, visual.participantNames);
            const readHighlights = (boxes, language) => readCrops(image, sample, boxes, current,
              { highlighted: true, language, messages: visual.messages, participants }).catch(() => new Map());
            const highlights = await readHighlights(cropped);
            if (!current()) return;
            messageReadings.push(...highlights);
            const found = ChatMentions.croppedRegions(lines, visual, sample, highlights);
            if (lines.some(line => /\p{Script=Han}/u.test(line.text))) {
              const retry = HighlightMentions.unreadCrops(cropped, found).filter(box => {
                const reading = highlights.get(box);
                return !box.outlined && (!reading || reading.confidence < 72) &&
                  (visual.messages.some(message => overlappingName(message, box)) || /^@/.test(reading?.line?.text ?? ""));
              });
              const prefixes = [...highlights.values()].flatMap(({ prefix }) => prefix &&
                !found.some(box => overlappingName(box, prefix)) ? [prefix] : []);
              if (retry.length || prefixes.length) {
                const chinese = await readHighlights([...retry, ...prefixes], "chi_sim");
                if (!current()) return;
                messageReadings.push(...chinese);
                found.push(...ChatMentions.croppedRegions(lines, visual, sample, chinese));
              }
            }
            found.sort((a, b) => Number(!!b.includesEmoji) - Number(!!a.includesEmoji) ||
              (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
            for (const box of found) {
              const prior = inlineNames.findIndex(name => overlappingName(name.box, box));
              if (prior < 0) inlineNames.push({ box, pending: false });
              else if (inlineNames[prior].pending || (box.includesEmoji && !inlineNames[prior].box.includesEmoji)) {
                inlineNames[prior] = { box, pending: false };
              }
            }
          }
        }

        const previous = masks();
        const manual = previous.filter(region => !region.type);
        const reviewed = previous.filter(region => region.type && region.reviewed);
        const matched = new Set();
        const messageLines = SensitiveText.mergeMessageLines(lines, visual.messages, messageReadings);
        const detected = stabilizeSpeakerIds(detections(messageLines, visual, inlineNames, image, sample), previous).map(region => {
          const decision = reviewed.find(other => !matched.has(other) && other.type === region.type &&
            similar(other.originalBounds || other.detectedBounds || other, region.detectedBounds || region));
          if (!decision) return region;
          matched.add(decision);
          const reviewedRegion = { ...region, enabled: decision.enabled, reviewed: true };
          if (!decision.originalBounds) return reviewedRegion;
          return { ...reviewedRegion, ...regionBounds(decision), originalBounds: decision.originalBounds };
        });
        const adjusted = reviewed.filter(region => region.originalBounds && !matched.has(region));
        const next = [...manual, ...detected, ...adjusted];
        if (next.length !== previous.length || next.some((region, index) => {
          const before = previous[index];
          const heightChanged = (region.detectedBounds || before.detectedBounds) && region.height !== before.height;
          return heightChanged || region.enabled !== before.enabled || region.type !== before.type || region.speaker !== before.speaker ||
            region.pending !== before.pending || region.avatarNickname !== before.avatarNickname ||
            region.quoteSender !== before.quoteSender || region.clipped !== before.clipped || !similar(region, before);
        })) {
          history.push(next);
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

  async function loadAvatar(choice, file) {
    if (!choice || choice.version !== loadVersion) return;
    const { speaker, version } = choice;
    avatarUploads.set(speaker, choice);
    const current = () => loadVersion === version && avatarUploads.get(speaker) === choice;
    notice = "";
    refresh();
    let image = null;
    try {
      if (!await supportedFormat(file)) {
        if (current()) notice = "avatarFormat";
        return;
      }
      if (!current()) return;
      image = await createImageBitmap(file);
      if (!current()) return;
      const { width, height } = image;
      if (Math.max(width, height) > maxSide || width * height > maxPixels) {
        notice = "avatarTooLarge";
        return;
      }
      const side = Math.min(width, height);
      const portrait = document.createElement("canvas");
      portrait.width = portrait.height = Math.min(side, avatarUploadSize);
      const target = portrait.getContext("2d", renderContextOptions);
      if (!target) throw new Error("Avatar canvas unavailable");
      target.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, portrait.width, portrait.height);
      avatarOverrides.set(speaker, portrait);
      updateAppearance();
    } catch {
      if (current()) notice = "avatarFailed";
    } finally {
      image?.close();
      if (avatarUploads.get(speaker) === choice) {
        avatarUploads.delete(speaker);
        refresh();
      }
    }
  }

  async function openImage(source) {
    const example = source === exampleImage;
    const moveFocus = example && tryExample && document.activeElement === tryExample;
    const version = ++loadVersion;
    notice = example ? "exampleLoading" : "loading";
    refresh();
    try {
      let file = source;
      if (example) {
        const response = await fetch(exampleImage);
        if (!response.ok) throw new Error("Example image unavailable");
        file = await response.blob();
        if (version !== loadVersion) return;
      }
      const supported = await supportedFormat(file);
      if (version !== loadVersion) return;
      if (!supported) {
        notice = example ? "exampleFailed" : "unsupported";
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
      blurCache = null;
      blurTile = null;
      bitmap = image;
      history = [[]];
      nextSpeakerId = 0;
      avatarChoice = null;
      avatarUploads.clear();
      avatarOverrides.clear();
      generatedAvatars.clear();
      avatarRows.clear();
      avatarList.replaceChildren();
      avatarList.scrollTop = 0;
      drag = null;
      setResizeCursor(null);
      showMasks = false;
      const scale = Math.min(1, previewLimit / Math.max(image.width, image.height));
      preview.width = Math.max(1, Math.round(image.width * scale));
      preview.height = Math.max(1, Math.round(image.height * scale));
      edited();
      scanCurrent();
      if (moveFocus) replace.focus({ preventScroll: true });
    } catch {
      if (version === loadVersion) notice = example ? "exampleFailed" : "unreadable";
    } finally {
      if (version === loadVersion) refresh();
    }
  }

  function position(event, inside = true) {
    const bounds = preview.getBoundingClientRect();
    const clamp = fraction => Math.min(1, Math.max(0, fraction));
    const x = (event.clientX - bounds.left - preview.clientLeft) / preview.clientWidth;
    const y = (event.clientY - bounds.top - preview.clientTop) / preview.clientHeight;
    return {
      x: (inside ? clamp(x) : x) * bitmap.width,
      y: (inside ? clamp(y) : y) * bitmap.height,
    };
  }

  function candidateAt(regions, position) {
    const point = { ...position, width: 0, height: 0 };
    let hit = -1;
    for (const [index, region] of regions.entries()) {
      if (showMasks && region.enabled === false) continue;
      if (contains(region, point) && (hit === -1 || area(region) <= area(regions[hit]))) hit = index;
    }
    return hit;
  }

  function resizeHandleAt(point, pointerType) {
    if (showMasks) return null;
    const scaleX = preview.clientWidth / bitmap.width;
    const scaleY = preview.clientHeight / bitmap.height;
    const radius = pointerType === "touch" ? 12 : 6;
    let closest = null;
    let distance = Infinity;
    for (const region of masks()) {
      if (region.enabled === false) continue;
      for (const corner of corners) {
        const { x, y } = cornerPoint(region, corner);
        const dx = (point.x - x) * scaleX * (corner.right ? -1 : 1);
        const dy = (point.y - y) * scaleY * (corner.bottom ? -1 : 1);
        // Leave the center available for toggling even when a box is small.
        if (dx < -radius || dx > Math.min(radius, region.width * scaleX / 3) ||
            dy < -radius || dy > Math.min(radius, region.height * scaleY / 3)) continue;
        const squareDistance = dx * dx + dy * dy;
        if (squareDistance >= distance) continue;
        closest = { region, corner };
        distance = squareDistance;
      }
    }
    return closest;
  }

  function setResizeCursor(handle) {
    if (handle) preview.dataset.resize = handle.corner.cursor;
    else preview.removeAttribute("data-resize");
  }

  preview.addEventListener("pointerdown", event => {
    if (!bitmap || drag || event.button !== 0) return;
    const start = position(event);
    const handle = resizeHandleAt(start, event.pointerType);
    drag = { id: event.pointerId, start, end: start, clientX: event.clientX, clientY: event.clientY, handle };
    preview.setPointerCapture(event.pointerId);
    preview.removeAttribute("data-candidate");
    setResizeCursor(handle);
  });

  preview.addEventListener("pointermove", event => {
    if (!drag) {
      if (!bitmap) return;
      const point = position(event);
      const handle = resizeHandleAt(point, event.pointerType);
      setResizeCursor(handle);
      preview.toggleAttribute("data-candidate", !handle && candidateAt(masks(), point) !== -1);
      return;
    }
    if (drag.id !== event.pointerId) return;
    drag.end = position(event, !drag.handle);
    redraw();
  });

  preview.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const end = position(event, !drag.handle);
    const isClick = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4;
    if (drag.handle) {
      const { region } = drag.handle;
      const regions = masks();
      if (regions.includes(region)) {
        const bounds = resizedBounds(drag, end);
        if (Object.keys(bounds).some(key => bounds[key] !== region[key])) {
          const resized = { ...region, ...bounds, reviewed: true };
          if (region.type) resized.originalBounds = region.originalBounds || region.detectedBounds || regionBounds(region);
          history.push(regions.map(item => item === region ? resized : item));
        }
      }
    } else if (isClick) {
      const regions = masks();
      const hit = candidateAt(regions, end);
      if (hit !== -1) {
        history.push(regions.map((region, index) => index === hit
          ? { ...region, enabled: region.enabled === false, reviewed: true } : region));
      }
    } else {
      const region = rectangle(drag.start, end);
      if (region) history.push([...masks(), region]);
    }
    drag = null;
    setResizeCursor(null);
    edited();
  });

  function cancelDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    setResizeCursor(null);
    redraw();
  }

  preview.addEventListener("pointercancel", cancelDrag);
  preview.addEventListener("lostpointercapture", cancelDrag);
  preview.addEventListener("pointerleave", () => {
    preview.removeAttribute("data-candidate");
    if (!drag) setResizeCursor(null);
  });

  choose.addEventListener("click", () => input.click());
  tryExample?.addEventListener("click", () => openImage(exampleImage));
  replace.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files[0];
    input.value = "";
    if (file) openImage(file);
  });

  avatarInput.addEventListener("change", () => {
    const [file] = avatarInput.files;
    const choice = avatarChoice;
    avatarChoice = null;
    avatarInput.value = "";
    if (file) loadAvatar(choice, file);
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

  function updateAppearance() {
    settingsVersion++;
    showMasks = true;
    edited();
  }

  for (const control of [style, markSpeakers, hideAvatarNames]) control.addEventListener("change", updateAppearance);
  for (const control of [opacity, blurStrength]) control.addEventListener("input", updateAppearance);

  clear.addEventListener("click", () => {
    history.push(masks().map(region => ({ ...region, enabled: false, reviewed: true })));
    edited();
  });

  async function encodePNG(image, regions, settings) {
    const output = document.createElement("canvas");
    try {
      output.width = image.width;
      output.height = image.height;
      const target = output.getContext("2d", renderContextOptions);
      if (!target) throw new Error("Unavailable export canvas");
      paint(target, image, regions, settings);
      const png = await new Promise(resolve => output.toBlob(resolve, "image/png"));
      if (!png) throw new Error("PNG encoding failed");
      return png;
    } finally {
      output.width = 0;
      output.height = 0;
    }
  }

  async function outputImage(toClipboard) {
    const image = bitmap;
    const snapshot = masks();
    const regions = snapshot.filter(region => region.enabled !== false);
    const settings = renderSettings();
    const version = loadVersion;
    const currentSettings = settingsVersion;
    if (!image || !regions.length || outputBusy || scanStatus || avatarUploads.size) return;
    if (toClipboard && (typeof navigator.clipboard?.write !== "function" || typeof ClipboardItem !== "function")) {
      notice = "copyFailed";
      refresh();
      return;
    }

    const current = () => loadVersion === version && bitmap === image && masks() === snapshot &&
      settingsVersion === currentSettings;
    outputBusy = true;
    notice = toClipboard ? "copying" : "exporting";
    refresh();
    try {
      const png = Promise.resolve().then(async () => {
        if (!current()) throw new Error("Editor changed");
        const blob = await encodePNG(image, regions, settings);
        if (!current()) throw new Error("Editor changed");
        return blob;
      });
      if (toClipboard) {
        // Start the clipboard write during the click and let it wait for the encoded PNG.
        png.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      } else {
        const blob = await png;
        if (!current()) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "redacted.png";
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      if (current()) notice = toClipboard ? "copied" : "exported";
    } catch {
      if (current()) notice = toClipboard ? "copyFailed" : "exportFailed";
    } finally {
      outputBusy = false;
      refresh();
    }
  }

  copy.addEventListener("click", () => outputImage(true));
  save.addEventListener("click", () => outputImage(false));

  choose.disabled = false;
  refresh();
  const handoffFragment = location.hash;
  const handoffToken = new URLSearchParams(handoffFragment.slice(1)).get("handoff");
  if (handoffToken !== null) {
    openFromHomepage(handoffToken);
  } else if (new URLSearchParams(location.search).get("example") === "chat") {
    openImage(exampleImage);
  }

  async function openFromHomepage(token) {
    const version = ++loadVersion;
    notice = "loading";
    refresh();
    const image = await take(token).catch(() => null);
    if (location.hash === handoffFragment) {
      window.history.replaceState(window.history.state, "", location.pathname + location.search);
    }
    if (version !== loadVersion) return;
    if (image) {
      openImage(image);
      return;
    }
    notice = "handoffFailed";
    refresh();
  }
})();
