import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';

export type ToolId = 'python' | 'javac' | 'java' | 'cpp' | 'node' | 'intellij' | 'arduino' | 'arduino_cli';

export interface DetectedTool {
  id: ToolId;
  name: string;
  category: 'runtime' | 'compiler' | 'ide';
  languageLabel: string;
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  searchedLocations: string[];
  installHint: string;
}

export interface EnvironmentReport {
  platform: string;
  arch: string;
  hostname: string;
  scannedAt: string;
  tools: DetectedTool[];
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function findInPath(commands: string[]): string | null {
  const pathEnv = process.env.PATH || '';
  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];

  for (const cmd of commands) {
    for (const dir of pathDirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, cmd.endsWith(ext) ? cmd : `${cmd}${ext}`);
        if (isExecutableFile(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

function findFirstMatch(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate.includes('*')) {
      const parent = path.dirname(candidate);
      const pattern = path.basename(candidate);
      if (fs.existsSync(parent)) {
        try {
          const prefix = pattern.split('*')[0];
          const suffix = pattern.split('*')[1] || '';
          const entries = fs.readdirSync(parent).sort().reverse();
          for (const entry of entries) {
            if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
              const full = path.join(parent, entry);
              if (fs.existsSync(full)) return full;
            }
          }
        } catch {
          // ignore unreadable directories
        }
      }
    } else if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function probeVersion(executablePath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(executablePath, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 3000);

      child.stdout.on('data', (chunk: Buffer) => {
        if (out.length < 1024) out += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (err.length < 1024) err += chunk.toString('utf8');
      });
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', () => {
        clearTimeout(timer);
        const combined = (out || err).trim();
        const firstLine = combined.split(/\r?\n/)[0]?.trim() || '';
        resolve(firstLine ? firstLine.slice(0, 120) : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function detectJavaTool(toolName: 'javac' | 'java'): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수'];
  const inPath = findInPath([toolName]);
  if (inPath) return { path: inPath, searched };

  const ext = process.platform === 'win32' ? '.exe' : '';
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    searched.push(`JAVA_HOME (${javaHome})`);
    const candidate = path.join(javaHome, 'bin', `${toolName}${ext}`);
    if (isExecutableFile(candidate)) return { path: candidate, searched };
  }

  if (process.platform === 'win32') {
    const dirs = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Zulu',
      'C:\\Program Files\\Microsoft',
    ];
    searched.push(...dirs);
    for (const base of dirs) {
      if (!fs.existsSync(base)) continue;
      try {
        for (const sub of fs.readdirSync(base).sort().reverse()) {
          const candidate = path.join(base, sub, 'bin', `${toolName}.exe`);
          if (isExecutableFile(candidate)) return { path: candidate, searched };
        }
      } catch {
        // ignore
      }
    }
  } else if (process.platform === 'darwin') {
    const jvmBase = '/Library/Java/JavaVirtualMachines';
    searched.push(jvmBase);
    if (fs.existsSync(jvmBase)) {
      try {
        for (const sub of fs.readdirSync(jvmBase).sort().reverse()) {
          const candidate = path.join(jvmBase, sub, 'Contents', 'Home', 'bin', toolName);
          if (isExecutableFile(candidate)) return { path: candidate, searched };
        }
      } catch {
        // ignore
      }
    }
  } else {
    const linuxBase = '/usr/lib/jvm';
    searched.push(linuxBase);
    if (fs.existsSync(linuxBase)) {
      try {
        for (const sub of fs.readdirSync(linuxBase).sort().reverse()) {
          const candidate = path.join(linuxBase, sub, 'bin', toolName);
          if (isExecutableFile(candidate)) return { path: candidate, searched };
        }
      } catch {
        // ignore
      }
    }
  }

  return { path: null, searched };
}

function detectPython(): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수 (python3, python)'];
  const inPath = findInPath(['python3', 'python', 'py']);
  if (inPath) return { path: inPath, searched };

  if (process.platform === 'win32') {
    const localPrograms = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python');
    searched.push(localPrograms, 'C:\\Python*');
    if (fs.existsSync(localPrograms)) {
      try {
        for (const sub of fs.readdirSync(localPrograms).sort().reverse()) {
          const candidate = path.join(localPrograms, sub, 'python.exe');
          if (isExecutableFile(candidate)) return { path: candidate, searched };
        }
      } catch {
        // ignore
      }
    }
  } else {
    const candidates = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'];
    searched.push(...candidates);
    const matched = findFirstMatch(candidates);
    if (matched && isExecutableFile(matched)) return { path: matched, searched };
  }

  return { path: null, searched };
}

function detectCpp(): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수 (g++, clang++)'];
  const inPath = findInPath(['g++', 'clang++']);
  if (inPath) return { path: inPath, searched };

