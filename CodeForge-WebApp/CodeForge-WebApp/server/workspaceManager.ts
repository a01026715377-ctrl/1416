import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { scanEnvironment } from './envDetector.ts';
import { buildZipBuffer, type ZipEntryInput } from './zipBuilder.ts';

export type SupportedLanguage = 'python' | 'java' | 'cpp' | 'javascript' | 'arduino';

export interface ProjectMeta {
  id: string;
  title: string;
  language: SupportedLanguage;
  filename: string;
  relativeEntryPath: string;
  intellijReady: boolean;
  updatedAt: string;
  lineCount: number;
}

export interface ProjectDetail extends ProjectMeta {
  code: string;
  files: string[];
}

export interface ExecutionResult {
  ok: boolean;
  stage: 'prepare' | 'compile' | 'run';
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  compilerUsed: string | null;
  timedOut: boolean;
}

function resolveWorkspaceRoot(): string {
  const preferred = process.env.CODEFORGE_WORKSPACE_DIR
    ? path.resolve(process.env.CODEFORGE_WORKSPACE_DIR)
    : path.resolve(process.cwd(), 'workspace');
  try {
    fs.mkdirSync(preferred, { recursive: true });
    fs.accessSync(preferred, fs.constants.W_OK);
    return preferred;
  } catch {
    const fallback = path.join(os.tmpdir(), 'codeforge-workspace');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const WORKSPACE_ROOT = resolveWorkspaceRoot();
const MAX_OUTPUT_BYTES = 256 * 1024;
const EXEC_TIMEOUT_MS = 15_000;

function ensureWorkspaceRoot(): void {
  if (!fs.existsSync(WORKSPACE_ROOT)) {
    fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
  }
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return lang === 'python' || lang === 'java' || lang === 'cpp' || lang === 'javascript' || lang === 'arduino';
}

export function sanitizeProjectId(id: string): string {
  const cleaned = id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!cleaned || cleaned.length > 64) {
    throw new Error('유효하지 않은 프로젝트 ID입니다.');
  }
  return cleaned;
}

export function sanitizeFilename(filename: string, language: SupportedLanguage): string {
  const base = path.basename(filename.trim()).replace(/[^a-zA-Z0-9_.-]/g, '');
  const fallback: Record<SupportedLanguage, string> = {
    python: 'main.py',
    java: 'Main.java',
    cpp: 'main.cpp',
    javascript: 'main.js',
    arduino: 'sketch.ino',
  };
  if (!base || base === '.' || base === '..') {
    return fallback[language];
  }
  if (language === 'java' && !base.endsWith('.java')) return `${base.replace(/\.[^.]+$/, '')}.java`;
  if (language === 'python' && !base.endsWith('.py')) return `${base.replace(/\.[^.]+$/, '')}.py`;
  if (language === 'cpp' && !/\.(cpp|cc|cxx)$/i.test(base)) return `${base.replace(/\.[^.]+$/, '')}.cpp`;
  if (language === 'javascript' && !/\.(js|mjs)$/i.test(base)) return `${base.replace(/\.[^.]+$/, '')}.js`;
  if (language === 'arduino' && !base.endsWith('.ino')) return `${base.replace(/\.[^.]+$/, '')}.ino`;
  return base;
}

function resolveProjectDir(projectId: string): string {
  ensureWorkspaceRoot();
  const safeId = sanitizeProjectId(projectId);
  const resolved = path.resolve(WORKSPACE_ROOT, safeId);
  if (!resolved.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error('잘못된 프로젝트 경로입니다.');
  }
  return resolved;
}

function resolveInsideDir(baseDir: string, relativePath: string): string {
  const resolved = path.resolve(baseDir, relativePath);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('허용된 작업 디렉터리를 벗어난 경로입니다.');
  }
  return resolved;
}

