import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Canvas, FabricImage, Line, Rect, filters } from 'fabric'
import { readFile } from '@tauri-apps/plugin-fs'
import { constrainImageTransform, minimumCoverScale, nearlyEqual } from '../lib/canvasMath'
import { useProjectStore } from '../store/projectStore'
import type { CollageFrame, ImageFilters, ImageTransform, ProjectPage } from '../types/project'

export interface CollageCanvasHandle {
  toPngDataUrl: (multiplier: number) => string
}

interface CollageCanvasProps {
  onError: (error: unknown) => void
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

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

const createClipPath = (frame: CollageFrame) => new Rect({
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

const createFrameOverlay = (frame: CollageFrame) => new Rect({
  left: frame.x,
  top: frame.y,
  width: frame.width,
  height: frame.height,
  rx: frame.cornerRadius,
  ry: frame.cornerRadius,
  originX: 'left',
  originY: 'top',
  fill: 'rgba(255,255,255,0.001)',
  stroke: 'rgba(255,255,255,0.55)',
  strokeWidth: 2,
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

const applyFilters = (image: FabricImage, adjustments: ImageFilters) => {
  image.filters = [
    new filters.Brightness({ brightness: adjustments.brightness / 100 }),
    new filters.Contrast({ contrast: adjustments.contrast / 100 }),
    new filters.Saturation({ saturation: adjustments.saturation / 100 }),
  ]
  image.applyFilters()
}

const activePageFromState = () => {
  const state = useProjectStore.getState()
  return state.project.pages.find((page) => page.id === state.project.activePageId)
    ?? state.project.pages[0]
}

const frameFromPage = (page: ProjectPage, frameId: string) =>
  page.frames.find((frame) => frame.id === frameId)

const SNAP_THRESHOLD = 18
const MIN_FRAME_SIZE = 120

interface SnapCandidate {
  value: number
  label: string
  isCanvasCenter?: boolean
  allowedAnchor?: 'start' | 'center' | 'end'
}

interface AxisSnap {
  distance: number
  start: number
  guide: number
  label: string
}

const findAxisSnap = (
  start: number,
  size: number,
  candidates: SnapCandidate[],
): AxisSnap | null => {
  const anchors = [
    { value: start, name: 'start' },
    { value: start + size / 2, name: 'center' },
    { value: start + size, name: 'end' },
  ] as const
  let best: AxisSnap | null = null
  candidates.forEach((candidate) => {
    anchors.forEach((anchor) => {
      if (candidate.allowedAnchor && candidate.allowedAnchor !== anchor.name) return
      const distance = Math.abs(candidate.value - anchor.value)
      if (distance > SNAP_THRESHOLD || (best && distance >= best.distance)) return
      const centered = candidate.isCanvasCenter && anchor.name === 'center'
      best = {
        distance,
        start: start + candidate.value - anchor.value,
        guide: candidate.value,
        label: centered ? `Centered ${candidate.label}` : `Aligned ${candidate.label}`,
      }
    })
  })
  return best
}

export const CollageCanvas = forwardRef<CollageCanvasHandle, CollageCanvasProps>(
  function CollageCanvas({ onError }, forwardedRef) {
    const canvasElementRef = useRef<HTMLCanvasElement | null>(null)
    const canvasRef = useRef<Canvas | null>(null)
    const frameObjectsRef = useRef(new Map<string, Rect>())
    const frameIdsByObjectRef = useRef(new Map<Rect, string>())
    const clipPathsRef = useRef(new Map<string, Rect>())
    const imageObjectsRef = useRef(new Map<string, FabricImage>())
    const imageIdsByObjectRef = useRef(new Map<FabricImage, string>())
    const loadedSourcesRef = useRef(new Map<string, string>())
    const loadTokensRef = useRef(new Map<string, number>())
    const directPanRef = useRef<{ frameId: string; x: number; y: number } | null>(null)
    const verticalGuideRef = useRef<Line | null>(null)
    const horizontalGuideRef = useRef<Line | null>(null)
    const [loadingFrameIds, setLoadingFrameIds] = useState<Set<string>>(new Set())
    const [snapStatus, setSnapStatus] = useState<string | null>(null)

    const project = useProjectStore((state) => state.project)
    const editor = useProjectStore((state) => state.editor)
    const selectFrame = useProjectStore((state) => state.selectFrame)
    const setCropMode = useProjectStore((state) => state.setCropMode)
    const setLoadedImage = useProjectStore((state) => state.setLoadedImage)
    const updateFrameGeometry = useProjectStore((state) => state.updateFrameGeometry)
    const updateImageTransform = useProjectStore((state) => state.updateImageTransform)

    const page = project.pages.find((candidate) => candidate.id === project.activePageId)
      ?? project.pages[0]
    const selectedFrame = frameFromPage(page, editor.selectedFrameId) ?? page.frames[0]

    const frameGeometrySignature = useMemo(() => page.frames.map((frame) => [
      frame.id,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      frame.cornerRadius,
      frame.zIndex,
    ].join(':')).join('|'), [page.frames])

    const sourceSignature = useMemo(() => page.frames.map((frame) => [
      frame.id,
      frame.image?.sourcePath ?? '',
      editor.imageLoadRevisions[frame.id] ?? 0,
    ].join(':')).join('|'), [editor.imageLoadRevisions, page.frames])

    const transformSignature = useMemo(() => page.frames.map((frame) => {
      const transform = frame.image?.transform
      return transform ? [
        frame.id,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        frame.image?.naturalWidth,
        frame.image?.naturalHeight,
        transform.offsetX,
        transform.offsetY,
        transform.scale,
        transform.rotation,
        transform.flipX,
        transform.flipY,
        transform.opacity,
      ].join(':') : `${frame.id}:empty`
    }).join('|'), [page.frames])

    const filterSignature = useMemo(() => page.frames.map((frame) => {
      const adjustments = frame.image?.filters
      return adjustments ? [
        frame.id,
        adjustments.brightness,
        adjustments.contrast,
        adjustments.saturation,
      ].join(':') : `${frame.id}:empty`
    }).join('|'), [page.frames])

    const reorderObjects = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const currentPage = activePageFromState()
      const orderedFrames = currentPage.frames.slice().sort((left, right) => left.zIndex - right.zIndex)
      let index = 0
      orderedFrames.forEach((frame) => {
        const image = imageObjectsRef.current.get(frame.id)
        if (image) canvas.moveObjectTo(image, index++)
      })
      orderedFrames.forEach((frame) => {
        const overlay = frameObjectsRef.current.get(frame.id)
        if (overlay) canvas.moveObjectTo(overlay, index++)
      })
    }

    useEffect(() => {
      const element = canvasElementRef.current
      if (!element) return
      const initialPage = activePageFromState()
      const canvas = new Canvas(element, {
        width: initialPage.width,
        height: initialPage.height,
        backgroundColor: initialPage.backgroundColor,
        selection: false,
        preserveObjectStacking: true,
      })
      canvasRef.current = canvas
      const verticalGuide = new Line([initialPage.width / 2, 0, initialPage.width / 2, initialPage.height], {
        stroke: '#38bdf8',
        strokeWidth: 3,
        strokeDashArray: [14, 10],
        selectable: false,
        evented: false,
        visible: false,
      })
      const horizontalGuide = new Line([0, initialPage.height / 2, initialPage.width, initialPage.height / 2], {
        stroke: '#38bdf8',
        strokeWidth: 3,
        strokeDashArray: [14, 10],
        selectable: false,
        evented: false,
        visible: false,
      })
      verticalGuideRef.current = verticalGuide
      horizontalGuideRef.current = horizontalGuide
      canvas.add(verticalGuide, horizontalGuide)
      const loadTokens = loadTokensRef.current
      const frameObjects = frameObjectsRef.current
      const frameIdsByObject = frameIdsByObjectRef.current
      const clipPaths = clipPathsRef.current
      const imageObjects = imageObjectsRef.current
      const imageIdsByObject = imageIdsByObjectRef.current
      const loadedSources = loadedSourcesRef.current

      const hideSnapGuides = () => {
        verticalGuide.set({ visible: false })
        horizontalGuide.set({ visible: false })
        setSnapStatus(null)
      }

      canvas.on('mouse:down', (event) => {
        const overlay = event.target instanceof Rect ? event.target : null
        const frameId = overlay ? frameIdsByObjectRef.current.get(overlay) : undefined
        if (!frameId) return
        const state = useProjectStore.getState()
        if (state.editor.cropMode && state.editor.selectedFrameId !== frameId) setCropMode(false)
        selectFrame(frameId)
        const currentFrame = frameFromPage(activePageFromState(), frameId)
        if (
          currentFrame?.image &&
          !state.editor.arrangeMode &&
          (!state.editor.cropMode || state.editor.selectedFrameId !== frameId)
        ) {
          directPanRef.current = {
            frameId,
            x: event.scenePoint.x,
            y: event.scenePoint.y,
          }
        }
      })

      canvas.on('mouse:move', (event) => {
        const pan = directPanRef.current
        if (!pan) return
        if ('buttons' in event.e && event.e.buttons === 0) {
          directPanRef.current = null
          return
        }
        const currentFrame = frameFromPage(activePageFromState(), pan.frameId)
        const image = imageObjectsRef.current.get(pan.frameId)
        if (!currentFrame?.image || !image) {
          directPanRef.current = null
          return
        }

        const safe = roundTransform(constrainImageTransform(
          currentFrame,
          currentFrame.image.naturalWidth,
          currentFrame.image.naturalHeight,
          {
            ...currentFrame.image.transform,
            offsetX: currentFrame.image.transform.offsetX + event.scenePoint.x - pan.x,
            offsetY: currentFrame.image.transform.offsetY + event.scenePoint.y - pan.y,
          },
        ))
        directPanRef.current = {
          frameId: pan.frameId,
          x: event.scenePoint.x,
          y: event.scenePoint.y,
        }
        image.set({
          left: currentFrame.x + currentFrame.width / 2 + safe.offsetX,
          top: currentFrame.y + currentFrame.height / 2 + safe.offsetY,
        })
        image.setCoords()
        updateImageTransform(currentFrame.id, safe)
        canvas.requestRenderAll()
      })

      canvas.on('mouse:up', () => {
        directPanRef.current = null
        hideSnapGuides()
        canvas.requestRenderAll()
      })

      canvas.on('mouse:dblclick', (event) => {
        const overlay = event.target instanceof Rect ? event.target : null
        const frameId = overlay ? frameIdsByObjectRef.current.get(overlay) : undefined
        if (!frameId) return
        if (useProjectStore.getState().editor.arrangeMode) return
        const currentFrame = frameFromPage(activePageFromState(), frameId)
        selectFrame(frameId)
        if (currentFrame?.image) setCropMode(true)
      })

      canvas.on('object:moving', (event) => {
        const overlay = event.target instanceof Rect ? event.target : null
        const movingFrameId = overlay ? frameIdsByObjectRef.current.get(overlay) : undefined
        const movingState = useProjectStore.getState()
        if (overlay && movingFrameId && movingState.editor.arrangeMode) {
          const currentPage = activePageFromState()
          const currentFrame = frameFromPage(currentPage, movingFrameId)
          if (!currentFrame) return
          const width = overlay.width * (overlay.scaleX ?? 1)
          const height = overlay.height * (overlay.scaleY ?? 1)
          const otherFrames = currentPage.frames.filter((frame) => frame.id !== movingFrameId)
          const xCandidates: SnapCandidate[] = [
            { value: 0, label: 'to left edge', allowedAnchor: 'start' },
            {
              value: currentPage.width / 2,
              label: 'horizontally',
              isCanvasCenter: true,
              allowedAnchor: 'center',
            },
            { value: currentPage.width, label: 'to right edge', allowedAnchor: 'end' },
            ...otherFrames.flatMap((frame) => [
              { value: frame.x, label: 'with another frame' },
              { value: frame.x + frame.width / 2, label: 'with another frame' },
              { value: frame.x + frame.width, label: 'with another frame' },
            ]),
          ]
          const yCandidates: SnapCandidate[] = [
            { value: 0, label: 'to top edge', allowedAnchor: 'start' },
            {
              value: currentPage.height / 2,
              label: 'vertically',
              isCanvasCenter: true,
              allowedAnchor: 'center',
            },
            { value: currentPage.height, label: 'to bottom edge', allowedAnchor: 'end' },
            ...otherFrames.flatMap((frame) => [
              { value: frame.y, label: 'with another frame' },
              { value: frame.y + frame.height / 2, label: 'with another frame' },
              { value: frame.y + frame.height, label: 'with another frame' },
            ]),
          ]
          const xSnap = findAxisSnap(overlay.left ?? currentFrame.x, width, xCandidates)
          const ySnap = findAxisSnap(overlay.top ?? currentFrame.y, height, yCandidates)
          const x = Math.min(Math.max(xSnap?.start ?? overlay.left ?? currentFrame.x, 0), currentPage.width - width)
          const y = Math.min(Math.max(ySnap?.start ?? overlay.top ?? currentFrame.y, 0), currentPage.height - height)
          overlay.set({ left: x, top: y })
          overlay.setCoords()

          if (xSnap) {
            verticalGuide.set({
              x1: xSnap.guide,
              x2: xSnap.guide,
              y1: 0,
              y2: currentPage.height,
              visible: true,
            })
          } else verticalGuide.set({ visible: false })
          if (ySnap) {
            horizontalGuide.set({
              x1: 0,
              x2: currentPage.width,
              y1: ySnap.guide,
              y2: ySnap.guide,
              visible: true,
            })
          } else horizontalGuide.set({ visible: false })
          setSnapStatus([xSnap?.label, ySnap?.label].filter(Boolean).join(' · ') || null)
          updateFrameGeometry(movingFrameId, { x, y })
          canvas.requestRenderAll()
          return
        }

        const image = event.target instanceof FabricImage ? event.target : null
        const frameId = image ? imageIdsByObjectRef.current.get(image) : undefined
        const state = useProjectStore.getState()
        if (!image || !frameId || !state.editor.cropMode || state.editor.selectedFrameId !== frameId) return
        const currentFrame = frameFromPage(activePageFromState(), frameId)
        if (!currentFrame?.image) return

        const safe = roundTransform(constrainImageTransform(
          currentFrame,
          currentFrame.image.naturalWidth,
          currentFrame.image.naturalHeight,
          {
            ...currentFrame.image.transform,
            offsetX: (image.left ?? 0) - (currentFrame.x + currentFrame.width / 2),
            offsetY: (image.top ?? 0) - (currentFrame.y + currentFrame.height / 2),
          },
        ))
        image.set({
          left: currentFrame.x + currentFrame.width / 2 + safe.offsetX,
          top: currentFrame.y + currentFrame.height / 2 + safe.offsetY,
        })
        image.setCoords()
        updateImageTransform(frameId, safe)
      })

      canvas.on('object:scaling', (event) => {
        const overlay = event.target instanceof Rect ? event.target : null
        const frameId = overlay ? frameIdsByObjectRef.current.get(overlay) : undefined
        if (!overlay || !frameId || !useProjectStore.getState().editor.arrangeMode) return
        const currentPage = activePageFromState()
        const width = Math.min(
          Math.max(overlay.width * (overlay.scaleX ?? 1), MIN_FRAME_SIZE),
          currentPage.width,
        )
        const height = Math.min(
          Math.max(overlay.height * (overlay.scaleY ?? 1), MIN_FRAME_SIZE),
          currentPage.height,
        )
        const x = Math.min(Math.max(overlay.left ?? 0, 0), currentPage.width - width)
        const y = Math.min(Math.max(overlay.top ?? 0, 0), currentPage.height - height)
        overlay.set({ left: x, top: y, width, height, scaleX: 1, scaleY: 1 })
        overlay.setCoords()
        updateFrameGeometry(frameId, { x, y, width, height })
        canvas.requestRenderAll()
      })

      canvas.on('object:modified', () => {
        hideSnapGuides()
        canvas.requestRenderAll()
      })

      canvas.on('mouse:wheel', (event) => {
        if (!(event.e instanceof WheelEvent)) return
        const state = useProjectStore.getState()
        if (state.editor.arrangeMode) return
        const overlayFrameId = event.target instanceof Rect
          ? frameIdsByObjectRef.current.get(event.target)
          : undefined
        const imageFrameId = event.target instanceof FabricImage
          ? imageIdsByObjectRef.current.get(event.target)
          : undefined
        const frameId = overlayFrameId ?? imageFrameId
        if (!frameId) return
        const currentFrame = frameFromPage(activePageFromState(), frameId)
        if (!currentFrame?.image) return
        event.e.preventDefault()
        event.e.stopPropagation()
        if (state.editor.selectedFrameId !== frameId) {
          setCropMode(false)
          selectFrame(frameId)
        }

        const minScale = minimumCoverScale(
          currentFrame,
          currentFrame.image.naturalWidth,
          currentFrame.image.naturalHeight,
          currentFrame.image.transform.rotation,
        )
        const factor = event.e.deltaY < 0 ? 1.08 : 0.92
        const scale = Math.min(
          Math.max(currentFrame.image.transform.scale * factor, minScale),
          minScale * 8,
        )
        const safe = roundTransform(constrainImageTransform(
          currentFrame,
          currentFrame.image.naturalWidth,
          currentFrame.image.naturalHeight,
          { ...currentFrame.image.transform, scale },
        ))
        updateImageTransform(currentFrame.id, safe)
      })

      return () => {
        loadTokens.forEach((token, frameId) => loadTokens.set(frameId, token + 1))
        imageObjects.forEach((image) => image.dispose())
        frameObjects.clear()
        frameIdsByObject.clear()
        clipPaths.clear()
        imageObjects.clear()
        imageIdsByObject.clear()
        loadedSources.clear()
        verticalGuideRef.current = null
        horizontalGuideRef.current = null
        canvasRef.current = null
        canvas.dispose()
      }
    }, [selectFrame, setCropMode, updateFrameGeometry, updateImageTransform])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const currentPage = activePageFromState()
      const currentIds = new Set(currentPage.frames.map((frame) => frame.id))

      frameObjectsRef.current.forEach((overlay, frameId) => {
        if (currentIds.has(frameId)) return
        canvas.remove(overlay)
        frameObjectsRef.current.delete(frameId)
        frameIdsByObjectRef.current.delete(overlay)
        clipPathsRef.current.delete(frameId)
      })
      imageObjectsRef.current.forEach((image, frameId) => {
        if (currentIds.has(frameId)) return
        canvas.remove(image)
        image.dispose()
        imageObjectsRef.current.delete(frameId)
        imageIdsByObjectRef.current.delete(image)
        loadedSourcesRef.current.delete(frameId)
      })

      canvas.setDimensions({ width: currentPage.width, height: currentPage.height })
      canvas.backgroundColor = currentPage.backgroundColor
      verticalGuideRef.current?.set({ y1: 0, y2: currentPage.height })
      horizontalGuideRef.current?.set({ x1: 0, x2: currentPage.width })
      const currentEditor = useProjectStore.getState().editor
      currentPage.frames.forEach((frame) => {
        let overlay = frameObjectsRef.current.get(frame.id)
        if (!overlay) {
          overlay = createFrameOverlay(frame)
          frameObjectsRef.current.set(frame.id, overlay)
          frameIdsByObjectRef.current.set(overlay, frame.id)
          canvas.add(overlay)
        }
        const isSelected = frame.id === currentEditor.selectedFrameId
        const isCropping = isSelected && currentEditor.cropMode
        const isArranging = currentEditor.arrangeMode
        overlay.set({
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          rx: frame.cornerRadius,
          ry: frame.cornerRadius,
          stroke: isCropping ? '#fbbf24' : isSelected ? '#60a5fa' : 'rgba(255,255,255,0.5)',
          strokeWidth: isSelected ? 5 : 2,
          selectable: !isCropping,
          evented: !isCropping,
          hasControls: isArranging && isSelected,
          hasBorders: isArranging && isSelected,
          lockMovementX: !isArranging,
          lockMovementY: !isArranging,
          lockRotation: true,
          visible: true,
          hoverCursor: isArranging ? 'move' : frame.image ? 'grab' : 'pointer',
          moveCursor: isArranging ? 'move' : frame.image ? 'grabbing' : 'pointer',
        })
        overlay.setControlsVisibility({ mtr: false })
        overlay.setCoords()

        let clipPath = clipPathsRef.current.get(frame.id)
        if (!clipPath) {
          clipPath = createClipPath(frame)
          clipPathsRef.current.set(frame.id, clipPath)
        }
        clipPath.set({
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
          rx: frame.cornerRadius,
          ry: frame.cornerRadius,
        })
        const image = imageObjectsRef.current.get(frame.id)
        if (image) {
          image.clipPath = clipPath
          image.set({
            selectable: isCropping,
            evented: isCropping,
            hoverCursor: isCropping ? 'grab' : 'default',
            moveCursor: 'grabbing',
          })
          image.setCoords()
        }
      })

      reorderObjects()
      const state = useProjectStore.getState()
      const selectedImage = imageObjectsRef.current.get(state.editor.selectedFrameId)
      const selectedOverlay = frameObjectsRef.current.get(state.editor.selectedFrameId)
      if (state.editor.cropMode && selectedImage) canvas.setActiveObject(selectedImage)
      else if (selectedOverlay) canvas.setActiveObject(selectedOverlay)
      canvas.requestRenderAll()
    }, [editor.arrangeMode, editor.cropMode, editor.selectedFrameId, frameGeometrySignature, page.backgroundColor, page.height, page.width])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const currentPage = activePageFromState()
      const currentIds = new Set(currentPage.frames.map((frame) => frame.id))

      imageObjectsRef.current.forEach((image, frameId) => {
        const frame = frameFromPage(currentPage, frameId)
        if (frame?.image && loadedSourcesRef.current.get(frameId) === frame.image.sourcePath) return
        canvas.remove(image)
        image.dispose()
        imageObjectsRef.current.delete(frameId)
        imageIdsByObjectRef.current.delete(image)
        loadedSourcesRef.current.delete(frameId)
      })

      loadTokensRef.current.forEach((token, frameId) => {
        if (!currentIds.has(frameId)) loadTokensRef.current.set(frameId, token + 1)
      })

      currentPage.frames.forEach((frame) => {
        if (!frame.image || imageObjectsRef.current.has(frame.id)) return
        const sourcePath = frame.image.sourcePath
        const token = (loadTokensRef.current.get(frame.id) ?? 0) + 1
        loadTokensRef.current.set(frame.id, token)
        loadedSourcesRef.current.set(frame.id, sourcePath)
        setLoadingFrameIds((current) => new Set(current).add(frame.id))

        const loadImage = async () => {
          try {
            const bytes = await readFile(sourcePath)
            const objectUrl = URL.createObjectURL(new Blob([bytes]))
            let loaded: FabricImage
            try {
              loaded = await FabricImage.fromURL(objectUrl)
            } finally {
              URL.revokeObjectURL(objectUrl)
            }
            if (loadTokensRef.current.get(frame.id) !== token || !canvasRef.current) {
              loaded.dispose()
              return
            }

            const latestFrame = frameFromPage(activePageFromState(), frame.id)
            if (!latestFrame?.image || latestFrame.image.sourcePath !== sourcePath) {
              loaded.dispose()
              return
            }
            const originalSize = loaded.getOriginalSize()
            const naturalWidth = Number(originalSize.width) || 1
            const naturalHeight = Number(originalSize.height) || 1
            const needsInitialCrop = latestFrame.image.naturalWidth <= 0 || latestFrame.image.naturalHeight <= 0
            const requestedTransform = needsInitialCrop
              ? {
                  ...latestFrame.image.transform,
                  scale: minimumCoverScale(
                    latestFrame,
                    naturalWidth,
                    naturalHeight,
                    latestFrame.image.transform.rotation,
                  ),
                }
              : latestFrame.image.transform
            const safe = roundTransform(constrainImageTransform(
              latestFrame,
              naturalWidth,
              naturalHeight,
              requestedTransform,
            ))
            const currentState = useProjectStore.getState()
            const isCropping = currentState.editor.cropMode
              && currentState.editor.selectedFrameId === frame.id
            const clipPath = clipPathsRef.current.get(frame.id) ?? createClipPath(latestFrame)
            clipPathsRef.current.set(frame.id, clipPath)
            loaded.set({
              left: latestFrame.x + latestFrame.width / 2 + safe.offsetX,
              top: latestFrame.y + latestFrame.height / 2 + safe.offsetY,
              originX: 'center',
              originY: 'center',
              scaleX: safe.scale,
              scaleY: safe.scale,
              angle: safe.rotation,
              flipX: safe.flipX,
              flipY: safe.flipY,
              opacity: safe.opacity,
              selectable: isCropping,
              evented: isCropping,
              hasControls: false,
              hasBorders: false,
              lockScalingX: true,
              lockScalingY: true,
              lockRotation: true,
              clipPath,
            })
            applyFilters(loaded, latestFrame.image.filters)
            loaded.setCoords()
            canvasRef.current.add(loaded)
            imageObjectsRef.current.set(frame.id, loaded)
            imageIdsByObjectRef.current.set(loaded, frame.id)
            reorderObjects()

            if (
              naturalWidth !== latestFrame.image.naturalWidth ||
              naturalHeight !== latestFrame.image.naturalHeight ||
              !transformsMatch(safe, latestFrame.image.transform)
            ) {
              setLoadedImage(frame.id, naturalWidth, naturalHeight, safe)
            }
            canvasRef.current.requestRenderAll()
          } catch (error) {
            if (loadTokensRef.current.get(frame.id) === token) {
              loadedSourcesRef.current.delete(frame.id)
              onError(`Could not load ${sourcePath.split(/[\\/]/).pop()}. ${errorMessage(error)}`)
            }
          } finally {
            if (loadTokensRef.current.get(frame.id) === token) {
              setLoadingFrameIds((current) => {
                const next = new Set(current)
                next.delete(frame.id)
                return next
              })
            }
          }
        }
        void loadImage()
      })
    }, [onError, setLoadedImage, sourceSignature])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const currentPage = activePageFromState()
      currentPage.frames.forEach((frame) => {
        const image = imageObjectsRef.current.get(frame.id)
        if (!image || !frame.image) return
        const safe = constrainImageTransform(
          frame,
          frame.image.naturalWidth,
          frame.image.naturalHeight,
          frame.image.transform,
        )
        image.set({
          left: frame.x + frame.width / 2 + safe.offsetX,
          top: frame.y + frame.height / 2 + safe.offsetY,
          scaleX: safe.scale,
          scaleY: safe.scale,
          angle: safe.rotation,
          flipX: safe.flipX,
          flipY: safe.flipY,
          opacity: safe.opacity,
        })
        image.setCoords()
        if (!transformsMatch(safe, frame.image.transform)) {
          updateImageTransform(frame.id, roundTransform(safe))
        }
      })
      canvas.requestRenderAll()
    }, [transformSignature, updateImageTransform])

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      activePageFromState().frames.forEach((frame) => {
        const image = imageObjectsRef.current.get(frame.id)
        if (image && frame.image) applyFilters(image, frame.image.filters)
      })
      canvas.requestRenderAll()
    }, [filterSignature])

    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setCropMode(false)
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [setCropMode])

    useImperativeHandle(forwardedRef, () => ({
      toPngDataUrl: (multiplier) => {
        const canvas = canvasRef.current
        if (!canvas) throw new Error('The canvas is not ready yet.')
        const state = useProjectStore.getState()
        frameObjectsRef.current.forEach((overlay) => overlay.set({ visible: false }))
        verticalGuideRef.current?.set({ visible: false })
        horizontalGuideRef.current?.set({ visible: false })
        canvas.discardActiveObject()
        canvas.renderAll()
        try {
          return canvas.toDataURL({ format: 'png', multiplier })
        } finally {
          frameObjectsRef.current.forEach((overlay) => overlay.set({ visible: true }))
          const selectedImage = imageObjectsRef.current.get(state.editor.selectedFrameId)
          const selectedOverlay = frameObjectsRef.current.get(state.editor.selectedFrameId)
          if (state.editor.cropMode && selectedImage) canvas.setActiveObject(selectedImage)
          else if (selectedOverlay) canvas.setActiveObject(selectedOverlay)
          canvas.requestRenderAll()
        }
      },
    }), [])

    return (
      <div className="canvas-stage relative max-h-full max-w-full shadow-2xl shadow-black/50">
        <canvas ref={canvasElementRef} />
        {loadingFrameIds.size > 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-black/75 px-4 py-2 text-xs text-zinc-300">
            Loading {loadingFrameIds.size} photo{loadingFrameIds.size === 1 ? '' : 's'}…
          </div>
        )}
        {snapStatus && editor.arrangeMode && (
          <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-sky-400 px-2.5 py-1 text-[10px] font-semibold text-sky-950 shadow-lg">
            {snapStatus}
          </span>
        )}
        {editor.arrangeMode && !snapStatus && (
          <span className="pointer-events-none absolute left-3 top-3 rounded bg-blue-500 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
            Arrange frames
          </span>
        )}
        {editor.cropMode && selectedFrame.image && (
          <span className="pointer-events-none absolute left-3 top-3 rounded bg-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-950">
            Crop frame
          </span>
        )}
      </div>
    )
  },
)