  if (process.platform === 'win32') {
    const candidates = [
      'C:\\msys64\\ucrt64\\bin\\g++.exe',
      'C:\\msys64\\mingw64\\bin\\g++.exe',
      'C:\\MinGW\\bin\\g++.exe',
    ];
    searched.push(...candidates);
    for (const c of candidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
  } else {
    const candidates = ['/usr/bin/g++', '/usr/bin/clang++', '/opt/homebrew/bin/g++'];
    searched.push(...candidates);
    for (const c of candidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
  }

  return { path: null, searched };
}

function findFileRecursive(rootDir: string, targetNames: string[], maxDepth = 5): string | null {
  if (!fs.existsSync(rootDir) || maxDepth < 0) return null;
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true }).sort((a, b) =>
      b.name.localeCompare(a.name)
    );
    for (const entry of entries) {
      const full = path.join(rootDir, entry.name);
      if (entry.isFile() && targetNames.includes(entry.name)) {
        if (isExecutableFile(full)) return full;
      }
    }
    if (maxDepth > 0) {
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = findFileRecursive(path.join(rootDir, entry.name), targetNames, maxDepth - 1);
          if (found) return found;
        }
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return null;
}

function queryWindowsRegistrySync(keyPath: string, valueName?: string): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const args = valueName ? ['query', keyPath, '/v', valueName] : ['query', keyPath, '/s'];
    const output = execFileSync('reg', args, { encoding: 'utf8', timeout: 2500 });
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)$/);
      if (match?.[1]) {
        const raw = match[1].trim().replace(/^"|"$/g, '');
        if (raw.toLowerCase().includes('idea')) {
          return raw;
        }
      }
    }
  } catch {
    // ignore missing registry keys
  }
  return null;
}

function queryMacSpotlightSync(query: string): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const output = execFileSync('mdfind', [query], { encoding: 'utf8', timeout: 2500 });
    const first = output
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.endsWith('.app') && fs.existsSync(s));
    return first || null;
  } catch {
    return null;
  }
}

const OVERRIDE_FILE = path.resolve(process.cwd(), 'workspace', '.tool-overrides.json');

function loadToolOverrides(): Partial<Record<ToolId, string>> {
  try {
    if (!fs.existsSync(OVERRIDE_FILE)) return {};
    return JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8')) as Partial<Record<ToolId, string>>;
  } catch {
    return {};
  }
}

export function setToolOverride(toolId: ToolId, customPath: string | null): { ok: boolean; error?: string } {
  const dir = path.dirname(OVERRIDE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const overrides = loadToolOverrides();
  if (!customPath || !customPath.trim()) {
    delete overrides[toolId];
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2), 'utf8');
    cachedReport = null;
    return { ok: true };
  }

  const trimmed = customPath.trim().replace(/^"|"$/g, '');
  const resolved = path.resolve(trimmed);
  const existsAsApp = process.platform === 'darwin' && resolved.endsWith('.app') && fs.existsSync(resolved);
  if (!existsAsApp && !isExecutableFile(resolved)) {
    return {
      ok: false,
      error: `입력한 경로에서 실행 파일을 찾을 수 없습니다: ${resolved}`,
    };
  }
  overrides[toolId] = resolved;
  fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2), 'utf8');
  cachedReport = null;
  return { ok: true };
}

