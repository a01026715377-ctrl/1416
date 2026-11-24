import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Play,
  Copy,
  Check,
  Download,
  ExternalLink,
  Wrench,
  Send,
  Save,
  Terminal,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { triggerFileDownload } from '../utils/downloadFile';
import type {
  ChatMessage,
  EnvironmentReport,
  ExecutionResult,
  PreferredLanguage,
  ReasoningLevel,
  SupportedLanguage,
} from '../types';

interface WorkbenchViewProps {
  envReport: EnvironmentReport | null;
  onGoToEnvironment: () => void;
  messages: ChatMessage[];
  chatLoading: boolean;
  onSendPrompt: (prompt: string, preferredLang: PreferredLanguage, reasoning: ReasoningLevel) => void;
  projectId: string | null;
  projectTitle: string;
  language: SupportedLanguage;
  filename: string;
  code: string;
  stdinText: string;
  onChangeLanguage: (lang: SupportedLanguage) => void;
  onChangeFilename: (name: string) => void;
  onChangeCode: (code: string) => void;
  onChangeStdin: (stdin: string) => void;
  onSaveCode: () => void;
  saving: boolean;
  onRunCode: () => void;
  running: boolean;
  executionResult: ExecutionResult | null;
  onOpenIDE: (ide: 'intellij' | 'arduino') => void;
  ideNotice: string | null;
}

const STARTER_PROMPTS: { label: string; prompt: string; lang: PreferredLanguage }[] = [
  {
    label: 'Python으로 퀵소트 성능 테스트',
    prompt: 'Python으로 퀵소트와 내장 정렬의 실행 시간을 비교 출력하는 코드를 작성해줘.',
    lang: 'python',
  },
  {
    label: 'C++17로 이진 탐색 구현',
    prompt: 'C++17로 정렬된 배열에서 이진 탐색(Binary Search)을 수행하고 표준 입력으로 타겟 값을 받아 인덱스를 출력하는 코드를 짜줘.',
    lang: 'cpp',
  },
  {
    label: 'Java로 성적 통계 콘솔 프로그램',
    prompt: 'Java로 학생 이름과 점수를 처리해 평균, 최고점, 등급을 출력하는 Main.java 콘솔 프로그램을 만들어줘.',
    lang: 'java',
  },
  {
    label: 'Arduino 서보모터 제어 스케치',
    prompt: '아두이노의 서보모터(Servo.h)를 9번 핀에 연결해 0도에서 180도로 부드럽게 왕복 제어하는 스케치 코드를 작성해줘.',
    lang: 'arduino',
  },
];

const LANG_OPTIONS: { id: SupportedLanguage; label: string; defaultFile: string }[] = [
  { id: 'python', label: 'Python', defaultFile: 'main.py' },
  { id: 'java', label: 'Java', defaultFile: 'Main.java' },
  { id: 'cpp', label: 'C++', defaultFile: 'main.cpp' },
  { id: 'javascript', label: 'JavaScript', defaultFile: 'main.js' },
  { id: 'arduino', label: 'Arduino (.ino)', defaultFile: 'sketch.ino' },
];

