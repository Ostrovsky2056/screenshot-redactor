(() => {
  let modelPromise;

  function loadModel() {
    if (!modelPromise) {
      const assets = new URL("assets/vision/", document.baseURI);
      modelPromise = import(new URL("vision_bundle.mjs", assets).href).then(async ({ FaceDetector, FilesetResolver }) => {
        const files = await FilesetResolver.forVisionTasks(new URL("wasm", assets).href);
        return FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: new URL("blaze_face_short_range.tflite", assets).href, delegate: "CPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: .55,
        });
      }).catch(error => {
        modelPromise = undefined;
        throw error;
      });
    }
    return modelPromise;
  }

  function overlap(a, b) {
    const width = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
    const height = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    return smaller > 0 ? width * height / smaller : 0;
  }

  function nameLike(text) {
    const value = text.trim();
    return /^(?:\p{Script=Han} *){2,6}$/u.test(value) ||
      /^(?:[A-Z][\p{L}.'’-]{1,19})(?: +[A-Z][\p{L}.'’-]{1,19}){0,2}$/u.test(value);
  }

  function nameCandidates(line, pixels) {
    const { text, box, spans } = line;
    const choices = nameLike(text) ? [box] : [];
    // List-style chats often put the display name and clock on the same OCR line.
    const clock = text.match(/,?\s+:?\s*(?:\d{1,2}\/\d{1,2}\s+)?[0-9loi]{1,2}\s*:\s*[0-9loi]{2}(?:\s*[AP]M)?$/i);
    const time = clock?.[0].replace(/[li]/gi, "1").replace(/o/gi, "0");
    if (time && /\d{2}/.test(clock[0]) && /\b(?:[01]?\d|2[0-3])\s*:\s*[0-5]\d(?:\s*[AP]M)?$/i.test(time) &&
      nameLike(text.slice(0, clock.index))) {
      const name = SensitiveText.exactBoxForRange(line, 0, clock.index);
      const comma = clock[0][0] === "," && spans.find(span => span.start === clock.index)?.box;
      if (name) choices.unshift(comma ? includeLeadingInk(pixels, name, comma) : name);
    }
    const prefix = text.match(/^(?:[A-Z]{1,3}|[^\p{L}\p{N}\s]{1,3}) +/u)?.[0].length ?? 0;
    const suffix = text.match(/ +(?:[A-Z]{1,3}|[^\p{L}\p{N}\s]{1,3})$/u)?.[0].length ?? 0;
    // OCR can join a graphic avatar's initials or symbol to the adjacent name.
    for (const [start, end] of [[prefix, text.length], [0, text.length - suffix]]) {
      if ((start === 0 && end === text.length) || !nameLike(text.slice(start, end))) continue;
      const parts = spans.filter(span => span.start < end && span.end > start && span.box).map(span => span.box);
      if (parts.length) {
        choices.unshift({
          x0: Math.min(...parts.map(part => part.x0)),
          y0: Math.min(...parts.map(part => part.y0)),
          x1: Math.max(...parts.map(part => part.x1)),
          y1: Math.max(...parts.map(part => part.y1)),
        });
      }
    }
    return choices;
  }

  function includeLeadingInk(pixels, name, separator) {
    // A symbol box for a comma can also contain the preceding letter.
    const tone = background(pixels, name, 1);
    const bottom = name.y0 + Math.floor(.65 * (name.y1 - name.y0));
    const right = Math.min(separator.x1, name.x1 + name.y1 - name.y0);
    const { data } = pixels;
    let x1 = name.x1;
    for (let x = name.x1; x < right; x++) {
      for (let y = name.y0; y < bottom; y++) {
        const offset = (y * pixels.width + x) * 4;
        if (Math.abs(data[offset] - tone[0]) + Math.abs(data[offset + 1] - tone[1]) +
          Math.abs(data[offset + 2] - tone[2]) > 110) {
          x1 = x + 1;
          break;
        }
      }
    }
    return x1 === name.x1 ? name : { ...name, x1 };
  }

  function background(pixels, area, stride) {
    const bins = new Map();
    let mode = 0;
    let best = 0;
    function add(x, y) {
      const offset = (y * pixels.width + x) * 4;
      const code = ((pixels.data[offset] >> 4) << 8) | ((pixels.data[offset + 1] >> 4) << 4) | (pixels.data[offset + 2] >> 4);
      const count = (bins.get(code) || 0) + 1;
      bins.set(code, count);
      if (count > best) {
        mode = code;
        best = count;
      }
    }
    for (let x = area.x0; x < area.x1; x += stride) {
      add(x, area.y0);
      add(x, area.y1 - 1);
    }
    for (let y = area.y0; y < area.y1; y += stride) {
      add(area.x0, y);
      add(area.x1 - 1, y);
    }
    return [(mode >> 8) * 16 + 8, ((mode >> 4) & 15) * 16 + 8, (mode & 15) * 16 + 8];
  }

  function components(pixels, area, step) {
    const cols = Math.floor((area.x1 - area.x0) / step);
    const rows = Math.floor((area.y1 - area.y0) / step);
    if (cols < 3 || rows < 3) return [];
    const tone = background(pixels, area, step);
    const active = new Uint8Array(cols * rows);
    for (let i = 0; i < active.length; i++) {
      const x = area.x0 + (i % cols) * step;
      const y = area.y0 + Math.floor(i / cols) * step;
      const offset = (y * pixels.width + x) * 4;
      const distance = Math.abs(pixels.data[offset] - tone[0]) +
        Math.abs(pixels.data[offset + 1] - tone[1]) + Math.abs(pixels.data[offset + 2] - tone[2]);
      active[i] = Number(distance > 66);
    }

    const shapes = [];
    for (let start = 0; start < active.length; start++) {
      if (!active[start]) continue;
      let left = cols, top = rows, right = 0, bottom = 0, count = 0;
      const pending = [];
      const visit = index => {
        if (!active[index]) return;
        active[index] = 0;
        pending.push(index);
      };
      visit(start);
      while (pending.length) {
        const index = pending.pop();
        const x = index % cols;
        const y = Math.floor(index / cols);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        count++;
        if (x > 0) visit(index - 1);
        if (x + 1 < cols) visit(index + 1);
        if (y > 0) visit(index - cols);
        if (y + 1 < rows) visit(index + cols);
      }
      if (left === 0 || top === 0 || right === cols - 1 || bottom === rows - 1) continue;
      const cells = (right - left + 1) * (bottom - top + 1);
      if (count / cells < .36) continue;
      shapes.push({
        x0: area.x0 + left * step,
        x1: area.x0 + (right + 1) * step,
        y0: area.y0 + top * step,
        y1: area.y0 + (bottom + 1) * step,
      });
    }
    return shapes;
  }

  function adjacentAvatar(pixels, name) {
    const height = name.y1 - name.y0;
    if (height < 8 || height > 100) return null;
    const step = Math.max(2, Math.round(height / 8));
    const top = Math.max(0, Math.floor(name.y0 - 2.8 * height));
    const bottom = Math.min(pixels.height, Math.ceil(name.y1 + 3.4 * height));
    const windows = [
      { x0: Math.max(0, Math.floor(name.x0 - 6.5 * height)), x1: Math.floor(name.x0 - .18 * height) },
      { x0: Math.ceil(name.x1 + .18 * height), x1: Math.min(pixels.width, Math.ceil(name.x1 + 6.5 * height)) },
    ];
    const possible = [];
    for (const sides of windows) {
      for (const box of components(pixels, { ...sides, y0: top, y1: bottom }, step)) {
        const w = box.x1 - box.x0;
        const h = box.y1 - box.y0;
        const gap = Math.max(name.x0 - box.x1, box.x0 - name.x1);
        const vertical = Math.abs((box.y0 + box.y1 - name.y0 - name.y1) / 2);
        if (w / h < .72 || w / h > 1.38 || w < height * 1.1 || w > height * 4.8) continue;
        if (gap > 2.7 * height || vertical > Math.max(height, .68 * h)) continue;
        possible.push({ box, distance: gap + vertical });
      }
    }
    possible.sort((a, b) => a.distance - b.distance);
    return possible[0]?.box || null;
  }

  function enclosingAvatar(pixels, face) {
    const w = face.x1 - face.x0;
    const h = face.y1 - face.y0;
    const area = {
      x0: Math.max(0, Math.floor(face.x0 - .65 * w)),
      y0: Math.max(0, Math.floor(face.y0 - .65 * h)),
      x1: Math.min(pixels.width, Math.ceil(face.x1 + .65 * w)),
      y1: Math.min(pixels.height, Math.ceil(face.y1 + .65 * h)),
    };
    const step = Math.max(2, Math.round(Math.min(w, h) / 20));
    const container = components(pixels, area, step).find(box => {
      const width = box.x1 - box.x0;
      const height = box.y1 - box.y0;
      return width / height >= .72 && width / height <= 1.38 &&
        width >= w * .88 && height >= h * .88 && overlap(box, face) > .92;
    });
    if (!container) return face;
    return {
      x0: Math.min(face.x0, container.x0),
      y0: Math.min(face.y0, container.y0),
      x1: Math.max(face.x1, container.x1),
      y1: Math.max(face.y1, container.y1),
    };
  }

  function chatSticker(pixels, face, avatars) {
    const width = face.x1 - face.x0, height = face.y1 - face.y0;
    const aligned = avatars.some(avatar => {
      if (avatar.clipped) return false;
      const size = avatar.y1 - avatar.y0;
      const left = (avatar.x0 + avatar.x1) / 2 < pixels.width / 2;
      const gap = left ? face.x0 - avatar.x1 : avatar.x0 - face.x1;
      const drop = face.y0 - avatar.y0;
      return gap >= .08 * size && gap <= 1.25 * size && drop >= .18 * size && drop < 1.35 * size &&
        width <= 1.5 * size && height <= 1.5 * size;
    });
    if (!aligned) return false;
    const box = {
      x0: Math.max(0, Math.floor(face.x0 - .22 * width)),
      y0: Math.max(0, Math.floor(face.y0 - .22 * height)),
      x1: Math.min(pixels.width, Math.ceil(face.x1 + .22 * width)),
      y1: Math.min(pixels.height, Math.ceil(face.y1 + .22 * height)),
    };
    const tone = background(pixels, box, 2);
    const colors = new Map();
    let edge = 0, backgroundEdge = 0, foreground = 0;
    for (let y = box.y0; y < box.y1; y += 2) {
      for (let x = box.x0; x < box.x1; x += 2) {
        const i = (y * pixels.width + x) * 4;
        const [r, g, b] = pixels.data.subarray(i, i + 3);
        const base = Math.abs(r - tone[0]) + Math.abs(g - tone[1]) + Math.abs(b - tone[2]) < 37;
        if (x === box.x0 || y === box.y0 || x >= box.x1 - 2 || y >= box.y1 - 2) {
          edge++;
          if (base) backgroundEdge++;
        }
        if (base) continue;
        const color = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
        colors.set(color, (colors.get(color) || 0) + 1);
        foreground++;
      }
    }
    const common = [...colors.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
    return backgroundEdge > .67 * edge && foreground > .18 * width * height / 4 && common >= .60 * foreground;
  }

  function offsets(full, side) {
    const positions = [0];
    const step = Math.round(side * .78);
    while (positions[positions.length - 1] + side < full) {
      positions.push(Math.min(full - side, positions[positions.length - 1] + step));
    }
    return positions;
  }

  async function findFaces(canvas, detector, current) {
    const faces = [];
    function detect(image, dx, dy) {
      for (const { boundingBox: box } of detector.detect(image).detections) {
        if (!box || box.width < 10 || box.height < 10) continue;
        faces.push({
          x0: dx + box.originX - box.width * .25,
          x1: dx + box.originX + box.width * 1.25,
          y0: dy + box.originY - box.height * .3,
          y1: dy + box.originY + box.height * 1.22,
        });
      }
    }
    detect(canvas, 0, 0);
    const side = Math.max(260, Math.ceil(Math.max(canvas.width, canvas.height) / 5));
    if (canvas.width <= side && canvas.height <= side) return faces;
    const crop = document.createElement("canvas");
    crop.width = Math.min(side, canvas.width);
    crop.height = Math.min(side, canvas.height);
    const ctx = crop.getContext("2d");
    try {
      for (const y of offsets(canvas.height, crop.height)) {
        if (!current()) break;
        for (const x of offsets(canvas.width, crop.width)) {
          ctx.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
          detect(crop, x, y);
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      crop.width = 0;
      crop.height = 0;
    }
    return faces;
  }

  async function findRegions(canvas, lines, detector, current, readNicknames) {
    let pixels;
    const readPixels = () => {
      pixels ||= canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      return pixels;
    };
    const colorCrops = HighlightMentions.findCrops(readPixels());
    const chat = typeof ChatLayout !== "undefined" && typeof ChatLayoutModel !== "undefined"
      ? ChatLayout.findRegions(readPixels(), lines, ChatLayoutModel, colorCrops)
      : { avatars: [], associatedNames: [], messages: [], quoteBodies: [], graphics: [],
        profiles: [], quoteSenders: [], speakerIds: new Map() };
    if (readNicknames && chat.quoteSenders.some(({ box }) => !chat.speakerIds.has(box))) {
      const boxes = chat.profiles.filter(({ name }) => name && !name.label).map(({ name }) => name.box);
      if (boxes.length) {
        const labels = await readNicknames(boxes).catch(() => null);
        if (labels?.size) ChatLayout.matchQuoteSpeakers(chat.profiles, chat.quoteSenders, chat.speakerIds, labels);
      }
    }
    const avatars = chat.avatars;
    const associatedNames = [...chat.associatedNames];
    const quotedLines = new Set(chat.quoteBodies.map(({ line }) => line));
    const candidateNames = lines.filter(line => !quotedLines.has(line)).flatMap(line => nameCandidates(line, readPixels()))
      .filter(box => !(chat.groupTitle && overlap(box, chat.groupTitle) > .55) &&
        !chat.messages.some(message => overlap(box, message) > .55))
      .slice(0, 180);
    if (candidateNames.length) {
      for (const box of candidateNames) {
        const avatar = adjacentAvatar(readPixels(), box);
        if (!avatar) continue;
        if (!avatars.some(found => overlap(found, avatar) > .55)) avatars.push(avatar);
        if (!associatedNames.some(found => overlap(found, box) > .75)) associatedNames.push(box);
      }
    }
    let faceScanIncomplete = !detector;
    if (detector) {
      try {
        const faces = await findFaces(canvas, detector, current);
        faces.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
        for (const face of faces) {
          if (avatars.some(box => overlap(box, face) > .55)) continue;
          const avatar = enclosingAvatar(readPixels(), face);
          if (chat.profiles.length >= 2 && chatSticker(readPixels(), avatar, avatars)) {
            chat.graphics.push(avatar);
            continue;
          }
          if (!avatars.some(box => overlap(box, avatar) > .55)) avatars.push(avatar);
        }
      } catch {
        faceScanIncomplete = true;
      }
    }
    for (const avatar of avatars) {
      const nearby = candidateNames.find(name => {
        const gap = Math.max(name.x0 - avatar.x1, avatar.x0 - name.x1);
        const offsetY = Math.abs((name.y0 + name.y1 - avatar.y0 - avatar.y1) / 2);
        return gap >= 0 && gap < 2.2 * (name.y1 - name.y0) &&
          offsetY < .55 * (avatar.y1 - avatar.y0);
      });
      if (nearby && !associatedNames.some(box => overlap(box, nearby) > .75)) associatedNames.push(nearby);
    }
    return { ...chat, associatedNames, participantNames: associatedNames, faceScanIncomplete, colorCrops };
  }

  const vision = { loadModel, findRegions };
  if (typeof module !== "undefined") module.exports = vision;
  else window.LocalVision = vision;
})();
