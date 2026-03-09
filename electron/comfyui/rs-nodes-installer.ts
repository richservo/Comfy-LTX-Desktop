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

interface CustomNodeRepo {
  name: string
  url: string
  dir: string
}

const CUSTOM_NODE_REPOS: CustomNodeRepo[] = [
  { name: 'rs-nodes', url: 'https://github.com/richservo/rs-nodes.git', dir: 'rs-nodes' },
  { name: 'RES4LYF', url: 'https://github.com/ClownsharkBatwing/RES4LYF.git', dir: 'RES4LYF' },
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
      await execPromise('git', ['pull'], { cwd: nodeDir })
    } catch (err) {
      logger.warn(`git pull failed for ${repo.name}, continuing: ${err}`)
    }
  } else {
    onProgress({ phase: 'cloning', message: `Cloning ${repo.name}...` })
    await execPromise(
      'git',
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
  for (const repo of CUSTOM_NODE_REPOS) {
    await installCustomNode(comfyPath, repo, onProgress)
  }

  onProgress({ phase: 'complete', message: 'Custom nodes installed successfully' })
}
