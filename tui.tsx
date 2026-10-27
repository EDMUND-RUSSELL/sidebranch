// sidebranch
// A minimal Ctrl+click file tree for the OpenCode TUI sidebar.
// MIT License.

import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { readdir, stat } from "node:fs/promises"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

type Entry = {
  name: string
  path: string
  kind: "directory" | "file"
}

type DirState =
  | { status: "loading" }
  | { status: "ready"; entries: Entry[]; truncated: number }
  | { status: "error"; message: string }

type Active =
  | { kind: "root" }
  | { kind: "directory"; entry: Entry }
  | { kind: "file"; entry: Entry }

type EditorLike = {
  insertText: (text: string) => void
  focus?: () => void
  editBuffer?: unknown
}

const IGNORED = new Set([".git", ".DS_Store"])
const MAX_ENTRIES = 300
const MAX_INDENT = 8
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })

async function readDirectory(directory: string) {
  const dirents = await readdir(directory, { withFileTypes: true })
  const entries: Entry[] = []

  for (const dirent of dirents) {
    if (IGNORED.has(dirent.name)) continue
    entries.push({
      name: dirent.name,
      path: join(directory, dirent.name),
      kind: dirent.isDirectory() ? "directory" : "file",
    })
  }

  entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
    return collator.compare(left.name, right.name)
  })

  return {
    entries: entries.slice(0, MAX_ENTRIES),
    truncated: Math.max(0, entries.length - MAX_ENTRIES),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function findEditor(renderable: unknown): EditorLike | undefined {
  if (!renderable || typeof renderable !== "object") return

  const candidate = renderable as {
    insertText?: unknown
    editBuffer?: unknown
    getChildren?: () => unknown[]
    focus?: () => void
  }

  if (typeof candidate.insertText === "function" && candidate.editBuffer !== undefined) {
    return candidate as EditorLike
  }

  if (typeof candidate.getChildren !== "function") return
  for (const child of candidate.getChildren()) {
    const editor = findEditor(child)
    if (editor) return editor
  }
}

function FileTree(props: { sessionID: string }) {
  const context = usePlugin()
  const theme = context.theme

  // Same persistence style as the built-in MCP section: the collapsed state
  // survives TUI restarts.
  const [view, updateView] = context.storage.store("view", { initial: { open: true } })

  const [directories, setDirectories] = createSignal<Record<string, DirState>>({})
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [active, setActive] = createSignal<Active | null>(null)

  const root = createMemo(() => {
    const session = context.data.session.get(props.sessionID)
    return (
      session?.location?.directory ??
      context.location?.directory ??
      context.data.location.default().directory
    )
  })

  const rootName = createMemo(() => basename(root()) || root())

  let activeTimer: ReturnType<typeof setTimeout> | undefined

  const clearActiveTimer = () => {
    if (activeTimer !== undefined) {
      clearTimeout(activeTimer)
      activeTimer = undefined
    }
  }

  const changeDirectory = async (directory: string) => {
    const target = resolve(directory)
    if (!(await isDirectory(target))) {
      context.ui.toast.show({
        title: "无法切换工作目录",
        message: `目录不存在或不可访问：${target}`,
        variant: "error",
        duration: 5000,
      })
      return
    }
    context.keymap.dispatch("session.cd", target)
  }

  const insertPath = (entry: Entry) => {
    const editor = (context.renderer.currentFocusedEditor as EditorLike | null) ?? findEditor(context.renderer.root)
    if (!editor) {
      context.ui.toast.show({
        title: "无法插入路径",
        message: "请先点击对话框，让输入光标处于闪烁状态",
        variant: "warning",
        duration: 4000,
      })
      return
    }

    const relativePath = relative(root(), entry.path).split(sep).join("/")
    const path = relativePath && !relativePath.startsWith("..") ? relativePath : entry.path
    editor.focus?.()
    editor.insertText(path)
    context.renderer.requestRender()
  }

  const activate = (item: Active) => {
    if (item.kind === "root") {
      const current = root()
      const parent = dirname(current)
      if (parent === current) {
        context.ui.toast.show({ message: "当前已在根目录", variant: "info" })
        return
      }
      void changeDirectory(parent)
      return
    }

    if (item.kind === "directory") {
      void changeDirectory(item.entry.path)
      return
    }

    insertPath(item.entry)
  }

  const selectActive = (item: Active) => {
    clearActiveTimer()
    setActive(item)
  }

  const clearActiveSoon = () => {
    clearActiveTimer()
    activeTimer = setTimeout(() => {
      activeTimer = undefined
      setActive(null)
    }, 80)
  }

  onCleanup(clearActiveTimer)

  const load = async (directory: string, force = false, silent = false) => {
    const current = directories()[directory]
    if (!force && current !== undefined && current.status !== "error") return

    if (!silent) {
      setDirectories((previous) => ({ ...previous, [directory]: { status: "loading" } }))
    }

    try {
      const result = await readDirectory(directory)
      setDirectories((previous) => ({
        ...previous,
        [directory]: { status: "ready", ...result },
      }))
    } catch (error) {
      setDirectories((previous) => ({
        ...previous,
        [directory]: {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  }

  createEffect(() => {
    const directory = root()
    untrack(() => {
      clearActiveTimer()
      setActive(null)
      setDirectories({})
      setExpanded(new Set())
      void load(directory, true)
    })
  })

  const toggleSection = () => {
    updateView((draft) => {
      draft.open = !draft.open
    }).catch((error) => console.error("Failed to persist file tree sidebar state", error))
  }

  const toggleDirectory = (entry: Entry) => {
    if (entry.kind !== "directory") return

    const isOpen = expanded().has(entry.path)
    setExpanded((previous) => {
      const next = new Set(previous)
      if (isOpen) next.delete(entry.path)
      else next.add(entry.path)
      return next
    })

    if (!isOpen) void load(entry.path)
  }

  const refresh = async () => {
    const directory = root()
    const open = expanded()
    clearActiveTimer()
    setActive(null)
    setDirectories({})
    await load(directory, true)
    await Promise.all([...open].map((path) => load(path, true)))
  }

  // Keep the visible part of the tree in sync after an assistant turn without
  // flashing every directory back to its loading state.
  const reloadQuietly = () => {
    void load(root(), true, true)
    for (const path of expanded()) void load(path, true, true)
  }

  const stopAutoRefresh = context.data.on("session.execution.succeeded", (event) => {
    if (event.data.sessionID === props.sessionID) reloadQuietly()
  })
  onCleanup(stopAutoRefresh)

  const rootState = () => directories()[root()]
  const rootCount = () => {
    const state = rootState()
    if (state?.status !== "ready") return 0
    return state.entries.length + state.truncated
  }

  const activeHint = () => {
    const item = active()
    if (!item) return ""
    if (item.kind === "root") return "Ctrl+单击：切换到上级目录"
    if (item.kind === "directory") return "Ctrl+单击：设为工作目录"
    if (!context.renderer.currentFocusedEditor) return "Ctrl+单击：插入路径（请先点击对话框）"
    return "Ctrl+单击：插入工作区路径"
  }

  const indent = (depth: number) => Math.min(depth, MAX_INDENT) * 2

  function Row(rowProps: { entry: Entry; depth: number }) {
    const [hovered, setHovered] = createSignal(false)
    const isDirectory = () => rowProps.entry.kind === "directory"
    const isOpen = () => isDirectory() && expanded().has(rowProps.entry.path)
    const isActive = () => {
      const item = active()
      return item?.kind !== "root" && item?.entry.path === rowProps.entry.path
    }

    const select = () => {
      selectActive({
        kind: rowProps.entry.kind,
        entry: rowProps.entry,
      })
    }

    return (
      <box
        flexDirection="row"
        gap={1}
        flexShrink={0}
        paddingLeft={indent(rowProps.depth)}
        backgroundColor={hovered() ? theme.background.raised.high : theme.background.raised.base}
        onMouseOver={() => {
          setHovered(true)
          select()
        }}
        onMouseOut={() => {
          setHovered(false)
          clearActiveSoon()
        }}
        onMouseDown={select}
        onMouseUp={(event: {
          button?: number
          modifiers?: { ctrl?: boolean }
          stopPropagation?: () => void
        }) => {
          if (event?.button !== undefined && event.button !== 0) return
          event?.stopPropagation?.()
          if (event?.modifiers?.ctrl) {
            activate({
              kind: rowProps.entry.kind,
              entry: rowProps.entry,
            })
            return
          }
          toggleDirectory(rowProps.entry)
        }}
      >
        <text flexShrink={0} selectable={false} fg={isDirectory() ? theme.text.base : theme.text.muted}>
          {isDirectory() ? (isOpen() ? "▾" : "▸") : "·"}
        </text>
        <text
          flexGrow={1}
          minWidth={0}
          selectable={false}
          wrapMode="none"
          truncate
          fg={isDirectory() ? theme.text.base : theme.text.muted}
        >
          {rowProps.entry.name}
        </text>
        <Show when={isActive()}>
          <text flexShrink={0} selectable={false} fg={theme.text.muted}>
            Ctrl
          </text>
        </Show>
      </box>
    )
  }

  function Directory(directoryProps: { directory: string; depth: number }) {
    const state = () => directories()[directoryProps.directory]
    const ready = () => {
      const current = state()
      return current?.status === "ready" ? current : undefined
    }
    const error = () => {
      const current = state()
      return current?.status === "error" ? current.message : undefined
    }

    return (
      <box flexDirection="column" flexShrink={0}>
        <Show when={state()?.status === "loading"}>
          <box flexDirection="row" flexShrink={0} paddingLeft={indent(directoryProps.depth)}>
            <text selectable={false} fg={theme.text.muted}>
              Loading…
            </text>
          </box>
        </Show>
        <Show when={error()}>
          <box flexDirection="row" flexShrink={0} paddingLeft={indent(directoryProps.depth)}>
            <text selectable={false} wrapMode="none" truncate fg={theme.text.feedback.error.base}>
              {error()}
            </text>
          </box>
        </Show>
        <For each={ready()?.entries ?? []}>
          {(entry) => (
            <box flexDirection="column" flexShrink={0}>
              <Row entry={entry} depth={directoryProps.depth} />
              <Show when={entry.kind === "directory" && expanded().has(entry.path)}>
                <Directory directory={entry.path} depth={directoryProps.depth + 1} />
              </Show>
            </box>
          )}
        </For>
        <Show when={(ready()?.truncated ?? 0) > 0}>
          <box flexDirection="row" flexShrink={0} paddingLeft={indent(directoryProps.depth)}>
            <text selectable={false} fg={theme.text.muted}>
              … {ready()!.truncated} more
            </text>
          </box>
        </Show>
      </box>
    )
  }

  return (
    <box flexDirection="column" flexShrink={0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <box
          flexDirection="row"
          gap={1}
          flexGrow={1}
          minWidth={0}
          backgroundColor={active()?.kind === "root" ? theme.background.raised.high : undefined}
          onMouseOver={() => selectActive({ kind: "root" })}
          onMouseOut={clearActiveSoon}
          onMouseDown={(event: {
            button?: number
            modifiers?: { ctrl?: boolean }
            stopPropagation?: () => void
          }) => {
            event?.stopPropagation?.()
            if (event?.button !== undefined && event.button !== 0) return
            selectActive({ kind: "root" })
            if (event?.modifiers?.ctrl) {
              activate({ kind: "root" })
              return
            }
            toggleSection()
          }}
        >
          <text flexShrink={0} selectable={false} fg={theme.text.base}>
            {view.open ? "▼" : "▶"}
          </text>
          <text
            flexGrow={1}
            minWidth={0}
            selectable={false}
            wrapMode="none"
            truncate
            fg={theme.text.base}
          >
            <b>{rootName()}</b>
          </text>
          <Show when={active()?.kind === "root"}>
            <text flexShrink={0} selectable={false} fg={theme.text.muted}>
              Ctrl
            </text>
          </Show>
          <Show when={!view.open && rootCount() > 0}>
            <text flexShrink={0} selectable={false} fg={theme.text.muted}>
              ({rootCount()})
            </text>
          </Show>
        </box>
        <text
          flexShrink={0}
          selectable={false}
          fg={theme.text.muted}
          onMouseDown={(event: { button?: number; stopPropagation?: () => void }) => {
            event?.stopPropagation?.()
            if (event?.button !== undefined && event.button !== 0) return
            void refresh()
          }}
        >
          ⟳
        </text>
      </box>
      <Show when={view.open}>
        <Directory directory={root()} depth={0} />
      </Show>
      <Show when={view.open && active()}>
        <box flexDirection="row" flexShrink={0}>
          <text selectable={false} wrapMode="none" truncate fg={theme.text.muted}>
            {activeHint()}
          </text>
        </box>
      </Show>
    </box>
  )
}

export default Plugin.define({
  id: "files.sidebar",
  setup(context) {
    return context.ui.slot({
      append: "sidebar.content",
      render: (input) => <FileTree sessionID={input.sessionID} />,
    })
  },
})
