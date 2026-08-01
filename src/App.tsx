import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Canvas,
  FabricImage,
  Rect,
  filters,
} from 'fabric'
import { open, save, confirm as confirmDialog } from '@tauri-apps/plugin-dialog'
import { readFile, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { constrainImageTransform, minimumCoverScale, nearlyEqual } from './lib/canvasMath'
import { useProjectStore } from './store/projectStore'
import {
  createDefaultTransform,
  parseProjectFile,
  type CollageFrame,
  type ImageFilters,
  type ImageTransform,
} from './types/project'
import './App.css'

type IconName =
  | 'add-photo'
  | 'chevron'
  | 'crop'
  | 'export'
  | 'folder'
  | 'image'
  | 'reset'
  | 'save'

type Notice = {
  kind: 'success' | 'error'
  message: string
} | null

const roundTransform = (transform: ImageTransform): ImageTransform => ({
  ...transform,
  offsetX: Number(transform.offsetX.toFixed(3)),
  offsetY: Number(transform.offsetY.toFixed(3)),
  scale: Number(transform.scale.toFixed(6)),
  rotation: Number(transform.rotation.toFixed(2)),
})

const transformsMatch = (left: ImageTransform, right: ImageTransform) => (
  nearlyEqual(left.offsetX, right.offsetX) &&
  nearlyEqual(left.offsetY, right.offsetY) &&
  nearlyEqual(left.scale, right.scale, 0.000001) &&
  nearlyEqual(left.rotation, right.rotation) &&
  left.flipX === right.flipX &&
  left.flipY === right.flipY &&
  nearlyEqual(left.opacity, right.opacity)
)

const dataUrlToBytes = (dataUrl: string) => {
  const encoded = dataUrl.split(',')[1]
  if (!encoded) throw new Error('The exported canvas was empty.')
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const frameClipPath = (frame: CollageFrame) => new Rect({
  left: frame.x,
  top: frame.y,
  width: frame.width,
  height: frame.height,
  rx: frame.cornerRadius,
  ry: frame.cornerRadius,
  originX: 'left',
  originY: 'top',
  absolutePositioned: true,
})

const createFrameObject = (frame: CollageFrame) => new Rect({
  left: frame.x,
  top: frame.y,
  width: frame.width,
  height: frame.height,
  rx: frame.cornerRadius,
  ry: frame.cornerRadius,
  originX: 'left',
  originY: 'top',
  fill: 'rgba(255,255,255,0.001)',
  stroke: '#60a5fa',
  strokeWidth: 5,
  strokeUniform: true,
  selectable: true,
  evented: true,
  hasControls: false,
  hasBorders: false,
  hoverCursor: 'pointer',
  moveCursor: 'pointer',
  lockMovementX: true,
  lockMovementY: true,
})

const applyFabricFilters = (image: FabricImage, adjustments: ImageFilters) => {
  image.filters = [
    new filters.Brightness({ brightness: adjustments.brightness / 100 }),
    new filters.Contrast({ contrast: adjustments.contrast / 100 }),
    new filters.Saturation({ saturation: adjustments.saturation / 100 }),
  ]
  image.applyFilters()
}

const Icon = ({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) => {
  const paths: Record<IconName, React.ReactNode> = {
    'add-photo': <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5v1" /><path d="m4 13 2.6-2.8a1 1 0 0 1 1.45-.02L10 12l1-1" /><path d="M7 7.5h.01" /><path d="M14.5 10v5M12 12.5h5" /><path d="M10.5 16H5.5A1.5 1.5 0 0 1 4 14.5v-9" /></>,
    chevron: <path d="m7 4 4 4-4 4" />,
    crop: <><path d="M5 2v9a2 2 0 0 0 2 2h9" /><path d="M2 5h9a2 2 0 0 1 2 2v9" /></>,
    export: <><path d="M8 11V2" /><path d="m4.5 5.5 3.5-3.5 3.5 3.5" /><path d="M3 9.5v4A1.5 1.5 0 0 0 4.5 15h7A1.5 1.5 0 0 0 13 13.5v-4" /></>,
    folder: <><path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h3l1.5 1.7H14A1.5 1.5 0 0 1 15.5 6.7v5.8A1.5 1.5 0 0 1 14 14H4a1.5 1.5 0 0 1-1.5-1.5Z" /></>,
    image: <><rect x="2.5" y="3" width="13" height="11" rx="1.5" /><circle cx="6.3" cy="6.7" r="1.2" /><path d="m3 12 3.3-3.3a1 1 0 0 1 1.4 0l1.8 1.8 1.1-1.1a1 1 0 0 1 1.4 0l3 3" /></>,
    reset: <><path d="M3 5v4h4" /><path d="M4.2 11.6A6 6 0 1 0 3 8.7" /></>,
    save: <><path d="M3 2.5h9l2 2v10H3z" /><path d="M5.5 2.5v4h5v-4M5.5 14v-4.5h6V14" /></>,
  }

  return (
    <svg className={className} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

interface RangeControlProps {
  label: string
  value: number
  displayValue: string
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number) => void
}

const RangeControl = ({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  disabled,
  onChange,
}: RangeControlProps) => (
  <label className={`block ${disabled ? 'opacity-40' : ''}`}>
    <span className="mb-2 flex items-center justify-between text-xs text-zinc-400">
      <span>{label}</span>
      <span className="min-w-12 rounded bg-zinc-800 px-1.5 py-0.5 text-right font-mono text-[11px] text-zinc-300">
        {displayValue}
      </span>
    </span>
    <input
      className="editor-range w-full"
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
)

function App() {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const frameObjectRef = useRef<Rect | null>(null)
  const clipPathRef = useRef<Rect | null>(null)
  const imageObjectRef = useRef<FabricImage | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [isLoadingImage, setIsLoadingImage] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const project = useProjectStore((state) => state.project)
  const editor = useProjectStore((state) => state.editor)
  const selectFrame = useProjectStore((state) => state.selectFrame)
  const setCropMode = useProjectStore((state) => state.setCropMode)
  const setBackgroundColor = useProjectStore((state) => state.setBackgroundColor)
  const chooseImage = useProjectStore((state) => state.chooseImage)
  const setLoadedImage = useProjectStore((state) => state.setLoadedImage)
  const updateImageTransform = useProjectStore((state) => state.updateImageTransform)
  const updateImageFilters = useProjectStore((state) => state.updateImageFilters)
  const resetImage = useProjectStore((state) => state.resetImage)
  const resetProject = useProjectStore((state) => state.resetProject)
  const loadProject = useProjectStore((state) => state.loadProject)
  const markSaved = useProjectStore((state) => state.markSaved)

  const page = project.pages.find((candidate) => candidate.id === project.activePageId) ?? project.pages[0]
  const frame = page.frames.find((candidate) => candidate.id === editor.selectedFrameId) ?? page.frames[0]
  const placedImage = frame.image
  const placedImageSourcePath = placedImage?.sourcePath ?? null
  const placedFilters = placedImage?.filters ?? null

  const showError = useCallback((error: unknown) => {
    setNotice({ kind: 'error', message: errorMessage(error) })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    const element = canvasElementRef.current
    if (!element) return

    const state = useProjectStore.getState()
    const initialPage = state.project.pages.find(
      (candidate) => candidate.id === state.project.activePageId,
    ) ?? state.project.pages[0]
    const initialFrame = initialPage.frames[0]
    const canvas = new Canvas(element, {
      width: initialPage.width,
      height: initialPage.height,
      backgroundColor: initialPage.backgroundColor,
      selection: false,
      preserveObjectStacking: true,
      renderOnAddRemove: true,
    })
    const frameObject = createFrameObject(initialFrame)

    canvas.add(frameObject)
    canvas.setActiveObject(frameObject)
    canvasRef.current = canvas
    frameObjectRef.current = frameObject

    canvas.on('mouse:down', (event) => {
      if (event.target !== frameObjectRef.current) return
      const currentFrame = useProjectStore.getState().project.pages
        .flatMap((currentPage) => currentPage.frames)
        .find((candidate) => candidate.id === useProjectStore.getState().editor.selectedFrameId)
      if (currentFrame) selectFrame(currentFrame.id)
    })

    canvas.on('mouse:dblclick', (event) => {
      if (event.target !== frameObjectRef.current) return
      const currentState = useProjectStore.getState()
      const currentFrame = currentState.project.pages
        .flatMap((currentPage) => currentPage.frames)
        .find((candidate) => candidate.id === currentState.editor.selectedFrameId)
      if (currentFrame?.image) setCropMode(true)
    })

    canvas.on('object:moving', (event) => {
      if (event.target !== imageObjectRef.current) return
      const currentState = useProjectStore.getState()
      if (!currentState.editor.cropMode) return
      const currentPage = currentState.project.pages.find(
        (candidate) => candidate.id === currentState.project.activePageId,
      ) ?? currentState.project.pages[0]
      const currentFrame = currentPage.frames.find(
        (candidate) => candidate.id === currentState.editor.selectedFrameId,
      ) ?? currentPage.frames[0]
      if (!currentFrame.image) return

      const imageObject = imageObjectRef.current
      const tentative = {
        ...currentFrame.image.transform,
        offsetX: (imageObject?.left ?? currentFrame.x + currentFrame.width / 2) - (currentFrame.x + currentFrame.width / 2),
        offsetY: (imageObject?.top ?? currentFrame.y + currentFrame.height / 2) - (currentFrame.y + currentFrame.height / 2),
      }
      const safe = roundTransform(constrainImageTransform(
        currentFrame,
        currentFrame.image.naturalWidth,
        currentFrame.image.naturalHeight,
        tentative,
      ))

      imageObject?.set({
        left: currentFrame.x + currentFrame.width / 2 + safe.offsetX,
        top: currentFrame.y + currentFrame.height / 2 + safe.offsetY,
      })
      imageObject?.setCoords()
      updateImageTransform(currentFrame.id, safe)
    })

    canvas.on('mouse:wheel', (event) => {
      if (!(event.e instanceof WheelEvent)) return
      const currentState = useProjectStore.getState()
      if (!currentState.editor.cropMode) return
      const currentPage = currentState.project.pages.find(
        (candidate) => candidate.id === currentState.project.activePageId,
      ) ?? currentState.project.pages[0]
      const currentFrame = currentPage.frames.find(
        (candidate) => candidate.id === currentState.editor.selectedFrameId,
      ) ?? currentPage.frames[0]
      if (!currentFrame.image) return

      event.e.preventDefault()
      event.e.stopPropagation()
      const minScale = minimumCoverScale(
        currentFrame,
        currentFrame.image.naturalWidth,
        currentFrame.image.naturalHeight,
        currentFrame.image.transform.rotation,
      )
      const factor = event.e.deltaY < 0 ? 1.08 : 0.92
      const requestedScale = Math.min(
        Math.max(currentFrame.image.transform.scale * factor, minScale),
        minScale * 8,
      )
      const safe = roundTransform(constrainImageTransform(
        currentFrame,
        currentFrame.image.naturalWidth,
        currentFrame.image.naturalHeight,
        { ...currentFrame.image.transform, scale: requestedScale },
      ))
      updateImageTransform(currentFrame.id, safe)
    })

    return () => {
      imageObjectRef.current?.dispose()
      imageObjectRef.current = null
      frameObjectRef.current = null
      clipPathRef.current = null
      canvasRef.current = null
      canvas.dispose()
    }
  }, [selectFrame, setCropMode, updateImageTransform])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCropMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCropMode])

  useEffect(() => {
    const canvas = canvasRef.current
    const frameObject = frameObjectRef.current
    if (!canvas || !frameObject) return

    canvas.setDimensions({ width: page.width, height: page.height })
    canvas.backgroundColor = page.backgroundColor
    frameObject.set({
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      rx: frame.cornerRadius,
      ry: frame.cornerRadius,
      stroke: editor.cropMode ? '#fbbf24' : '#60a5fa',
      strokeWidth: editor.cropMode ? 6 : 5,
      selectable: !editor.cropMode,
      evented: !editor.cropMode,
      visible: true,
    })
    frameObject.setCoords()

    const clipPath = clipPathRef.current ?? frameClipPath(frame)
    clipPath.set({
      left: frame.x,
      top: frame.y,
      width: frame.width,
      height: frame.height,
      rx: frame.cornerRadius,
      ry: frame.cornerRadius,
    })
    clipPathRef.current = clipPath

    const imageObject = imageObjectRef.current
    if (imageObject) {
      imageObject.clipPath = clipPath
      imageObject.set({
        selectable: editor.cropMode,
        evented: editor.cropMode,
        hoverCursor: editor.cropMode ? 'grab' : 'default',
        moveCursor: 'grabbing',
      })
      imageObject.setCoords()
    }

    if (editor.cropMode && imageObject) {
      canvas.setActiveObject(imageObject)
    } else {
      canvas.setActiveObject(frameObject)
    }
    canvas.requestRenderAll()
  }, [editor.cropMode, frame, page.backgroundColor, page.height, page.width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (!placedImageSourcePath) {
      if (imageObjectRef.current) {
        canvas.remove(imageObjectRef.current)
        imageObjectRef.current.dispose()
        imageObjectRef.current = null
      }
      setIsLoadingImage(false)
      canvas.requestRenderAll()
      return
    }

    let cancelled = false
    const sourcePath = placedImageSourcePath

    if (imageObjectRef.current) {
      canvas.remove(imageObjectRef.current)
      imageObjectRef.current.dispose()
      imageObjectRef.current = null
      canvas.requestRenderAll()
    }

    const loadSourceImage = async () => {
      setIsLoadingImage(true)
      try {
        const bytes = await readFile(sourcePath)
        if (cancelled) return
        const blob = new Blob([bytes])
        const objectUrl = URL.createObjectURL(blob)
        let loaded: FabricImage
        try {
          loaded = await FabricImage.fromURL(objectUrl)
        } finally {
          URL.revokeObjectURL(objectUrl)
        }
        if (cancelled) {
          loaded.dispose()
          return
        }

        const latestState = useProjectStore.getState()
        const latestPage = latestState.project.pages.find(
          (candidate) => candidate.id === latestState.project.activePageId,
        ) ?? latestState.project.pages[0]
        const latestFrame = latestPage.frames.find(
          (candidate) => candidate.id === latestState.editor.selectedFrameId,
        ) ?? latestPage.frames[0]
        if (!latestFrame.image || latestFrame.image.sourcePath !== sourcePath) {
          loaded.dispose()
          return
        }

        const originalSize = loaded.getOriginalSize()
        const naturalWidth = Number(originalSize.width) || 1
        const naturalHeight = Number(originalSize.height) || 1
        const needsInitialCrop = latestFrame.image.naturalWidth <= 0 || latestFrame.image.naturalHeight <= 0
        const requestedTransform = needsInitialCrop
          ? {
              ...createDefaultTransform(),
              scale: minimumCoverScale(latestFrame, naturalWidth, naturalHeight, 0),
            }
          : latestFrame.image.transform
        const safeTransform = roundTransform(constrainImageTransform(
          latestFrame,
          naturalWidth,
          naturalHeight,
          requestedTransform,
        ))

        if (imageObjectRef.current) {
          canvas.remove(imageObjectRef.current)
          imageObjectRef.current.dispose()
        }
        loaded.set({
          left: latestFrame.x + latestFrame.width / 2 + safeTransform.offsetX,
          top: latestFrame.y + latestFrame.height / 2 + safeTransform.offsetY,
          originX: 'center',
          originY: 'center',
          scaleX: safeTransform.scale,
          scaleY: safeTransform.scale,
          angle: safeTransform.rotation,
          flipX: safeTransform.flipX,
          flipY: safeTransform.flipY,
          opacity: safeTransform.opacity,
          selectable: latestState.editor.cropMode,
          evented: latestState.editor.cropMode,
          hasControls: false,
          hasBorders: false,
          centeredRotation: true,
          lockScalingX: true,
          lockScalingY: true,
          lockRotation: true,
          clipPath: clipPathRef.current ?? frameClipPath(latestFrame),
        })
        applyFabricFilters(loaded, latestFrame.image.filters)
        loaded.setCoords()
        if (!clipPathRef.current) clipPathRef.current = loaded.clipPath as Rect
        canvas.add(loaded)
        canvas.sendObjectToBack(loaded)
        imageObjectRef.current = loaded
        if (latestState.editor.cropMode) {
          canvas.setActiveObject(loaded)
        } else if (frameObjectRef.current) {
          canvas.setActiveObject(frameObjectRef.current)
        }

        if (
          naturalWidth !== latestFrame.image.naturalWidth ||
          naturalHeight !== latestFrame.image.naturalHeight ||
          !transformsMatch(safeTransform, latestFrame.image.transform)
        ) {
          setLoadedImage(latestFrame.id, naturalWidth, naturalHeight, safeTransform)
        }
        setIsLoadingImage(false)
        canvas.requestRenderAll()
      } catch (error) {
        if (!cancelled) {
          setIsLoadingImage(false)
          showError(`Could not load the source photo. ${errorMessage(error)}`)
        }
      }
    }

    void loadSourceImage()
    return () => {
      cancelled = true
    }
  }, [editor.imageLoadRevision, placedImageSourcePath, setLoadedImage, showError])

  useEffect(() => {
    const canvas = canvasRef.current
    const imageObject = imageObjectRef.current
    if (!canvas || !imageObject || !placedImage) return

    const safe = constrainImageTransform(
      frame,
      placedImage.naturalWidth,
      placedImage.naturalHeight,
      placedImage.transform,
    )
    imageObject.set({
      left: frame.x + frame.width / 2 + safe.offsetX,
      top: frame.y + frame.height / 2 + safe.offsetY,
      scaleX: safe.scale,
      scaleY: safe.scale,
      angle: safe.rotation,
      flipX: safe.flipX,
      flipY: safe.flipY,
      opacity: safe.opacity,
    })
    imageObject.setCoords()
    if (!transformsMatch(safe, placedImage.transform)) {
      updateImageTransform(frame.id, roundTransform(safe))
    }
    canvas.requestRenderAll()
  }, [frame, placedImage, placedImage?.transform, updateImageTransform])

  useEffect(() => {
    const canvas = canvasRef.current
    const imageObject = imageObjectRef.current
    if (!canvas || !imageObject || !placedFilters) return
    applyFabricFilters(imageObject, placedFilters)
    canvas.requestRenderAll()
  }, [placedFilters])

  const handleChooseImage = async () => {
    try {
      const selected = await open({
        title: 'Choose a photo',
        multiple: false,
        fileAccessMode: 'scoped',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      })
      if (typeof selected === 'string') chooseImage(frame.id, selected)
    } catch (error) {
      showError(error)
    }
  }

  const handleSaveProject = useCallback(async () => {
    try {
      let path = useProjectStore.getState().editor.projectPath
      if (!path) {
        path = await save({
          title: 'Save collage project',
          defaultPath: 'Untitled.collage.json',
          filters: [{ name: 'Collage project', extensions: ['json'] }],
        })
      }
      if (!path) return
      const projectToSave = useProjectStore.getState().project
      await writeTextFile(path, JSON.stringify(projectToSave, null, 2))
      markSaved(path)
      setNotice({ kind: 'success', message: 'Project saved on this device.' })
    } catch (error) {
      showError(error)
    }
  }, [markSaved, showError])

  const handleOpenProject = async () => {
    try {
      if (useProjectStore.getState().editor.dirty) {
        const discardChanges = await confirmDialog(
          'Open another project and discard the current unsaved changes?',
          { title: 'Unsaved changes', kind: 'warning' },
        )
        if (!discardChanges) return
      }
      const selected = await open({
        title: 'Open collage project',
        multiple: false,
        fileAccessMode: 'scoped',
        filters: [{ name: 'Collage project', extensions: ['json'] }],
      })
      if (typeof selected !== 'string') return
      const content = await readTextFile(selected)
      const nextProject = parseProjectFile(JSON.parse(content) as unknown)
      loadProject(nextProject, selected)
      setNotice({ kind: 'success', message: 'Project opened.' })
    } catch (error) {
      showError(error)
    }
  }

  const handleResetImage = () => {
    if (!placedImage) return
    const transform = {
      ...createDefaultTransform(),
      scale: minimumCoverScale(frame, placedImage.naturalWidth, placedImage.naturalHeight, 0),
    }
    resetImage(frame.id, roundTransform(transform))
  }

  const handleResetProject = async () => {
    try {
      const accepted = await confirmDialog(
        'Reset the complete project? Your original photo will not be changed.',
        { title: 'Reset project', kind: 'warning' },
      )
      if (accepted) resetProject()
    } catch (error) {
      showError(error)
    }
  }

  const handleExportPng = async () => {
    const canvas = canvasRef.current
    const frameObject = frameObjectRef.current
    if (!canvas || !frameObject) return

    try {
      const path = await save({
        title: 'Export PNG',
        defaultPath: `${project.name || 'Instagram collage'}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      })
      if (!path) return
      setIsExporting(true)

      const wasVisible = frameObject.visible
      frameObject.set({ visible: false })
      canvas.discardActiveObject()
      canvas.renderAll()
      const multiplier = project.exportSettings.width / page.width
      const dataUrl = canvas.toDataURL({ format: 'png', multiplier })
      frameObject.set({ visible: wasVisible })
      if (editor.cropMode && imageObjectRef.current) {
        canvas.setActiveObject(imageObjectRef.current)
      } else {
        canvas.setActiveObject(frameObject)
      }
      canvas.requestRenderAll()

      await writeFile(path, dataUrlToBytes(dataUrl))
      setNotice({
        kind: 'success',
        message: `PNG exported at ${project.exportSettings.width} × ${project.exportSettings.height}.`,
      })
    } catch (error) {
      frameObject.set({ visible: true })
      canvas.requestRenderAll()
      showError(error)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSaveProject()
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [handleSaveProject])

  const minScale = placedImage
    ? minimumCoverScale(
        frame,
        placedImage.naturalWidth,
        placedImage.naturalHeight,
        placedImage.transform.rotation,
      )
    : 1
  const zoomPercent = placedImage ? Math.round(placedImage.transform.scale / minScale * 100) : 100
  const currentFilters = placedImage?.filters
  const projectFileName = useMemo(() => {
    if (!editor.projectPath) return 'Not saved yet'
    return editor.projectPath.split(/[\\/]/).pop() ?? editor.projectPath
  }, [editor.projectPath])

  const setSafeTransform = (next: ImageTransform) => {
    if (!placedImage) return
    const safe = constrainImageTransform(
      frame,
      placedImage.naturalWidth,
      placedImage.naturalHeight,
      next,
    )
    updateImageTransform(frame.id, roundTransform(safe))
  }

  const updateFilter = (filters: Partial<ImageFilters>) => {
    if (placedImage) updateImageFilters(frame.id, filters)
  }

  return (
    <div className="h-screen min-h-[680px] min-w-[1080px] overflow-hidden bg-[#17181a] text-zinc-100">
      <main className="grid h-full grid-cols-[240px_minmax(540px,1fr)_292px]">
        <aside className="flex min-h-0 flex-col border-r border-white/[0.07] bg-[#1c1d20]">
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] px-5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500 text-white shadow-sm shadow-black/30">
              <Icon name="image" className="h-[18px] w-[18px]" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-tight">Collage Studio</h1>
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">Local editor</p>
            </div>
          </div>

          <div className="border-b border-white/[0.07] p-3">
            <div className="grid grid-cols-2 gap-2">
              <button className="secondary-button" type="button" onClick={() => void handleOpenProject()}>
                <Icon name="folder" /> Open
              </button>
              <button className="secondary-button" type="button" onClick={() => void handleSaveProject()}>
                <Icon name="save" /> Save
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Photos</h2>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">1 frame</span>
            </div>

            <button
              className="group flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 px-4 py-7 text-center transition-colors hover:border-blue-500/70 hover:bg-blue-500/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              type="button"
              onClick={() => void handleChooseImage()}
            >
              <span className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-zinc-800 text-zinc-400 group-hover:text-blue-400">
                <Icon name="add-photo" className="h-[18px] w-[18px]" />
              </span>
              <span className="text-xs font-medium text-zinc-300">
                {placedImage ? 'Replace photo' : 'Select a photo'}
              </span>
              <span className="mt-1 text-[10px] leading-4 text-zinc-600">JPEG, PNG or WebP</span>
            </button>

            {placedImage && (
              <div className="mt-3 rounded-lg border border-white/[0.07] bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded bg-zinc-800 text-blue-400">
                    <Icon name="image" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs text-zinc-300">
                      {placedImage.sourcePath.split(/[\\/]/).pop()}
                    </p>
                    <p className="mt-0.5 text-[10px] text-zinc-600">
                      {placedImage.naturalWidth > 0
                        ? `${placedImage.naturalWidth} × ${placedImage.naturalHeight}`
                        : 'Loading source…'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.07] p-4">
            <p className="mb-1 flex items-center gap-2 text-[11px] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${editor.dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              {editor.dirty ? 'Unsaved changes' : 'All changes saved'}
            </p>
            <p className="truncate pl-3.5 text-[10px] text-zinc-600" title={editor.projectPath ?? undefined}>
              {projectFileName}
            </p>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col bg-[#151618]">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#1b1c1f] px-4">
            <div className="flex items-center gap-2">
              <button
                className={`toolbar-button ${editor.cropMode ? 'toolbar-button-active' : ''}`}
                type="button"
                disabled={!placedImage}
                onClick={() => setCropMode(!editor.cropMode)}
              >
                <Icon name="crop" />
                {editor.cropMode ? 'Finish crop' : 'Crop photo'}
              </button>
              <span className="hidden text-[11px] text-zinc-600 xl:inline">
                {editor.cropMode ? 'Drag to reposition · Scroll to zoom · Esc to finish' : 'Double-click the frame to crop'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="toolbar-button" type="button" onClick={() => void handleResetProject()}>
                <Icon name="reset" /> Reset project
              </button>
              <span className="mx-1 h-5 w-px bg-white/[0.08]" />
              <button
                className="primary-button"
                type="button"
                disabled={isExporting}
                onClick={() => void handleExportPng()}
              >
                <Icon name="export" /> {isExporting ? 'Exporting…' : 'Export PNG'}
              </button>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-7">
            <div className="canvas-stage relative max-h-full max-w-full shadow-2xl shadow-black/50">
              <canvas ref={canvasElementRef} />
              {!placedImage && !isLoadingImage && (
                <button
                  className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl bg-black/55 px-7 py-5 text-zinc-300 backdrop-blur-sm hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  type="button"
                  onClick={() => void handleChooseImage()}
                >
                  <Icon name="add-photo" className="mb-2 h-6 w-6 text-blue-400" />
                  <span className="text-xs font-medium">Place a photo</span>
                  <span className="mt-1 whitespace-nowrap text-[10px] text-zinc-500">Full resolution stays on your device</span>
                </button>
              )}
              {isLoadingImage && (
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/70 px-4 py-2 text-xs text-zinc-300">
                  Loading full-resolution photo…
                </div>
              )}
              {editor.cropMode && (
                <span className="pointer-events-none absolute left-3 top-3 rounded bg-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-950">
                  Crop mode
                </span>
              )}
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-white/[0.06] bg-[#1d1e21] px-2.5 py-1 text-[10px] text-zinc-500 shadow-md">
              Portrait · 1080 × 1350 px
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-white/[0.07] bg-[#1c1d20]">
          <div className="flex h-16 shrink-0 items-center border-b border-white/[0.07] px-5">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Frame inspector</h2>
              <p className="mt-0.5 text-[10px] text-zinc-600">Single frame selected</p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="inspector-section">
              <h3 className="inspector-heading">Canvas</h3>
              <label className="flex items-center justify-between text-xs text-zinc-400">
                <span>Background</span>
                <span className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-zinc-900 p-1 pr-2 font-mono text-[10px] text-zinc-500">
                  <input
                    className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                    type="color"
                    value={page.backgroundColor}
                    onChange={(event) => setBackgroundColor(event.target.value)}
                  />
                  {page.backgroundColor.toUpperCase()}
                </span>
              </label>
            </section>

            <section className="inspector-section space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="inspector-heading mb-0">Crop</h3>
                <button
                  className="text-[10px] text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
                  type="button"
                  disabled={!placedImage}
                  onClick={handleResetImage}
                >
                  Reset
                </button>
              </div>
              <RangeControl
                label="Zoom"
                value={zoomPercent}
                displayValue={`${zoomPercent}%`}
                min={100}
                max={800}
                step={1}
                disabled={!placedImage}
                onChange={(value) => {
                  if (!placedImage) return
                  setSafeTransform({ ...placedImage.transform, scale: minScale * value / 100 })
                }}
              />
              <RangeControl
                label="Rotation"
                value={placedImage?.transform.rotation ?? 0}
                displayValue={`${Math.round(placedImage?.transform.rotation ?? 0)}°`}
                min={-180}
                max={180}
                step={1}
                disabled={!placedImage}
                onChange={(rotation) => {
                  if (!placedImage) return
                  setSafeTransform({ ...placedImage.transform, rotation })
                }}
              />
              <button
                className={`w-full rounded-md border px-3 py-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  editor.cropMode
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15'
                    : 'border-white/[0.08] bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800'
                }`}
                type="button"
                disabled={!placedImage}
                onClick={() => setCropMode(!editor.cropMode)}
              >
                {editor.cropMode ? 'Finish crop mode' : 'Enter crop mode'}
              </button>
            </section>

            <section className="inspector-section space-y-5">
              <h3 className="inspector-heading">Adjustments</h3>
              <RangeControl
                label="Brightness"
                value={currentFilters?.brightness ?? 0}
                displayValue={String(currentFilters?.brightness ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!placedImage}
                onChange={(brightness) => updateFilter({ brightness })}
              />
              <RangeControl
                label="Contrast"
                value={currentFilters?.contrast ?? 0}
                displayValue={String(currentFilters?.contrast ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!placedImage}
                onChange={(contrast) => updateFilter({ contrast })}
              />
              <RangeControl
                label="Saturation"
                value={currentFilters?.saturation ?? 0}
                displayValue={String(currentFilters?.saturation ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!placedImage}
                onChange={(saturation) => updateFilter({ saturation })}
              />
            </section>
          </div>

          <div className="border-t border-white/[0.07] p-4">
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-zinc-900/40 px-3 py-2.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={!placedImage}
              onClick={handleResetImage}
            >
              <span className="flex items-center gap-2"><Icon name="reset" /> Reset selected image</span>
              <Icon name="chevron" className="h-3 w-3" />
            </button>
          </div>
        </aside>
      </main>

      {notice && (
        <div
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-xs shadow-xl ${
            notice.kind === 'error'
              ? 'border-red-400/25 bg-red-950 text-red-200'
              : 'border-emerald-400/20 bg-emerald-950 text-emerald-200'
          }`}
          role="status"
        >
          {notice.message}
        </div>
      )}
    </div>
  )
}

export default App