function writeIntelliJConfig(projectDir: string, language: SupportedLanguage, entryFile: string, title: string): void {
  const ideaDir = resolveInsideDir(projectDir, '.idea');
  fs.mkdirSync(ideaDir, { recursive: true });

  if (language === 'java') {
    const imlContent = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<module type="JAVA_MODULE" version="4">',
      '  <component name="NewModuleRootManager" inherit-compiler-output="true">',
      '    <exclude-output />',
      '    <content url="file://$MODULE_DIR$">',
      '      <sourceFolder url="file://$MODULE_DIR$/src" isTestSource="false" />',
      '    </content>',
      '    <orderEntry type="inheritedJdk" />',
      '    <orderEntry type="sourceFolder" forTests="false" />',
      '  </component>',
      '</module>',
      '',
    ].join('\n');
    fs.writeFileSync(resolveInsideDir(projectDir, 'project.iml'), imlContent, 'utf8');

    const modulesXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project version="4">',
      '  <component name="ProjectModuleManager">',
      '    <modules>',
      '      <module fileurl="file://$PROJECT_DIR$/project.iml" filepath="$PROJECT_DIR$/project.iml" />',
      '    </modules>',
      '  </component>',
      '</project>',
      '',
    ].join('\n');
    fs.writeFileSync(resolveInsideDir(ideaDir, 'modules.xml'), modulesXml, 'utf8');
  } else if (language === 'cpp') {
    const safeTarget = title.replace(/[^a-zA-Z0-9_]/g, '_') || 'app';
    const cmake = [
      'cmake_minimum_required(VERSION 3.16)',
      `project(${safeTarget})`,
      'set(CMAKE_CXX_STANDARD 17)',
      `add_executable(${safeTarget} ${entryFile})`,
      '',
    ].join('\n');
    fs.writeFileSync(resolveInsideDir(projectDir, 'CMakeLists.txt'), cmake, 'utf8');
  } else {
    const imlContent = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<module type="WEB_MODULE" version="4">',
      '  <component name="NewModuleRootManager">',
      '    <content url="file://$MODULE_DIR$" />',
      '    <orderEntry type="sourceFolder" forTests="false" />',
      '  </component>',
      '</module>',
      '',
    ].join('\n');
    fs.writeFileSync(resolveInsideDir(projectDir, 'project.iml'), imlContent, 'utf8');
    const modulesXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project version="4">',
      '  <component name="ProjectModuleManager">',
      '    <modules>',
      '      <module fileurl="file://$PROJECT_DIR$/project.iml" filepath="$PROJECT_DIR$/project.iml" />',
      '    </modules>',
      '  </component>',
      '</project>',
      '',
    ].join('\n');
    fs.writeFileSync(resolveInsideDir(ideaDir, 'modules.xml'), modulesXml, 'utf8');
  }
}

export function saveProject(input: {
  projectId?: string;
  title: string;
  language: SupportedLanguage;
  filename: string;
  code: string;
}): ProjectDetail {
  ensureWorkspaceRoot();
  const language = input.language;
  const safeFilename = sanitizeFilename(input.filename, language);
  const projectId = input.projectId
    ? sanitizeProjectId(input.projectId)
    : `proj_${language}_${Date.now().toString(36)}`;
  const projectDir = resolveProjectDir(projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  const sketchStem = safeFilename.replace(/\.ino$/i, '') || 'sketch';
  const relativeEntryPath =
    language === 'java'
      ? `src/${safeFilename}`
      : language === 'arduino'
        ? `${sketchStem}/${safeFilename}`
        : safeFilename;
  const entryFullPath = resolveInsideDir(projectDir, relativeEntryPath);
  fs.mkdirSync(path.dirname(entryFullPath), { recursive: true });
  fs.writeFileSync(entryFullPath, input.code, 'utf8');

  const cleanTitle = (input.title || safeFilename).trim().slice(0, 80);
  if (language !== 'arduino') {
    writeIntelliJConfig(projectDir, language, relativeEntryPath, cleanTitle);
  }

  const meta: ProjectMeta = {
    id: projectId,
    title: cleanTitle,
    language,
    filename: safeFilename,
    relativeEntryPath,
    intellijReady: true,
    updatedAt: new Date().toISOString(),
    lineCount: input.code.split(/\r?\n/).length,
  };
  fs.writeFileSync(resolveInsideDir(projectDir, '.codeforge.json'), JSON.stringify(meta, null, 2), 'utf8');

  return {
    ...meta,
    code: input.code,
    files: collectRelativeFiles(projectDir),
  };
}

function collectRelativeFiles(baseDir: string, currentDir = baseDir): string[] {
  const results: string[] = [];
  if (!fs.existsSync(currentDir)) return results;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === '.codeforge.json' || entry.name === 'out' || entry.name === 'bin') continue;
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRelativeFiles(baseDir, full));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}

