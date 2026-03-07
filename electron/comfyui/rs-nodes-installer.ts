import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import { logger } from '../logger'

export interface RsNodesProgress {
  phase: 'cloning' | 'updating' | 'installing-deps' | 'complete' | 'error'
  message: string
  error?: string
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

export async function installRsNodes(
  comfyPath: string,
  onProgress: (progress: RsNodesProgress) => void,
): Promise<void> {
  const customNodesDir = path.join(comfyPath, 'custom_nodes')
  const rsNodesDir = path.join(customNodesDir, 'rs-nodes')

  // Ensure custom_nodes directory exists
  fs.mkdirSync(customNodesDir, { recursive: true })

  if (fs.existsSync(path.join(rsNodesDir, '.git'))) {
    // Update existing
    onProgress({ phase: 'updating', message: 'Updating rs-nodes...' })
    try {
      await execPromise('git', ['pull'], { cwd: rsNodesDir })
    } catch (err) {
      logger.warn(`git pull failed for rs-nodes, continuing: ${err}`)
    }
  } else {
    // Fresh clone
    onProgress({ phase: 'cloning', message: 'Cloning rs-nodes...' })
    await execPromise(
      'git',
      ['clone', 'https://github.com/richservo/rs-nodes.git', rsNodesDir],
      { cwd: customNodesDir },
    )
  }

  // Install pip requirements if requirements.txt exists
  const reqFile = path.join(rsNodesDir, 'requirements.txt')
  if (fs.existsSync(reqFile)) {
    onProgress({ phase: 'installing-deps', message: 'Installing rs-nodes dependencies...' })
    const python = findComfyPython(comfyPath)
    if (python) {
      await execPromise(python, ['-m', 'pip', 'install', '-r', reqFile], {
        cwd: rsNodesDir,
      })
    } else {
      logger.warn('Could not find ComfyUI Python venv — skipping pip install for rs-nodes')
    }
  }

  onProgress({ phase: 'complete', message: 'rs-nodes installed successfully' })
}
