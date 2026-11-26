(() => {
  const maskColor = "#191a16";
  const speakerColors = ["#355665", "#7b4a35", "#395840", "#51466d", "#69404f", "#465674"];
  const previewLimit = 1600;
  const ocrLanguages = ["eng", "chi_sim"];
  const maxSide = 16_384;
  const maxPixels = 40_000_000;
  const messages = {
    en: {
      loading: "Opening the screenshot…",
      exampleLoading: "Opening the example…",
      exampleFailed: "Couldn’t open the example. Try again.",
      ready: "Drag on the image to cover a region.",
      masks: count => count + (count === 1 ? " region covered" : " regions covered"),
      reviewed: (count, total) => count + " of " + total + " selected. Click a dashed box to toggle it, or drag to add one.",
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
      exporting: "Preparing the PNG…",
      exported: "Redacted PNG ready.",
      exportFailed: "The browser could not export this image.",
      browser: "This browser can’t run the image editor.",
    },
    "zh-CN": {
      loading: "正在打开截图…",
      exampleLoading: "正在打开示例…",
      exampleFailed: "无法打开示例，请重试。",
      ready: "在图上拖出矩形，遮挡敏感区域。",
      masks: count => "已遮挡 " + count + " 处",
      reviewed: (count, total) => "已框选 " + count + " 处，共 " + total + " 个候选。点击虚线框切换选择，拖动可补画。",
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
      exporting: "正在生成 PNG…",
      exported: "已生成脱敏 PNG。",
      exportFailed: "浏览器无法导出这张图片。",
      browser: "当前浏览器无法运行图片编辑器。",
    },
  };
  const errors = new Set(["unsupported", "unreadable", "tooLarge", "exampleFailed", "exportFailed", "ocrFailed", "scanPartial", "browser"]);

  const choose = document.querySelector("#choose");
  const tryExample = document.querySelector("#try-example");
  const exampleImage = "assets/chat-example.png?v=1";
  const replace = document.querySelector("#replace");
  const scan = document.querySelector("#scan");
  const undo = document.querySelector("#undo");
  const clear = document.querySelector("#clear");
  const save = document.querySelector("#save");
  const input = document.querySelector("#image-input");
  const toolbar = document.querySelector("#toolbar");
  const styleBar = document.querySelector("#style-bar");
  const style = document.querySelector("#mask-style");
  const speakerStyle = document.querySelector("#speaker-mask-style");
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
  let preferredStyle = "";

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
    speakerStyle.hidden = !hasSpeakers;
    speakerStyle.disabled = !hasSpeakers;
    const defaultStyle = hasSpeakers ? "speakers" : "ink";
    style.value = preferredStyle && (preferredStyle !== "speakers" || hasSpeakers) ? preferredStyle : defaultStyle;
    previewMasks.setAttribute("aria-pressed", String(showMasks));
    importPanel.hidden = !!bitmap;
    preview.hidden = !bitmap;
    workspace.toggleAttribute("data-loaded", !!bitmap);
    scan.disabled = opening || !!scanStatus || exporting;
    undo.disabled = history.length === 1;
    clear.disabled = !count;
    save.disabled = !count || exporting || !!scanStatus;
    status.hidden = !message && !bitmap;
    status.toggleAttribute("data-error", errors.has(message));
    const summary = showMasks ? language.masks(count) : language.reviewed(count, regions.length);
    const details = message ? language[message] : regions.length ? summary : language.ready;
    feedback.textContent = details + (uncertain && !scanStatus && !opening ? " " + language.pendingNames(uncertain) : "");
    dimensions.textContent = bitmap ? bitmap.width + " × " + bitmap.height + " px" : "";
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

  function coverRegion(target, { x, y, width, height, speaker }, appearance) {
    if (appearance === "speakers" && speaker !== undefined) {
      target.fillStyle = speakerColors[speaker % speakerColors.length];
      target.fillRect(x, y, width, height);
      const label = speakerLabel(speaker);
      const size = Math.floor(Math.min(height * .65, (width - 3) / label.length));
      if (size >= 7) {
        target.save();
        target.fillStyle = "#f4f1e9";
        target.font = "700 " + size + "px system-ui, sans-serif";
        target.textAlign = "center";
        target.textBaseline = "middle";
        target.fillText(label, x + width / 2, y + height / 2, width - 2);
        target.restore();
      }
      return;
    }
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
    const ordered = review ? [...regions].sort((a, b) => area(b) - area(a)) : regions;
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
        coverRegion(target, region, appearance);
      }
    }
    if (review) target.setLineDash([]);
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
    const regions = SensitiveText.findRegions(lines, image, sample);
    function add(box, type, margin, enabled = true, pending = false) {
      const region = SensitiveText.scaleBox(box, type, image, sample, margin);
      if (!region) return;
      const speaker = visual.speakerIds.get(box);
      const existing = regions.find(other => similar(other, region) || (contains(other, region) &&
        (type === "name" || other.enabled !== false || (type === "graphic" && other.type === "text"))));
      if (existing) {
        if (speaker !== undefined && existing.type === type) existing.speaker ??= speaker;
        return;
      }
      regions.push({ ...region, enabled, speaker, pending });
    }
    if (visual.groupTitle) add(visual.groupTitle, "name", 0);
    for (const box of visual.avatars) add(box, "avatar", box.clipped ? 0 : 4);
    for (const box of visual.associatedNames) add(box, "name", 2);
    for (const { box, pending } of inlineNames) add(box, "name", 0, !pending, pending);
    const quoteStarts = new Map(visual.quoteBodies.map(({ line, start }) => [line, start]));
    const nicknames = visual.profiles.map(profile => profile.name).filter(name => name?.line);
    for (const line of lines) {
      const quoteStart = quoteStarts.get(line) ?? 0;
      for (const { box, start, end } of SensitiveText.runs(line, visual.avatars)) {
        if (end <= quoteStart) continue;
        if (nicknames.some(name => name.line === line && start >= name.start && end <= name.end)) continue;
        const textBox = start < quoteStart ? SensitiveText.boxForRange(line, quoteStart, end) : box;
        if (textBox) add(textBox, "text", 0, false);
      }
    }
    for (const box of visual.messages) add(box, "bubble", 0, false);
    for (const box of visual.graphics) add(box, "graphic", 0, false);
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
        const visual = await LocalVision.findRegions(sample, lines, await model, current, text && readNicknames);
        if (version !== scanVersion) return;
        const inlineNames = await ChatMentions.refineRegions(lines, visual, sample, async boxes => {
          scanStatus = "ocrRefining";
          refresh();
          return read(boxes).catch(() => new Map());
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
        const detected = detections(lines, visual, inlineNames, image, sample).map(region => {
          const decision = reviewed.find(other => other.type === region.type && similar(other, region));
          return decision ? { ...region, enabled: decision.enabled, reviewed: true } : region;
        });
        const next = [...manual, ...detected];
        if (next.length !== previous.length || next.some((region, index) => {
          const before = previous[index];
          return region.enabled !== before.enabled || region.type !== before.type || region.speaker !== before.speaker ||
            region.pending !== before.pending ||
            !similar(region, before);
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

  async function supportedFormat(file) {
    const first = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = first.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => first[i] === byte);
    const jpeg = first[0] === 255 && first[1] === 216 && first[2] === 255;
    const webp = String.fromCharCode(...first.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...first.slice(8, 12)) === "WEBP";
    return png || jpeg || webp;
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
      bitmap = image;
      history = [[]];
      drag = null;
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

  function position(event) {
    const bounds = preview.getBoundingClientRect();
    const clamp = fraction => Math.min(1, Math.max(0, fraction));
    return {
      x: clamp((event.clientX - bounds.left - preview.clientLeft) / preview.clientWidth) * bitmap.width,
      y: clamp((event.clientY - bounds.top - preview.clientTop) / preview.clientHeight) * bitmap.height,
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

  preview.addEventListener("pointerdown", event => {
    if (!bitmap || drag || event.button !== 0) return;
    const start = position(event);
    drag = { id: event.pointerId, start, end: start, clientX: event.clientX, clientY: event.clientY };
    preview.setPointerCapture(event.pointerId);
    preview.removeAttribute("data-candidate");
  });

  preview.addEventListener("pointermove", event => {
    if (!drag) {
      preview.toggleAttribute("data-candidate", !!bitmap && candidateAt(masks(), position(event)) !== -1);
      return;
    }
    if (drag.id !== event.pointerId) return;
    drag.end = position(event);
    redraw();
  });

  preview.addEventListener("pointerup", event => {
    if (drag?.id !== event.pointerId) return;
    const end = position(event);
    const isClick = Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4;
    if (isClick) {
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
    edited();
  });

  function cancelDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    redraw();
  }

  preview.addEventListener("pointercancel", cancelDrag);
  preview.addEventListener("lostpointercapture", cancelDrag);
  preview.addEventListener("pointerleave", () => preview.removeAttribute("data-candidate"));

  choose.addEventListener("click", () => input.click());
  tryExample?.addEventListener("click", () => openImage(exampleImage));
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
    preferredStyle = style.value;
    showMasks = true;
    edited();
  });

  clear.addEventListener("click", () => {
    history.push(masks().map(region => ({ ...region, enabled: false, reviewed: true })));
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
  if (new URLSearchParams(location.search).get("example") === "chat") openImage(exampleImage);
})();
