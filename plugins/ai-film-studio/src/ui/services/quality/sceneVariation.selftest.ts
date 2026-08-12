/** 场景组变化度检查自测 */
import { checkSceneVariation, type SceneVariationShot } from './sceneVariation'

let failures = 0
function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function shot(index: number, patch: Partial<SceneVariationShot> = {}): SceneVariationShot {
  return { id: `sb${index}`, index, sceneId: 'hall', shotSize: '中景', cameraMove: '固定', ...patch }
}

// —— 整组同质：所有维度都一样 ——
{
  const result = checkSceneVariation([shot(0), shot(1), shot(2), shot(3)])
  check('a fully uniform scene group is flagged', result.issues.length > 0, JSON.stringify(result.issues))
  check('zero variation is high severity', result.issues[0].severity === 'high', JSON.stringify(result.issues[0]))
  check('issue lists every shot in the group', result.issues[0].shotIndexes.join(',') === '1,2,3,4', JSON.stringify(result.issues[0]))
  check('issue explains the consequence', result.issues[0].message.includes('同一张图配不同台词'), result.issues[0].message)
  check('issue carries an actionable suggestion', result.issues[0].suggestion.includes('换景别'), result.issues[0].suggestion)
}

// —— 变化足够：不报 ——
{
  const result = checkSceneVariation([
    shot(0, { shotSize: '远景', cameraMove: '固定' }),
    shot(1, { shotSize: '中景', cameraMove: '推' }),
    shot(2, { shotSize: '特写', cameraMove: '手持' }),
  ])
  check('a varied group passes', result.issues.length === 0, JSON.stringify(result.issues))
  check('summary reports the varied dimension count', result.groups[0].variedDimensions === 2, JSON.stringify(result.groups))
}

// —— 只变一个维度：3-5 镜要求 2 个 ——
{
  const result = checkSceneVariation([
    shot(0, { shotSize: '远景' }),
    shot(1, { shotSize: '中景' }),
    shot(2, { shotSize: '特写' }),
  ])
  check('varying only shot size is not enough', result.issues.length === 1 && result.issues[0].severity === 'med', JSON.stringify(result.issues))
}

// —— 决策层维度也算变化 ——
{
  const result = checkSceneVariation([
    shot(0, { shotSize: '中景', design: { viewerPosition: '同处现场', compositionMechanism: '关系疏离' } }),
    shot(1, { shotSize: '中景', design: { viewerPosition: '隔着门框', compositionMechanism: '被观察' } }),
    shot(2, { shotSize: '中景', design: { viewerPosition: '肩后', compositionMechanism: '心理失衡' } }),
  ])
  check('decision-layer dimensions count as variation', result.issues.length === 0, JSON.stringify(result.issues))
  check('viewer position and mechanism both counted', result.groups[0].variedDimensions === 2, JSON.stringify(result.groups))
}

// —— 6 镜以上要求更严 ——
{
  const six = Array.from({ length: 6 }, (_, i) => shot(i, { shotSize: i < 3 ? '远景' : '中景', cameraMove: i % 2 ? '推' : '固定' }))
  check('6+ shots need 3 varied dimensions', checkSceneVariation(six).issues.length === 1, JSON.stringify(checkSceneVariation(six).issues))

  const sixVaried = Array.from({ length: 6 }, (_, i) =>
    shot(i, { shotSize: ['远景', '中景', '特写'][i % 3], cameraMove: ['固定', '推', '摇'][i % 3], design: { viewerPosition: ['同处现场', '门框外', '肩后'][i % 3] } }),
  )
  check('6 shots varied on 3 dimensions pass', checkSceneVariation(sixVaried).issues.length === 0, JSON.stringify(checkSceneVariation(sixVaried).issues))
}

// —— 连续相同机位：即使整组够多样也要报 ——
{
  const shots = [
    shot(0, { shotSize: '远景', cameraMove: '固定' }),
    shot(1, { shotSize: '中景', cameraMove: '推' }),
    shot(2, { shotSize: '中景', cameraMove: '推' }),
    shot(3, { shotSize: '中景', cameraMove: '推' }),
    shot(4, { shotSize: '特写', cameraMove: '手持' }),
  ]
  const result = checkSceneVariation(shots)
  check('an identical run inside a varied group is flagged', result.issues.some((issue) => issue.message.includes('连续 3 镜')), JSON.stringify(result.issues))
  check('the identical-run issue points at the right shots', result.issues.find((i) => i.message.includes('连续 3 镜'))?.shotIndexes.join(',') === '2,3,4', JSON.stringify(result.issues))
}

// —— 边界 ——
{
  check('two-shot groups are not judged', checkSceneVariation([shot(0), shot(1)]).issues.length === 0, 'expected none')
  check('shots without a sceneId are ignored', checkSceneVariation([shot(0, { sceneId: undefined }), shot(1, { sceneId: undefined }), shot(2, { sceneId: undefined })]).issues.length === 0, 'expected none')
  check('empty input is safe', checkSceneVariation([]).issues.length === 0 && checkSceneVariation([]).groups.length === 0, 'expected empty')

  const twoScenes = checkSceneVariation([
    shot(0, { sceneId: 'a' }), shot(1, { sceneId: 'a' }), shot(2, { sceneId: 'a' }),
    shot(3, { sceneId: 'b', shotSize: '远景' }), shot(4, { sceneId: 'b', shotSize: '中景' }), shot(5, { sceneId: 'b', shotSize: '特写', cameraMove: '推' }),
  ])
  check('scenes are judged independently', twoScenes.issues.length === 1 && twoScenes.issues[0].sceneId === 'a', JSON.stringify(twoScenes.issues))
}

console.log(failures ? `\nsceneVariation selftest: ${failures} FAILED` : '\nsceneVariation selftest: ALL PASSED')
if (failures) process.exit(1)