export function listProjects(): ProjectMeta[] {
  ensureWorkspaceRoot();
  const projects: ProjectMeta[] = [];
  for (const entry of fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const dir = resolveProjectDir(entry.name);
      const metaPath = resolveInsideDir(dir, '.codeforge.json');
      if (fs.existsSync(metaPath)) {
        const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectMeta;
        projects.push(parsed);
      }
    } catch {
      // skip invalid directories
    }
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(projectId: string): ProjectDetail | null {
  const dir = resolveProjectDir(projectId);
  const metaPath = resolveInsideDir(dir, '.codeforge.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectMeta;
  const entryPath = resolveInsideDir(dir, meta.relativeEntryPath);
  const code = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
  return {
    ...meta,
    code,
    files: collectRelativeFiles(dir),
  };
}

export function deleteProject(projectId: string): boolean {
  const dir = resolveProjectDir(projectId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

export function exportProjectZip(projectId: string): { filename: string; buffer: Buffer } | null {
  const dir = resolveProjectDir(projectId);
  const metaPath = resolveInsideDir(dir, '.codeforge.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ProjectMeta;

  const files = collectRelativeFiles(dir);
  const entries: ZipEntryInput[] = files.map((rel) => ({
    name: `${meta.id}/${rel}`,
    content: fs.readFileSync(resolveInsideDir(dir, rel)),
  }));

  return {
    filename: `${meta.id}-intellij-project.zip`,
    buffer: buildZipBuffer(entries),
  };
}

function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  stdinText: string
): Promise<{ stdout: string; stderr: string; exitCode: number | null; durationMs: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 500);
    }, EXEC_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stdout, 'utf8') < MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(stderr, 'utf8') < MAX_OUTPUT_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code,
        durationMs: Date.now() - start,
        timedOut,
      });
    });

    if (stdinText) {
      child.stdin.write(stdinText);
    }
    child.stdin.end();
  });
}

