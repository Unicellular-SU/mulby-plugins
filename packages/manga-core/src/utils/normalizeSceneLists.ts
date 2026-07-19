// ================= 剧本名单归一化（方案 B：解析后兜底，题材中性） =================
// 症状：模型在 characters_in_scene / props_in_scene / scenes_in_scene 里自由发挥变体名
// （如基础名相同但括号里写场景身份/状态，或裸名/分隔符差异），导致参考图无法按名注入。
// 规则（按序取首个命中）：
//   1. 精确命中（trim 后逐字一致）
//   2. 去括号基础名相等（'X（逃兵）' 与 'X（郎官）' 基础名均为 'X'）
//   2.5 基础名 token 是 sheet 名 token 的子集（'虎符（复制品）' → '虎符/兵符'）
//   3. 括号内容互相包含
//   4. 分隔符 token 子集等价（'虎符' ⊆ {'虎符','兵符'}；分隔符 / _ 空格 括号 顿号 逗号）
//   5. manga-kit resolveByName 模糊兜底（含短名保护与长度差择优）
// 处置：置信变体吸附为 sheet 原名（记 corrections）；未匹配的道具/场景自动补进对应
// sheet（记 additions）；未匹配的角色保留原名（记 unmatchedCharacters，不自动补建——
// 新角色意味着设定缺失，交给 UI 提示用户补建）。
// 幂等：吸附后即为精确命中、补表后即为表内项，二次执行零变更。

import { resolveByName } from '@mulby-plugins/manga-kit';
import { ComicResponse } from '../engine-types';

export interface NormalizeCorrection {
  kind: 'character' | 'prop' | 'scene';
  from: string;   // 变体名
  to: string;     // 吸附到的 sheet 原名
}

export interface NormalizeAddition {
  kind: 'prop' | 'scene';
  name: string;
}

export interface NormalizeReport {
  corrections: NormalizeCorrection[];
  additions: NormalizeAddition[];
  unmatchedCharacters: string[];
}

/** 拆 '基础名（括号内容）'；无括号时 bracket 为空 */
const splitBase = (name: string): { base: string; bracket: string } => {
  const m = name.match(/^(.+?)[（(](.+)[)）]\s*$/);
  if (!m) return { base: name.trim(), bracket: '' };
  return { base: m[1].trim(), bracket: m[2].trim() };
};

/** 分隔符 token 集合（/ _ 空格 中英文括号 顿号 逗号） */
const tokenSet = (s: string): Set<string> =>
  new Set(s.split(/[/\s_（）()、，,]+/).filter(Boolean));

/** 在 sheet 名字列表中为 target 找置信原名（规则按序，见文件头注释） */
const matchSheetName = (target: string, sheetNames: string[]): string | undefined => {
  const t = target.trim();
  if (!t) return undefined;

  // 1. 精确
  const exact = sheetNames.find(n => n === t);
  if (exact) return exact;

  // 2. 去括号基础名相等
  const tBase = splitBase(t).base;
  if (tBase) {
    const byBase = sheetNames.find(n => splitBase(n).base === tBase);
    if (byBase) return byBase;
  }

  // 2.5 基础名 token 是 sheet 名 token 的子集
  // （'虎符（复制品）' 基础名 '虎符' ⊆ {'虎符','兵符'} → '虎符/兵符'）
  const tBaseTokens = tokenSet(tBase);
  if (tBaseTokens.size > 0) {
    const byBaseTokens = sheetNames.find(n => {
      const nTokens = tokenSet(n);
      return nTokens.size > 0 && [...tBaseTokens].every(tok => nTokens.has(tok));
    });
    if (byBaseTokens) return byBaseTokens;
  }

  // 3. 括号内容互相包含
  const tBracket = splitBase(t).bracket;
  if (tBracket) {
    const byBracket = sheetNames.find(n => {
      const nBracket = splitBase(n).bracket;
      return nBracket && (nBracket.includes(tBracket) || tBracket.includes(nBracket));
    });
    if (byBracket) return byBracket;
  }

  // 4. 分隔符 token 子集等价（短集合是长集合的子集）
  const tTokens = tokenSet(t);
  if (tTokens.size > 0) {
    const byTokens = sheetNames.find(n => {
      const nTokens = tokenSet(n);
      if (nTokens.size === 0) return false;
      const [small, big] = tTokens.size <= nTokens.size ? [tTokens, nTokens] : [nTokens, tTokens];
      return [...small].every(tok => big.has(tok));
    });
    if (byTokens) return byTokens;
  }

  // 5. kit 模糊兜底（substring 命中 + 长度差择优 + 短名保护）
  return resolveByName(t, sheetNames.map(name => ({ name })))?.name;
};