function detectIntelliJ(): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수 (idea64.exe, idea.cmd, idea.bat, idea.sh, idea)'];
  const inPath = findInPath(['idea64.exe', 'idea.cmd', 'idea.bat', 'idea.sh', 'idea']);
  if (inPath) return { path: inPath, searched };

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const jetbrainsBases = [
      'C:\\Program Files\\JetBrains',
      'C:\\Program Files (x86)\\JetBrains',
      'D:\\Program Files\\JetBrains',
      'D:\\JetBrains',
    ];
    const localPrograms = path.join(localAppData, 'Programs');
    const toolboxScripts = path.join(localAppData, 'JetBrains', 'Toolbox', 'scripts');
    const toolboxApps = path.join(localAppData, 'JetBrains', 'Toolbox', 'apps');
    searched.push(...jetbrainsBases, localPrograms, toolboxScripts, toolboxApps, 'Windows Registry (JetBrains)');

    for (const scriptName of ['idea.cmd', 'idea.bat', 'idea64.exe']) {
      const scriptPath = path.join(toolboxScripts, scriptName);
      if (isExecutableFile(scriptPath)) return { path: scriptPath, searched };
    }

    if (fs.existsSync(localPrograms)) {
      try {
        for (const sub of fs.readdirSync(localPrograms).sort().reverse()) {
          if (sub.toLowerCase().includes('intellij')) {
            const candidate = path.join(localPrograms, sub, 'bin', 'idea64.exe');
            if (isExecutableFile(candidate)) return { path: candidate, searched };
          }
        }
      } catch {
        // ignore
      }
    }

    for (const base of jetbrainsBases) {
      if (!fs.existsSync(base)) continue;
      try {
        for (const sub of fs.readdirSync(base).sort().reverse()) {
          if (sub.toLowerCase().includes('intellij')) {
            const candidate = path.join(base, sub, 'bin', 'idea64.exe');
            if (isExecutableFile(candidate)) return { path: candidate, searched };
          }
        }
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(toolboxApps)) {
      const found = findFileRecursive(toolboxApps, ['idea64.exe'], 5);
      if (found) return { path: found, searched };
    }

    for (const regKey of [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\idea64.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\idea64.exe',
      'HKCU\\SOFTWARE\\JetBrains\\IntelliJ IDEA',
      'HKLM\\SOFTWARE\\JetBrains\\IntelliJ IDEA',
    ]) {
      const regVal = queryWindowsRegistrySync(regKey);
      if (regVal) {
        const candidate = regVal.toLowerCase().endsWith('.exe')
          ? regVal
          : path.join(regVal, 'bin', 'idea64.exe');
        if (isExecutableFile(candidate)) return { path: candidate, searched };
      }
    }
  } else if (process.platform === 'darwin') {
    const userApps = path.join(os.homedir(), 'Applications');
    const toolboxApps = path.join(userApps, 'JetBrains Toolbox');
    searched.push('/Applications/IntelliJ IDEA*.app', userApps, toolboxApps, 'macOS Spotlight (mdfind)');
    const match = findFirstMatch([
      '/Applications/IntelliJ IDEA.app',
      '/Applications/IntelliJ IDEA Ultimate.app',
      '/Applications/IntelliJ IDEA CE.app',
      '/Applications/IntelliJ IDEA Community Edition.app',
      '/Applications/IntelliJ IDEA*.app',
      path.join(userApps, 'IntelliJ IDEA*.app'),
      path.join(toolboxApps, 'IntelliJ IDEA*.app'),
    ]);
    if (match) return { path: match, searched };

    const spotlight =
      queryMacSpotlightSync("kMDItemCFBundleIdentifier == 'com.jetbrains.intellij'") ||
      queryMacSpotlightSync("kMDItemCFBundleIdentifier == 'com.jetbrains.intellij.ce'");
    if (spotlight) return { path: spotlight, searched };
  } else {
    const linuxToolbox = path.join(os.homedir(), '.local', 'share', 'JetBrains', 'Toolbox');
    const linuxCandidates = [
      '/opt/idea/bin/idea.sh',
      '/opt/intellij-idea-community/bin/idea.sh',
      '/opt/intellij-idea-ultimate/bin/idea.sh',
      '/snap/intellij-idea-community/current/bin/idea.sh',
      '/snap/intellij-idea-ultimate/current/bin/idea.sh',
      '/usr/local/bin/idea',
      path.join(linuxToolbox, 'scripts', 'idea'),
    ];
    searched.push(...linuxCandidates, path.join(linuxToolbox, 'apps'));
    for (const c of linuxCandidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
    const foundToolbox = findFileRecursive(path.join(linuxToolbox, 'apps'), ['idea.sh', 'idea'], 5);
    if (foundToolbox) return { path: foundToolbox, searched };
  }

  return { path: null, searched };
}

