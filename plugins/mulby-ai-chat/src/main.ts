// 插件后端入口（不依赖 PluginContext 类型导入，直接使用 any）
declare const mulby: any;

// ============================================================
// 插件生命周期
// ============================================================
export function onLoad() {
  // 插件加载时无需特殊初始化
}

export function onUnload() {
  // 清理资源
}

export async function run(_context: any) {
  // detached 模式下由 Mulby 直接打开独立浮窗，此处无需额外逻辑
}

// ============================================================
// RPC 方法：供 UI 调用的后端桥接
// ============================================================
export const rpc = {
  /**
   * 获取可用模型列表
   */
  async getAllModels() {
    return await mulby.ai.allModels();
  },

  /**
   * 连通性检查
   */
  async ping() {
    return { ok: true };
  },
};

export default { onLoad, onUnload, run };
