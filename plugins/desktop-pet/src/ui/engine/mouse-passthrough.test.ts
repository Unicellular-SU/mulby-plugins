import {
  isPointInRect,
  resolvePetMousePassthroughForPoint,
  resolvePetMousePassthrough,
  shouldApplyMousePassthrough,
} from './mouse-passthrough'

function assertDeepEqual(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`)
  }
}

function testMenuCloseKeepsWindowClickableWhenPointerStillOverPet() {
  assertDeepEqual(
    resolvePetMousePassthrough({ pointerOverPet: true }),
    { ignore: false, forward: false }
  )
}

function testPointerOutsidePetUsesForwardedPassthrough() {
  assertDeepEqual(
    resolvePetMousePassthrough({ pointerOverPet: false }),
    { ignore: true, forward: true }
  )
}

function testRepeatedSamePassthroughStateIsSkipped() {
  assertDeepEqual(
    shouldApplyMousePassthrough(
      { ignore: true, forward: true },
      { ignore: true, forward: true }
    ),
    false
  )
}

function testChangedPassthroughStateIsApplied() {
  assertDeepEqual(
    shouldApplyMousePassthrough(
      { ignore: true, forward: true },
      { ignore: false, forward: false }
    ),
    true
  )
}

function testPointInsidePetWindowRect() {
  assertDeepEqual(
    isPointInRect({ x: 50, y: 60 }, { x: 40, y: 50, width: 80, height: 80 }),
    true
  )
}

function testPointOutsidePetWindowRect() {
  assertDeepEqual(
    isPointInRect({ x: 121, y: 60 }, { x: 40, y: 50, width: 80, height: 80 }),
    false
  )
}

function testPointAndActualWindowBoundsResolveClickableState() {
  assertDeepEqual(
    resolvePetMousePassthroughForPoint(
      { x: 75, y: 75 },
      { x: 40, y: 50, width: 80, height: 80 }
    ),
    { ignore: false, forward: false }
  )
}

testMenuCloseKeepsWindowClickableWhenPointerStillOverPet()
testPointerOutsidePetUsesForwardedPassthrough()
testRepeatedSamePassthroughStateIsSkipped()
testChangedPassthroughStateIsApplied()
testPointInsidePetWindowRect()
testPointOutsidePetWindowRect()
testPointAndActualWindowBoundsResolveClickableState()
