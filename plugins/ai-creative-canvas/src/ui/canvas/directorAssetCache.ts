/**
 * 会话级异步资源缓存：成功值长期复用，进行中的请求去重，失败不固化，
 * 这样下次选择同一资源时仍有机会重试。
 */
export class DirectorAsyncResourceCache<K, V> {
  private readonly values = new Map<K, V>()
  private readonly pending = new Map<K, Promise<V | null>>()

  peek(key: K): V | undefined {
    return this.values.get(key)
  }

  has(key: K): boolean {
    return this.values.has(key)
  }

  load(key: K, loader: () => Promise<V>): Promise<V | null> {
    const cached = this.values.get(key)
    if (this.values.has(key)) return Promise.resolve(cached as V)

    const active = this.pending.get(key)
    if (active) return active

    const request = loader()
      .then((value) => {
        this.values.set(key, value)
        return value
      })
      .catch(() => null)
      .finally(() => this.pending.delete(key))

    this.pending.set(key, request)
    return request
  }
}
