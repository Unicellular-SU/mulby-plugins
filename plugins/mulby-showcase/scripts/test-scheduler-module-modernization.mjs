import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const schedulerModulePath = resolve(pluginRoot, 'src/ui/modules/Scheduler/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(schedulerModulePath), 'Scheduler module file must exist')

const schedulerSource = readFileSync(schedulerModulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')
const mainSource = read('src/main.ts')

assert(
  schedulerSource.includes('ApiReferencePanel') && schedulerSource.includes('page-with-api-panel'),
  'Scheduler module must use the shared right-side API panel layout'
)

assert(
  !schedulerSource.includes('CodeBlock'),
  'Scheduler module must not keep API examples in main content'
)

for (const token of [
  'scheduler.subscribe',
  'scheduler.unsubscribe',
  'scheduler.onEvent',
  'scheduler.listTasks',
  'scheduler.getTask',
  'scheduler.getTaskCount',
  'scheduler.cancelTask',
  'scheduler.pauseTask',
  'scheduler.resumeTask',
  'scheduler.deleteTasks',
  'scheduler.cleanupTasks',
  'scheduler.getExecutions',
  'scheduler.validateCron',
  'scheduler.describeCron',
  'scheduler.getNextCronTime',
  'host.call',
  'scheduleShowcaseDelayTask',
  'scheduleShowcaseOnceTask',
  'scheduleShowcaseRepeatTask',
]) {
  assert(schedulerSource.includes(token), `Scheduler module must demonstrate ${token}`)
}

for (const token of [
  'onShowcaseDelayTask',
  'onShowcaseOnceTask',
  'onShowcaseRepeatTask',
  'scheduleShowcaseDelayTask',
  'scheduleShowcaseOnceTask',
  'scheduleShowcaseRepeatTask',
  'mulby.scheduler.schedule',
]) {
  assert(mainSource.includes(token), `Backend must expose scheduler token ${token}`)
}

for (const forbidden of [
  'systemPage',
  'task-scheduler',
  'onOpenTaskScheduler',
  'settings.',
  'developer',
  'pluginStore',
  'trayMenu',
  'superPanel',
]) {
  assert(!schedulerSource.includes(forbidden), `Scheduler module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('SchedulerModule'), 'App must import and render SchedulerModule')
assert(appSource.includes("scheduler: 'scheduler'"), 'App feature map must route scheduler to the Scheduler module')
assert(sidebarSource.includes("label: '任务调度'"), 'Sidebar must include Scheduler module')
assert(indexSource.includes("from './Scheduler'"), 'Module index must export Scheduler module')
assert(manifestSource.includes('"code": "scheduler"'), 'Manifest must declare scheduler feature')
