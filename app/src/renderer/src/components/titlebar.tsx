// The title-bar row (spec section 2): the sidebar's part holds the toggle and the wordmark; the content part holds
// the current screen's title on the left and its actions on the right. Screens fill those two with <TitleBarSlot>.
// The two parts are separate elements so the page can put the sidebar between them: Tab then goes toggle, sidebar,
// the screen's title row, the screen (audit-1028 finding 24).
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Logo } from './brand'
import { IconButton, IS_MAC, MOD } from './ui'

type Slots = { title: HTMLElement | null; actions: HTMLElement | null }
type SlotsCtx = { slots: Slots; setTitle: (el: HTMLElement | null) => void; setActions: (el: HTMLElement | null) => void }

const Ctx = createContext<SlotsCtx | null>(null)

const useSlots = (who: string): SlotsCtx => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error(`${who} must be inside <TitleBarProvider>`)
  return ctx
}

export function TitleBarProvider({ children }: { children: ReactNode }) {
  const [slots, setSlots] = useState<Slots>({ title: null, actions: null })
  const setTitle = useCallback((title: HTMLElement | null) => setSlots((s) => (s.title === title ? s : { ...s, title })), [])
  const setActions = useCallback((actions: HTMLElement | null) => setSlots((s) => (s.actions === actions ? s : { ...s, actions })), [])
  const value = useMemo(() => ({ slots, setTitle, setActions }), [slots, setTitle, setActions])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * A screen's title and actions, drawn in the title-bar row. Render one per screen, anywhere in it. A string title
 * becomes the screen's heading; pass an element instead for anything richer (a title you can rename).
 */
export function TitleBarSlot({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  const { slots } = useSlots('TitleBarSlot')
  return (
    <>
      {title != null && slots.title && createPortal(typeof title === 'string' ? <h1 className="tb-h">{title}</h1> : title, slots.title)}
      {actions != null && slots.actions && createPortal(actions, slots.actions)}
    </>
  )
}

/** The sidebar's part of the row. On a Mac the traffic lights sit at its left (main/window.ts centres them on it). */
export function TitleBar({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  const label = rail ? 'Show the sidebar' : 'Collapse the sidebar'
  return (
    <div className="titlebar tb-side">
      <IconButton
        icon="sidebar"
        label={label}
        className="sbt"
        shortcut={`${MOD}\\`}
        onClick={() => onToggle()}
        aria-expanded={!rail}
        aria-controls="sidebar"
        aria-keyshortcuts={IS_MAC ? 'Meta+\\' : 'Control+\\'}
        data-testid="sidebar-toggle"
      />
      <div className="wordmark" aria-hidden>
        <span className="logo">
          <Logo />
        </span>
        Reel Studio
      </div>
    </div>
  )
}

/** The screen's part of the row, after the sidebar in the page. Windows draws its window buttons at its right. */
export function TitleBarMain() {
  const { setTitle, setActions } = useSlots('TitleBarMain')
  return (
    <header className="titlebar tb-main">
      <div className="tb-title" ref={setTitle} data-testid="titlebar-title" />
      <div className="tb-actions" ref={setActions} data-testid="titlebar-actions" />
    </header>
  )
}