export async function executeProjectCode(params: {
  projectId?: string;
  title?: string;
  language: SupportedLanguage;
  filename: string;
  code: string;
  stdin?: string;
}): Promise<{ project: ProjectDetail; result: ExecutionResult }> {
  const project = saveProject({
    projectId: params.projectId,
    title: params.title || params.filename,
    language: params.language,
    filename: params.filename,
    code: params.code,
  });

  const projectDir = resolveProjectDir(project.id);
  const entryPath = resolveInsideDir(projectDir, project.relativeEntryPath);
  const env = await scanEnvironment(false);
  const findTool = (id: string) => env.tools.find((t) => t.id === id);
  const stdinText = params.stdin || '';

  if (project.language === 'python') {
    const py = findTool('python');
    if (!py?.executablePath) {
      return {
        project,
        result: {
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr: '감지된 Python 인터프리터가 없습니다. [환경 탐지] 탭에서 설치 경로를 확인해 주세요.',
          exitCode: 127,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        },
      };
    }
    const res = await runProcess(py.executablePath, [entryPath], projectDir, stdinText);
    return {
      project,
      result: {
        ok: res.exitCode === 0 && !res.timedOut,
        stage: 'run',
        stdout: res.stdout,
        stderr: res.timedOut ? `${res.stderr}\n[시간 초과] 실행 시간이 15초를 초과했습니다.`.trim() : res.stderr,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        compilerUsed: py.executablePath,
        timedOut: res.timedOut,
      },
    };
  }

  if (project.language === 'javascript') {
    const nodeTool = findTool('node');
    if (!nodeTool?.executablePath) {
      return {
        project,
        result: {
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr: '감지된 Node.js 런타임이 없습니다.',
          exitCode: 127,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        },
      };
    }
    const res = await runProcess(nodeTool.executablePath, [entryPath], projectDir, stdinText);
    return {
      project,
      result: {
        ok: res.exitCode === 0 && !res.timedOut,
        stage: 'run',
        stdout: res.stdout,
        stderr: res.timedOut ? `${res.stderr}\n[시간 초과] 실행 시간이 15초를 초과했습니다.`.trim() : res.stderr,
        exitCode: res.exitCode,
        durationMs: res.durationMs,
        compilerUsed: nodeTool.executablePath,
        timedOut: res.timedOut,
      },
    };
  }

  if (project.language === 'java') {
    const javac = findTool('javac');
    const java = findTool('java');
    if (!javac?.executablePath || !java?.executablePath) {
      return {
        project,
        result: {
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr:
            '현재 실행 호스트에 JDK(javac/java)가 설치되어 있지 않습니다. 우측 상단 [ZIP 저장]으로 IntelliJ IDEA용 프로젝트를 내려받거나, JDK가 설치된 로컬 PC에서 실행해 주세요.',
          exitCode: 127,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        },
      };
    }

    const outDir = resolveInsideDir(projectDir, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const comp = await runProcess(
      javac.executablePath,
      ['-encoding', 'UTF-8', '-d', outDir, entryPath],
      projectDir,
      ''
    );
    if (comp.exitCode !== 0 || comp.timedOut) {
      return {
        project,
        result: {
          ok: false,
          stage: 'compile',
          stdout: comp.stdout,
          stderr: comp.stderr || 'Java 컴파일에 실패했습니다.',
          exitCode: comp.exitCode,
          durationMs: comp.durationMs,
          compilerUsed: javac.executablePath,
          timedOut: comp.timedOut,
        },
      };
    }

    const mainClass = path.basename(project.filename, '.java');
    const run = await runProcess(java.executablePath, ['-cp', outDir, mainClass], projectDir, stdinText);
    return {
      project,
      result: {
        ok: run.exitCode === 0 && !run.timedOut,
        stage: 'run',
        stdout: run.stdout,
        stderr: run.timedOut ? `${run.stderr}\n[시간 초과] 실행 시간이 15초를 초과했습니다.`.trim() : run.stderr,
        exitCode: run.exitCode,
        durationMs: comp.durationMs + run.durationMs,
        compilerUsed: `${javac.executablePath} -> ${java.executablePath}`,
        timedOut: run.timedOut,
      },
    };
  }

  if (project.language === 'arduino') {
    const cli = findTool('arduino_cli');
    if (!cli?.executablePath) {
      return {
        project,
        result: {
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr:
            'Arduino 스케치는 PC에 연결된 Arduino IDE에서 보드/포트를 선택해 업로드·실행해야 합니다. 상단 [Arduino IDE로 열기] 또는 [ZIP] 버튼을 이용해 스케치를 열어 주세요. (arduino-cli를 설치하면 앱 내 컴파일 검증도 지원됩니다.)',
          exitCode: 127,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        },
      };
    }
    const sketchDir = path.dirname(entryPath);
    const comp = await runProcess(
      cli.executablePath,
      ['compile', '--fqbn', 'arduino:avr:uno', sketchDir],
      projectDir,
      ''
    );
    return {
      project,
      result: {
        ok: comp.exitCode === 0 && !comp.timedOut,
        stage: 'compile',
        stdout: comp.stdout || 'Arduino Uno(arduino:avr:uno) 대상 컴파일 검증 성공',
        stderr: comp.stderr,
        exitCode: comp.exitCode,
        durationMs: comp.durationMs,
        compilerUsed: cli.executablePath,
        timedOut: comp.timedOut,
      },
    };
  }

  // C++
  const cpp = findTool('cpp');
  if (!cpp?.executablePath) {
    return {
      project,
      result: {
        ok: false,
        stage: 'prepare',
        stdout: '',
        stderr: '감지된 C++ 컴파일러(g++ / clang++)가 없습니다. [환경 탐지] 탭에서 확인해 주세요.',
        exitCode: 127,
        durationMs: 0,
        compilerUsed: null,
        timedOut: false,
      },
    };
  }

  const binDir = resolveInsideDir(projectDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const exePath = resolveInsideDir(binDir, process.platform === 'win32' ? 'program.exe' : 'program');
  const comp = await runProcess(
    cpp.executablePath,
    ['-std=c++17', '-O2', entryPath, '-o', exePath],
    projectDir,
    ''
  );
  if (comp.exitCode !== 0 || comp.timedOut) {
    return {
      project,
      result: {
        ok: false,
        stage: 'compile',
        stdout: comp.stdout,
        stderr: comp.stderr || 'C++ 컴파일에 실패했습니다.',
        exitCode: comp.exitCode,
        durationMs: comp.durationMs,
        compilerUsed: cpp.executablePath,
        timedOut: comp.timedOut,
      },
    };
  }

  const run = await runProcess(exePath, [], projectDir, stdinText);
  return {
    project,
    result: {
      ok: run.exitCode === 0 && !run.timedOut,
      stage: 'run',
      stdout: run.stdout,
      stderr: run.timedOut ? `${run.stderr}\n[시간 초과] 실행 시간이 15초를 초과했습니다.`.trim() : run.stderr,
      exitCode: run.exitCode,
      durationMs: comp.durationMs + run.durationMs,
      compilerUsed: cpp.executablePath,
      timedOut: run.timedOut,
    },
  };
}

export async function openProjectInIDE(
  projectId: string,
  preferredIde?: 'intellij' | 'arduino'
): Promise<{
  launched: boolean;
  message: string;
  executablePath: string | null;
  projectDir: string;
}> {
  const projectDir = resolveProjectDir(projectId);
  const project = getProject(projectId);
  if (!project) {
    throw new Error('프로젝트를 찾을 수 없습니다.');
  }
  const entryPath = resolveInsideDir(projectDir, project.relativeEntryPath);
  const env = await scanEnvironment(false);
  const targetIde = preferredIde || (project.language === 'arduino' ? 'arduino' : 'intellij');
  const ideTool = env.tools.find((t) => t.id === targetIde);
  const ideLabel = targetIde === 'arduino' ? 'Arduino IDE' : 'IntelliJ IDEA';

  if (!ideTool?.executablePath) {
    return {
      launched: false,
      message: `현재 실행 환경에서 ${ideLabel}가 감지되지 않았습니다. 프로젝트 ZIP을 다운로드한 뒤 로컬 PC의 ${ideLabel}에서 열어 주세요.`,
      executablePath: null,
      projectDir,
    };
  }

  const launchArgs = targetIde === 'arduino' ? [entryPath] : [projectDir, entryPath];

  if (process.platform === 'darwin' && ideTool.executablePath.endsWith('.app')) {
    const child = spawn('open', ['-a', ideTool.executablePath, ...launchArgs], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.unref();
  } else {
    const child = spawn(ideTool.executablePath, launchArgs, {
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.unref();
  }

  return {
    launched: true,
    message: `${ideLabel}에서 프로젝트를 실행했습니다: ${targetIde === 'arduino' ? entryPath : projectDir}`,
    executablePath: ideTool.executablePath,
    projectDir,
  };
}
