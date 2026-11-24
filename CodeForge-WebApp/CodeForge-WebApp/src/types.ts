export type NavTab = 'workbench' | 'environment' | 'projects' | 'desktop';

export type SupportedLanguage = 'python' | 'java' | 'cpp' | 'javascript' | 'arduino';
export type PreferredLanguage = 'auto' | SupportedLanguage;
export type ReasoningLevel = 'low' | 'medium' | 'high';

export interface DetectedTool {
  id: 'python' | 'javac' | 'java' | 'cpp' | 'node' | 'intellij' | 'arduino' | 'arduino_cli';
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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: string;
  language?: string;
  filename?: string;
  suggestedNextSteps?: string[];
}