export function WorkbenchView({
  envReport,
  onGoToEnvironment,
  messages,
  chatLoading,
  onSendPrompt,
  projectId,
  projectTitle,
  language,
  filename,
  code,
  stdinText,
  onChangeLanguage,
  onChangeFilename,
  onChangeCode,
  onChangeStdin,
  onSaveCode,
  saving,
  onRunCode,
  running,
  executionResult,
  onOpenIDE,
  ideNotice,
}: WorkbenchViewProps) {
  const [promptInput, setPromptInput] = useState('');
  const [preferredLang, setPreferredLang] = useState<PreferredLanguage>('auto');
  const [reasoning, setReasoning] = useState<ReasoningLevel>('medium');
  const [copied, setCopied] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  const lineCount = Math.max(1, code.split('\n').length);

  function handleSubmitPrompt(text?: string) {
    const target = (text ?? promptInput).trim();
    if (!target || chatLoading) return;
    if (!text) setPromptInput('');
    onSendPrompt(target, preferredLang, reasoning);
  }

  function handlePromptKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitPrompt();
    }
  }

  function handleEditorKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = code.slice(0, start) + '    ' + code.slice(end);
      onChangeCode(next);
      requestAnimationFrame(() => {
        if (editorRef.current) {
          editorRef.current.selectionStart = start + 4;
          editorRef.current.selectionEnd = start + 4;
        }
      });
    }
  }

  async function handleCopyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard fallback ignored
    }
  }

  function handleAutoFix() {
    if (!executionResult || executionResult.ok) return;
    const errorLog = [executionResult.stderr, executionResult.stdout].filter(Boolean).join('\n').trim();
    const fixPrompt = `방금 실행에서 다음 ${executionResult.stage === 'compile' ? '컴파일' : '실행'} 오류가 발생했습니다. 원인을 간단히 설명하고 수정된 전체 코드를 작성해 주세요.\n\n[오류 로그]\n${errorLog}`;
    onSendPrompt(fixPrompt, language, 'high');
  }

  const pyReady = envReport?.tools.find((t) => t.id === 'python')?.installed ?? false;
  const javaReady =
    (envReport?.tools.find((t) => t.id === 'javac')?.installed &&
      envReport?.tools.find((t) => t.id === 'java')?.installed) ??
    false;
  const cppReady = envReport?.tools.find((t) => t.id === 'cpp')?.installed ?? false;
  const ideaReady = envReport?.tools.find((t) => t.id === 'intellij')?.installed ?? false;
  const arduinoReady = envReport?.tools.find((t) => t.id === 'arduino')?.installed ?? false;

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row bg-[#0B0F17]">
      {/* Left Pane: AI Prompt Assistant */}
      <section
        aria-label="AI 코딩 프롬프트"
        className="w-full lg:w-[430px] xl:w-[460px] shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-800/90 bg-[#0F141F] h-[420px] lg:h-auto lg:min-h-0"
      >
        {/* Environment Strip */}
        <div className="px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-400 truncate">
            <span className={pyReady ? 'text-emerald-400' : 'text-slate-500'}>
              Python {pyReady ? '가능' : '없음'}
            </span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className={javaReady ? 'text-emerald-400' : 'text-slate-500'}>
              Java {javaReady ? '가능' : '없음'}
            </span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className={cppReady ? 'text-emerald-400' : 'text-slate-500'}>
              C++ {cppReady ? '가능' : '없음'}
            </span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className={ideaReady ? 'text-emerald-400' : 'text-slate-500'}>
              IDEA {ideaReady ? '연결' : 'ZIP'}
            </span>
            <span aria-hidden="true" className="text-slate-700">·</span>
            <span className={arduinoReady ? 'text-emerald-400' : 'text-slate-500'}>
              Arduino {arduinoReady ? '연결' : 'ZIP'}
            </span>
          </div>
          <button
            type="button"
            onClick={onGoToEnvironment}
            className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap shrink-0"
          >
            상세 보기
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="py-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  자연어로 코딩을 요청해 보세요
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  원하는 언어와 기능을 채팅하듯 입력하면 실행 가능한 코드를 생성하고, PC에 감지된 컴파일러로 즉시 실행합니다.
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-400">빠른 시작 예시</div>
                {STARTER_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setPreferredLang(item.lang);
                      handleSubmitPrompt(item.prompt);
                    }}
                    className="w-full text-left px-3.5 py-2.5 text-xs text-slate-200 bg-[#141B29] hover:bg-[#192234] border border-slate-800 rounded-md transition-colors"
                  >
                    <div className="font-medium text-slate-100">{item.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400 line-clamp-1">{item.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`space-y-1.5 ${
                  msg.role === 'user' ? 'pl-6' : ''
                }`}
              >
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className={msg.role === 'user' ? 'text-blue-400 font-medium' : msg.role === 'error' ? 'text-rose-400 font-medium' : 'text-slate-300 font-medium'}>
                    {msg.role === 'user' ? '나' : msg.role === 'error' ? '오류' : 'Gemini'}
                    {msg.filename && msg.language && msg.language !== 'none' && (
                      <span className="ml-2 font-mono text-slate-400">
                        · {msg.filename} ({msg.language})
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums">{msg.timestamp}</span>
                </div>
                <div
                  className={`rounded-md px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words border ${
                    msg.role === 'user'
                      ? 'bg-blue-950/35 border-blue-800/40 text-slate-100'
                      : msg.role === 'error'
                        ? 'bg-rose-950/30 border-rose-800/50 text-rose-200'
                        : 'bg-[#141B29] border-slate-800/90 text-slate-200'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.suggestedNextSteps && msg.suggestedNextSteps.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {msg.suggestedNextSteps.map((step) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => handleSubmitPrompt(step)}
                        disabled={chatLoading}
                        className="text-left px-2.5 py-1 text-[11px] text-slate-300 hover:text-white bg-[#141B29] hover:bg-slate-800 border border-slate-800 rounded transition-colors"
                      >
                        {step}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
          {chatLoading && (
            <div className="px-3.5 py-2.5 text-xs text-slate-400 bg-[#141B29] border border-slate-800 rounded-md">
              코드를 설계하고 작성하는 중입니다...
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Prompt Input Composer */}
        <div className="p-3.5 border-t border-slate-800/90 bg-[#0D121C] space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'auto', label: '자동' },
                  { id: 'python', label: 'Py' },
                  { id: 'java', label: 'Java' },
                  { id: 'cpp', label: 'C++' },
                  { id: 'javascript', label: 'JS' },
                  { id: 'arduino', label: 'Arduino' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPreferredLang(opt.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 ${
                    preferredLang === opt.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <span>추론:</span>
              {(['low', 'medium', 'high'] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setReasoning(lvl)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    reasoning === lvl ? 'bg-slate-800 text-blue-400 font-medium' : 'hover:text-slate-200'
                  }`}
                >
                  {lvl === 'low' ? '빠름' : lvl === 'medium' ? '표준' : '심층'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <textarea
              rows={3}
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="예: 자바로 다익스트라 최단 경로 알고리즘 짜줘 (Enter 전송, Shift+Enter 줄바꿈)"
              className="w-full resize-none rounded-md bg-[#141B29] border border-slate-700/80 px-3 py-2.5 pr-12 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="button"
              onClick={() => handleSubmitPrompt()}
              disabled={chatLoading || !promptInput.trim()}
              aria-label="프롬프트 전송"
              className="absolute right-2 bottom-2.5 p-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Right Pane: Code Editor + Execution Console */}
      <section aria-label="코드 에디터 및 실행 결과" className="flex-1 min-w-0 min-h-0 flex flex-col">
        {/* Editor Toolbar */}
        <div className="px-4 py-2.5 border-b border-slate-800/90 bg-[#101623] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <select
              aria-label="프로그래밍 언어 선택"
              value={language}
              onChange={(e) => onChangeLanguage(e.target.value as SupportedLanguage)}
              className="bg-[#182132] border border-slate-700/80 text-xs font-medium text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>

            <input
              aria-label="파일 이름"
              type="text"
              value={filename}
              onChange={(e) => onChangeFilename(e.target.value)}
              className="w-36 sm:w-44 bg-[#182132] border border-slate-700/80 text-xs font-mono text-slate-100 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500"
            />

            <span className="hidden md:inline text-xs text-slate-400 truncate max-w-[200px]">
              {projectTitle}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#182132] hover:bg-slate-700 border border-slate-700/80 rounded transition-colors whitespace-nowrap"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '복사됨' : '복사'}
            </button>

            <button
              type="button"
              onClick={onSaveCode}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-[#182132] hover:bg-slate-700 border border-slate-700/80 rounded transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? '저장 중' : '저장'}
            </button>

            <button
              type="button"
              onClick={() => onOpenIDE('intellij')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#182132] hover:bg-slate-700 border border-slate-700/80 rounded transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              IntelliJ IDEA로 열기
            </button>

            <button
              type="button"
              onClick={() => onOpenIDE('arduino')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-[#182132] hover:bg-slate-700 border border-slate-700/80 rounded transition-colors whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Arduino IDE로 열기
            </button>

            {projectId && (
              <button
                type="button"
                onClick={() => void triggerFileDownload(`/api/workspace/export/${encodeURIComponent(projectId)}`, `${projectId}-${language === 'arduino' ? 'arduino-sketch' : 'intellij-project'}.zip`)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-[#182132] hover:bg-slate-700 border border-slate-700/80 rounded transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                ZIP
              </button>
            )}

            <button
              type="button"
              onClick={onRunCode}
              disabled={running || !code.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" />
              {running ? '실행 중...' : '컴파일 및 실행'}
            </button>
          </div>
        </div>

        {/* IDE Notice Banner if applicable */}
        {ideNotice && (
          <div className="px-4 py-2 bg-[#141B29] border-b border-slate-800 text-xs text-slate-300 flex items-center justify-between gap-4">
            <span>{ideNotice}</span>
            {projectId && (
              <button
                type="button"
                onClick={() => void triggerFileDownload(`/api/workspace/export/${encodeURIComponent(projectId)}`, `${projectId}-${language === 'arduino' ? 'arduino-sketch' : 'intellij-project'}.zip`)}
                className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
              >
                {language === 'arduino' ? '아두이노 스케치 ZIP 다운로드' : 'IntelliJ 프로젝트 ZIP 다운로드'}
              </button>
            )}
          </div>
        )}

        {/* Code Editor Area with Line Numbers */}
        <div className="flex-1 min-h-[220px] flex overflow-hidden bg-[#0B0F17] relative">
          <div
            ref={gutterRef}
            aria-hidden="true"
            className="w-12 py-4 pr-3 text-right font-mono text-xs leading-6 text-slate-600 select-none overflow-hidden bg-[#0B0F17] border-r border-slate-800/70 tabular-nums shrink-0"
          >
            {Array.from({ length: lineCount }, (_, idx) => (
              <div key={idx + 1}>{idx + 1}</div>
            ))}
          </div>
          <textarea
            ref={editorRef}
            aria-label="소스 코드 에디터"
            spellCheck={false}
            value={code}
            onChange={(e) => onChangeCode(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            onScroll={(e) => {
              if (gutterRef.current) {
                gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            placeholder="좌측 프롬프트 입력창에 원하는 기능을 요청하거나 여기에 직접 코드를 작성하세요."
            className="flex-1 w-full h-full resize-none bg-[#0B0F17] text-slate-100 font-mono text-[13px] leading-6 p-4 focus:outline-none overflow-auto whitespace-pre"
          />
        </div>

        {/* Bottom Stdin + Execution Console */}
        <div className="h-[210px] shrink-0 border-t border-slate-800/90 bg-[#0D121C] flex flex-col">
          {/* Stdin Bar & Result Header */}
          <div className="px-4 py-2 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
              <Terminal className="w-3.5 h-3.5 text-slate-400" />
              <span>실행 콘솔</span>
              {executionResult && (
                <>
                  <span className="text-slate-700" aria-hidden="true">·</span>
                  <span className={`inline-flex items-center gap-1 ${executionResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {executionResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    {executionResult.ok ? '성공' : executionResult.stage === 'compile' ? '컴파일 오류' : '실행 오류'}
                  </span>
                  <span className="text-slate-700" aria-hidden="true">·</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    종료 코드 {executionResult.exitCode ?? '—'} · {executionResult.durationMs}ms
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-1 max-w-md justify-end">
              <label htmlFor="stdin-input" className="text-[11px] text-slate-400 whitespace-nowrap">
                표준 입력(stdin):
              </label>
              <input
                id="stdin-input"
                type="text"
                value={stdinText}
                onChange={(e) => onChangeStdin(e.target.value)}
                placeholder="Scanner / input() / cin 입력값 (줄바꿈은 \n)"
                className="w-full max-w-[260px] bg-[#141B29] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
              />
              {executionResult && !executionResult.ok && (
                <button
                  type="button"
                  onClick={handleAutoFix}
                  disabled={chatLoading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-800/60 rounded transition-colors whitespace-nowrap shrink-0"
                >
                  <Wrench className="w-3 h-3" />
                  AI 에러 자동 수정
                </button>
              )}
            </div>
          </div>

          {/* Output Body */}
          <div className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed">
            {running && <div className="text-slate-400">컴파일 및 실행 중입니다...</div>}
            {!running && !executionResult && (
              <div className="text-slate-500">
                [컴파일 및 실행] 버튼을 누르면 감지된 로컬 컴파일러/런타임으로 코드를 실행하고 결과가 여기에 표시됩니다.
              </div>
            )}
            {!running && executionResult && (
              <div className="space-y-2.5">
                {executionResult.compilerUsed && (
                  <div className="text-[11px] text-slate-500">
                    사용된 실행기: {executionResult.compilerUsed}
                  </div>
                )}
                {executionResult.stdout && (
                  <pre className="whitespace-pre-wrap break-words text-slate-100">{executionResult.stdout}</pre>
                )}
                {executionResult.stderr && (
                  <pre className="whitespace-pre-wrap break-words text-rose-400">{executionResult.stderr}</pre>
                )}
                {!executionResult.stdout && !executionResult.stderr && (
                  <div className="text-slate-500">(표준 출력 내용 없음 / 종료 코드: {executionResult.exitCode})</div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
