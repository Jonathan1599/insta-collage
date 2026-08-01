import { create } from 'zustand'
import {
  createDefaultFilters,
  createDefaultTransform,
  createNewProject,
  type CollageProject,
  type CollageFrame,
  type CollageTemplateId,
  type FrameImage,
  type ImageFilters,
  type ImageTransform,
} from '../types/project'

interface EditorState {
  selectedFrameId: string
  cropMode: boolean
  arrangeMode: boolean
  projectPath: string | null
  dirty: boolean
  imageLoadRevisions: Record<string, number>
}

interface ProjectStore {
  project: CollageProject
  editor: EditorState
  selectFrame: (frameId: string) => void
  setCropMode: (cropMode: boolean) => void
  setArrangeMode: (arrangeMode: boolean) => void
  setBackgroundColor: (color: string) => void
  setFrameGap: (gap: number, frames: CollageFrame[]) => void
  setTemplateFrames: (templateId: CollageTemplateId, frames: CollageFrame[]) => void
  addFrame: (frame: CollageFrame) => void
  updateFrameGeometry: (
    frameId: string,
    geometry: Partial<Pick<CollageFrame, 'x' | 'y' | 'width' | 'height'>>,
  ) => void
  assignImages: (assignments: Array<{ frameId: string; sourcePath: string }>) => void
  chooseImage: (frameId: string, sourcePath: string) => void
  setLoadedImage: (
    frameId: string,
    naturalWidth: number,
    naturalHeight: number,
    transform: ImageTransform,
  ) => void
  updateImageTransform: (frameId: string, transform: Partial<ImageTransform>) => void
  updateImageFilters: (frameId: string, filters: Partial<ImageFilters>) => void
  resetImage: (frameId: string, transform: ImageTransform) => void
  resetProject: () => void
  loadProject: (project: CollageProject, path: string) => void
  markSaved: (path: string) => void
}

const updateFrame = (
  project: CollageProject,
  frameId: string,
  updater: (image: FrameImage | null) => FrameImage | null,
) => ({
  ...project,
  updatedAt: new Date().toISOString(),
  pages: project.pages.map((page) => ({
    ...page,
    frames: page.frames.map((frame) => (
      frame.id === frameId ? { ...frame, image: updater(frame.image) } : frame
    )),
  })),
})

const firstFrameId = (project: CollageProject) => (
  project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0]
).frames[0].id

const freshProject = createNewProject()

