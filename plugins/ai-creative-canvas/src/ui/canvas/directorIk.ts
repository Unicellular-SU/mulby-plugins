import { MathUtils, Object3D, Quaternion, Vector3 } from 'three'

export interface DirectorIkResult {
  target: Vector3
  error: number
  clamped: boolean
}

const worldPosition = (object: Object3D) => object.getWorldPosition(new Vector3())

const rotateWorld = (object: Object3D, rotation: Quaternion) => {
  const currentWorld = object.getWorldQuaternion(new Quaternion())
  const targetWorld = rotation.clone().multiply(currentWorld)
  const parentWorld = object.parent?.getWorldQuaternion(new Quaternion()) || new Quaternion()
  object.quaternion.copy(parentWorld.invert().multiply(targetWorld))
}

const distanceToLine = (point: Vector3, start: Vector3, end: Vector3) => {
  const line = end.clone().sub(start)
  const lengthSq = line.lengthSq()
  if (lengthSq < 1e-8) return point.distanceTo(start)
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(line) / lengthSq))
  return point.distanceTo(start.clone().addScaledVector(line, t))
}

/**
 * 轻量 CCD IK。joints 按“靠近末端 -> 靠近根部”排列，例如 [左肘, 左肩]。
 * 求解只改变关节旋转，不改变骨长；超出可达范围的目标会钳到 98%。
 */
export function solveDirectorCcdIk(input: {
  root: Object3D
  joints: Object3D[]
  effector: Object3D
  target: Vector3
  iterations?: number
}): DirectorIkResult {
  const { root, joints, effector } = input
  const iterations = Math.max(1, Math.min(20, input.iterations || 10))
  root.updateMatrixWorld(true)
  const rootJoint = joints[joints.length - 1]
  if (!rootJoint || !effector || !joints.length) {
    return { target: input.target.clone(), error: Infinity, clamped: false }
  }

  const points = [...joints].reverse().map(worldPosition)
  points.push(worldPosition(effector))
  let reach = 0
  for (let index = 1; index < points.length; index++) reach += points[index].distanceTo(points[index - 1])
  reach = Math.max(0.001, reach)

  const origin = worldPosition(rootJoint)
  const desired = input.target.clone()
  const offset = desired.clone().sub(origin)
  const maxReach = reach * 0.98
  let clamped = false
  if (offset.length() > maxReach) {
    desired.copy(origin).add(offset.normalize().multiplyScalar(maxReach))
    clamped = true
  }

  // 完全伸直的二骨骼链没有可用弯曲平面，先按模型记录的自然屈曲轴播种一个小角度。
  if (joints.length >= 2) {
    root.updateMatrixWorld(true)
    const middle = joints[0]
    const middlePosition = worldPosition(middle)
    const endPosition = worldPosition(effector)
    if (distanceToLine(middlePosition, origin, endPosition) < reach * 0.004) {
      const stored = middle.userData.poseBendAxisLocal as [number, number, number] | undefined
      const axis = new Vector3(...(stored || [-1, 0, 0]))
      if (middle.parent) axis.applyQuaternion(middle.parent.getWorldQuaternion(new Quaternion()))
      if (axis.lengthSq() > 1e-8) rotateWorld(middle, new Quaternion().setFromAxisAngle(axis.normalize(), MathUtils.degToRad(8)))
    }
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    for (const joint of joints) {
      root.updateMatrixWorld(true)
      const jointPosition = worldPosition(joint)
      const currentEnd = worldPosition(effector)
      const toEnd = currentEnd.sub(jointPosition)
      const toTarget = desired.clone().sub(jointPosition)
      if (toEnd.lengthSq() < 1e-10 || toTarget.lengthSq() < 1e-10) continue
      const rotation = new Quaternion().setFromUnitVectors(toEnd.normalize(), toTarget.normalize())
      rotateWorld(joint, rotation)
    }
    root.updateMatrixWorld(true)
    if (worldPosition(effector).distanceTo(desired) < 0.0025) break
  }

  root.updateMatrixWorld(true)
  return { target: desired, error: worldPosition(effector).distanceTo(desired), clamped }
}
