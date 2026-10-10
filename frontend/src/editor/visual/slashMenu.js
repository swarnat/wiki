import { Plugin, PluginKey } from 'prosemirror-state'

/**
 * A deliberately small, framework-free slash menu for the Visual editor.
 *
 * The editor is native ProseMirror inside a Vue screen, so mounting React just for this menu would
 * add a second UI runtime at the most frequently updated point in the editor. This plugin keeps the
 * ProseMirror integration isolated here and asks the component for the actions it already exposes in
 * its toolbars. The slash and query remain ordinary document text until an action is chosen.
 */

const slashMenuKey = new PluginKey('visualSlashMenu')

/** The slash query immediately before a collapsed selection, or null. */
function queryAtSelection(state) {
  const { $cursor } = state.selection
  if (!$cursor || !$cursor.parent.isTextblock) {
    return null
  }
  const before = $cursor.parent.textBetween(0, $cursor.parentOffset, undefined, '\ufffc')
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before)
  if (!match) {
    return null
  }
  return {
    from: $cursor.pos - match[1].length - 1,
    to: $cursor.pos,
    text: match[1].toLocaleLowerCase()
  }
}

function matches(item, query) {
  if (!query) {
    return true
  }
  return [item.label, ...(item.keywords ?? [])].join(' ').toLocaleLowerCase().includes(query)
}

/**
 * @param {object} options
 * @param {() => Array<{ key: string, label: string, keywords?: string[], run: () => void }>} options.items
 */
export function slashMenu({ items }) {
  let controller = null

  return new Plugin({
    key: slashMenuKey,
    props: {
      handleKeyDown(_view, event) {
        if (!controller?.shown) {
          return false
        }
        if (event.key === 'ArrowDown') {
          controller.move(1)
        } else if (event.key === 'ArrowUp') {
          controller.move(-1)
        } else if (event.key === 'Enter') {
          controller.choose()
        } else if (event.key === 'Escape') {
          controller.dismiss()
        } else {
          return false
        }
        event.preventDefault()
        return true
      }
    },
    view(editorView) {
      const menu = document.createElement('div')
      menu.className = 'visual-slash-menu'
      menu.hidden = true
      menu.setAttribute('role', 'listbox')

      const surface = editorView.dom.parentNode
      surface.append(menu)

      let query = null
      let visibleItems = []
      let selected = 0
      let dismissedAt = null

      const render = () => {
        menu.replaceChildren()
        visibleItems.forEach((item, index) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'visual-slash-menu-item'
          button.textContent = item.label
          button.setAttribute('role', 'option')
          button.setAttribute('aria-selected', index === selected ? 'true' : 'false')
          if (index === selected) {
            button.classList.add('is-selected')
          }
          // Keep the document selection in place until the command has removed the slash query.
          button.addEventListener('mousedown', (event) => event.preventDefault())
          button.addEventListener('mouseenter', () => {
            selected = index
            render()
          })
          button.addEventListener('click', () => choose(index))
          menu.append(button)
        })
      }

      const hide = () => {
        menu.hidden = true
        visibleItems = []
        query = null
      }

      const choose = (index = selected) => {
        const item = visibleItems[index]
        if (!item || !query) {
          return
        }
        const { from, to } = query
        hide()
        editorView.dispatch(editorView.state.tr.delete(from, to))
        item.run()
      }

      const update = (view) => {
        const next = view.editable ? queryAtSelection(view.state) : null
        const signature = next ? `${next.from}:${next.to}:${next.text}` : null
        if (!next || signature === dismissedAt) {
          hide()
          return
        }
        dismissedAt = null
        if (query?.text !== next.text) {
          selected = 0
        }
        query = next
        visibleItems = items().filter((item) => matches(item, query.text))
        if (visibleItems.length === 0) {
          hide()
          return
        }
        selected = Math.min(selected, visibleItems.length - 1)
        render()

        const coords = view.coordsAtPos(next.from)
        const box = surface.getBoundingClientRect()
        menu.hidden = false
        menu.style.top = `${coords.bottom - box.top + 6}px`
        menu.style.left = `${Math.max(0, Math.min(coords.left - box.left, box.width - menu.offsetWidth))}px`
      }

      controller = {
        get shown() {
          return !menu.hidden
        },
        move(step) {
          selected = (selected + step + visibleItems.length) % visibleItems.length
          render()
          menu.children[selected]?.scrollIntoView({ block: 'nearest' })
        },
        choose,
        dismiss() {
          dismissedAt = query ? `${query.from}:${query.to}:${query.text}` : null
          hide()
        }
      }

      update(editorView)
      return {
        update,
        destroy() {
          controller = null
          menu.remove()
        }
      }
    }
  })
}
