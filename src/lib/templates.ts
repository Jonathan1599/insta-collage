import {
  createId,
  type CollageFrame,
  type CollageTemplateId,
  type FrameImage,
  type ProjectPage,
} from '../types/project'

export interface TemplateDefinition {
  id: CollageTemplateId
  name: string
  frames: Array<{ x: number; y: number; width: number; height: number }>
}

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    id: 'single',
    name: 'Single',
    frames: [{ x: 0, y: 0, width: 1, height: 1 }],
  },
  {
    id: 'two-columns',
    name: '2 columns',
    frames: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
  },
  {
    id: 'two-rows',
    name: '2 rows',
    frames: [
      { x: 0, y: 0, width: 1, height: 0.5 },
      { x: 0, y: 0.5, width: 1, height: 0.5 },
    ],
  },
  {
    id: 'three-columns',
    name: '3 columns',
    frames: [
      { x: 0, y: 0, width: 1 / 3, height: 1 },
      { x: 1 / 3, y: 0, width: 1 / 3, height: 1 },
      { x: 2 / 3, y: 0, width: 1 / 3, height: 1 },
    ],
  },
  {
    id: 'hero-split',
    name: 'Hero + 2',
    frames: [
      { x: 0, y: 0, width: 0.64, height: 1 },
      { x: 0.64, y: 0, width: 0.36, height: 0.5 },
      { x: 0.64, y: 0.5, width: 0.36, height: 0.5 },
    ],
  },
  {
    id: 'four-grid',
    name: '4 grid',
    frames: [
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0, width: 0.5, height: 0.5 },
      { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    ],
  },
  {
    id: 'freeform',
    name: 'Freeform',
    frames: [
      { x: 0.02, y: 0.04, width: 0.62, height: 0.58 },
      { x: 0.44, y: 0.22, width: 0.54, height: 0.48 },
      { x: 0.12, y: 0.64, width: 0.7, height: 0.32 },
    ],
  },
]

const templateById = (templateId: CollageTemplateId) => (
  TEMPLATE_DEFINITIONS.find((template) => template.id === templateId) ?? TEMPLATE_DEFINITIONS[0]
)

export const createTemplateFrames = (
  templateId: CollageTemplateId,
  page: Pick<ProjectPage, 'width' | 'height' | 'gap' | 'frames'>,
): CollageFrame[] => {
  const template = templateById(templateId)
  const margin = 54
  const gap = templateId === 'single' ? 0 : page.gap
  const contentWidth = page.width - margin * 2
  const contentHeight = page.height - margin * 2
  const previousImages = page.frames
    .slice()
    .sort((left, right) => left.zIndex - right.zIndex)
    .map((frame) => frame.image)
    .filter((image): image is FrameImage => image !== null)

  return template.frames.map((definition, index) => {
    const leftInset = definition.x > 0 ? gap / 2 : 0
    const rightInset = definition.x + definition.width < 1 ? gap / 2 : 0
    const topInset = definition.y > 0 ? gap / 2 : 0
    const bottomInset = definition.y + definition.height < 1 ? gap / 2 : 0

    return {
      id: createId('frame'),
      x: margin + definition.x * contentWidth + leftInset,
      y: margin + definition.y * contentHeight + topInset,
      width: definition.width * contentWidth - leftInset - rightInset,
      height: definition.height * contentHeight - topInset - bottomInset,
      cornerRadius: 0,
      border: { width: 0, color: '#ffffff' },
      zIndex: index,
      image: previousImages[index] ?? null,
    }
  })
}

export const resizeFramesForGap = (
  page: Pick<ProjectPage, 'templateId' | 'width' | 'height' | 'gap' | 'frames'>,
  gap: number,
) => createTemplateFrames(page.templateId, { ...page, gap }).map((frame, index) => ({
  ...frame,
  id: page.frames[index]?.id ?? frame.id,
  image: page.frames[index]?.image ?? frame.image,
}))
