import { app } from 'electron'
import { logger } from './logger'

export interface GpuInfo {
  available: boolean
  name?: string
  vendor?: string
  supportsRtx: boolean
}

let cachedGpuInfo: GpuInfo | null = null

/**
 * Detect GPU capabilities using Electron's GPU info.
 * RTX Super Resolution requires an NVIDIA GPU.
 */
export async function detectGpu(): Promise<GpuInfo> {
  if (cachedGpuInfo) return cachedGpuInfo

  try {
    const info = await app.getGPUInfo('basic') as { gpuDevice?: Array<{ vendorId: number; deviceId: number; driverVendor?: string; driverVersion?: string }> }
    const devices = info.gpuDevice ?? []

    // NVIDIA vendor ID is 0x10DE
    const nvidiaDevice = devices.find(d => d.vendorId === 0x10DE)
    const supportsRtx = !!nvidiaDevice

    const primaryDevice = devices[0]
    const vendorName = primaryDevice
      ? primaryDevice.vendorId === 0x10DE ? 'NVIDIA'
        : primaryDevice.vendorId === 0x1002 ? 'AMD'
        : primaryDevice.vendorId === 0x8086 ? 'Intel'
        : `Unknown (0x${primaryDevice.vendorId.toString(16)})`
      : 'Unknown'

    cachedGpuInfo = {
      available: devices.length > 0,
      vendor: vendorName,
      supportsRtx,
    }

    logger.info(`GPU detected: vendor=${vendorName}, supportsRtx=${supportsRtx}, devices=${devices.length}`)
    return cachedGpuInfo
  } catch (err) {
    logger.warn(`GPU detection failed: ${err}`)
    cachedGpuInfo = { available: false, supportsRtx: false }
    return cachedGpuInfo
  }
}

/** Synchronous getter — returns cached result after detectGpu() has run */
export function getGpuInfo(): GpuInfo {
  return cachedGpuInfo ?? { available: false, supportsRtx: false }
}

// Keep the old export for backwards compat
export async function checkGPU(): Promise<{ available: boolean; name?: string; vram?: number }> {
  const info = await detectGpu()
  return { available: info.available, name: info.vendor }
}
