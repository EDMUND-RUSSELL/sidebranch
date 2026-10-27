# sidebranch

A minimal Ctrl+click file tree sidebar for the OpenCode TUI.
一个极简的 OpenCode TUI 文件树侧边栏插件。

[![syntax](https://github.com/EDMUND-RUSSELL/sidebranch/actions/workflows/syntax.yml/badge.svg)](https://github.com/EDMUND-RUSSELL/sidebranch/actions/workflows/syntax.yml)

## 预览

```text
▼ dsh-workspace                    ⟳
  ▸ src
  ▸ docs
  · README.md
```

## 交互

| 操作 | 效果 |
| --- | --- |
| 点击标题（当前工作区目录名） | 收起 / 展开文件树 |
| Ctrl+左键单击标题 | 工作目录切换到上一级 |
| 点击目录行 | 展开 / 收起目录 |
| Ctrl+左键单击目录行 | 把该目录设为当前工作目录 |
| Ctrl+左键单击文件行 | 把文件相对工作区的路径插入输入框当前光标位置，不发送消息 |
| 点击 `⟳` | 刷新根目录和所有已展开目录 |

悬浮行时会显示 `Ctrl` 标记和底部提示。普通左键单击目录仍然只展开 / 收起。

## 安装

```bash
git clone https://github.com/EDMUND-RUSSELL/sidebranch.git
cd sidebranch
./install.sh
```

`install.sh` 会把当前目录软链接到：

```text
~/.config/opencode/plugins/sidebranch
```

然后重启 OpenCode TUI。

也可以只复制入口文件：

```bash
mkdir -p ~/.config/opencode/plugins/sidebranch
cp tui.tsx ~/.config/opencode/plugins/sidebranch/
```

插件目录名可以不同，OpenCode 会自动发现 `~/.config/opencode/plugins/` 下的插件目录。

## 说明

- 根目录取当前会话的 location，回退到 OpenCode 的启动目录。
- 标题直接显示当前根目录的 basename。
- 切换工作目录复用内置 `session.cd`，会同步更新会话 location 和最近目录。
- 文件路径相对于当前工作区。例如当前工作区是 `~/dev` 时，文件 `~/dev/src/button.tsx` 会插入为 `src/button.tsx`。
- 插入路径前请确保对话框输入框已聚焦（光标在闪烁）；路径会插入到当前光标处，而不是追加到末尾。
- 目录按需读取（懒加载），不会递归扫描整个仓库。
- 排序为目录优先、再按名称（数字感知、忽略大小写）。
- 跳过 `.git` 和 `.DS_Store`；单个目录最多显示 300 项，超出显示 `… N more`。
- 每轮对话结束后自动静默刷新已加载目录。
- 插件 id 仍是 `files.sidebar`，原有折叠状态会沿用。
- 状态保存在 `~/.local/state/opencode/latest/tui/plugin.files.sidebar.view.json`。

## 兼容性与已知限制

- 开发和测试环境：OpenCode 2.1.3。
- 文件路径插入使用 OpenCode TUI 的 `currentFocusedEditor` / `EditBufferRenderable` 接口；OpenCode 升级后可能需要适配。
- Ctrl+单击需要终端把 Ctrl 修饰键传给 TUI。如果终端把 Ctrl+单击用于打开链接或上下文菜单，请先关闭该快捷键。
- 没有文件系统 watcher，刷新时机见上。

## 实现要点

- 通过 `sidebar.content` 槽位追加，不改动内置侧边栏。
- 使用 `context.storage.store` 持久化折叠状态。
- 使用 `session.execution.succeeded` 事件触发静默刷新。
- 目录切换调用内置 `session.cd`。
- 文件路径插入调用 `context.renderer.currentFocusedEditor.insertText()`。

## License

MIT
