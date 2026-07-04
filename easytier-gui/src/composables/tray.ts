import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { TrayIcon } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import pkg from '~/../package.json'

const DEFAULT_TRAY_NAME = 'main'

// Restore (only) the main window from the tray. The Rust-side
// `on_tray_icon_event` left-click handler still toggles visibility; this
// helper is used by the menu's "显示窗口" item and is intentionally
// restore-only (it never hides).
async function showMainWindow() {
  const win = getCurrentWindow()
  await win.show()
  await win.unminimize().catch(() => {})
  await win.setFocus()
  await invoke('set_dock_visibility', { visible: true }).catch(() => {})
}

// Kept for the JS-side tray icon `action` callback path. The Rust
// `on_tray_icon_event` handler is what actually fires on most platforms; this
// stays here so any platform that routes tray clicks through the JS action
// keeps working.
async function toggleVisibility() {
  const win = getCurrentWindow()
  if (await win.isVisible()) {
    await win.hide()
    await invoke('set_dock_visibility', { visible: false }).catch(() => {})
  }
  else {
    await showMainWindow()
  }
}

export async function useTray(init: boolean = false) {
  let tray
  try {
    tray = await TrayIcon.getById(DEFAULT_TRAY_NAME)
    if (!tray) {
      tray = await TrayIcon.new({
        tooltip: `Genexis\n${pkg.version}`,
        title: `Genexis\n${pkg.version}`,
        id: DEFAULT_TRAY_NAME,
        menu: await Menu.new({
          id: 'main',
          items: await generateMenuItem(),
        }),
        action: async () => {
          toggleVisibility()
        },
      })
    }
  }
  catch (error) {
    console.warn('Error while creating tray icon:', error)
    return null
  }

  if (init) {
    tray.setTooltip(`Genexis\n${pkg.version}`)
    tray.setMenuOnLeftClick(false)
    tray.setMenu(await Menu.new({
      id: 'main',
      items: await generateMenuItem(),
    }))
  }

  return tray
}

export async function generateMenuItem() {
  return [
    await MenuItemShow('显示窗口'),
    await PredefinedMenuItem.new({ item: 'Separator' }),
    await MenuItemExit('彻底退出'),
  ]
}

// "彻底退出": stop easytier-core (releases TUN) then exit. Replaces the old
// PredefinedMenuItem "Quit", which hard-quit without cleaning up network
// instances / TUN. Same code path as the close dialog's "彻底关闭".
export async function MenuItemExit(text: string) {
  return await MenuItem.new({
    id: 'full-exit',
    text,
    action: async () => {
      await invoke('quit_app').catch((e: unknown) => {
        console.error('quit_app failed from tray:', e)
      })
    },
  })
}

// "显示窗口": restore the window from the tray (show + focus + dock).
export async function MenuItemShow(text: string) {
  return await MenuItem.new({
    id: 'show',
    text,
    action: async () => {
      await showMainWindow()
    },
  })
}

export async function setTrayMenu(items: (MenuItem | PredefinedMenuItem)[] | undefined = undefined) {
  const tray = await useTray()
  if (!tray)
    return
  const menu = await Menu.new({
    id: 'main',
    items: items || await generateMenuItem(),
  })
  tray.setMenu(menu)
}

export async function setTrayRunState(isRunning: boolean = false) {
  const tray = await useTray()
  if (!tray)
    return
  tray.setIcon(isRunning ? 'icons/icon-inactive.ico' : 'icons/icon.ico')
}

export async function setTrayTooltip(tooltip: string) {
  if (tooltip) {
    const tray = await useTray()
    if (!tray)
      return
    tray.setTooltip(`Genexis\n${pkg.version}\n${tooltip}`)
    tray.setTitle(`Genexis\n${pkg.version}\n${tooltip}`)
  }
}
