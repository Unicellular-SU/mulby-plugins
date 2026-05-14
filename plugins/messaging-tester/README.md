# 插件通信测试器

`@mulby/messaging-tester` 是一个小型 Mulby 插件，用于配合 `@mulby/showcase` 的插件通信模块测试消息互传。

## 功能

- 从测试器向 `@mulby/showcase` 发送点对点消息。
- 默认发送 `showcase-ping`，Showcase 收到后应回复 `showcase-pong`。
- 接收 Showcase 通信页发来的 `tester-ping`，并自动回复 `tester-pong`。
- 发送广播消息，并在本地记录广播摘要。
- 缓存最近 50 条收到、发送和广播摘要消息，支持按方向和类型过滤。

## 触发方式

- `messaging-tester`
- `消息测试`
- `通信测试`

## 使用示例

1. 在 Mulby 中启用 `@mulby/showcase` 和 `@mulby/messaging-tester`。
2. 打开本插件，点击 `showcase-ping`。
3. 查看本插件消息日志，应先出现发送到 `@mulby/showcase` 的 `showcase-ping`，随后出现收到的 `showcase-pong`。
4. 打开 Showcase 的插件通信模块，将目标插件 ID 改为 `@mulby/messaging-tester`，消息类型改为 `tester-ping`，点击发送。
5. 回到本插件日志，应看到收到的 `tester-ping`；Showcase 最近消息中应看到测试器回复的 `tester-pong`。
6. 在任一插件发送广播，另一个已启动并订阅的插件会记录收到的广播。广播不会发回发送者自己。

## 开发

```bash
pnpm install
pnpm --dir plugins/messaging-tester run test
pnpm --dir plugins/messaging-tester run build
pnpm --dir plugins/messaging-tester run pack
```

## 说明

插件通信 API 在后台使用：

- `context.api.messaging.on(handler)` 订阅消息。
- `context.api.messaging.off(handler)` 卸载时取消订阅。
- `mulby.messaging.send(targetPluginId, type, payload)` 发送点对点消息。
- `mulby.messaging.broadcast(type, payload)` 发送广播。
