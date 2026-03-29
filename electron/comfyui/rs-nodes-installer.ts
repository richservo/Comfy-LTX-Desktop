import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import https from 'https'
import { app } from 'electron'
import { logger } from '../logger'

export interface RsNodesProgress {
  phase: 'cloning' | 'updating' | 'installing-deps' | 'installing-git' | 'complete' | 'error'
  message: string
  error?: string
}

/** Cached git binary path — resolved once per session */
let resolvedGitPath: string | null = null

/**
 * Find a working git binary. Checks:
 * 1. System PATH
 * 2. Common Windows install locations
 * 3. Our own portable git in app data
 */
function findGit(): string | null {
  if (resolvedGitPath) return resolvedGitPath

  // 1. Check if git is on PATH
  try {
    const { execFileSync } = require('child_process') as typeof import('child_process')
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const result = (execFileSync(cmd, ['git'], { timeout: 5000 }) as Buffer).toString().trim()
    if (result) {
      const gitPath = result.split('\n')[0].trim()
      resolvedGitPath = gitPath
      logger.info(`Found git on PATH: ${gitPath}`)
      return gitPath
    }
  } catch {
    // Not on PATH
  }

  // 2. Check common install locations (Windows)
  if (process.platform === 'win32') {
    const commonPaths = [
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
      // Portable git in our app data
      path.join(app.getPath('userData'), 'git', 'cmd', 'git.exe'),
    ]
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        resolvedGitPath = p
        logger.info(`Found git at: ${p}`)
        return p
      }
    }
  }

  return null
}

/** Download a file with redirect following */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath)
    const request = (reqUrl: string) => {
      https.get(reqUrl, (response) => {
        // Follow redirects
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close()
          request(response.headers.location)
          return
        }
        if (response.statusCode !== 200) {
          file.close()
          reject(new Error(`Download failed: HTTP ${response.statusCode}`))
          return
        }
        response.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', reject)
      }).on('error', (err) => { file.close(); reject(err) })
    }
    request(url)
  })
}

/**
 * Download and extract portable git for Windows.
 * Uses the official Git for Windows MinGit release — a minimal ~45MB download.
 */
async function installPortableGit(onProgress?: (progress: RsNodesProgress) => void): Promise<string | null> {
  if (process.platform !== 'win32') return null

  const gitDir = path.join(app.getPath('userData'), 'git')
  const gitExe = path.join(gitDir, 'cmd', 'git.exe')

  // Already installed
  if (fs.existsSync(gitExe)) {
    resolvedGitPath = gitExe
    return gitExe
  }

  onProgress?.({ phase: 'installing-git', message: 'Downloading portable git...' })
  logger.info('Downloading portable git (MinGit)...')

  const zipPath = path.join(app.getPath('userData'), 'mingit.zip')
  const mingitUrl = 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/MinGit-2.47.1.2-64-bit.zip'

  try {
    await downloadFile(mingitUrl, zipPath)

    onProgress?.({ phase: 'installing-git', message: 'Extracting portable git...' })

    // Extract using PowerShell (available on all modern Windows)
    fs.mkdirSync(gitDir, { recursive: true })
    await execPromise(
      'powershell',
      ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${gitDir}' -Force`],
      {},
    )

    // Clean up zip
    try { fs.unlinkSync(zipPath) } catch { /* ignore */ }

    if (fs.existsSync(gitExe)) {
      resolvedGitPath = gitExe
      logger.info(`Portable git installed at: ${gitExe}`)
      return gitExe
    }

    logger.error('Portable git extraction succeeded but git.exe not found')
    return null
  } catch (err) {
    logger.error(`Failed to install portable git: ${err}`)
    try { fs.unlinkSync(zipPath) } catch { /* ignore */ }
    return null
  }
}

/**
 * Ensure git is available, installing portable git on Windows if needed.
 * Returns the path to the git binary, or null if unavailable.
 */
export async function ensureGit(onProgress?: (progress: RsNodesProgress) => void): Promise<string | null> {
  const existing = findGit()
  if (existing) return existing

  // Try installing portable git (Windows only)
  if (process.platform === 'win32') {
    return installPortableGit(onProgress)
  }

  logger.error('git not found and cannot auto-install on this platform')
  return null
}

