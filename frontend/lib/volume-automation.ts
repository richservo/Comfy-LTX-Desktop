import type { VolumeKeyframe } from '../types/project'

/**
 * Linearly interpolate the volume at a given media-time position.
 * Keyframes must be sorted by time. Returns `fallback` if no keyframes exist.
 */
export function interpolateVolume(
  keyframes: VolumeKeyframe[] | undefined,
  mediaTime: number,
  fallback: number,
): number {
  if (!keyframes || keyframes.length === 0) return fallback
  if (keyframes.length === 1) return keyframes[0].value
  if (mediaTime <= keyframes[0].time) return keyframes[0].value
  if (mediaTime >= keyframes[keyframes.length - 1].time) return keyframes[keyframes.length - 1].value

  // Find the two surrounding keyframes
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i]
    const b = keyframes[i + 1]
    if (mediaTime >= a.time && mediaTime <= b.time) {
      const t = (mediaTime - a.time) / (b.time - a.time)
      return a.value + t * (b.value - a.value)
    }
  }
  return keyframes[keyframes.length - 1].value
}

/**
 * Split keyframes at a media-time point, returning [before, after].
 * An interpolated keyframe is inserted at the split point in both halves.
 * The "after" keyframes have their times left as-is (still in media time).
 */
export function splitKeyframes(
  keyframes: VolumeKeyframe[] | undefined,
  splitMediaTime: number,
  fallback: number,
): [VolumeKeyframe[] | undefined, VolumeKeyframe[] | undefined] {
  if (!keyframes || keyframes.length === 0) return [undefined, undefined]

  const splitValue = interpolateVolume(keyframes, splitMediaTime, fallback)
  const before = keyframes.filter(k => k.time < splitMediaTime - 0.001)
  const after = keyframes.filter(k => k.time > splitMediaTime + 0.001)

  const beforeResult = [...before, { time: splitMediaTime, value: splitValue }]
  const afterResult = [{ time: splitMediaTime, value: splitValue }, ...after]

  return [
    beforeResult.length > 0 ? beforeResult : undefined,
    afterResult.length > 0 ? afterResult : undefined,
  ]
}