function detectArduinoIDE(): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수 (arduino-ide, arduino, arduino-ide.exe, arduino.exe)'];
  const inPath = findInPath(['arduino-ide.exe', 'arduino.exe', 'arduino-ide', 'arduino']);
  if (inPath) return { path: inPath, searched };

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Programs', 'Arduino IDE', 'Arduino IDE.exe'),
      path.join(localAppData, 'Programs', 'arduino-ide', 'Arduino IDE.exe'),
      'C:\\Program Files\\Arduino IDE\\Arduino IDE.exe',
      'C:\\Program Files (x86)\\Arduino\\arduino.exe',
      'C:\\Program Files\\Arduino\\arduino.exe',
      'D:\\Program Files\\Arduino IDE\\Arduino IDE.exe',
    ];
    searched.push(...candidates, 'Windows Registry (Arduino IDE)');
    for (const c of candidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
    for (const regKey of [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Arduino IDE.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Arduino IDE.exe',
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\arduino.exe',
    ]) {
      const regVal = queryWindowsRegistrySync(regKey);
      if (regVal && isExecutableFile(regVal)) return { path: regVal, searched };
    }
  } else if (process.platform === 'darwin') {
    const userApps = path.join(os.homedir(), 'Applications');
    searched.push('/Applications/Arduino IDE.app', '/Applications/Arduino.app', userApps, 'macOS Spotlight (mdfind)');
    const match = findFirstMatch([
      '/Applications/Arduino IDE.app',
      '/Applications/Arduino.app',
      path.join(userApps, 'Arduino IDE.app'),
      path.join(userApps, 'Arduino.app'),
    ]);
    if (match) return { path: match, searched };

    const spotlight =
      queryMacSpotlightSync("kMDItemCFBundleIdentifier == 'cc.arduino.IDE2'") ||
      queryMacSpotlightSync("kMDItemCFBundleIdentifier == 'cc.arduino.Arduino'");
    if (spotlight) return { path: spotlight, searched };
  } else {
    const linuxCandidates = [
      '/usr/bin/arduino-ide',
      '/usr/bin/arduino',
      '/usr/local/bin/arduino-ide',
      '/usr/local/bin/arduino',
      '/opt/arduino-ide/arduino-ide',
      '/snap/arduino/current/bin/arduino',
    ];
    searched.push(...linuxCandidates);
    for (const c of linuxCandidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
  }

  return { path: null, searched };
}

function detectArduinoCli(): { path: string | null; searched: string[] } {
  const searched: string[] = ['PATH 환경 변수 (arduino-cli)'];
  const inPath = findInPath(['arduino-cli.exe', 'arduino-cli']);
  if (inPath) return { path: inPath, searched };

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'Arduino15', 'arduino-cli.exe'),
      'C:\\Program Files\\Arduino CLI\\arduino-cli.exe',
      'C:\\arduino-cli\\arduino-cli.exe',
    ];
    searched.push(...candidates);
    for (const c of candidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
  } else {
    const candidates = ['/usr/bin/arduino-cli', '/usr/local/bin/arduino-cli', '/opt/homebrew/bin/arduino-cli'];
    searched.push(...candidates);
    for (const c of candidates) {
      if (isExecutableFile(c)) return { path: c, searched };
    }
  }

  return { path: null, searched };
}

let cachedReport: EnvironmentReport | null = null;