/** Find ComfyUI's Python executable (venv) */
function findComfyPython(comfyPath: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(comfyPath, 'venv', 'Scripts', 'python.exe'),
          path.join(comfyPath, '.venv', 'Scripts', 'python.exe'),
          path.join(comfyPath, 'python_embeded', 'python.exe'),
        ]
      : [
          path.join(comfyPath, 'venv', 'bin', 'python'),
          path.join(comfyPath, '.venv', 'bin', 'python'),
        ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

function execPromise(
  cmd: string,
  args: string[],
  options: { cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...options, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${stderr || err.message}`))
      } else {
        resolve(stdout)
      }
    })
  })
}

/** Run a git command using the resolved git binary */
function gitExec(args: string[], options: { cwd?: string }): Promise<string> {
  const git = resolvedGitPath || 'git'
  return execPromise(git, args, options)
}

interface CustomNodeRepo {
  name: string
  url: string
  dir: string
}

const CUSTOM_NODE_REPOS: CustomNodeRepo[] = [
  { name: 'rs-nodes', url: 'https://github.com/richservo/rs-nodes.git', dir: 'rs-nodes' },
  { name: 'RES4LYF', url: 'https://github.com/ClownsharkBatwing/RES4LYF.git', dir: 'RES4LYF' },
  { name: 'VideoHelperSuite', url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite.git', dir: 'ComfyUI-VideoHelperSuite' },
  { name: 'ComfyUI-RMBG', url: 'https://github.com/1038lab/ComfyUI-RMBG.git', dir: 'comfyui-rmbg' },
  { name: 'ComfyUI-Impact-Pack', url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack.git', dir: 'comfyui-impact-pack' },
  { name: 'ComfyUI_essentials', url: 'https://github.com/cubiq/ComfyUI_essentials.git', dir: 'comfyui_essentials' },
]

async function installCustomNode(
  comfyPath: string,
  repo: CustomNodeRepo,
  onProgress: (progress: RsNodesProgress) => void,
): Promise<void> {
  const customNodesDir = path.join(comfyPath, 'custom_nodes')
  const nodeDir = path.join(customNodesDir, repo.dir)

  fs.mkdirSync(customNodesDir, { recursive: true })

  if (fs.existsSync(path.join(nodeDir, '.git'))) {
    onProgress({ phase: 'updating', message: `Updating ${repo.name}...` })
    try {
      await gitExec(['pull'], { cwd: nodeDir })
    } catch (err) {
      logger.warn(`git pull failed for ${repo.name}, continuing: ${err}`)
    }
  } else if (fs.existsSync(nodeDir)) {
    // Directory exists but not a git repo — init and connect to remote
    // This handles partial installs, ComfyUI Manager installs, or manual copies
    logger.info(`${repo.name} exists without .git — initializing git repo`)
    onProgress({ phase: 'updating', message: `Initializing git for ${repo.name}...` })
    try {
      await gitExec(['init'], { cwd: nodeDir })
      // Use set-url in case origin already exists from a previous failed attempt
      try {
        await gitExec(['remote', 'add', 'origin', repo.url], { cwd: nodeDir })
      } catch {
        await gitExec(['remote', 'set-url', 'origin', repo.url], { cwd: nodeDir })
      }
      await gitExec(['fetch', 'origin'], { cwd: nodeDir })
      // Reset to remote main/master so we're in sync
      try {
        await gitExec(['reset', '--hard', 'origin/main'], { cwd: nodeDir })
      } catch {
        await gitExec(['reset', '--hard', 'origin/master'], { cwd: nodeDir })
      }
      logger.info(`${repo.name} git repo initialized and synced to remote`)
    } catch (err) {
      logger.warn(`git init failed for ${repo.name}, continuing: ${err}`)
    }
  } else {
    onProgress({ phase: 'cloning', message: `Cloning ${repo.name}...` })
    await gitExec(
      ['clone', repo.url, nodeDir],
      { cwd: customNodesDir },
    )
  }

  // Install pip requirements if requirements.txt exists
  const reqFile = path.join(nodeDir, 'requirements.txt')
  if (fs.existsSync(reqFile)) {
    onProgress({ phase: 'installing-deps', message: `Installing ${repo.name} dependencies...` })
    const python = findComfyPython(comfyPath)
    if (python) {
      await execPromise(python, ['-m', 'pip', 'install', '-r', reqFile], {
        cwd: nodeDir,
      })
    } else {
      logger.warn(`Could not find ComfyUI Python venv — skipping pip install for ${repo.name}`)
    }
  }
}

export async function installRsNodes(
  comfyPath: string,
  onProgress: (progress: RsNodesProgress) => void,
): Promise<void> {
  const git = await ensureGit(onProgress)
  if (!git) {
    onProgress({ phase: 'error', message: 'Git is required but could not be found or installed', error: 'git not found' })
    throw new Error('Git is required to install custom nodes but could not be found or installed automatically. Please install Git from https://git-scm.com and try again.')
  }

  for (const repo of CUSTOM_NODE_REPOS) {
    await installCustomNode(comfyPath, repo, onProgress)
  }

  // Install faster-whisper for audio transcription
  const python = findComfyPython(comfyPath)
  if (python) {
    onProgress({ phase: 'installing-deps', message: 'Installing audio transcription (faster-whisper)...' })
    try {
      await execPromise(python, ['-m', 'pip', 'install', 'faster-whisper'], { cwd: comfyPath })
    } catch (err) {
      logger.warn(`Failed to install faster-whisper: ${err}`)
    }
  }

  onProgress({ phase: 'complete', message: 'Custom nodes installed successfully' })
}

/**
 * Check for missing or broken custom nodes and install/repair them.
 * Intended to run on app startup to catch nodes that failed initial install
 * or were removed externally.
 */
export async function checkAndRepairNodes(comfyPath: string): Promise<void> {
  const customNodesDir = path.join(comfyPath, 'custom_nodes')
  if (!fs.existsSync(customNodesDir)) return

  const git = await ensureGit()
  if (!git) {
    logger.error('[startup] Git not available — cannot check/repair custom nodes')
    return
  }

  for (const repo of CUSTOM_NODE_REPOS) {
    const nodeDir = path.join(customNodesDir, repo.dir)
    const hasDir = fs.existsSync(nodeDir)
    const hasGitDir = hasDir && fs.existsSync(path.join(nodeDir, '.git'))

    if (!hasDir) {
      // Missing entirely — clone it
      logger.info(`[startup] ${repo.name} missing — cloning`)
      try {
        await gitExec(['clone', repo.url, nodeDir], { cwd: customNodesDir })
        const reqFile = path.join(nodeDir, 'requirements.txt')
        if (fs.existsSync(reqFile)) {
          const python = findComfyPython(comfyPath)
          if (python) {
            await execPromise(python, ['-m', 'pip', 'install', '-r', reqFile], { cwd: nodeDir })
          }
        }
        logger.info(`[startup] ${repo.name} installed successfully`)
      } catch (err) {
        logger.error(`[startup] Failed to install ${repo.name}: ${err}`)
      }
    } else if (!hasGitDir) {
      // Directory exists but no .git — init and sync
      logger.info(`[startup] ${repo.name} has no .git — initializing`)
      try {
        await gitExec(['init'], { cwd: nodeDir })
        try {
          await gitExec(['remote', 'add', 'origin', repo.url], { cwd: nodeDir })
        } catch {
          await gitExec(['remote', 'set-url', 'origin', repo.url], { cwd: nodeDir })
        }
        await gitExec(['fetch', 'origin'], { cwd: nodeDir })
        try {
          await gitExec(['reset', '--hard', 'origin/main'], { cwd: nodeDir })
        } catch {
          await gitExec(['reset', '--hard', 'origin/master'], { cwd: nodeDir })
        }
        const reqFile = path.join(nodeDir, 'requirements.txt')
        if (fs.existsSync(reqFile)) {
          const python = findComfyPython(comfyPath)
          if (python) {
            await execPromise(python, ['-m', 'pip', 'install', '-r', reqFile], { cwd: nodeDir })
          }
        }
        logger.info(`[startup] ${repo.name} git initialized and synced`)
      } catch (err) {
        logger.error(`[startup] Failed to init ${repo.name}: ${err}`)
      }
    }
  }
}
