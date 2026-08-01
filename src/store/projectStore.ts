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

interface HistorySnapshot {
  project: CollageProject
  selectedFrameId: string
  projectPath: string | null
}

interface HistoryState {
  past: HistorySnapshot[]
  future: HistorySnapshot[]
  transactionBase: HistorySnapshot | null
  transactionRecorded: boolean
  savedProject: CollageProject
}

interface ProjectStore {
  project: CollageProject
  editor: EditorState
  history: HistoryState
  selectFrame: (frameId: string) => void
  setCropMode: (cropMode: boolean) => void
  setArrangeMode: (arrangeMode: boolean) => void
  beginHistoryTransaction: () => void
  endHistoryTransaction: () => void
  undo: () => void
  redo: () => void
  setBackgroundColor: (color: string) => void
  setFrameGap: (gap: number, frames: CollageFrame[]) => void
  setTemplateFrames: (templateId: CollageTemplateId, frames: CollageFrame[]) => void
  addFrame: (frame: CollageFrame) => void
  updateFrameGeometry: (
    frameId: string,
    geometry: Partial<Pick<CollageFrame, 'x' | 'y' | 'width' | 'height'>>,
  ) => void
  swapFrameGeometry: (firstFrameId: string, secondFrameId: string) => void
  assignImages: (assignments: Array<{ frameId: string; sourcePath: string }>) => void
  chooseImage: (frameId: string, sourcePath: string) => void
  setLoadedImage: (
    frameId: string,
    naturalWidth: number,
    naturalHeight: number,
    transform: ImageTransform,
  ) => void
  updateImageTransform: (
    frameId: string,
    transform: Partial<ImageTransform>,
    options?: { recordHistory?: boolean },
  ) => void
  updateImageFilters: (frameId: string, filters: Partial<ImageFilters>) => void
  resetImage: (frameId: string, transform: ImageTransform) => void
  resetProject: () => void
  loadProject: (project: CollageProject, path: string) => void
  markSaved: (path: string) => void
}

const HISTORY_LIMIT = 100

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

const projectHasFrame = (project: CollageProject, frameId: string) =>
  project.pages.some((page) => page.frames.some((frame) => frame.id === frameId))

const createSnapshot = (
  state: Pick<ProjectStore, 'project' | 'editor'>,
): HistorySnapshot => ({
  project: state.project,
  selectedFrameId: state.editor.selectedFrameId,
  projectPath: state.editor.projectPath,
})

const capHistory = (snapshots: HistorySnapshot[]) =>
  snapshots.length > HISTORY_LIMIT ? snapshots.slice(-HISTORY_LIMIT) : snapshots

const trackedProjectChange = (
  state: ProjectStore,
  project: CollageProject,
  editor: EditorState,
): Pick<ProjectStore, 'project' | 'editor' | 'history'> => {
  const transactionActive = state.history.transactionBase !== null
  const shouldRecord = !transactionActive || !state.history.transactionRecorded
  const snapshot = state.history.transactionBase ?? createSnapshot(state)
  const past = shouldRecord
    ? capHistory([...state.history.past, snapshot])
    : state.history.past

  return {
    project,
    editor: {
      ...editor,
      dirty: project !== state.history.savedProject,
    },
    history: {
      ...state.history,
      past,
      future: [],
      transactionRecorded: transactionActive,
    },
  }
}

const untrackedProjectChange = (
  state: ProjectStore,
  project: CollageProject,
  editor: EditorState,
): Pick<ProjectStore, 'project' | 'editor'> => ({
  project,
  editor: {
    ...editor,
    dirty: project !== state.history.savedProject,
  },
})

