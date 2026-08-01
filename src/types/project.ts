export const PROJECT_SCHEMA_VERSION = 1 as const

export type ProjectImageFormat = 'png' | 'jpeg'

export interface ImageFilters {
  brightness: number
  contrast: number
  saturation: number
  vibrance: number
  hue: number
  grayscale: boolean
  sepia: boolean
  blur: number
}

export interface ImageTransform {
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  flipX: boolean
  flipY: boolean
  opacity: number
}

export interface FrameImage {
  sourcePath: string
  naturalWidth: number
  naturalHeight: number
  transform: ImageTransform
  filters: ImageFilters
}

export interface FrameBorder {
  width: number
  color: string
}

export interface CollageFrame {
  id: string
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
  border: FrameBorder
  zIndex: number
  image: FrameImage | null
}

export interface ProjectPage {
  id: string
  name: string
  width: number
  height: number
  backgroundColor: string
  frames: CollageFrame[]
}

export interface ExportSettings {
  format: ProjectImageFormat
  jpegQuality: number
  width: number
  height: number
}

export interface CollageProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  name: string
  createdAt: string
  updatedAt: string
  activePageId: string
  pages: ProjectPage[]
  exportSettings: ExportSettings
}

export const createDefaultFilters = (): ImageFilters => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  hue: 0,
  grayscale: false,
  sepia: false,
  blur: 0,
})

export const createDefaultTransform = (): ImageTransform => ({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
})

const createId = (prefix: string) => {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}-${suffix}`
}

export const createNewProject = (): CollageProject => {
  const timestamp = new Date().toISOString()
  const pageId = createId('page')

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('project'),
    name: 'Untitled portrait',
    createdAt: timestamp,
    updatedAt: timestamp,
    activePageId: pageId,
    pages: [
      {
        id: pageId,
        name: 'Page 1',
        width: 1080,
        height: 1350,
        backgroundColor: '#18191b',
        frames: [
          {
            id: createId('frame'),
            x: 54,
            y: 54,
            width: 972,
            height: 1242,
            cornerRadius: 0,
            border: {
              width: 0,
              color: '#ffffff',
            },
            zIndex: 0,
            image: null,
          },
        ],
      },
    ],
    exportSettings: {
      format: 'png',
      jpegQuality: 0.92,
      width: 1080,
      height: 1350,
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isTransform = (value: unknown): value is ImageTransform => {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.offsetX) &&
    isFiniteNumber(value.offsetY) &&
    isFiniteNumber(value.scale) &&
    value.scale > 0 &&
    isFiniteNumber(value.rotation) &&
    typeof value.flipX === 'boolean' &&
    typeof value.flipY === 'boolean' &&
    isFiniteNumber(value.opacity)
  )
}

const isFilters = (value: unknown): value is ImageFilters => {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.brightness) &&
    isFiniteNumber(value.contrast) &&
    isFiniteNumber(value.saturation) &&
    isFiniteNumber(value.vibrance) &&
    isFiniteNumber(value.hue) &&
    typeof value.grayscale === 'boolean' &&
    typeof value.sepia === 'boolean' &&
    isFiniteNumber(value.blur)
  )
}

const isFrame = (value: unknown): value is CollageFrame => {
  if (!isRecord(value) || !isRecord(value.border)) return false
  const imageIsValid = value.image === null || (
    isRecord(value.image) &&
    typeof value.image.sourcePath === 'string' &&
    isFiniteNumber(value.image.naturalWidth) &&
    isFiniteNumber(value.image.naturalHeight) &&
    isTransform(value.image.transform) &&
    isFilters(value.image.filters)
  )

  return (
    typeof value.id === 'string' &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isFiniteNumber(value.cornerRadius) &&
    isFiniteNumber(value.border.width) &&
    typeof value.border.color === 'string' &&
    isFiniteNumber(value.zIndex) &&
    imageIsValid
  )
}

const isPage = (value: unknown): value is ProjectPage => {
  if (!isRecord(value) || !Array.isArray(value.frames)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    typeof value.backgroundColor === 'string' &&
    value.frames.length > 0 &&
    value.frames.every(isFrame)
  )
}

export const parseProjectFile = (value: unknown): CollageProject => {
  if (!isRecord(value) || !Array.isArray(value.pages) || !isRecord(value.exportSettings)) {
    throw new Error('This is not a valid Collage Studio project.')
  }

  const isValid = (
    value.schemaVersion === PROJECT_SCHEMA_VERSION &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.activePageId === 'string' &&
    value.pages.length > 0 &&
    value.pages.every(isPage) &&
    (value.exportSettings.format === 'png' || value.exportSettings.format === 'jpeg') &&
    isFiniteNumber(value.exportSettings.jpegQuality) &&
    isFiniteNumber(value.exportSettings.width) &&
    isFiniteNumber(value.exportSettings.height)
  )

  if (!isValid || !value.pages.some((page) => page.id === value.activePageId)) {
    throw new Error('This project is damaged or uses an unsupported project version.')
  }

  return structuredClone(value) as unknown as CollageProject
}
