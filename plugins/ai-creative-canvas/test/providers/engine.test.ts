// engine 视频任务两段化单测（E6）：锁定「submitVideoJob 只提交不轮询、runVideoJob 仍提交+轮询」契约。
// 通过 stub window.mulby.http.request 记录每次 HTTP 的 method/url，断言 submit 阶段绝不发 GET 轮询，
// 从而保证 generate.ts 能在拿到 taskId 后即释放并发槽、把轮询挪到池外（长视频不再饿死文/图队列）。
import assert from 'node:assert/strict'
import type { ProviderConfig } from '../../src/ui/services/providers/types.ts'
import { submitVideoJob, runVideoJob, resumeVideoJob } from '../../src/ui/services/providers/engine.ts'

const cfg = {
  id: 'p1',
  label: 'Test Video',
  baseURL: 'https://api.test',
  submitPath: '/v1/submit',
  statusPath: '/v1/status/{id}',
  idPath: 'id',
  resultPath: 'video_url',
  statusField: 'state',
  doneValues: 'completed',
  pollIntervalMs: 1, // 轮询间隔压到 1ms 保持测试快
  timeoutMs: 5000
} as unknown as ProviderConfig

interface Call {
  method: string
  url: string
}
let calls: Call[] = []
let pollHits = 0 // status GET 命中前返回几次「running」，模拟未即时完成

function installHttp() {
  ;(globalThis as any).window = {
    mulby: {
      http: {
        request: async ({ url, method }: { url: string; method: string }) => {
          calls.push({ method, url })
          if (method === 'POST') return { status: 200, data: { id: 'task-123' } } // 提交返回 taskId、无同步 url
          // status GET：前 pollHits 次未完成，之后 completed
          if (pollHits > 0) {
            pollHits--
            return { status: 200, data: { state: 'running' } }
          }
          return { status: 200, data: { state: 'completed', video_url: 'https://api.test/out.mp4' } }
        }
      }
    }
  }
}

function gets(): Call[] {
  return calls.filter((c) => c.method === 'GET')
}
function posts(): Call[] {
  return calls.filter((c) => c.method === 'POST')
}

async function testSubmitDoesNotPoll() {
  calls = []
  pollHits = 0
  const r = await submitVideoJob(cfg, 'KEY', { prompt: 'hi' })
  assert.equal(r.taskId, 'task-123', 'submit 返回 taskId')
  assert.equal(r.url, undefined, 'submit 无同步 url')
  assert.equal(posts().length, 1, 'submit 只发一次提交 POST')
  assert.equal(gets().length, 0, 'submit 绝不发 status 轮询 GET（E6：拿到 taskId 即返回，让出并发槽）')
}

async function testSubmitReturnsSyncUrl() {
  // 供应商同步回 url（无需 taskId）：submit 直接带回 url、仍不轮询
  calls = []
  pollHits = 0
  ;(globalThis as any).window.mulby.http.request = async ({ url, method }: { url: string; method: string }) => {
    calls.push({ method, url })
    return { status: 200, data: { video_url: 'https://api.test/sync.mp4' } }
  }
  const r = await submitVideoJob(cfg, 'KEY', { prompt: 'hi' })
  assert.equal(r.url, 'https://api.test/sync.mp4', 'submit 带回同步 url')
  assert.equal(gets().length, 0, '同步 url 时也不轮询')
  installHttp() // 复原 stub 供后续用例
}

async function testRunVideoJobStillPolls() {
  calls = []
  pollHits = 2 // 前两次 running，第三次 completed
  const r = await runVideoJob(cfg, 'KEY', { prompt: 'hi' })
  assert.equal(r.url, 'https://api.test/out.mp4', 'runVideoJob 轮询到结果 url')
  assert.equal(posts().length, 1, 'runVideoJob 提交一次')
  assert.ok(
    gets().some((c) => c.url === 'https://api.test/v1/status/task-123'),
    'runVideoJob 仍对 status/{id} 轮询（行为与拆分前一致）'
  )
  assert.ok(gets().length >= 3, `轮询到完成需 ≥3 次 GET，实得 ${gets().length}`)
}

async function testResumePollsWithoutSubmit() {
  // 断点续跑：仅凭 taskId 轮询，不再提交
  calls = []
  pollHits = 1
  const r = await resumeVideoJob(cfg, 'KEY', 'task-999')
  assert.equal(r.url, 'https://api.test/out.mp4', 'resume 轮询到结果')
  assert.equal(posts().length, 0, 'resume 不重新提交')
  assert.ok(
    gets().some((c) => c.url === 'https://api.test/v1/status/task-999'),
    'resume 按传入 taskId 轮询'
  )
}

async function main() {
  installHttp()
  await testSubmitDoesNotPoll()
  await testSubmitReturnsSyncUrl()
  await testRunVideoJobStillPolls()
  await testResumePollsWithoutSubmit()
  console.log('engine video split: 4 tests OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
