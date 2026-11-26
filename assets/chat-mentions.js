(() => {
  const { boxForRange, exactBoxForRange, runs } = typeof module === "undefined"
    ? window.SensitiveText : require("./sensitive-text.js");
  const han = /^\p{Script=Han}+$/u;
  const handleCharacter = /[\p{Script=Latin}\p{N}_]/u;
  const surnames =
    "王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗郑梁谢宋唐许韩邓曹彭曾萧肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆" +
    "汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严戴莫孔向汤温康施文牛洪翟安易乔伍庞颜倪聂祁符鲁童齐霍梅蓝祝甘季翁欧殷滕关常武傅葛费廉";
  const surname = new RegExp("欧阳|司马|上官|诸葛|司徒|慕容|东方|令狐|夏侯|[" + surnames + "]", "gu");
  const nickname = new RegExp("[小老][" + surnames + "]|阿\\p{Script=Han}", "gu");
  const title = /哥哥|姐姐|老师|先生|女士|同学|师傅|经理|[哥姐叔姨总董]/gu;
  const generic = /^(?:大家|大哥|大姐|大叔|大姨|小姐|老哥|老姐|先生|同学|老师|自己|我们|你们|他们|她们|我哥|我姐|你哥|你姐|他哥|她姐|他姐|夏天|高兴|白天|东方|王者|龙王)$/u;
  const namePart = /^[^我你他她它的了地得们这那与把在让去问说会要先再就还也跟给是来]+$/u;
  const leftAction = /(?:发给|转给|交给|联系|通知|告诉|问(?:了|问|一下|下)?|找(?:到)?|招呼|麻烦|辛苦|谢谢|多谢|拜托|安排|邀请|提醒|请教|转告|欢迎|约了|见到|叫|找|跟|和|让|给|向|由|请|等|帮|是)$/u;
  const englishAddress = /\b(?:ask|tell|notify|ping|message|contact|thank|remind|let)\s+$/i;
  const leftTime = /(?:现在|刚才|刚刚|昨天|今天|明天|之前|后来)$/u;
  const rightAction = /^(?:现在|刚刚|刚才|已经|没有|今天|昨天|明天|稍后|马上|也在|也会|一起|确认|联系|回复|反馈|负责|对接|参加|打电话|发来|发给|发了|收到|提交|签字|到了|来了|回[来去]|过去|过来|帮忙|先(?:确认|联系|回复|[看去来回])|说过|说了|叫我|告诉)/u;
  const rightParticle = /^[说问想去在来也会要呢吗吧喊看做]/u;
  const breakBefore = /[\p{P}\p{So}]$/u;
  const breakAfter = /^[\p{P}\p{So}]/u;

  // OCR inserts spaces between Chinese glyphs. Keep Latin word boundaries and source offsets.
  function compact(text) {
    const parts = Array.from(text.matchAll(/\s+|[^\s]/gu));
    const offsets = [];
    const units = [];
    for (const [i, part] of parts.entries()) {
      const value = part[0];
      const space = /^\s/u.test(value);
      if (space && (i === 0 || i === parts.length - 1 ||
        (han.test(parts[i - 1][0]) && han.test(parts[i + 1][0])))) continue;
      units.push(space ? " " : value);
      for (let j = 0; j < (space ? 1 : value.length); j++) {
        offsets.push({ start: part.index + j, end: part.index + (space ? value.length : j + 1) });
      }
    }
    return { text: units.join(""), offsets };
  }

  function inside(area, box) {
    const x = (box.x0 + box.x1) / 2;
    const y = (box.y0 + box.y1) / 2;
    return x >= area.x0 && x < area.x1 && y >= area.y0 && y < area.y1;
  }

  function participantLabels(lines, areas) {
    const values = new Set();
    for (const line of lines) {
      for (const area of areas) {
        if (area.y0 >= line.box.y1 || area.y1 <= line.box.y0 || area.x0 >= line.box.x1 || area.x1 <= line.box.x0) continue;
        const spans = line.spans.filter(({ box }) => box && inside(area, box));
        if (!spans.length) continue;
        const { text } = compact(line.text.slice(spans[0].start, spans.at(-1).end));
        if (text.length >= 2 && text.length <= 36 && /\p{L}/u.test(text) && !generic.test(text)) values.add(text);
      }
    }
    return [...values];
  }

  function aliasPattern(value, flags) {
    return new RegExp(value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"), flags);
  }

  function aliasesFor(lines, areas) {
    return participantLabels(lines, areas).map(value => aliasPattern(value, "giu"));
  }

  function leadingAddress(text, participants) {
    const comma = text.search(/[,，]/u);
    if (comma < 2 || comma > 38) return null;
    const prefix = text.slice(0, comma).trimEnd();
    const value = compact(prefix).text;
    if (generic.test(value)) return null;
    const known = participants.some(label => label.toLowerCase() === value.toLowerCase());
    const familiar = [...value.matchAll(nickname)].some(match => match[0] === value);
    return known || familiar ? { end: prefix.length, comma, known, isolated: !text.slice(comma + 1).trim() } : null;
  }

  function leftContext(text, start) {
    const prefix = text.slice(Math.max(0, start - 24), start).trimEnd();
    if (leftAction.test(prefix)) return 2;
    return Number(!prefix || breakBefore.test(prefix) || leftTime.test(prefix));
  }

  function rightContext(text, end) {
    const suffix = text.slice(end).trimStart();
    if (rightAction.test(suffix)) return 3;
    if (!suffix || breakAfter.test(suffix)) return 2;
    return Number(rightParticle.test(suffix));
  }

  function hasWordBoundaries(text, start, end) {
    return !(start && handleCharacter.test(text[start]) && handleCharacter.test(text[start - 1])) &&
      !(end < text.length && handleCharacter.test(text[end - 1]) && handleCharacter.test(text[end]));
  }

  function mentions(text, aliases, inChat) {
    const found = [];
    function add(start, value, priority) {
      if (value && !generic.test(value)) found.push({ start, end: start + value.length, priority });
    }
    for (const alias of aliases) {
      for (const match of text.matchAll(alias)) {
        const start = match.index;
        const end = start + match[0].length;
        if (!hasWordBoundaries(text, start, end)) continue;
        if (inChat || leftContext(text, start) === 2 || englishAddress.test(text.slice(0, start))) {
          add(start, match[0], 90);
        }
      }
    }
    for (const match of text.matchAll(/(?<![\p{Script=Latin}\p{N}_.%+-])@\s*([\p{Script=Latin}\p{N}_][\p{Script=Latin}\p{N}_.-]{0,31}[\p{Script=Latin}\p{N}_]|\p{Script=Han}{1,8}(?=$|[\p{So}\s,，.。!?！？、:：]))/gu)) {
      if (match[1].length > 2 && /^[0-9]+$/.test(match[1])) continue;
      add(match.index + match[0].lastIndexOf(match[1]), match[1], 95);
    }

    for (const match of text.matchAll(title)) {
      const end = match.index + match[0].length;
      const right = rightContext(text, end);
      for (let size = 1; size <= 4; size++) {
        const start = match.index - size;
        if (start < 0) break;
        const stem = text.slice(start, match.index);
        if (!han.test(stem) || !namePart.test(stem)) break;
        const left = leftContext(text, start);
        if (!left && !right) continue;
        const personal = [...stem.matchAll(surname)].some(match => match.index === 0) ||
          [...stem.matchAll(nickname)].some(match => match.index === 0);
        if ((personal && (left || (inChat && right >= 2 && size === 1))) || (left === 2 && right && inChat)) {
          add(start, stem + match[0], 68 + left * 4 + right);
        }
      }
    }
    for (const match of text.matchAll(nickname)) {
      const left = leftContext(text, match.index);
      const right = rightContext(text, match.index + match[0].length);
      if (left && (right >= 2 || left === 2)) add(match.index, match[0], 61);
    }
    for (const match of text.matchAll(surname)) {
      const left = leftContext(text, match.index);
      if (!left) continue;
      const start = match.index + match[0].length;
      for (let size = 1; size <= 2; size++) {
        const given = text.slice(start, start + size);
        if (given.length !== size || !han.test(given) || !namePart.test(given)) break;
        const right = rightContext(text, start + size);
        if (right && (left === 2 || (inChat && right !== 2))) {
          add(match.index, match[0] + given, 36 + right * 4);
        }
      }
    }

    const selected = [];
    for (const candidate of found.sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start))) {
      if (!selected.some(other => candidate.start < other.end && candidate.end > other.start)) selected.push(candidate);
    }
    return selected;
  }

  function inkBand(box, canvas, padding, { minX = 0, maxX = canvas.width, adjacentBackground = false } = {}) {
    const x = Math.max(0, minX, Math.floor(box.x0) - padding);
    const y = Math.max(0, Math.floor(box.y0) - 1);
    const width = Math.min(canvas.width, maxX, Math.ceil(box.x1) + padding) - x;
    const height = Math.min(canvas.height, Math.ceil(box.y1) + 1) - y;
    if (width < 20 || height < 8 || height > 160) return null;
    const { data } = canvas.getContext("2d").getImageData(x, y, width, height);
    const levels = new Uint8Array(width * height);
    const counts = new Uint32Array(32);
    for (let i = 0; i < levels.length; i++) {
      const j = i * 4;
      levels[i] = (3 * data[j] + 6 * data[j + 1] + data[j + 2]) / 10;
      counts[levels[i] >> 3]++;
    }
    const mode = counts.indexOf(Math.max(...counts));
    let support = counts[mode];
    let background = mode * 8 + 4;
    if (adjacentBackground && support < .55 * levels.length) {
      // Antialiasing and subtle gradients can put the bubble color in two adjacent bins.
      const lower = counts[mode - 1] ?? 0, upper = counts[mode + 1] ?? 0;
      const neighbor = Math.max(lower, upper);
      support += neighbor;
      background += (lower > upper ? -8 : 8) * neighbor / support;
    }
    if (support < .55 * levels.length) return null;
    const contrast = new Uint32Array(32);
    for (const level of levels) contrast[Math.abs(level - background) >> 3]++;
    // Ignore a few high-contrast outliers when estimating the text color.
    let contrastBin = contrast.length - 1;
    for (let pixels = 0; contrastBin > 0; contrastBin--) {
      pixels += contrast[contrastBin];
      if (pixels >= .025 * levels.length) break;
    }
    const inkThreshold = Math.max(28, .5 * contrastBin * 8);
    const rows = new Uint32Array(height);
    for (let i = 0; i < levels.length; i++) {
      levels[i] = Number(Math.abs(levels[i] - background) >= inkThreshold);
      rows[Math.floor(i / width)] += levels[i];
    }
    let top = rows.indexOf(Math.max(...rows));
    if (rows[top] < 4) return null;
    let bottom = top + 1;
    while (top > 0 && rows[top - 1] >= 2) top--;
    while (bottom < height && rows[bottom] >= 2) bottom++;

    const columns = new Uint32Array(width);
    for (let row = top; row < bottom; row++) {
      for (let col = 0; col < width; col++) columns[col] += levels[row * width + col];
    }
    const left = columns.findIndex(count => count > 0);
    const right = columns.findLastIndex(count => count > 0) + 1;
    return { x, y, width, height, levels, left, right, columns,
      y0: Math.max(y, y + top - 1), y1: Math.min(y + height, y + bottom + 1) };
  }

  function hanGlyphs(line, run, canvas, minX, maxX) {
    const characters = [...line.text.slice(run.start, run.end).matchAll(/\S/gu)];
    if (characters.length < 4 || !han.test(characters[0][0]) ||
      characters.some(([value]) => !han.test(value) && !/^[,.!?:;，。！？：；、]$/u.test(value))) return null;
    const padding = Math.max(1, Math.ceil(.36 * (run.box.x1 - run.box.x0) / characters.length));
    const band = inkBand(run.box, canvas, padding, { minX, maxX });
    if (!band) return null;
    const { left, right, columns } = band;
    const advance = (right - left) / (characters.length - (han.test(characters.at(-1)[0]) ? 0 : .65));
    if (advance < 6 || advance > (band.y1 - band.y0) * 1.8) return null;
    // Use the ink-free gaps only when they fit the same character spacing across the line.
    const edges = [left];
    let foundGaps = 0;
    for (let i = 1; i < characters.length; i++) {
      const ideal = left + i * advance;
      let gap = -1;
      for (let col = Math.max(left + 1, Math.ceil(ideal - .30 * advance));
        col < right && col <= ideal + .30 * advance; col++) {
        if (!columns[col] && (gap === -1 || Math.abs(col - ideal) < Math.abs(gap - ideal))) gap = col;
      }
      edges.push(gap >= 0 ? gap : null);
      if (gap >= 0) foundGaps++;
    }
    if (foundGaps <= .50 * (characters.length - 1)) return null;
    edges.push(right);
    return { characters, edges, advance, x: band.x, y0: band.y0, y1: band.y1 };
  }

  function boxAtGlyphs(grid, start, end, original) {
    const first = grid.characters.findIndex(({ index }) => index >= start);
    const last = grid.characters.findLastIndex(({ index }) => index < end);
    if (first < 0 || last < first) return original;
    if (grid.edges[first] === null || grid.edges[last + 1] === null) return original;
    const x0 = grid.x + grid.edges[first];
    const x1 = grid.x + grid.edges[last + 1];
    if (Math.abs(x0 - original.x0) > .85 * grid.advance || Math.abs(x1 - original.x1) > .85 * grid.advance) return original;
    return { x0, y0: grid.y0, x1, y1: grid.y1 };
  }

  function ranges(line, start, end, aliases, inChat, minimum = 0) {
    const { text, offsets } = compact(line.text.slice(start, end));
    return mentions(text, aliases, inChat).filter(match => match.priority >= minimum).flatMap(match => {
      const from = start + offsets[match.start].start;
      const to = start + offsets[match.end - 1].end;
      if (match.priority === 95) {
        const prefix = line.text.slice(start, from).match(/@\s*$/u);
        const sign = prefix && exactBoxForRange(line, start + prefix.index, start + prefix.index + 1);
        const name = exactBoxForRange(line, from, to);
        if (sign && name) {
          const size = name.y1 - name.y0;
          // OCR can read a nearby control icon as an at sign.
          if (name.x0 - sign.x1 > size * .65 && sign.y1 - sign.y0 > size * 1.18) return [];
        }
      }
      return [{ from, to }];
    });
  }

  function readingRuns(lines, { avatars, messages, quoteBodies, participantNames, groupTitle, sidebar }, aliases, canvas) {
    const quoteStarts = new Map(quoteBodies.map(({ line, start }) => [line, start]));
    const found = [];
    for (const line of lines) {
      const quoted = quoteStarts.has(line);
      for (const run of runs(line, avatars)) {
        if (sidebar && inside(sidebar, run.box)) continue;
        if (groupTitle && (inside(run.box, groupTitle) || inside(groupTitle, run.box))) continue;
        const start = Math.max(run.start, quoteStarts.get(line) ?? 0);
        if (start >= run.end) continue;
        const inChat = quoted || messages.some(message => inside(message, run.box)) || participantNames.some(name => {
          const height = name.y1 - name.y0;
          const drop = run.box.y0 - name.y1;
          return drop >= 0 && drop <= 3 * height && Math.abs(run.box.x0 - name.x0) < height;
        });
        if (!inChat && participantNames.some(name => inside(name, run.box))) continue;
        const matches = ranges(line, start, run.end, aliases, inChat);
        const grid = inChat && canvas && matches.length ? hanGlyphs(line, run, canvas) : null;
        const names = matches.flatMap(({ from, to }) => {
          const estimate = boxForRange(line, from, to);
          if (!estimate) return [];
          const box = grid ? boxAtGlyphs(grid, from - run.start, to - run.start, estimate) : estimate;
          return [{ from, to, box, exact: box !== estimate || !!exactBoxForRange(line, from, to) }];
        });
        const text = line.text.slice(start, run.end);
        const mixed = /\p{Script=Han}/u.test(text) && /[\p{Script=Latin}\p{N}]/u.test(text);
        // A rule or dashed outline can be read as a two-pixel-tall line of letters.
        const textHeight = run.box.y1 - run.box.y0;
        const retry = (inChat && textHeight >= 6 && (mixed || (line.confidence < 75 && /\p{L}/u.test(text)))) ||
          names.some(name => !name.exact || line.spans.some(span => span.box &&
          (span.end <= name.from || span.start >= name.to) &&
          span.box.x0 < name.box.x1 && name.box.x0 < span.box.x1));
        if (names.length || retry) found.push({ line, run, start, inChat, names, retry });
      }
    }
    return found;
  }

  function comparable(text) {
    return text.replace(/\s+/g, "").toLowerCase();
  }

  function alignName(entry, name, local) {
    const first = entry.line.text;
    const whole = comparable(first.slice(entry.run.start, entry.run.end));
    const localText = comparable(local.text);
    const word = comparable(first.slice(name.from, name.to));
    let offset = comparable(first.slice(entry.run.start, name.from)).length;
    if (whole !== localText) {
      offset = localText.indexOf(word);
      if (offset < 0 || offset !== localText.lastIndexOf(word) ||
        whole.indexOf(word) !== whole.lastIndexOf(word)) return null;
    }
    // Convert an offset in the space-free text back to the worker's character spans.
    const letters = [...local.text.matchAll(/\S/gu)];
    const before = Array.from(localText.slice(0, offset)).length;
    const count = Array.from(word).length;
    const firstLetter = letters[before];
    const lastLetter = letters[before + count - 1];
    if (!firstLetter || !lastLetter) return null;
    const from = firstLetter.index;
    const to = lastLetter.index + lastLetter[0].length;
    if (!hasWordBoundaries(local.text, from, to)) return null;
    const box = exactBoxForRange(local, from, to);
    const tolerance = entry.run.box.y1 - entry.run.box.y0;
    if (!box || Math.abs(box.x0 + box.x1 - name.box.x0 - name.box.x1) > 2 * tolerance ||
      Math.abs(box.y0 + box.y1 - name.box.y0 - name.box.y1) > tolerance) return null;
    return { box, from, to };
  }

  function polishLocal(local, { box, from, to }, original, canvas) {
    if (!canvas) return box;
    const name = comparable(local.text.slice(from, to));
    if (han.test(name)) {
      // Apply the Han glyph grid within a contiguous Han run in mixed-script text.
      for (const match of local.text.matchAll(/\p{Script=Han}+(?:\s+\p{Script=Han}+)*/gu)) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > from || end < to) continue;
        const bounds = boxForRange(local, start, end);
        if (!bounds) return box;
        const before = local.spans.findLast(span => span.end <= start && span.box);
        const after = local.spans.find(span => span.start >= end && span.box);
        const left = before && before.box.x1 <= bounds.x0 ? Math.floor(before.box.x1) : 0;
        const right = after && after.box.x0 > bounds.x0 ? Math.ceil(after.box.x0) : canvas.width;
        const grid = hanGlyphs(local, { start, end, box: bounds }, canvas, left, right);
        return grid ? boxAtGlyphs(grid, from - start, to - start, box) : box;
      }
    }
    if (!/^\p{Script=Latin}+$/u.test(name)) return box;
    const next = local.spans.find(span => span.start >= to && span.box);
    if (!next || !han.test(local.text.slice(next.start, next.end))) return box;
    const final = local.spans.findLast(span => span.end === to && span.box);
    if (!final || [...local.text.slice(final.start, final.end)].length !== 1) return box;
    const band = inkBand(local.box, canvas, 2);
    if (!band) return box;
    const height = band.y1 - band.y0;
    const left = Math.round(Math.min(box.x0, original.x0) - band.x);
    let x0 = box.x0;
    let distance = Infinity;
    for (let i = Math.max(0, left - Math.ceil(.25 * height));
      i < band.columns.length && i <= left + .25 * height; i++) {
      if (band.columns[i] === 0 && Math.abs(i - left) < distance) {
        x0 = i + band.x;
        distance = Math.abs(i - left);
      }
    }
    const last = Math.max(0, Math.floor(final.box.x0 - band.x));
    let ink = false;
    for (let i = last; i < band.columns.length && i < last + 1.2 * height; i++) {
      if (band.columns[i]) ink = true;
      else if (ink) {
        const x1 = i + band.x;
        if (x1 > x0 && Math.abs(x1 - box.x1) <= .85 * height) {
          return { x0, x1, y0: Math.min(box.y0, original.y0), y1: Math.max(box.y1, original.y1) };
        }
        break;
      }
    }
    return box;
  }

  const personalName = "\\p{Lu}[\\p{Ll}\\p{M}]+(?:['’\\-]\\p{Lu}?[\\p{Ll}\\p{M}]+)?";
  const addressName = personalName + "(?:\\s+" + personalName + "){0,2}";
  const trailingAddress = new RegExp(",\\s*(" + addressName + ")(?=\\s*[.!?]?\\s*$|\\s*,\\s*(?:you\\b|(?:can|could|would|will) you\\b|please\\b))", "u");
  const greetingAddress = new RegExp("^(?:[Hh]ey|[Hh]i|[Hh]ello|[Tt]hanks|[Tt]hank you)[,\\s]+(" + addressName + ")(?=\\s*[,!.?]|$)", "u");
  const ordinaryAddress = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|everyone|anyone|team|thanks|please|there|again|okay)$/iu;

  function addressInLine(line) {
    const text = line.text.trimEnd();
    const match = trailingAddress.exec(text) || greetingAddress.exec(text);
    if (!match || ordinaryAddress.test(match[1]) || match[1].length > 40) return null;
    const from = match.index + match[0].lastIndexOf(match[1]);
    return { from, to: from + match[1].length };
  }

  function strokeWeight(band, box) {
    const { x, y, width, height, levels } = band;
    let pixels = 0;
    let centers = 0;
    for (let row = Math.max(1, Math.floor(box.y0 - y)); row < Math.min(height - 1, Math.ceil(box.y1 - y)); row++) {
      for (let col = Math.max(1, Math.floor(box.x0 - x)); col < Math.min(width - 1, Math.ceil(box.x1 - x)); col++) {
        const i = row * width + col;
        if (!levels[i]) continue;
        pixels++;
        if (levels[i - 1] && levels[i + 1] && levels[i - width] && levels[i + width]) centers++;
      }
    }
    return { pixels, centers };
  }

  function isEmphasizedName(line, { from, to }, box, band) {
    const weight = strokeWeight(band, box);
    if (weight.pixels < 24 || weight.centers < .11 * weight.pixels) return false;
    let pixels = 0;
    let centers = 0;
    for (const word of line.text.matchAll(/[\p{Script=Latin}\p{M}]{2,}(?:['’][\p{Script=Latin}]+)?/gu)) {
      const start = word.index;
      const end = start + word[0].length;
      if (start < to && end > from) continue;
      const bounds = exactBoxForRange(line, start, end);
      if (!bounds || Math.abs(bounds.y1 + bounds.y0 - box.y1 - box.y0) > box.y1 - box.y0) continue;
      const reference = strokeWeight(band, bounds);
      pixels += reference.pixels;
      centers += reference.centers;
    }
    if (pixels < 32) return false;
    const usual = centers / pixels;
    const highlighted = weight.centers / weight.pixels;
    return highlighted >= usual + .045 && highlighted >= 1.25 * usual;
  }

  function endBeforePunctuation(line, to, box, band) {
    const next = line.spans.find(span => span.start >= to && span.box);
    if (!next || !/^[,.。!?！？、]$/u.test(line.text.slice(next.start, next.end))) return box.x1;
    const { levels, width, height, x } = band;
    const size = box.y1 - box.y0;
    const end = Math.min(width, Math.ceil(next.box.x1 + 1 - x), Math.ceil(box.x1 + size - x));
    // A punctuation box supplied by OCR can contain the end of the previous letter.
    let group = null;
    for (let col = Math.max(0, Math.floor(box.x1 - .22 * size - x)); col <= end; col++) {
      let y0 = height, y1 = 0;
      if (col < end) {
        for (let row = 0; row < height; row++) {
          if (!levels[row * width + col]) continue;
          y0 = Math.min(y0, row);
          y1 = Math.max(y1, row + 1);
        }
      }
      if (y1 > y0) {
        if (!group) group = { x: col, y0, y1 };
        group.y0 = Math.min(group.y0, y0);
        group.y1 = Math.max(group.y1, y1);
      } else if (group) {
        if (group.x + x >= box.x1 - .17 * size && group.y1 - group.y0 <= .47 * size &&
            group.y0 + band.y >= box.y0 + .31 * size) return group.x + x - 1;
        group = null;
      }
    }
    return box.x1;
  }

  function tightNameBox(line, { from, to }, canvas, body, emphasized = false) {
    const box = exactBoxForRange(line, from, to);
    if (!box || !inside(body, box)) return null;
    const band = canvas && inkBand(line.box, canvas, 2, {
      minX: Math.ceil(body.x0), maxX: Math.floor(body.x1), adjacentBackground: true,
    });
    if (emphasized && (!band || !isEmphasizedName(line, { from, to }, box, band))) return null;
    if (!band) return box;
    const x1 = endBeforePunctuation(line, to, box, band);
    const previous = line.spans.findLast(span => span.end <= from && span.box);
    const left = previous ? Math.min(box.x0, previous.box.x1) : body.x0;
    const x0 = Math.max(body.x0, left, box.x0 - 1);
    return x1 > x0 ? { x0, x1: Math.min(body.x1, x1), y0: Math.max(body.y0, box.y0 - 1),
      y1: Math.min(body.y1, box.y1 + 1) } : null;
  }

  function addressReads(lines, layout) {
    if (!layout.groupTitle || !layout.addressBodies?.length) return [];
    return lines.flatMap(line => {
      const match = line.confidence >= 54 && addressInLine(line);
      const body = match && layout.addressBodies.find(bubble => inside(bubble, line.box) &&
        line.box.x0 >= bubble.x0 - 2 && line.box.x1 <= bubble.x1 + 2);
      return body ? [{ line, match, body }] : [];
    });
  }

  function knownNamesInBody(line, aliases, canvas, body) {
    const boxes = [];
    for (const alias of aliases) {
      for (const match of line.text.matchAll(alias)) {
        const from = match.index, to = from + match[0].length;
        if (!hasWordBoundaries(line.text, from, to)) continue;
        const before = line.text.slice(0, from), after = line.text.slice(to);
        const address = /(?:@\s*|[,，]\s*|\b(?:ask(?:ed)?|tell|told|thank(?:ed)?|invite[ds]?|remind(?:ed)?|with|to|for)\s+)$/iu.test(before) ||
          /^\s*[,，]/u.test(after) && (!before.trim() ||
            /^\s*[,，]\s*(?:you\b|please\b|(?:can|could|will|would) you\b)/iu.test(after));
        if (!address && !/\p{L}\s+\p{L}/u.test(match[0])) continue;
        const box = tightNameBox(line, { from, to }, canvas, body);
        if (box && !boxes.some(seen => inside(seen, box))) boxes.push(box);
      }
    }
    return boxes;
  }

  function repeatedAccounts(lines, header) {
    if (header?.kind !== "inline" || header.count || !header.text) return [];
    const title = header.text.normalize("NFKC").replace(/\s+/gu, "");
    const parts = title.match(/^(\d{4,8})(\D(?:.{0,22}?\D)?)(\d{4,8})$/u);
    if (!parts) return [];
    const [, first, middle, last] = parts;
    const noisy = /[/\\|]/u.test(middle);
    const tails = [last];
    if (noisy && last.length > 4) {
      for (let skip = 1; skip <= Math.min(2, last.length - 4); skip++) tails.push(last.slice(skip));
    }
    const pattern = new RegExp("(?<!\\d)" + first + "\\s*([\\p{L}\\p{M}_·.\\-]+(?:\\s+[\\p{L}\\p{M}_·.\\-]+){0,7})\\s*(?:" +
      tails.join("|") + ")(?!\\d)", "giu");
    const boxes = [];
    for (const line of lines) {
      if (line.box.y0 < header.bodyTop || line.box.x0 < header.pane.x0 || line.box.x1 > header.pane.x1) continue;
      for (const match of line.text.matchAll(pattern)) {
        const body = match[1].replace(/\s+/gu, "");
        if (body.length > 16 || !/\p{L}/u.test(body) ||
            (noisy ? Math.abs(body.length - middle.length) > 4 : body.toLowerCase() !== middle.toLowerCase())) continue;
        const box = exactBoxForRange(line, match.index, match.index + match[0].length);
        if (box) boxes.push(box);
      }
    }
    return boxes;
  }

  function findRegions(lines, layout, canvas) {
    const aliases = aliasesFor(lines, layout.participantNames);
    const names = readingRuns(lines, layout, aliases, canvas).flatMap(({ names }) => names.map(({ box }) => box));
    return [...names, ...repeatedAccounts(lines, layout.header)];
  }

  async function refineRegions(lines, layout, canvas, readCrops) {
    const aliases = aliasesFor(lines, layout.participantNames);
    const entries = readingRuns(lines, layout, aliases, canvas);
    const retries = entries.filter(entry => entry.retry);
    const wholeLines = new Map(retries.filter(({ line, run }) => !run.start && run.end === line.text.length)
      .map(({ line, run }) => [line, run.box]));
    const direct = addressReads(lines, layout).map(entry => ({ ...entry, crop: wholeLines.get(entry.line) || entry.line.box }));
    const known = layout.knownNameCrops || [];
    const boxes = [...new Set([...retries.map(({ run }) => run.box), ...direct.map(({ crop }) => crop), ...known])];
    const crops = boxes.length ? await readCrops(boxes) : new Map();
    const names = entries.flatMap(entry => {
      const { run, line, names, start } = entry;
      const reading = crops.get(run.box);
      const local = reading?.confidence >= 55 ? reading.line : null;
      const resolved = names.map(name => {
        const aligned = local && alignName(entry, name, local);
        if (aligned) return { box: polishLocal(local, aligned, name.box, canvas), pending: false };
        if (name.exact) return { box: name.box, pending: false };
        return { box: boxForRange(line, name.from, name.to, { wholeWords: true }), pending: true };
      });
      // A clearer crop can reveal a mention missed by the full-image pass.
      if (!local || reading.confidence < 70) return resolved;
      let localStart = 0;
      if (start > run.start) {
        const prefix = comparable(line.text.slice(run.start, start));
        const colon = local.text.indexOf(":") + 1;
        if (!colon || comparable(local.text.slice(0, colon)) !== prefix) return resolved;
        localStart = colon;
      }
      for (const { from, to } of ranges(local, localStart, local.text.length, aliases, entry.inChat)) {
        const raw = exactBoxForRange(local, from, to);
        const box = raw && polishLocal(local, { box: raw, from, to }, raw, canvas);
        if (box && inside(run.box, box) && !layout.participantNames.some(name => inside(name, box)) && !resolved.some(region =>
          region.box.x0 < box.x1 && box.x0 < region.box.x1)) resolved.push({ box, pending: false });
      }
      return resolved;
    });
    const add = (box, options) => {
      if (!box) return;
      const index = names.findIndex(name => inside(name.box, box) && inside(box, name.box));
      const resolved = { box, pending: false, ...options };
      if (index < 0) names.push(resolved);
      else if (names[index].pending) names[index] = resolved;
    };
    const exactBounds = { preserveBounds: true };
    for (const { line, match, body, crop } of direct) {
      const reading = crops.get(crop);
      const local = reading?.confidence >= 56 && reading.line;
      const focused = local && addressInLine(local);
      if (focused && comparable(local.text.slice(focused.from, focused.to)) === comparable(line.text.slice(match.from, match.to))) {
        add(tightNameBox(local, focused, canvas, body, true), exactBounds);
      }
    }
    const aliasesFromCaptions = (layout.captionLabels || []).map(name => aliasPattern(name, "gu"));
    for (const crop of known) {
      const reading = crops.get(crop);
      if (reading?.line && reading.confidence >= 64) {
        for (const box of knownNamesInBody(reading.line, aliasesFromCaptions, canvas, crop)) add(box, exactBounds);
      }
    }
    for (const box of repeatedAccounts(lines, layout.header)) add(box);
    return names;
  }

  function croppedRegions(lines, layout, canvas, readings) {
    const aliases = aliasesFor(lines, layout.participantNames);
    return [...readings].flatMap(([crop, { line, confidence, name }]) => {
      if (name) return [name];
      if (crop.outlined || confidence < 70 || !layout.messages.some(message => inside(message, crop))) return [];
      return ranges(line, 0, line.text.length, aliases, true, 61).flatMap(({ from, to }) => {
        const box = exactBoxForRange(line, from, to);
        return box ? [polishLocal(line, { box, from, to }, box, canvas)] : [];
      });
    });
  }

  const scanner = { findRegions, refineRegions, croppedRegions, participantLabels, leadingAddress };
  if (typeof module !== "undefined") module.exports = scanner;
  else window.ChatMentions = scanner;
})();
