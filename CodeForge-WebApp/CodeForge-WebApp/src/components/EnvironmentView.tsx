import { useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Play, Terminal, FolderCog, MonitorDown } from 'lucide-react';
import type { EnvironmentReport, ExecutionResult, SupportedLanguage } from '../types';

interface EnvironmentViewProps {
  report: EnvironmentReport | null;
  scanning: boolean;
  onRescan: () => void;
  onGoToDesktop: () => void;
}

const TOOL_TEST_LANG: Partial<Record<string, SupportedLanguage>> = {
  python: 'python',
  javac: 'java',
  java: 'java',
  cpp: 'cpp',
  node: 'javascript',
  arduino_cli: 'arduino',
};

function detectBrowserPlatformLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return '로컬 PC';
}

export function EnvironmentView({ report, scanning, onRescan, onGoToDesktop }: EnvironmentViewProps) {
  const [testingToolId, setTestingToolId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ExecutionResult>>({});
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [customPathInput, setCustomPathInput] = useState('');
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [savingOverride, setSavingOverride] = useState(false);

  const browserOs = useMemo(() => detectBrowserPlatformLabel(), []);
  const isRemoteCloudHost = useMemo(() => {
    if (typeof window === 'undefined' || !report) return false;
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const osMismatch =
      (browserOs === 'Windows' && report.platform !== 'win32') ||
      (browserOs === 'macOS' && report.platform !== 'darwin');
    return !isLocalHost || osMismatch;
  }, [browserOs, report]);

  async function handleTestTool(toolId: string) {
    const lang = TOOL_TEST_LANG[toolId];
    if (!lang) return;
    setTestingToolId(toolId);
    try {
      const res = await fetch('/api/environment/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      const data = (await res.json()) as ExecutionResult & { error?: string };
      if (!res.ok) {
        setTestResults((prev) => ({
          ...prev,
          [toolId]: {
            ok: false,
            stage: 'prepare',
            stdout: '',
            stderr: data.error || '검증 실행 실패',
            exitCode: 1,
            durationMs: 0,
            compilerUsed: null,
            timedOut: false,
          },
        }));
      } else {
        setTestResults((prev) => ({ ...prev, [toolId]: data }));
      }
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [toolId]: {
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr: err instanceof Error ? err.message : '네트워크 오류',
          exitCode: 1,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        },
      }));
    } finally {
      setTestingToolId(null);
    }
  }

  async function handleSaveOverride(toolId: string, pathValue: string | null) {
    setSavingOverride(true);
    setOverrideError(null);
    try {
      const res = await fetch('/api/environment/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId, customPath: pathValue }),
      });
      const data = (await res.json()) as EnvironmentReport & { error?: string };
      if (!res.ok) {
        setOverrideError(data.error || '경로 저장에 실패했습니다.');
      } else {
        setEditingToolId(null);
        setCustomPathInput('');
        onRescan();
      }
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : '경로 저장 중 오류가 발생했습니다.');
    } finally {
      setSavingOverride(false);
    }
  }

  const installedCount = report?.tools.filter((t) => t.installed).length ?? 0;
  const totalCount = report?.tools.length ?? 0;

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0F17] px-8 py-8">
      <div className="max-w-[1200px] mx-auto space-y-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              로컬 개발 환경 자동 탐지
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              외부 설정 없이 현재 실행 호스트의 PATH, 레지스트리, JetBrains Toolbox 및 표준 설치 디렉터리를 스캔합니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onRescan}
            disabled={scanning}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? '스캔 중...' : '환경 재탐지'}
          </button>
        </div>

        {/* Cloud Preview vs Local PC Explanation */}
        {isRemoteCloudHost && report && (
          <div className="border border-blue-800/50 bg-blue-950/25 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 max-w-3xl">
              <div className="text-sm font-semibold text-slate-100">
                현재 클라우드 미리보기 서버({report.platform})의 환경을 스캔하고 있습니다
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                브라우저 보안 구조상 웹 미리보기 서버는 사용자님의 {browserOs} PC에 설치된 <strong className="text-white">IntelliJ IDEA</strong>, <strong className="text-white">Arduino IDE</strong>나 <strong className="text-white">로컬 JDK</strong> 폴더에 직접 접근할 수 없습니다. 내 컴퓨터의 로컬 IDE를 자동 감지·실행하려면 데스크톱 빌드 탭에서 앱을 내려받아 내 PC에서 실행해 주세요.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToDesktop}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <MonitorDown className="w-3.5 h-3.5" />
              내 PC용 앱 다운로드
            </button>
          </div>
        )}

        {/* Clean Unboxed Host Summary Row */}
        {report && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-400 font-mono tabular-nums">
            <span>
              스캔 호스트 OS: <strong className="text-slate-200 font-medium">{report.platform} ({report.arch})</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              접속 브라우저: <strong className="text-slate-200 font-medium">{browserOs}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              감지된 도구: <strong className="text-slate-200 font-medium">{installedCount}/{totalCount}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              마지막 스캔: <strong className="text-slate-200 font-medium">{new Date(report.scannedAt).toLocaleTimeString('ko-KR')}</strong>
            </span>
          </div>
        )}

        {/* High-Density Tools Table */}
        <div className="border border-slate-800 bg-[#111827] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0E1420] text-xs font-medium text-slate-400">
                  <th className="py-3 px-4">프로그램 / 도구</th>
                  <th className="py-3 px-4">상태</th>
                  <th className="py-3 px-4">감지된 버전</th>
                  <th className="py-3 px-4">실행 경로 / 탐색 위치</th>
                  <th className="py-3 px-4 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {!report && (
                  <tr>
                    <td colSpan={5} className="py-10 px-4 text-center text-slate-400">
                      로컬 환경 정보를 불러오는 중입니다...
                    </td>
                  </tr>
                )}
                {report?.tools.map((tool) => {
                  const testLang = TOOL_TEST_LANG[tool.id];
                  const testRes = testResults[tool.id];
                  const isTesting = testingToolId === tool.id;
                  const isEditing = editingToolId === tool.id;
                  return (
                    <tr key={tool.id} className="hover:bg-slate-800/35 transition-colors align-top">
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-100">{tool.name}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{tool.languageLabel}</div>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {tool.installed ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            감지됨
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            미설치
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300 tabular-nums">
                        {tool.version || '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        {tool.executablePath ? (
                          <div className="font-mono text-xs text-slate-200 break-all">
                            {tool.executablePath}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs text-slate-400">{tool.installHint}</div>
                            <div className="text-[11px] font-mono text-slate-500">
                              탐색: {tool.searchedLocations.join(', ')}
                            </div>
                          </div>
                        )}

                        {isEditing && (
                          <div className="mt-3 p-3 bg-[#0B0F17] border border-slate-700 rounded-md space-y-2">
                            <div className="text-[11px] text-slate-400">
                              로컬 PC에서 실행 중일 때 실제 실행 파일 전체 경로를 입력하세요
                              (예: <span className="font-mono text-slate-300">C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe</span>, <span className="font-mono text-slate-300">%LOCALAPPDATA%\Programs\Arduino IDE\Arduino IDE.exe</span>, <span className="font-mono text-slate-300">/Applications/Arduino IDE.app</span>)
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={customPathInput}
                                onChange={(e) => setCustomPathInput(e.target.value)}
                                placeholder="실행 파일 전체 경로 입력"
                                className="flex-1 bg-[#141B29] border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-500"
                              />
                              <button
                                type="button"
                                disabled={savingOverride}
                                onClick={() => void handleSaveOverride(tool.id, customPathInput)}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded whitespace-nowrap"
                              >
                                {savingOverride ? '저장 중' : '적용'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingToolId(null);
                                  setOverrideError(null);
                                }}
                                className="px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                              >
                                취소
                              </button>
                            </div>
                            {overrideError && (
                              <div className="text-xs text-rose-400">{overrideError}</div>
                            )}
                          </div>
                        )}

                        {testRes && (
                          <div className="mt-2 pt-2 border-t border-slate-800/80 font-mono text-xs flex items-start gap-2">
                            <Terminal className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" />
                            <span className={testRes.ok ? 'text-emerald-300' : 'text-rose-400'}>
                              {testRes.ok ? testRes.stdout.trim() : testRes.stderr.trim()} ({testRes.durationMs}ms)
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          {tool.installed && testLang && (
                            <button
                              type="button"
                              onClick={() => handleTestTool(tool.id)}
                              disabled={isTesting}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded border border-slate-700 transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              {isTesting ? '실행 중...' : '검증 실행'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingToolId(isEditing ? null : tool.id);
                              setCustomPathInput(tool.executablePath || '');
                              setOverrideError(null);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 bg-slate-800/70 hover:bg-slate-700 rounded border border-slate-700/80 transition-colors"
                          >
                            <FolderCog className="w-3.5 h-3.5" />
                            경로 지정
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
