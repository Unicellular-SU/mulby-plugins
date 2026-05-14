export interface PetMousePassthroughInput {
  pointerOverPet: boolean
}

export interface PetMousePassthroughState {
  ignore: boolean
  forward: boolean
}

export function resolvePetMousePassthrough(input: PetMousePassthroughInput): PetMousePassthroughState {
  if (input.pointerOverPet) {
    return { ignore: false, forward: false }
  }

  return { ignore: true, forward: true }
}

export function shouldApplyMousePassthrough(
  current: PetMousePassthroughState | null,
  next: PetMousePassthroughState
): boolean {
  return current?.ignore !== next.ignore || current.forward !== next.forward
}

export function resolvePetMousePassthroughForPoint(
  point: { x: number; y: number } | null,
  bounds: { x: number; y: number; width: number; height: number } | null
): PetMousePassthroughState {
  return resolvePetMousePassthrough({
    pointerOverPet: !!point && !!bounds && isPointInRect(point, bounds),
  })
}

export function isPointInRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x
    && point.x < rect.x + rect.width
    && point.y >= rect.y
    && point.y < rect.y + rect.height
  )
}
