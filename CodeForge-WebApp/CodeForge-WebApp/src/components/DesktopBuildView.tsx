import { useState } from 'react';
import { Download, Terminal, Monitor, Cpu, CheckCircle2, AlertCircle } from 'lucide-react';
import { triggerFileDownload } from '../utils/downloadFile';

export function DesktopBuildView() {
  const [downloadingKind, setDownloadingKind] = useState<'desktop' | 'webapp' | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleDownloadBundle(kind: 'desktop' | 'webapp') {
    setDownloadingKind(kind);
    setDownloadStatus(null);
    const url = kind === 'desktop' ? '/api/desktop-bundle' : '/api/app-bundle';
    const filename = kind === 'desktop' ? 'CodeForgeDesktop-Builder.zip' : 'CodeForge-WebApp.zip';
    try {
      await triggerFileDownload(url, filename);
      setDownloadStatus({
        ok: true,
        message: `${filename} 다운로드를 시작했습니다. 압축을 풀고 아래 안내에 따라 실행하세요.`,
      });
    } catch (err) {
      setDownloadStatus({
        ok: false,
        message: err instanceof Error ? err.message : '파일 다운로드에 실패했습니다.',
      });
    } finally {
      setDownloadingKind(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0F17] px-8 py-8">
      <div className="max-w-[1040px] mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              앱 ZIP 다운로드 및 단독 데스크톱(.exe / .app) 빌드
            </h1>
            <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
              현재 웹 워크벤치 전체 소스를 ZIP으로 내려받아 내 PC에서 바로 실행하거나, Python/Java/C++/IntelliJ IDEA/Arduino IDE가 연동되는 단독 실행 파일(.exe / .app) 빌드 키트를 다운로드할 수 있습니다.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleDownloadBundle('webapp')}
              disabled={downloadingKind !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-100 bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              {downloadingKind === 'webapp' ? 'ZIP 생성 중...' : '전체 웹 앱 ZIP 다운로드'}
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadBundle('desktop')}
              disabled={downloadingKind !== null}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              {downloadingKind === 'desktop' ? 'ZIP 생성 중...' : '단독 데스크톱 빌드 키트 (.zip)'}
            </button>
          </div>
        </div>

        {downloadStatus && (
          <div
            className={`px-4 py-3 rounded-md border text-xs flex items-center gap-2 ${
              downloadStatus.ok
                ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                : 'bg-rose-950/30 border-rose-800/50 text-rose-300'
            }`}
          >
            {downloadStatus.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{downloadStatus.message}</span>
          </div>
        )}

        {/* 3 Step Workflow */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="border border-slate-800 bg-[#111827] rounded-lg p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Monitor className="w-4 h-4 text-blue-400 shrink-0" />
              01. 1회 패키징으로 독립 실행
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              빌드 시 PyInstaller가 런타임을 내부에 포함하므로, 완성된 <span className="font-mono text-slate-200">CodeForgeDesktop.exe</span>(또는 <span className="font-mono text-slate-200">.app</span>)는 파이썬이 설치되지 않은 PC에서도 곧바로 실행됩니다.
            </p>
          </div>

          <div className="border border-slate-800 bg-[#111827] rounded-lg p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Cpu className="w-4 h-4 text-blue-400 shrink-0" />
              02. 로컬 컴파일러 · IDE 자동 탐지
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              앱이 켜질 때 PC의 PATH, JAVA_HOME, Program Files, JetBrains Toolbox, macOS Applications를 탐색해 Python, Java, C++, IntelliJ IDEA, Arduino IDE 경로를 스스로 연결합니다.
            </p>
          </div>

          <div className="border border-slate-800 bg-[#111827] rounded-lg p-5 space-y-2.5">
            <div className="flex items-center gap-2 text-slate-200 font-semibold text-sm">
              <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
              03. IntelliJ · Arduino IDE 즉시 열기
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Java 프로젝트는 <span className="font-mono text-slate-200">.idea</span> 및 <span className="font-mono text-slate-200">src/Main.java</span> 구조로, Arduino 코드는 <span className="font-mono text-slate-200">스케치폴더/스케치.ino</span> 구조로 저장되어 각 IDE에서 즉시 열립니다.
            </p>
          </div>
        </div>

        {/* Build Commands */}
        <div className="border border-slate-800 bg-[#111827] rounded-lg divide-y divide-slate-800">
          <div className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">방법 A: Windows / macOS 단독 실행 파일(.exe / .app) 만들기</h2>
              <button
                type="button"
                onClick={() => void handleDownloadBundle('desktop')}
                disabled={downloadingKind !== null}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
              >
                CodeForgeDesktop-Builder.zip 내려받기
              </button>
            </div>
            <p className="text-xs text-slate-400">
              <strong className="text-slate-200">단독 데스크톱 빌드 키트 (.zip)</strong>를 내려받아 압축을 푼 뒤 실행 스크립트(<span className="font-mono text-slate-200">build_windows.bat</span> 또는 <span className="font-mono text-slate-200">build_mac.sh</span>)를 실행하세요.
            </p>
            <pre className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
{`# Windows (압축 해제 폴더에서 실행)
build_windows.bat
# 완료 후 dist\\CodeForgeDesktop.exe 생성됨

# macOS (터미널에서 실행)
chmod +x build_mac.sh && ./build_mac.sh
# 완료 후 dist/CodeForgeDesktop.app 생성됨`}
            </pre>
          </div>

          <div className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-100">방법 B: 현재 웹 워크벤치 전체를 내 PC에서 직접 실행하기</h2>
              <button
                type="button"
                onClick={() => void handleDownloadBundle('webapp')}
                disabled={downloadingKind !== null}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 whitespace-nowrap"
              >
                CodeForge-WebApp.zip 내려받기
              </button>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              내 PC에 설치된 <strong className="text-slate-200">IntelliJ IDEA</strong>, <strong className="text-slate-200">Arduino IDE</strong>, <strong className="text-slate-200">JDK</strong>를 웹 UI에서 직접 실행하려면 <strong className="text-slate-200">전체 웹 앱 ZIP 다운로드</strong> 버튼을 눌러 압축을 푼 뒤 아래 명령으로 실행하세요.
            </p>
            <pre className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded text-xs font-mono text-slate-200 overflow-x-auto">
{`npm install
# Windows PowerShell: $env:GEMINI_API_KEY="여기에_API_KEY"; npm run dev
# macOS / Linux:      GEMINI_API_KEY="여기에_API_KEY" npm run dev`}
            </pre>
          </div>

          <div className="p-5 space-y-2">
            <h2 className="text-sm font-semibold text-slate-100">실행 전 API 키 환경 변수 안내</h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              로컬 PC에서 실행할 때는 운영체제 환경 변수 <span className="font-mono text-slate-200">GEMINI_API_KEY</span>가 설정되어 있어야 Gemini API(`gemini-4-hydrogen`)가 동작합니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
