import { create } from 'zustand'
import {
  createDefaultFilters,
  createDefaultTransform,
  createNewProject,
  type CollageProject,
  type FrameImage,
  type ImageFilters,
  type ImageTransform,
} from '../types/project'

interface EditorState {
  selectedFrameId: string
  cropMode: boolean
  projectPath: string | null
  dirty: boolean
  imageLoadRevision: number
}

interface ProjectStore {
  project: CollageProject
  editor: EditorState
  selectFrame: (frameId: string) => void
  setCropMode: (cropMode: boolean) => void
  setBackgroundColor: (color: string) => void
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
    projectPath: null,
    dirty: false,
    imageLoadRevision: 0,
  },
  selectFrame: (selectedFrameId) =>
    set((state) => ({ editor: { ...state.editor, selectedFrameId } })),
  setCropMode: (cropMode) =>
    set((state) => ({ editor: { ...state.editor, cropMode } })),
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
  chooseImage: (frameId, sourcePath) =>
    set((state) => ({
      project: updateFrame(state.project, frameId, () => ({
        sourcePath,
        naturalWidth: 0,
        naturalHeight: 0,
        transform: createDefaultTransform(),
        filters: createDefaultFilters(),
      })),
      editor: {
        ...state.editor,
        selectedFrameId: frameId,
        cropMode: false,
        dirty: true,
        imageLoadRevision: state.editor.imageLoadRevision + 1,
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
          projectPath: null,
          dirty: false,
          imageLoadRevision: 0,
        },
      }
    }),
  loadProject: (project, projectPath) =>
    set((state) => ({
      project,
      editor: {
        selectedFrameId: firstFrameId(project),
        cropMode: false,
        projectPath,
        dirty: false,
        imageLoadRevision: state.editor.imageLoadRevision + 1,
      },
    })),
  markSaved: (projectPath) =>
    set((state) => ({ editor: { ...state.editor, projectPath, dirty: false } })),
}))
