import { createLimiter } from '../util'
import { useGraph } from '../store/graphStore'

// 共享并发限流：所有走 provider/AI 的生成与修复操作共用一个池（按工程 concurrency）。
// 防止「批量生成 + 360 接缝/天地修复 + 局部重绘」叠加时无限并发打满供应商配额(429)。
export const aiLimiter = createLimiter(() => useGraph.getState().project.concurrency || 4)
