// 统一的角色/道具名字解析（方案 2.4）：
// - 精确命中即终止（即使该项还没有参考图，也不再落入 fuzzy——宁缺勿错）
// - 短名禁用 fuzzy（中文 < 2 字、其他 < 3 字符），避免"大雄"命中"大雄的妈妈"、"AI"命中"Captain"
// - 多候选取与目标长度差最小者

const norm = (s: string) => s.toLowerCase().trim();
const CJK = /[一-鿿]/;
const fuzzyAllowed = (s: string) => (CJK.test(s) ? s.length >= 2 : s.length >= 3);

/** 表项的最小结构：调用方消费 name 与（可选的）referenceImage */
export interface NamedSheetItem {
  name: string;
  referenceImage?: string;
}

export function resolveByName<T extends NamedSheetItem>(name: string, sheet: T[]): T | undefined {
  if (!sheet || sheet.length === 0) return undefined;
  const target = norm(name);
  if (!target) return undefined;
  const exact = sheet.find(c => norm(c.name) === target);
  if (exact) return exact;
  if (!fuzzyAllowed(target)) return undefined;
  const hits = sheet.filter(c => {
    const n = norm(c.name);
    return fuzzyAllowed(n) && (n.includes(target) || target.includes(n));
  });
  return hits.sort((a, b) =>
    Math.abs(norm(a.name).length - target.length) - Math.abs(norm(b.name).length - target.length)
  )[0];
}