export const useProjectStore = create<ProjectStore>((set) => ({
  project: freshProject,
  editor: {
    selectedFrameId: firstFrameId(freshProject),
    cropMode: false,
    arrangeMode: false,
    projectPath: null,
    dirty: false,
    imageLoadRevisions: {},
  },
  selectFrame: (selectedFrameId) =>
    set((state) => ({ editor: { ...state.editor, selectedFrameId } })),
  setCropMode: (cropMode) =>
    set((state) => ({ editor: { ...state.editor, cropMode, arrangeMode: false } })),
  setArrangeMode: (arrangeMode) =>
    set((state) => ({ editor: { ...state.editor, arrangeMode, cropMode: false } })),
  setBackgroundColor: (backgroundColor) =>
    set((state) => ({
      project: {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, backgroundColor } : page
        )),
      },
      editor: { ...state.editor, dirty: true },
    })),
  setFrameGap: (gap, frames) =>
    set((state) => ({
      project: {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, gap, frames } : page
        )),
      },
      editor: { ...state.editor, dirty: true },
    })),
  setTemplateFrames: (templateId, frames) =>
    set((state) => ({
      project: {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, templateId, frames } : page
        )),
      },
      editor: {
        ...state.editor,
        selectedFrameId: frames[0].id,
        cropMode: false,
        arrangeMode: false,
        dirty: true,
      },
    })),
  addFrame: (frame) =>
    set((state) => ({
      project: {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId
            ? { ...page, templateId: 'freeform', frames: [...page.frames, frame] }
            : page
        )),
      },
      editor: {
        ...state.editor,
        selectedFrameId: frame.id,
        cropMode: false,
        arrangeMode: true,
        dirty: true,
      },
    })),
  updateFrameGeometry: (frameId, geometry) =>
    set((state) => ({
      project: {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => ({
          ...page,
          templateId: page.frames.some((frame) => frame.id === frameId)
            ? 'freeform'
            : page.templateId,
          frames: page.frames.map((frame) => (
            frame.id === frameId ? { ...frame, ...geometry } : frame
          )),
        })),
      },
      editor: { ...state.editor, dirty: true },
    })),
  assignImages: (assignments) =>
    set((state) => {
      const pathsByFrame = new Map(assignments.map(({ frameId, sourcePath }) => [frameId, sourcePath]))
      const nextRevisions = { ...state.editor.imageLoadRevisions }
      assignments.forEach(({ frameId }) => {
        nextRevisions[frameId] = (nextRevisions[frameId] ?? 0) + 1
      })
      return {
        project: {
          ...state.project,
          updatedAt: new Date().toISOString(),
          pages: state.project.pages.map((page) => ({
            ...page,
            frames: page.frames.map((frame) => {
              const sourcePath = pathsByFrame.get(frame.id)
              return sourcePath ? {
                ...frame,
                image: {
                  sourcePath,
                  naturalWidth: 0,
                  naturalHeight: 0,
                  transform: createDefaultTransform(),
                  filters: createDefaultFilters(),
                },
              } : frame
            }),
          })),
        },
        editor: {
          ...state.editor,
          selectedFrameId: assignments[0]?.frameId ?? state.editor.selectedFrameId,
          cropMode: false,
          dirty: true,
          imageLoadRevisions: nextRevisions,
        },
      }
    }),
  chooseImage: (frameId, sourcePath) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, (currentImage) => ({
        sourcePath,
        naturalWidth: 0,
        naturalHeight: 0,
        transform: currentImage?.transform ?? createDefaultTransform(),
        filters: currentImage?.filters ?? createDefaultFilters(),
      })),
      editor: {
        ...state.editor,
        selectedFrameId: frameId,
        cropMode: false,
        dirty: true,
        imageLoadRevisions: {
          ...state.editor.imageLoadRevisions,
          [frameId]: (state.editor.imageLoadRevisions[frameId] ?? 0) + 1,
        },
      },
    })),
  setLoadedImage: (frameId, naturalWidth, naturalHeight, transform) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        naturalWidth,
        naturalHeight,
        transform,
      } : null),
      editor: { ...state.editor, dirty: true },
    })),
  updateImageTransform: (frameId, transform) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        transform: { ...image.transform, ...transform },
      } : null),
      editor: { ...state.editor, dirty: true },
    })),
  updateImageFilters: (frameId, filters) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        filters: { ...image.filters, ...filters },
      } : null),
      editor: { ...state.editor, dirty: true },
    })),
  resetImage: (frameId, transform) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        transform,
        filters: createDefaultFilters(),
      } : null),
      editor: { ...state.editor, dirty: true, cropMode: false },
    })),
  resetProject: () =>
    set(() => {
      const project = createNewProject()
      return {
        project,
        editor: {
          selectedFrameId: firstFrameId(project),
          cropMode: false,
          arrangeMode: false,
          projectPath: null,
          dirty: false,
          imageLoadRevisions: {},
        },
      }
    }),
  loadProject: (project, projectPath) =>
    set(() => ({
      project,
      editor: {
        selectedFrameId: firstFrameId(project),
        cropMode: false,
        arrangeMode: false,
        projectPath,
        dirty: false,
        imageLoadRevisions: Object.fromEntries(
          project.pages.flatMap((page) => page.frames.map((frame) => [frame.id, 1])),
        ),
      },
    })),
  markSaved: (projectPath) =>
    set((state) => ({ editor: { ...state.editor, projectPath, dirty: false } })),
}))
