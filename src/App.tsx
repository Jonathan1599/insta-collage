import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { open, save, confirm as confirmDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { CollageCanvas, type CollageCanvasHandle } from './components/CollageCanvas'
import { constrainImageTransform, minimumCoverScale } from './lib/canvasMath'
import { createTemplateFrames, resizeFramesForGap, TEMPLATE_DEFINITIONS } from './lib/templates'
import { useProjectStore } from './store/projectStore'
import {
  createDefaultTransform,
  parseProjectFile,
  type CollageTemplateId,
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

const Icon = ({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) => {
  const paths: Record<IconName, ReactNode> = {
    'add-photo': <><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5v1" /><path d="m4 13 2.6-2.8a1 1 0 0 1 1.45-.02L10 12l1-1" /><path d="M7 7.5h.01" /><path d="M14.5 10v5M12 12.5h5" /><path d="M10.5 16H5.5A1.5 1.5 0 0 1 4 14.5v-9" /></>,
    chevron: <path d="m7 4 4 4-4 4" />,
    crop: <><path d="M5 2v9a2 2 0 0 0 2 2h9" /><path d="M2 5h9a2 2 0 0 1 2 2v9" /></>,
    export: <><path d="M8 11V2" /><path d="m4.5 5.5 3.5-3.5 3.5 3.5" /><path d="M3 9.5v4A1.5 1.5 0 0 0 4.5 15h7A1.5 1.5 0 0 0 13 13.5v-4" /></>,
    folder: <path d="M2.5 5A1.5 1.5 0 0 1 4 3.5h3l1.5 1.7H14A1.5 1.5 0 0 1 15.5 6.7v5.8A1.5 1.5 0 0 1 14 14H4a1.5 1.5 0 0 1-1.5-1.5Z" />,
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

const TemplatePreview = ({ templateId }: { templateId: CollageTemplateId }) => {
  const template = TEMPLATE_DEFINITIONS.find((candidate) => candidate.id === templateId)
    ?? TEMPLATE_DEFINITIONS[0]
  return (
    <span className="relative block h-9 w-full overflow-hidden rounded-sm bg-zinc-950">
      {template.frames.map((frame, index) => (
        <span
          className="absolute rounded-[1px] border border-current bg-current/10"
          key={index}
          style={{
            left: `calc(${frame.x * 100}% + 1px)`,
            top: `calc(${frame.y * 100}% + 1px)`,
            width: `calc(${frame.width * 100}% - 2px)`,
            height: `calc(${frame.height * 100}% - 2px)`,
          }}
        />
      ))}
    </span>
  )
}

const dataUrlToBytes = (dataUrl: string) => {
  const encoded = dataUrl.split(',')[1]
  if (!encoded) throw new Error('The exported canvas was empty.')
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
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

function App() {
  const canvasRef = useRef<CollageCanvasHandle | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [isExporting, setIsExporting] = useState(false)

  const project = useProjectStore((state) => state.project)
  const editor = useProjectStore((state) => state.editor)
  const selectFrame = useProjectStore((state) => state.selectFrame)
  const setCropMode = useProjectStore((state) => state.setCropMode)
  const setBackgroundColor = useProjectStore((state) => state.setBackgroundColor)
  const setFrameGap = useProjectStore((state) => state.setFrameGap)
  const setTemplateFrames = useProjectStore((state) => state.setTemplateFrames)
  const assignImages = useProjectStore((state) => state.assignImages)
  const chooseImage = useProjectStore((state) => state.chooseImage)
  const updateImageTransform = useProjectStore((state) => state.updateImageTransform)
  const updateImageFilters = useProjectStore((state) => state.updateImageFilters)
  const resetImage = useProjectStore((state) => state.resetImage)
  const resetProject = useProjectStore((state) => state.resetProject)
  const loadProject = useProjectStore((state) => state.loadProject)
  const markSaved = useProjectStore((state) => state.markSaved)

  const page = project.pages.find((candidate) => candidate.id === project.activePageId)
    ?? project.pages[0]
  const selectedFrame = page.frames.find((candidate) => candidate.id === editor.selectedFrameId)
    ?? page.frames[0]
  const selectedImage = selectedFrame.image
  const selectedFrameNumber = page.frames.findIndex((frame) => frame.id === selectedFrame.id) + 1
  const placedPhotoCount = page.frames.filter((frame) => frame.image).length

  const showError = useCallback((error: unknown) => {
    setNotice({ kind: 'error', message: errorMessage(error) })
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const applyTemplate = async (templateId: CollageTemplateId) => {
    const template = TEMPLATE_DEFINITIONS.find((candidate) => candidate.id === templateId)
      ?? TEMPLATE_DEFINITIONS[0]
    if (placedPhotoCount > template.frames.length) {
      const accepted = await confirmDialog(
        `This layout has ${template.frames.length} frame${template.frames.length === 1 ? '' : 's'}. Extra placed photos will be removed from the project, but the original files stay untouched.`,
        { title: 'Change layout?', kind: 'warning' },
      )
      if (!accepted) return
    }
    setTemplateFrames(templateId, createTemplateFrames(templateId, page))
  }

  const handleAddPhotos = async () => {
    try {
      const selected = await open({
        title: 'Add photos to collage',
        multiple: true,
        fileAccessMode: 'scoped',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      })
      const paths = Array.isArray(selected) ? selected : typeof selected === 'string' ? [selected] : []
      if (paths.length === 0) return

      let currentPage = useProjectStore.getState().project.pages.find(
        (candidate) => candidate.id === useProjectStore.getState().project.activePageId,
      ) ?? useProjectStore.getState().project.pages[0]
      const existingCount = currentPage.frames.filter((frame) => frame.image).length
      const requestedCount = existingCount + paths.length

      // Make the first multi-photo action immediately useful by choosing a fitting layout.
      if (currentPage.frames.length === 1 && requestedCount > 1) {
        const automaticTemplate: CollageTemplateId = requestedCount === 2
          ? 'two-columns'
          : requestedCount === 3
            ? 'three-columns'
            : 'four-grid'
        setTemplateFrames(automaticTemplate, createTemplateFrames(automaticTemplate, currentPage))
        currentPage = useProjectStore.getState().project.pages.find(
          (candidate) => candidate.id === useProjectStore.getState().project.activePageId,
        ) ?? useProjectStore.getState().project.pages[0]
      }

      const emptyFrames = currentPage.frames.filter((frame) => !frame.image)
      const assignments = paths.slice(0, emptyFrames.length).map((sourcePath, index) => ({
        frameId: emptyFrames[index].id,
        sourcePath,
      }))
      if (assignments.length === 0) {
        setNotice({ kind: 'error', message: 'This layout is full. Select a larger layout or replace a selected frame.' })
        return
      }
      assignImages(assignments)
      const skipped = paths.length - assignments.length
      setNotice({
        kind: skipped > 0 ? 'error' : 'success',
        message: skipped > 0
          ? `Added ${assignments.length} photos. ${skipped} did not fit in this layout.`
          : `Added ${assignments.length} photo${assignments.length === 1 ? '' : 's'} to the collage.`,
      })
    } catch (error) {
      showError(error)
    }
  }

  const handleReplaceSelected = async () => {
    try {
      const selected = await open({
        title: selectedImage ? 'Replace selected photo' : 'Place photo in selected frame',
        multiple: false,
        fileAccessMode: 'scoped',
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      })
      if (typeof selected === 'string') chooseImage(selectedFrame.id, selected)
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
      await writeTextFile(path, JSON.stringify(useProjectStore.getState().project, null, 2))
      markSaved(path)
      setNotice({ kind: 'success', message: 'Collage project saved on this device.' })
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
      const nextProject = parseProjectFile(JSON.parse(await readTextFile(selected)) as unknown)
      loadProject(nextProject, selected)
      setNotice({ kind: 'success', message: 'Collage project opened.' })
    } catch (error) {
      showError(error)
    }
  }

  const handleResetSelected = () => {
    if (!selectedImage) return
    resetImage(selectedFrame.id, roundTransform({
      ...createDefaultTransform(),
      scale: minimumCoverScale(
        selectedFrame,
        selectedImage.naturalWidth,
        selectedImage.naturalHeight,
        0,
      ),
    }))
  }

  const handleResetProject = async () => {
    try {
      const accepted = await confirmDialog(
        'Reset the complete collage? Original photos will not be changed.',
        { title: 'Reset project', kind: 'warning' },
      )
      if (accepted) resetProject()
    } catch (error) {
      showError(error)
    }
  }

  const handleExportPng = async () => {
    try {
      const path = await save({
        title: 'Export collage PNG',
        defaultPath: `${project.name || 'Instagram collage'}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      })
      if (!path) return
      setIsExporting(true)
      const multiplier = project.exportSettings.width / page.width
      const dataUrl = canvasRef.current?.toPngDataUrl(multiplier)
      if (!dataUrl) throw new Error('The canvas is not ready yet.')
      await writeFile(path, dataUrlToBytes(dataUrl))
      setNotice({
        kind: 'success',
        message: `Collage exported at ${project.exportSettings.width} × ${project.exportSettings.height}.`,
      })
    } catch (error) {
      showError(error)
    } finally {
      setIsExporting(false)
    }
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSaveProject()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [handleSaveProject])

  const minScale = selectedImage ? minimumCoverScale(
    selectedFrame,
    selectedImage.naturalWidth,
    selectedImage.naturalHeight,
    selectedImage.transform.rotation,
  ) : 1
  const zoomPercent = selectedImage
    ? Math.round(selectedImage.transform.scale / minScale * 100)
    : 100
  const projectFileName = useMemo(() => {
    if (!editor.projectPath) return 'Not saved yet'
    return editor.projectPath.split(/[\\/]/).pop() ?? editor.projectPath
  }, [editor.projectPath])

  const setSafeTransform = (transform: ImageTransform) => {
    if (!selectedImage) return
    updateImageTransform(selectedFrame.id, roundTransform(constrainImageTransform(
      selectedFrame,
      selectedImage.naturalWidth,
      selectedImage.naturalHeight,
      transform,
    )))
  }

  const updateFilter = (filters: Partial<ImageFilters>) => {
    if (selectedImage) updateImageFilters(selectedFrame.id, filters)
  }

  return (
    <div className="h-screen min-h-[680px] min-w-[1080px] overflow-hidden bg-[#17181a] text-zinc-100">
      <main className="grid h-full grid-cols-[252px_minmax(520px,1fr)_292px]">
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
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Layouts</h2>
              <span className="text-[10px] text-zinc-600">{page.frames.length} frames</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATE_DEFINITIONS.map((template) => (
                <button
                  className={`rounded-md border p-2 text-left text-[10px] transition-colors ${
                    page.templateId === template.id
                      ? 'border-blue-400/60 bg-blue-500/10 text-blue-300'
                      : 'border-white/[0.07] bg-zinc-900/35 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                  }`}
                  key={template.id}
                  type="button"
                  onClick={() => void applyTemplate(template.id)}
                >
                  <TemplatePreview templateId={template.id} />
                  <span className="mt-1.5 block truncate">{template.name}</span>
                </button>
              ))}
            </div>

            <div className="mb-3 mt-6 flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Photos</h2>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                {placedPhotoCount}/{page.frames.length}
              </span>
            </div>
            <button className="primary-button w-full justify-center" type="button" onClick={() => void handleAddPhotos()}>
              <Icon name="add-photo" /> Add multiple photos
            </button>

            <div className="mt-3 space-y-2">
              {page.frames.map((candidate, index) => {
                const isSelected = candidate.id === selectedFrame.id
                const fileName = candidate.image?.sourcePath.split(/[\\/]/).pop()
                return (
                  <button
                    className={`flex w-full items-center gap-2.5 rounded-md border p-2 text-left transition-colors ${
                      isSelected
                        ? 'border-blue-400/45 bg-blue-500/[0.08]'
                        : 'border-white/[0.06] bg-zinc-900/30 hover:bg-zinc-800/50'
                    }`}
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      setCropMode(false)
                      selectFrame(candidate.id)
                    }}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded text-[11px] font-semibold ${
                      candidate.image ? 'bg-zinc-800 text-blue-400' : 'border border-dashed border-zinc-700 text-zinc-600'
                    }`}>
                      {candidate.image ? <Icon name="image" /> : index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] uppercase tracking-wider text-zinc-600">Frame {index + 1}</span>
                      <span className="block truncate text-xs text-zinc-300">{fileName ?? 'Empty frame'}</span>
                    </span>
                    <Icon name="chevron" className="h-3 w-3 text-zinc-600" />
                  </button>
                )
              })}
            </div>
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
                disabled={!selectedImage}
                onClick={() => setCropMode(!editor.cropMode)}
              >
                <Icon name="crop" /> {editor.cropMode ? 'Finish crop' : 'Crop selected'}
              </button>
              <span className="hidden text-[11px] text-zinc-600 xl:inline">
                {editor.cropMode ? 'Drag to reposition · Scroll to zoom · Esc to finish' : 'Click a frame to select · Double-click to crop'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button className="toolbar-button" type="button" onClick={() => void handleResetProject()}>
                <Icon name="reset" /> Reset project
              </button>
              <span className="mx-1 h-5 w-px bg-white/[0.08]" />
              <button className="primary-button" type="button" disabled={isExporting} onClick={() => void handleExportPng()}>
                <Icon name="export" /> {isExporting ? 'Exporting…' : 'Export PNG'}
              </button>
            </div>
          </header>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-7">
            <CollageCanvas ref={canvasRef} onError={showError} />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-white/[0.06] bg-[#1d1e21] px-2.5 py-1 text-[10px] text-zinc-500 shadow-md">
              Portrait · 1080 × 1350 px · {placedPhotoCount} photo{placedPhotoCount === 1 ? '' : 's'}
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-white/[0.07] bg-[#1c1d20]">
          <div className="flex h-16 shrink-0 items-center border-b border-white/[0.07] px-5">
            <div>
              <h2 className="text-sm font-medium text-zinc-200">Frame {selectedFrameNumber}</h2>
              <p className="mt-0.5 text-[10px] text-zinc-600">of {page.frames.length} · independently editable</p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <section className="inspector-section">
              <h3 className="inspector-heading">Selected photo</h3>
              <button className="secondary-button w-full justify-center" type="button" onClick={() => void handleReplaceSelected()}>
                <Icon name="add-photo" /> {selectedImage ? 'Replace in this frame' : 'Place photo in this frame'}
              </button>
            </section>

            <section className="inspector-section">
              <h3 className="inspector-heading">Canvas</h3>
              <label className="mb-5 flex items-center justify-between text-xs text-zinc-400">
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
              <RangeControl
                label="Gap between photos"
                value={page.gap}
                displayValue={`${Math.round(page.gap)} px`}
                min={0}
                max={80}
                step={2}
                onChange={(gap) => setFrameGap(gap, resizeFramesForGap(page, gap))}
              />
            </section>

            <section className="inspector-section space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="inspector-heading mb-0">Crop</h3>
                <button className="text-[10px] text-zinc-500 hover:text-zinc-200 disabled:opacity-30" type="button" disabled={!selectedImage} onClick={handleResetSelected}>
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
                disabled={!selectedImage}
                onChange={(value) => {
                  if (selectedImage) setSafeTransform({ ...selectedImage.transform, scale: minScale * value / 100 })
                }}
              />
              <RangeControl
                label="Rotation"
                value={selectedImage?.transform.rotation ?? 0}
                displayValue={`${Math.round(selectedImage?.transform.rotation ?? 0)}°`}
                min={-180}
                max={180}
                step={1}
                disabled={!selectedImage}
                onChange={(rotation) => {
                  if (selectedImage) setSafeTransform({ ...selectedImage.transform, rotation })
                }}
              />
              <button
                className={`w-full rounded-md border px-3 py-2 text-xs transition-colors disabled:opacity-40 ${
                  editor.cropMode
                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                    : 'border-white/[0.08] bg-zinc-800/60 text-zinc-300 hover:bg-zinc-800'
                }`}
                type="button"
                disabled={!selectedImage}
                onClick={() => setCropMode(!editor.cropMode)}
              >
                {editor.cropMode ? 'Finish crop mode' : 'Enter crop mode'}
              </button>
            </section>

            <section className="inspector-section space-y-5">
              <h3 className="inspector-heading">Adjustments</h3>
              <RangeControl
                label="Brightness"
                value={selectedImage?.filters.brightness ?? 0}
                displayValue={String(selectedImage?.filters.brightness ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!selectedImage}
                onChange={(brightness) => updateFilter({ brightness })}
              />
              <RangeControl
                label="Contrast"
                value={selectedImage?.filters.contrast ?? 0}
                displayValue={String(selectedImage?.filters.contrast ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!selectedImage}
                onChange={(contrast) => updateFilter({ contrast })}
              />
              <RangeControl
                label="Saturation"
                value={selectedImage?.filters.saturation ?? 0}
                displayValue={String(selectedImage?.filters.saturation ?? 0)}
                min={-100}
                max={100}
                step={1}
                disabled={!selectedImage}
                onChange={(saturation) => updateFilter({ saturation })}
              />
            </section>
          </div>

          <div className="border-t border-white/[0.07] p-4">
            <button
              className="flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-zinc-900/40 px-3 py-2.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200 disabled:opacity-40"
              type="button"
              disabled={!selectedImage}
              onClick={handleResetSelected}
            >
              <span className="flex items-center gap-2"><Icon name="reset" /> Reset selected image</span>
              <Icon name="chevron" className="h-3 w-3" />
            </button>
          </div>
        </aside>
      </main>

      {notice && (
        <div className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-xs shadow-xl ${
          notice.kind === 'error'
            ? 'border-red-400/25 bg-red-950 text-red-200'
            : 'border-emerald-400/20 bg-emerald-950 text-emerald-200'
        }`} role="status">
          {notice.message}
        </div>
      )}
    </div>
  )
}

export default App
