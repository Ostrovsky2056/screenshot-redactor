(() => {
  const { exactBoxForRange } = typeof module === "undefined"
    ? window.SensitiveText : require("./sensitive-text.js");
  const { leadingAddress } = typeof module === "undefined"
    ? window.ChatMentions : require("./chat-mentions.js");

  function chroma(r, g, b) {
    return Math.max(r, g, b) - Math.min(r, g, b);
  }

  function bridgeDots(mask, length, count, stride, spacing, gap) {
    for (let line = 0; line < count; line++) {
      const offset = line * spacing;
      let previous = -gap - 2, color = 0;
      for (let i = 0; i < length; i++) {
        const current = mask[offset + i * stride];
        if (!current) continue;
        if (current === color && i - previous <= gap + 1) {
          for (let j = previous + 1; j < i; j++) mask[offset + j * stride] = color;
        }
        previous = i;
        color = current;
      }
    }
  }

  function findCrops(pixels) {
    const { width, height, data } = pixels;
    const step = Math.max(1, Math.ceil(Math.max(width, height) / 1900));
    const cols = Math.ceil(width / step), rows = Math.ceil(height / step);
    const mask = new Uint8Array(cols * rows);
    const queue = new Int32Array(mask.length);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * step, y = row * step;
        const cell = row * cols + col;
        for (let dy = 0; dy < step && y + dy < height && !mask[cell]; dy++) {
          for (let dx = 0; dx < step && x + dx < width; dx++) {
            const i = ((y + dy) * width + x + dx) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (chroma(r, g, b) < 13) continue;
            mask[cell] = b >= r && b >= g ? 3 : g >= r ? 2 : 1;
            break;
          }
        }
      }
    }
    const gap = Math.max(1, Math.floor(2 / step));
    bridgeDots(mask, cols, rows, 1, cols, gap);
    bridgeDots(mask, rows, cols, cols, 1, gap);

    const crops = [];
    for (let seed = 0; seed < mask.length; seed++) {
      const color = mask[seed];
      if (!color) continue;
      let length = 0;
      let left = cols, right = 0, top = rows, bottom = 0;
      function enqueue(i) {
        if (mask[i] !== color) return;
        mask[i] = 0;
        queue[length++] = i;
      }
      enqueue(seed);
      for (let index = 0; index < length; index++) {
        const i = queue[index], x = i % cols, y = Math.floor(i / cols);
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
        if (x > 0) enqueue(i - 1);
        if (y > 0) enqueue(i - cols);
        if (x + 1 < cols) enqueue(i + 1);
        if (y + 1 < rows) enqueue(i + cols);
      }
      const w = right - left, h = bottom - top;
      if (w * step < 15 || h * step < 9 || h * step > 150 || w < 1.2 * h || w > 15 * h) continue;
      const counts = new Uint32Array(h);
      const starts = new Int32Array(h).fill(cols);
      const ends = new Int32Array(h);
      for (let index = 0; index < length; index++) {
        const i = queue[index], x = i % cols, y = Math.floor(i / cols) - top;
        counts[y]++;
        starts[y] = Math.min(starts[y], x);
        ends[y] = Math.max(ends[y], x + 1);
      }
      const first = counts.findIndex(count => count >= .56 * w);
      const last = counts.findLastIndex(count => count >= .56 * w);
      if (first < 0 || (last - first + 1) * step < 9) continue;
      const outlined = length < .52 * w * h;
      // The two rails locate the interior even when an adjacent annotation touches the border.
      const crop = outlined ? {
        x0: (Math.max(starts[first], starts[last]) + 1) * step,
        y0: (top + first + 1) * step,
        x1: (Math.min(ends[first], ends[last]) - 1) * step,
        y1: (top + last) * step,
      } : { x0: left * step, y0: top * step, x1: right * step, y1: bottom * step };
      crop.x1 = Math.min(width, crop.x1);
      crop.y1 = Math.min(height, crop.y1);
      if (crop.x1 - crop.x0 < 12 || crop.y1 - crop.y0 < 8) continue;
      crops.push({ ...crop, outlined });
    }
    return crops;
  }

  function light(r, g, b) {
    return (r + 2 * g + b) / 4;
  }

  function cleanCrop(target, x, y, width, height, outlined, tight = false) {
    const pixels = target.getImageData(x, y, width, height);
    const { data } = pixels;
    const tones = new Uint32Array(64);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (!outlined || chroma(r, g, b) < 19) tones[light(r, g, b) >> 2]++;
    }
    const background = (tones.indexOf(Math.max(...tones)) << 2) + 2;
    const polarity = background >= 128 ? 1 : -1;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const contrast = outlined && chroma(r, g, b) >= 19 ? 0 : polarity * (background - light(r, g, b));
      const value = 255 - Math.min(255, 2 * Math.max(0, contrast - 12));
      data[i] = data[i + 1] = data[i + 2] = value;
    }
    if (!outlined && !tight) {
      const top = Math.round(.11 * height), bottom = height - top;
      const verticalRules = new Set();
      for (let col = 0; col < width; col++) {
        let first = height, last = 0, dark = 0;
        for (let row = top; row < bottom; row++) {
          if (data[(row * width + col) * 4] >= 200) continue;
          first = Math.min(first, row);
          last = row;
          dark++;
        }
        if (last - first >= .64 * height && dark >= .27 * height) verticalRules.add(col);
      }
      for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
          if (row >= top && row < bottom && !verticalRules.has(col)) continue;
          const i = (row * width + col) * 4;
          data[i] = data[i + 1] = data[i + 2] = 255;
        }
      }
    }
    target.putImageData(pixels, x, y);
    return { x, y, width, height, data };
  }

  function inkGroups({ data, width, height }, start = 0) {
    const groups = [];
    let group = null;
    for (let x = start; x < width; x++) {
      let top = height, bottom = 0, count = 0;
      for (let y = 0; y < height; y++) {
        if (data[(y * width + x) * 4] >= 211) continue;
        top = Math.min(top, y);
        bottom = y + 1;
        count++;
      }
      if (count < 2) {
        group = null;
        continue;
      }
      if (!group) {
        group = { x0: x, y0: top, x1: x + 1, y1: bottom, count: 0 };
        groups.push(group);
      }
      group.x1 = x + 1;
      group.y0 = Math.min(group.y0, top);
      group.y1 = Math.max(group.y1, bottom);
      group.count += count;
    }
    return groups;
  }

  function firstClause(ink) {
    if (ink.width < 1.3 * ink.height) return null;
    const groups = inkGroups(ink);
    const letters = groups.filter(box => box.y1 - box.y0 >= .23 * ink.height &&
      box.y1 - box.y0 < .72 * ink.height && box.x1 - box.x0 > .045 * ink.height);
    if (!letters.length) return null;
    const start = letters[0];
    const sizes = letters.map(box => box.y1 - box.y0).sort((a, b) => a - b);
    const size = sizes[Math.floor(sizes.length / 2)];
    const index = groups.findIndex((box, i) => {
      const advance = box.x0 - start.x0;
      const height = box.y1 - box.y0;
      return advance >= size && advance < 4.4 * size && box.y0 >= start.y0 + .52 * size &&
        height >= .08 * size && height <= .39 * size && box.x1 - box.x0 <= .31 * size &&
        (groups[i + 1]?.x0 ?? ink.width) - box.x1 >= .14 * size;
    });
    if (index < 0) return null;
    const comma = groups[index];
    const prefix = letters.filter(box => box.x0 < comma.x0);
    const pad = Math.ceil(.13 * size);
    return {
      comma: ink.x + comma.x0,
      box: {
        x0: ink.x + Math.max(0, start.x0 - pad),
        y0: ink.y + Math.max(0, Math.min(...prefix.map(box => box.y0)) - pad),
        x1: ink.x + Math.min(groups[index + 1]?.x0 ?? ink.width, comma.x1 + pad),
        y1: ink.y + Math.min(ink.height, Math.max(comma.y1, ...prefix.map(box => box.y1)) + pad),
      },
    };
  }

  function shortAddress(line, confidence, ink, participants, clause) {
    const address = leadingAddress(line.text, participants);
    if (!address || confidence < (address.known || address.isolated ? 45 : 60)) return null;
    const box = exactBoxForRange(line, 0, address.end);
    if (!box) return null;
    const { x, y, width, height, data } = ink;
    const size = box.y1 - box.y0;
    const top = Math.max(0, Math.floor(box.y0 - y - .05 * size));
    // Scan above the comma to recover a boundary even if its OCR box overlaps the name.
    const upper = Math.min(height, Math.ceil(box.y0 - y + .46 * size));
    const comma = clause?.comma ?? Infinity;
    const after = Math.min(width, Math.ceil(box.x1 - x + .13 * size), comma - x);
    let first = width, last = -1;
    for (let col = Math.max(0, Math.floor(box.x0 - x - .15 * size)); col < after; col++) {
      let count = 0;
      for (let row = top; row < upper; row++) count += Number(data[(row * width + col) * 4] < 211);
      if (count < 2) continue;
      first = Math.min(first, col);
      last = col;
    }
    if (last - first < .65 * size) return null;
    return { x0: x + Math.max(first - 1, 0), y0: Math.max(y, box.y0 - 2),
      x1: x + Math.min(last + 2, after), y1: Math.min(y + height, box.y1 + 2) };
  }

  function emojiTail(ink, right, size, tail) {
    const pictographic = /\p{Extended_Pictographic}/u.test(tail);
    const tailPattern = pictographic ? /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\s\u200d\ufe0f]+$/u :
      /^[A-Za-z]?[\p{P}\p{So}\s]+$/u;
    if (!tailPattern.test(tail)) return null;
    // A symbol and the last character can share columns while remaining separate shapes.
    const graphics = inkGroups(ink, right).filter(box => box.y1 - box.y0 >= .21 * size && box.x1 - box.x0 >= .07 * size);
    if (!graphics.length) return null;
    const first = graphics[0], last = graphics.at(-1);
    const y0 = Math.min(...graphics.map(box => box.y0));
    const y1 = Math.max(...graphics.map(box => box.y1));
    const width = last.x1 - first.x0, height = y1 - y0;
    if (first.x0 - right > .24 * size || width < .38 * size || width > 1.75 * size ||
      height < .65 * size || height > 1.65 * size ||
      graphics.some((box, i) => i && box.x0 - graphics[i - 1].x1 > .43 * size)) return null;
    const density = graphics.reduce((total, box) => total + box.count, 0) / (width * height);
    if (!pictographic && density < .29) return null;
    return { x1: last.x1, y0, y1 };
  }

  function readName(line, confidence, ink, { participants, clause, includeEmoji = false } = {}) {
    const mention = line.text.match(/^@\s*((?:\p{Script=Han}\s*){2,8})(?=[A-Za-z]?[\p{P}\p{So}])/u) ||
      line.text.match(/^@\s*([\p{L}\p{N}_][\p{L}\p{M}\p{N}_.’'· -]{0,35}?)(?:\s*[\p{So}\uFE0F]+)?$/u);
    if (!mention) return participants ? shortAddress(line, confidence, ink, participants, clause) : null;
    if (confidence < (includeEmoji ? 58 : 65) || !/\p{L}/u.test(mention[1]) ||
      /^(?:channel|everyone|here|all)$/i.test(mention[1])) return null;
    const words = mention[1].trim().split(/ +/u);
    // OCR can insert spaces into Han names. Additional Latin words must look like name parts.
    if (words.slice(1).some(word => /^[a-z]/u.test(word))) return null;
    const start = mention[0].indexOf(mention[1]);
    const end = start + mention[1].trimEnd().length;
    const name = exactBoxForRange(line, start, end);
    const marker = exactBoxForRange(line, 0, 1);
    if (!name || !marker) return null;

    const { x, y, width, height, data } = ink;
    const size = name.y1 - name.y0;
    const firstRow = Math.max(0, Math.floor(Math.min(name.y0, marker.y0) - y - .12 * size));
    const afterRow = Math.min(height, Math.ceil(Math.max(name.y1, marker.y1) - y + .12 * size));
    const suffix = line.spans.find(span => span.start >= end && span.box);
    const afterCol = Math.min(width, Math.ceil(name.x1 - x + .18 * size),
      suffix ? Math.floor(suffix.box.x0 - x) : width);
    if (afterCol <= 0) return null;
    const columns = new Uint16Array(afterCol);
    for (let row = firstRow; row < afterRow; row++) {
      for (let col = 0; col < afterCol; col++) {
        if (data[(row * width + col) * 4] < 211) columns[col]++;
      }
    }
    const expected = (marker.x1 + name.x0) / 2 - x;
    const startCol = Math.max(1, Math.ceil(marker.x0 - x + .70 * (marker.x1 - marker.x0)),
      Math.floor(expected - .26 * size));
    let gap = -1;
    for (let col = startCol; col < afterCol - 1 && col <= expected + .22 * size; col++) {
      if (columns[col]) continue;
      if (!columns[col + 1]) {
        gap = col;
        break;
      }
      if (gap < 0 || Math.abs(col - expected) < Math.abs(gap - expected)) gap = col;
    }
    if (gap < 0 || !columns.subarray(0, gap).some(Boolean)) return null;

    const left = columns.findIndex((count, col) => col > gap && count);
    let right = columns.findLastIndex(Boolean) + 1;
    if (left < 0 || right - left < .25 * size) return null;
    const han = mention[1].replace(/\s+/g, "");
    if (suffix && /^\p{Script=Han}{2,8}$/u.test(han)) {
      const advance = 1.12 * (marker.y1 - marker.y0);
      const end = left + Array.from(han).length * advance;
      let boundary = -1;
      for (let col = Math.ceil(end - .26 * advance); col < right && col < end + .30 * advance; col++) {
        if (!columns[col] && (boundary < 0 || Math.abs(col - end) < Math.abs(boundary - end))) boundary = col;
      }
      if (boundary >= 0) right = boundary;
    }
    let inkTop = afterRow, inkBottom = firstRow;
    for (let row = firstRow; row < afterRow; row++) {
      let count = 0;
      for (let col = left; col < right; col++) count += Number(data[(row * width + col) * 4] < 211);
      if (count < 2) continue;
      inkTop = Math.min(inkTop, row);
      inkBottom = row + 1;
    }
    if (inkBottom <= inkTop) return null;
    const graphic = includeEmoji && emojiTail(ink, right, marker.y1 - marker.y0, line.text.slice(end).trim());
    const top = Math.max(firstRow, inkTop - 3);
    const bottom = Math.min(afterRow, inkBottom + 3);
    return {
      x0: x + left, y0: y + (graphic ? Math.max(0, Math.min(top, graphic.y0 - 1)) : top),
      x1: x + (graphic ? Math.min(width, graphic.x1 + 1) : Math.min(afterCol, right + 1)),
      y1: y + (graphic ? Math.min(height, Math.max(bottom, graphic.y1 + 1)) : bottom),
      ...(graphic ? { includesEmoji: true } : {}),
    };
  }

  function unreadCrops(crops, covered) {
    return crops.filter(crop => !covered.some(box => {
      const commonWidth = Math.min(box.x1, crop.x1) - Math.max(box.x0, crop.x0);
      const commonHeight = Math.min(box.y1, crop.y1) - Math.max(box.y0, crop.y0);
      return commonWidth >= .25 * (crop.x1 - crop.x0) &&
        commonHeight >= .45 * Math.min(box.y1 - box.y0, crop.y1 - crop.y0);
    }));
  }

  const scanner = { findCrops, unreadCrops, cleanCrop, readName, firstClause };
  if (typeof module !== "undefined") module.exports = scanner;
  else window.HighlightMentions = scanner;
})();