/** 对剧本每页三个名单归一化；返回新 script（sheet 可能追加了道具/场景）与处理报告 */
export const normalizeSceneLists = (script: ComicResponse): { script: ComicResponse; report: NormalizeReport } => {
  const out: ComicResponse = {
    ...script,
    character_sheet: [...(script.character_sheet || [])],
    prop_sheet: [...(script.prop_sheet || [])],
    scene_sheet: [...(script.scene_sheet || [])],
    pages: (script.pages || []).map(p => ({ ...p })),
  };
  const report: NormalizeReport = { corrections: [], additions: [], unmatchedCharacters: [] };

  out.pages.forEach(page => {
    page.characters_in_scene = (page.characters_in_scene || []).map(raw => {
      const name = (raw || '').trim();
      if (!name) return raw;
      if (out.character_sheet.some(i => i.name === name)) return name;
      const to = matchSheetName(name, out.character_sheet.map(i => i.name));
      if (to) {
        if (to !== name) report.corrections.push({ kind: 'character', from: name, to });
        return to;
      }
      if (!report.unmatchedCharacters.includes(name)) report.unmatchedCharacters.push(name);
      return name;
    });

    page.props_in_scene = (page.props_in_scene || []).map(raw => {
      const name = (raw || '').trim();
      if (!name) return raw;
      if (out.prop_sheet.some(i => i.name === name)) return name;
      const to = matchSheetName(name, out.prop_sheet.map(i => i.name));
      if (to) {
        if (to !== name) report.corrections.push({ kind: 'prop', from: name, to });
        return to;
      }
      // 未匹配道具：自动补进 prop_sheet（无参考图，资产工坊可补生成；description 以名字兜底）
      out.prop_sheet.push({ name, description: name });
      report.additions.push({ kind: 'prop', name });
      return name;
    });

    page.scenes_in_scene = (page.scenes_in_scene || []).map(raw => {
      const name = (raw || '').trim();
      if (!name) return raw;
      if (out.scene_sheet.some(i => i.name === name)) return name;
      const to = matchSheetName(name, out.scene_sheet.map(i => i.name));
      if (to) {
        if (to !== name) report.corrections.push({ kind: 'scene', from: name, to });
        return to;
      }
      // 未匹配场景：自动补进 scene_sheet（同道具口径）
      out.scene_sheet.push({ name, description: name });
      report.additions.push({ kind: 'scene', name });
      return name;
    });
  });

  return { script: out, report };
};

/** 报告摘要（LogPanel/notes 用）；无变更返回 null */
export const summarizeNormalizeReport = (report: NormalizeReport): string | null => {
  const lines: string[] = [];
  report.corrections.forEach(c => lines.push(`name fix (${c.kind}): "${c.from}" → "${c.to}"`));
  report.additions.forEach(a => lines.push(`sheet add (${a.kind}): "${a.name}"`));
  report.unmatchedCharacters.forEach(n => lines.push(`unmatched character (kept as-is, not added): "${n}"`));
  return lines.length > 0 ? lines.join('\n') : null;
};