export async function scanEnvironment(forceRefresh = false): Promise<EnvironmentReport> {
  if (cachedReport && !forceRefresh) {
    return cachedReport;
  }

  const overrides = loadToolOverrides();

  const py = overrides.python ? { path: overrides.python, searched: ['사용자 직접 지정 경로'] } : detectPython();
  const javac = overrides.javac ? { path: overrides.javac, searched: ['사용자 직접 지정 경로'] } : detectJavaTool('javac');
  const java = overrides.java ? { path: overrides.java, searched: ['사용자 직접 지정 경로'] } : detectJavaTool('java');
  const cpp = overrides.cpp ? { path: overrides.cpp, searched: ['사용자 직접 지정 경로'] } : detectCpp();
  const nodePath =
    overrides.node || findInPath(['node']) || (isExecutableFile(process.execPath) ? process.execPath : null);
  const idea = overrides.intellij
    ? { path: overrides.intellij, searched: ['사용자 직접 지정 경로'] }
    : detectIntelliJ();
  const arduinoIde = overrides.arduino
    ? { path: overrides.arduino, searched: ['사용자 직접 지정 경로'] }
    : detectArduinoIDE();
  const arduinoCli = overrides.arduino_cli
    ? { path: overrides.arduino_cli, searched: ['사용자 직접 지정 경로'] }
    : detectArduinoCli();

  const [pyVer, javacVer, javaVer, cppVer, nodeVer, arduinoCliVer] = await Promise.all([
    py.path ? probeVersion(py.path, ['--version']) : Promise.resolve(null),
    javac.path ? probeVersion(javac.path, ['-version']) : Promise.resolve(null),
    java.path ? probeVersion(java.path, ['-version']) : Promise.resolve(null),
    cpp.path ? probeVersion(cpp.path, ['--version']) : Promise.resolve(null),
    nodePath ? probeVersion(nodePath, ['-v']) : Promise.resolve(null),
    arduinoCli.path ? probeVersion(arduinoCli.path, ['version']) : Promise.resolve(null),
  ]);

  const tools: DetectedTool[] = [
    {
      id: 'python',
      name: 'Python 인터프리터',
      category: 'runtime',
      languageLabel: 'Python',
      installed: Boolean(py.path),
      executablePath: py.path,
      version: pyVer,
      searchedLocations: py.searched,
      installHint: 'python.org 또는 패키지 관리자(apt, brew, winget)로 Python 3를 설치하세요.',
    },
    {
      id: 'javac',
      name: 'Java 컴파일러 (javac)',
      category: 'compiler',
      languageLabel: 'Java',
      installed: Boolean(javac.path),
      executablePath: javac.path,
      version: javacVer,
      searchedLocations: javac.searched,
      installHint: 'Eclipse Temurin(Adoptium) JDK 17 이상을 설치하고 JAVA_HOME 또는 PATH를 등록하세요.',
    },
    {
      id: 'java',
      name: 'Java 런타임 (java)',
      category: 'runtime',
      languageLabel: 'Java',
      installed: Boolean(java.path),
      executablePath: java.path,
      version: javaVer,
      searchedLocations: java.searched,
      installHint: 'JDK를 설치하면 java 및 javac가 함께 제공됩니다.',
    },
    {
      id: 'cpp',
      name: 'C++ 컴파일러 (g++ / clang++)',
      category: 'compiler',
      languageLabel: 'C++',
      installed: Boolean(cpp.path),
      executablePath: cpp.path,
      version: cppVer,
      searchedLocations: cpp.searched,
      installHint: 'Windows는 MSYS2(ucrt64), macOS는 Xcode CLI, Linux는 g++ 패키지를 설치하세요.',
    },
    {
      id: 'node',
      name: 'Node.js 런타임',
      category: 'runtime',
      languageLabel: 'JavaScript',
      installed: Boolean(nodePath),
      executablePath: nodePath,
      version: nodeVer,
      searchedLocations: ['PATH 환경 변수 (node)', '현재 프로세스 런타임'],
      installHint: 'nodejs.org에서 LTS 버전을 설치하세요.',
    },
    {
      id: 'intellij',
      name: 'IntelliJ IDEA',
      category: 'ide',
      languageLabel: 'IDE 연동',
      installed: Boolean(idea.path),
      executablePath: idea.path,
      version: idea.path ? '설치 경로 확인됨' : null,
      searchedLocations: idea.searched,
      installHint:
        '클라우드 미리보기에서는 로컬 PC의 IntelliJ IDEA에 접근할 수 없습니다. 로컬 PC에서 직접 실행하거나 아래에서 실행 경로를 지정하세요.',
    },
    {
      id: 'arduino',
      name: 'Arduino IDE',
      category: 'ide',
      languageLabel: 'Arduino (.ino)',
      installed: Boolean(arduinoIde.path),
      executablePath: arduinoIde.path,
      version: arduinoIde.path ? '설치 경로 확인됨' : null,
      searchedLocations: arduinoIde.searched,
      installHint:
        'Arduino IDE 2.x를 설치하거나 로컬 PC에서 실행 후 [경로 지정]으로 Arduino IDE.exe / .app을 연결하세요.',
    },
    {
      id: 'arduino_cli',
      name: 'Arduino CLI (선택)',
      category: 'compiler',
      languageLabel: 'Arduino 컴파일 검증',
      installed: Boolean(arduinoCli.path),
      executablePath: arduinoCli.path,
      version: arduinoCliVer,
      searchedLocations: arduinoCli.searched,
      installHint: 'arduino-cli를 설치하면 앱 내부에서 스케치 문법·컴파일 검증을 바로 실행할 수 있습니다.',
    },
  ];

  cachedReport = {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    scannedAt: new Date().toISOString(),
    tools,
  };

  return cachedReport;
}
