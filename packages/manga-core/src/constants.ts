// ================= 题材中性的下拉选项（页面比例 / 总页数） =================
// 与题材无关的引擎常量留核心包；画风、叙事模式、预设角色等题材数据见各插件 theme.ts。

import { AspectRatio } from './engine-types';

export const ASPECT_RATIOS = [
  { label: '2:3（漫画页）', value: AspectRatio.MANGA_PAGE },
  { label: '3:4（竖版）', value: AspectRatio.PORTRAIT },
  { label: '1:1（方形）', value: AspectRatio.SQUARE },
  { label: '4:3（横版）', value: AspectRatio.LANDSCAPE },
  { label: '16:9（宽银幕）', value: AspectRatio.WIDE },
];

export const PAGE_LENGTH_OPTIONS = [
  { label: '短篇（3-5 页）', value: 'Short' },
  { label: '中篇（6-10 页）', value: 'Medium' },
  { label: '长篇（11-15 页）', value: 'Long' },
];
