import type { CollageFrame, ImageTransform } from '../types/project'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const toRadians = (degrees: number) => degrees * Math.PI / 180

export const minimumCoverScale = (
  frame: Pick<CollageFrame, 'width' | 'height'>,
  naturalWidth: number,
  naturalHeight: number,
  rotation: number,
) => {
  if (naturalWidth <= 0 || naturalHeight <= 0) return 1

  const radians = toRadians(rotation)
  const cosine = Math.abs(Math.cos(radians))
  const sine = Math.abs(Math.sin(radians))

  return Math.max(
    (cosine * frame.width + sine * frame.height) / naturalWidth,
    (sine * frame.width + cosine * frame.height) / naturalHeight,
  )
}

export const constrainImageTransform = (
  frame: Pick<CollageFrame, 'width' | 'height'>,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
): ImageTransform => {
  const scale = Math.max(
    transform.scale,
    minimumCoverScale(frame, naturalWidth, naturalHeight, transform.rotation),
  )
  const radians = toRadians(transform.rotation)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)

  // Work in the rotated image's local coordinate system. If all four frame
  // corners fit inside the source rectangle, no empty pixels can be exposed.
  const frameExtentX = (
    Math.abs(cosine) * frame.width + Math.abs(sine) * frame.height
  ) / 2
  const frameExtentY = (
    Math.abs(sine) * frame.width + Math.abs(cosine) * frame.height
  ) / 2
  const imageHalfWidth = naturalWidth * scale / 2
  const imageHalfHeight = naturalHeight * scale / 2
  const localLimitX = Math.max(imageHalfWidth - frameExtentX, 0)
  const localLimitY = Math.max(imageHalfHeight - frameExtentY, 0)

  const localOffsetX = cosine * transform.offsetX + sine * transform.offsetY
  const localOffsetY = -sine * transform.offsetX + cosine * transform.offsetY
  const safeLocalX = clamp(localOffsetX, -localLimitX, localLimitX)
  const safeLocalY = clamp(localOffsetY, -localLimitY, localLimitY)

  return {
    ...transform,
    scale,
    offsetX: cosine * safeLocalX - sine * safeLocalY,
    offsetY: sine * safeLocalX + cosine * safeLocalY,
  }
}

export const nearlyEqual = (left: number, right: number, tolerance = 0.001) =>
  Math.abs(left - right) <= tolerance