const restoreSnapshot = (
  state: ProjectStore,
  snapshot: HistorySnapshot,
): Pick<ProjectStore, 'project' | 'editor'> => ({
  project: snapshot.project,
  editor: {
    ...state.editor,
    selectedFrameId: projectHasFrame(snapshot.project, snapshot.selectedFrameId)
      ? snapshot.selectedFrameId
      : firstFrameId(snapshot.project),
    cropMode: false,
    arrangeMode: false,
    projectPath: snapshot.projectPath,
    dirty: snapshot.project !== state.history.savedProject,
  },
})

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
  history: {
    past: [],
    future: [],
    transactionBase: null,
    transactionRecorded: false,
    savedProject: freshProject,
  },
  selectFrame: (selectedFrameId) =>
    set((state) => ({ editor: { ...state.editor, selectedFrameId } })),
  setCropMode: (cropMode) =>
    set((state) => ({ editor: { ...state.editor, cropMode, arrangeMode: false } })),
  setArrangeMode: (arrangeMode) =>
    set((state) => ({ editor: { ...state.editor, arrangeMode, cropMode: false } })),
  beginHistoryTransaction: () =>
    set((state) => state.history.transactionBase ? state : ({
      history: {
        ...state.history,
        transactionBase: createSnapshot(state),
        transactionRecorded: false,
      },
    })),
  endHistoryTransaction: () =>
    set((state) => !state.history.transactionBase ? state : ({
      history: {
        ...state.history,
        transactionBase: null,
        transactionRecorded: false,
      },
    })),
  undo: () =>
    set((state) => {
      const snapshot = state.history.past[state.history.past.length - 1]
      if (!snapshot) return state
      const current = createSnapshot(state)
      return {
        ...restoreSnapshot(state, snapshot),
        history: {
          ...state.history,
          past: state.history.past.slice(0, -1),
          future: [current, ...state.history.future].slice(0, HISTORY_LIMIT),
          transactionBase: null,
          transactionRecorded: false,
        },
      }
    }),
  redo: () =>
    set((state) => {
      const snapshot = state.history.future[0]
      if (!snapshot) return state
      const current = createSnapshot(state)
      return {
        ...restoreSnapshot(state, snapshot),
        history: {
          ...state.history,
          past: capHistory([...state.history.past, current]),
          future: state.history.future.slice(1),
          transactionBase: null,
          transactionRecorded: false,
        },
      }
    }),
  setBackgroundColor: (backgroundColor) =>
    set((state) => {
      const activePage = state.project.pages.find((page) => page.id === state.project.activePageId)
      if (activePage?.backgroundColor === backgroundColor) return state
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, backgroundColor } : page
        )),
      }
      return trackedProjectChange(state, project, state.editor)
    }),
  setFrameGap: (gap, frames) =>
    set((state) => {
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, gap, frames } : page
        )),
      }
      return trackedProjectChange(state, project, state.editor)
    }),
  setTemplateFrames: (templateId, frames) =>
    set((state) => {
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId ? { ...page, templateId, frames } : page
        )),
      }
      return trackedProjectChange(state, project, {
        ...state.editor,
        selectedFrameId: frames[0].id,
        cropMode: false,
        arrangeMode: false,
      })
    }),
  addFrame: (frame) =>
    set((state) => {
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId
            ? { ...page, frames: [...page.frames, frame] }
            : page
        )),
      }
      return trackedProjectChange(state, project, {
        ...state.editor,
        selectedFrameId: frame.id,
        cropMode: false,
        arrangeMode: true,
      })
    }),
  updateFrameGeometry: (frameId, geometry) =>
    set((state) => {
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => ({
          ...page,
          frames: page.frames.map((frame) => (
            frame.id === frameId ? { ...frame, ...geometry } : frame
          )),
        })),
      }
      return trackedProjectChange(state, project, state.editor)
    }),
  swapFrameGeometry: (firstFrameId, secondFrameId) =>
    set((state) => {
      const activePage = state.project.pages.find(
        (page) => page.id === state.project.activePageId,
      )
      const firstFrame = activePage?.frames.find((frame) => frame.id === firstFrameId)
      const secondFrame = activePage?.frames.find((frame) => frame.id === secondFrameId)
      if (!firstFrame || !secondFrame) return state

      const firstGeometry = {
        x: firstFrame.x,
        y: firstFrame.y,
        width: firstFrame.width,
        height: firstFrame.height,
      }
      const secondGeometry = {
        x: secondFrame.x,
        y: secondFrame.y,
        width: secondFrame.width,
        height: secondFrame.height,
      }
      const project = {
        ...state.project,
        updatedAt: new Date().toISOString(),
        pages: state.project.pages.map((page) => (
          page.id === state.project.activePageId
            ? {
                ...page,
                frames: page.frames.map((frame) => {
                  if (frame.id === firstFrameId) return { ...frame, ...secondGeometry }
                  if (frame.id === secondFrameId) return { ...frame, ...firstGeometry }
                  return frame
                }),
              }
            : page
        )),
      }
      return trackedProjectChange(state, project, state.editor)
    }),
  assignImages: (assignments) =>
    set((state) => {
      if (assignments.length === 0) return state
      const pathsByFrame = new Map(assignments.map(({ frameId, sourcePath }) => [frameId, sourcePath]))
      const nextRevisions = { ...state.editor.imageLoadRevisions }
      assignments.forEach(({ frameId }) => {
        nextRevisions[frameId] = (nextRevisions[frameId] ?? 0) + 1
      })
      const project = {
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
      }
      return trackedProjectChange(state, project, {
        ...state.editor,
        selectedFrameId: assignments[0]?.frameId ?? state.editor.selectedFrameId,
        cropMode: false,
        imageLoadRevisions: nextRevisions,
      })
    }),
  chooseImage: (frameId, sourcePath) =>
    set((state) => {
      const project = updateFrame(state.project, frameId, (currentImage) => ({
        sourcePath,
        naturalWidth: 0,
        naturalHeight: 0,
        transform: currentImage?.transform ?? createDefaultTransform(),
        filters: currentImage?.filters ?? createDefaultFilters(),
      }))
      return trackedProjectChange(state, project, {
        ...state.editor,
        selectedFrameId: frameId,
        cropMode: false,
        imageLoadRevisions: {
          ...state.editor.imageLoadRevisions,
          [frameId]: (state.editor.imageLoadRevisions[frameId] ?? 0) + 1,
        },
      })
    }),
  setLoadedImage: (frameId, naturalWidth, naturalHeight, transform) =>
    set((state) => {
      const project = updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        naturalWidth,
        naturalHeight,
        transform,
      } : null)
      return untrackedProjectChange(state, project, state.editor)
    }),
  updateImageTransform: (frameId, transform, options) =>
    set((state) => {
      const currentFrame = state.project.pages
        .flatMap((page) => page.frames)
        .find((frame) => frame.id === frameId)
      if (!currentFrame?.image) return state
      const project = updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        transform: { ...image.transform, ...transform },
      } : null)
      return options?.recordHistory === false
        ? untrackedProjectChange(state, project, state.editor)
        : trackedProjectChange(state, project, state.editor)
    }),
  updateImageFilters: (frameId, filters) =>
    set((state) => {
      const currentFrame = state.project.pages
        .flatMap((page) => page.frames)
        .find((frame) => frame.id === frameId)
      if (!currentFrame?.image) return state
      const project = updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        filters: { ...image.filters, ...filters },
      } : null)
      return trackedProjectChange(state, project, state.editor)
    }),
  resetImage: (frameId, transform) =>
    set((state) => {
      const currentFrame = state.project.pages
        .flatMap((page) => page.frames)
        .find((frame) => frame.id === frameId)
      if (!currentFrame?.image) return state
      const project = updateFrame(state.project, frameId, (image) => image ? {
        ...image,
        transform,
        filters: createDefaultFilters(),
      } : null)
      return trackedProjectChange(state, project, {
        ...state.editor,
        cropMode: false,
      })
    }),
  resetProject: () =>
    set((state) => {
      const project = createNewProject()
      return trackedProjectChange(state, project, {
        selectedFrameId: firstFrameId(project),
        cropMode: false,
        arrangeMode: false,
        projectPath: null,
        dirty: true,
        imageLoadRevisions: {},
      })
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
      history: {
        past: [],
        future: [],
        transactionBase: null,
        transactionRecorded: false,
        savedProject: project,
      },
    })),
  markSaved: (projectPath) =>
    set((state) => {
      const updatePath = (snapshot: HistorySnapshot) => (
        snapshot.project.id === state.project.id
          ? { ...snapshot, projectPath }
          : snapshot
      )
      return {
        editor: { ...state.editor, projectPath, dirty: false },
        history: {
          ...state.history,
          past: state.history.past.map(updatePath),
          future: state.history.future.map(updatePath),
          transactionBase: null,
          transactionRecorded: false,
          savedProject: state.project,
        },
      }
    }),
}))
