<script setup lang="ts">
import type { CloseRequestedEvent } from '@tauri-apps/api/window'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { invoke } from '@tauri-apps/api/core'
import { useToast } from 'primevue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import pkg from '~/../package.json'
import { flushConfigsToLocalStorage } from '~/composables/event'

const toast = useToast()

const closeDialogVisible = ref(false)
// Default ON: persist the current network config before a full quit so the
// next launch can restore it. Users can opt out per-close.
const saveConfigOnExit = ref(true)

// 「收入托盘」: hide the window to the system tray. easytier-core keeps
// running in-process, so the TUN device stays up (network stays connected).
async function minimizeToTray() {
  closeDialogVisible.value = false
  await getCurrentWindow().hide()
  // On macOS also drop the dock icon so the app truly lives in the tray.
  await invoke('set_dock_visibility', { visible: false }).catch(() => {})
}

// 「彻底关闭」: optionally persist configs, then stop every running network
// instance (which releases the TUN interface) and exit the app. The heavy
// lifting (stop + app.exit) lives in the Rust `quit_app` command so the tray
// menu and this dialog share one clean-shutdown code path.
async function fullQuit() {
  closeDialogVisible.value = false
  if (saveConfigOnExit.value) {
    flushConfigsToLocalStorage()
    toast.add({
      severity: 'success',
      summary: '配置已保存',
      detail: '网络配置已写入本地，下次启动可恢复。',
      life: 2500,
    })
  }
  await invoke('quit_app').catch((e: unknown) => {
    console.error('quit_app failed:', e)
  })
}

onBeforeMount(async () => {
  await getCurrentWindow().setTitle(`Genexis: v${pkg.version}`)
  // Intercept the window's close (X) button. The Rust `on_window_event`
  // handler always calls prevent_close(); here we surface the choice to the
  // user and dispatch to minimize-to-tray or full-quit.
  await getCurrentWindow().onCloseRequested(async (event: CloseRequestedEvent) => {
    event.preventDefault()
    closeDialogVisible.value = true
  })
})
</script>

<template>
  <Toast position="bottom-right" />
  <RouterView />
  <Dialog
    v-model:visible="closeDialogVisible"
    modal
    :closable="false"
    :draggable="false"
    header="关闭 Genexis"
    :style="{ width: '26rem' }"
  >
    <div class="flex flex-col gap-3">
      <div class="text-sm text-gray-700 dark:text-gray-300">
        关闭窗口时，你希望如何处理 Genexis？
      </div>
      <div class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        · 收入托盘：隐藏到系统托盘，easytier-core 后台继续运行，TUN 保留（不断网）。<br />
        · 彻底关闭：停止 easytier-core、清理 TUN 网卡并退出应用。
      </div>
      <div class="flex items-center gap-2 pt-1">
        <Checkbox
          v-model="saveConfigOnExit"
          :binary="true"
          input-id="saveCfg"
        />
        <label for="saveCfg" class="text-sm cursor-pointer select-none">彻底关闭时保存当前网络配置（供下次恢复）</label>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <Button
          label="收入托盘"
          icon="pi pi-minus"
          severity="primary"
          autofocus
          @click="minimizeToTray"
        />
        <Button
          label="彻底关闭"
          icon="pi pi-power-off"
          severity="danger"
          @click="fullQuit"
        />
      </div>
    </template>
  </Dialog>
</template>
