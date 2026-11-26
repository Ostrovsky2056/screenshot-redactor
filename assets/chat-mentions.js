(() => {
  const { boxForRange, runs } = typeof module === "undefined"
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

  function aliasesFor(lines, areas) {
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
    return [...values].map(value => new RegExp(value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&"), "giu"));
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

  function mentions(text, aliases, inChat) {
    const found = [];
    function add(start, value, priority) {
      if (value && !generic.test(value)) found.push({ start, end: start + value.length, priority });
    }
    for (const alias of aliases) {
      for (const match of text.matchAll(alias)) {
        const start = match.index;
        const end = start + match[0].length;
        if ((handleCharacter.test(match[0][0]) && start && handleCharacter.test(text[start - 1])) ||
          (handleCharacter.test(match[0].at(-1)) && end < text.length && handleCharacter.test(text[end]))) continue;
        if (inChat || leftContext(text, start) === 2) add(start, match[0], 90);
      }
    }
    for (const match of text.matchAll(/(?<![\p{Script=Latin}\p{N}_.%+-])@\s*([\p{Script=Latin}\p{N}_][\p{Script=Latin}\p{N}_.-]{0,31}[\p{Script=Latin}\p{N}_]|\p{Script=Han}{1,8}(?=$|[\s,，.。!?！？、:：]))/gu)) {
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

  function quoteGlyphs(line, run, canvas) {
    const characters = [...line.text.slice(run.start, run.end).matchAll(/\S/gu)];
    if (characters.length < 4 || !han.test(characters[0][0]) ||
      characters.some(([value]) => !han.test(value) && !/^[,.!?:;，。！？：；、]$/u.test(value))) return null;
    const x = Math.max(0, Math.floor(run.box.x0) - 1);
    const y = Math.max(0, Math.floor(run.box.y0) - 1);
    const width = Math.min(canvas.width, Math.ceil(run.box.x1) + 1) - x;
    const height = Math.min(canvas.height, Math.ceil(run.box.y1) + 1) - y;
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
    if (counts[mode] < .55 * levels.length) return null;
    const background = mode * 8 + 4;
    const rows = new Uint32Array(height);
    for (let i = 0; i < levels.length; i++) {
      levels[i] = Number(Math.abs(levels[i] - background) >= 28);
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
    const advance = (right - left) / (characters.length - (han.test(characters.at(-1)[0]) ? 0 : .65));
    if (advance < 6 || advance > (bottom - top) * 1.8) return null;
    // Use the ink-free gaps only when they fit the same character spacing across the line.
    const edges = [left];
    for (let i = 1; i < characters.length; i++) {
      const ideal = left + i * advance;
      let gap = -1;
      for (let col = Math.max(edges.at(-1) + 1, Math.ceil(ideal - .30 * advance));
        col < right && col <= ideal + .30 * advance; col++) {
        if (!columns[col] && (gap === -1 || Math.abs(col - ideal) < Math.abs(gap - ideal))) gap = col;
      }
      if (gap < 0) return null;
      edges.push(gap);
    }
    edges.push(right);
    return { characters, edges, advance, x, y0: Math.max(y, y + top - 1), y1: Math.min(y + height, y + bottom + 1) };
  }

  function boxAtGlyphs(grid, start, end, original) {
    const first = grid.characters.findIndex(({ index }) => index >= start);
    const last = grid.characters.findLastIndex(({ index }) => index < end);
    if (first < 0 || last < first) return original;
    const x0 = grid.x + grid.edges[first];
    const x1 = grid.x + grid.edges[last + 1];
    if (Math.abs(x0 - original.x0) > .65 * grid.advance || Math.abs(x1 - original.x1) > .65 * grid.advance) return original;
    return { x0, y0: grid.y0, x1, y1: grid.y1 };
  }

  function findRegions(lines, { avatars, messages, quoteBodies, participantNames }, canvas) {
    const aliases = aliasesFor(lines, participantNames);
    const quoteStarts = new Map(quoteBodies.map(({ line, start }) => [line, start]));
    const regions = [];
    for (const line of lines) {
      const quoted = quoteStarts.has(line);
      for (const run of runs(line, avatars)) {
        const start = Math.max(run.start, quoteStarts.get(line) ?? 0);
        if (start >= run.end) continue;
        const inChat = quoted || messages.some(message => inside(message, run.box));
        if (!inChat && participantNames.some(name => inside(name, run.box))) continue;
        const { text, offsets } = compact(line.text.slice(start, run.end));
        const matches = mentions(text, aliases, inChat);
        const grid = quoted && canvas && matches.length ? quoteGlyphs(line, run, canvas) : null;
        for (const match of matches) {
          const from = start + offsets[match.start].start;
          const to = start + offsets[match.end - 1].end;
          const box = boxForRange(line, from, to);
          if (box) regions.push(grid ? boxAtGlyphs(grid, from - run.start, to - run.start, box) : box);
        }
      }
    }
    return regions;
  }

  if (typeof module !== "undefined") module.exports = { findRegions };
  else window.ChatMentions = { findRegions };
})();
