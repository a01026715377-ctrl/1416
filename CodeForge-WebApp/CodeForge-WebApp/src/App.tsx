import { useCallback, useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { WorkbenchView } from './components/WorkbenchView';
import { EnvironmentView } from './components/EnvironmentView';
import { ProjectsView } from './components/ProjectsView';
import { DesktopBuildView } from './components/DesktopBuildView';
import type {
  ChatMessage,
  EnvironmentReport,
  ExecutionResult,
  NavTab,
  PreferredLanguage,
  ProjectDetail,
  ProjectMeta,
  ReasoningLevel,
  SupportedLanguage,
} from './types';

const DEFAULT_SAMPLES: Record<SupportedLanguage, { filename: string; code: string }> = {
  python: {
    filename: 'main.py',
    code: `def fibonacci(n: int) -> list[int]:
    seq = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]

if __name__ == "__main__":
    print("피보나치 수열 10항:", fibonacci(10))
`,
  },
  java: {
    filename: 'Main.java',
    code: `public class Main {
    public static void main(String[] args) {
        System.out.println("CodeForge Java + IntelliJ IDEA 준비 완료!");
    }
}
`,
  },
  cpp: {
    filename: 'main.cpp',
    code: `#include <iostream>
#include <vector>

int main() {
    std::vector<int> nums = {10, 20, 30, 40, 50};
    int sum = 0;
    for (int n : nums) sum += n;
    std::cout << "C++17 합계: " << sum << std::endl;
    return 0;
}
`,
  },
  javascript: {
    filename: 'main.js',
    code: `const items = [1, 2, 3, 4, 5];
const squared = items.map((n) => n * n);
console.log("제곱 결과:", squared);
`,
  },
  arduino: {
    filename: 'sketch.ino',
    code: `#include <Servo.h>

Servo myServo;

void setup() {
  myServo.attach(9);
}

void loop() {
  myServo.write(0);
  delay(1000);
  myServo.write(90);
  delay(1000);
}
`,
  },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('workbench');
  const [envReport, setEnvReport] = useState<EnvironmentReport | null>(null);
  const [scanning, setScanning] = useState(false);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState('빠른 시작 프로젝트');
  const [language, setLanguage] = useState<SupportedLanguage>('python');
  const [filename, setFilename] = useState(DEFAULT_SAMPLES.python.filename);
  const [code, setCode] = useState(DEFAULT_SAMPLES.python.code);
  const [stdinText, setStdinText] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [ideNotice, setIdeNotice] = useState<string | null>(null);

  const fetchEnvironment = useCallback(async (refresh = false) => {
    setScanning(true);
    try {
      const res = await fetch(`/api/environment/scan${refresh ? '?refresh=1' : ''}`);
      if (res.ok) {
        const data = (await res.json()) as EnvironmentReport;
        setEnvReport(data);
      }
    } catch {
      // ignore initial scan network hiccup
    } finally {
      setScanning(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await fetch('/api/workspace/projects');
      if (res.ok) {
        const data = (await res.json()) as { projects: ProjectMeta[] };
        setProjects(data.projects || []);
      }
    } catch {
      // ignore
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEnvironment(false);
    void fetchProjects();
  }, [fetchEnvironment, fetchProjects]);

  function handleNewProject() {
    setProjectId(null);
    setProjectTitle('새 프로젝트');
    setLanguage('python');
    setFilename(DEFAULT_SAMPLES.python.filename);
    setCode(DEFAULT_SAMPLES.python.code);
    setStdinText('');
    setMessages([]);
    setExecutionResult(null);
    setIdeNotice(null);
    setActiveTab('workbench');
  }

  function handleChangeLanguage(nextLang: SupportedLanguage) {
    setLanguage(nextLang);
    const currentIsSample = Object.values(DEFAULT_SAMPLES).some((s) => s.code.trim() === code.trim());
    setFilename(DEFAULT_SAMPLES[nextLang].filename);
    if (currentIsSample || !code.trim()) {
      setCode(DEFAULT_SAMPLES[nextLang].code);
    }
  }

  async function handleSaveCode(): Promise<string | null> {
    setSaving(true);
    setIdeNotice(null);
    try {
      const res = await fetch('/api/workspace/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId || undefined,
          title: projectTitle || filename,
          language,
          filename,
          code,
        }),
      });
      const data = (await res.json()) as { project?: ProjectDetail; error?: string };
      if (res.ok && data.project) {
        setProjectId(data.project.id);
        setFilename(data.project.filename);
        setProjectTitle(data.project.title);
        void fetchProjects();
        return data.project.id;
      }
      setIdeNotice(data.error || '저장에 실패했습니다.');
      return null;
    } catch (err) {
      setIdeNotice(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function handleRunCode() {
    setRunning(true);
    setIdeNotice(null);
    const normalizedStdin = stdinText.replace(/\\n/g, '\n');
    try {
      const res = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId || undefined,
          title: projectTitle || filename,
          language,
          filename,
          code,
          stdin: normalizedStdin,
        }),
      });
      const data = (await res.json()) as {
        project?: ProjectDetail;
        result?: ExecutionResult;
        error?: string;
      };
      if (!res.ok || !data.result) {
        setExecutionResult({
          ok: false,
          stage: 'prepare',
          stdout: '',
          stderr: data.error || '실행 요청이 실패했습니다.',
          exitCode: 1,
          durationMs: 0,
          compilerUsed: null,
          timedOut: false,
        });
      } else {
        if (data.project) {
          setProjectId(data.project.id);
          void fetchProjects();
        }
        setExecutionResult(data.result);
      }
    } catch (err) {
      setExecutionResult({
        ok: false,
        stage: 'prepare',
        stdout: '',
        stderr: err instanceof Error ? err.message : '실행 중 네트워크 오류가 발생했습니다.',
        exitCode: 1,
        durationMs: 0,
        compilerUsed: null,
        timedOut: false,
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleOpenIDE(ide: 'intellij' | 'arduino') {
    setIdeNotice(null);
    let targetId = projectId;
    if (!targetId) {
      targetId = await handleSaveCode();
    } else {
      await handleSaveCode();
    }
    if (!targetId) return;

    const ideName = ide === 'arduino' ? 'Arduino IDE' : 'IntelliJ IDEA';
    try {
      const res = await fetch('/api/ide/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: targetId, ide }),
      });
      const data = (await res.json()) as { launched?: boolean; message?: string; error?: string };
      setIdeNotice(data.message || data.error || `${ideName} 연동을 확인했습니다.`);
    } catch (err) {
      setIdeNotice(err instanceof Error ? err.message : `${ideName} 실행 요청 실패`);
    }
  }

  async function handleSendPrompt(
    prompt: string,
    preferredLang: PreferredLanguage,
    reasoning: ReasoningLevel
  ) {
    const nowTime = new Date().toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: nowTime,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setChatLoading(true);
    setIdeNotice(null);

    try {
      const historyPayload = nextMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          preferredLanguage: preferredLang,
          reasoning,
          currentCode: code,
          currentFilename: filename,
          currentLanguage: language,
          projectId: projectId || undefined,
          history: historyPayload.slice(0, -1),
        }),
      });

      const data = (await res.json()) as {
        ai?: {
          explanation: string;
          language: string;
          projectTitle: string;
          filename: string;
          code: string;
          stdinHint: string;
          suggestedNextSteps: string[];
        };
        project?: ProjectDetail | null;
        error?: string;
      };

      const replyTime = new Date().toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      if (!res.ok || !data.ai) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e_${Date.now()}`,
            role: 'error',
            content: data.error || 'Gemini API 응답을 받지 못했습니다.',
            timestamp: replyTime,
          },
        ]);
        return;
      }

      const ai = data.ai;
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: ai.explanation,
          timestamp: replyTime,
          language: ai.language,
          filename: ai.filename,
          suggestedNextSteps: ai.suggestedNextSteps,
        },
      ]);

      if (ai.code?.trim() && ai.language !== 'none') {
        if (
          ai.language === 'python' ||
          ai.language === 'java' ||
          ai.language === 'cpp' ||
          ai.language === 'javascript' ||
          ai.language === 'arduino'
        ) {
          setLanguage(ai.language);
        }
        setCode(ai.code);
        if (ai.filename) setFilename(ai.filename);
        if (ai.projectTitle) setProjectTitle(ai.projectTitle);
        if (ai.stdinHint) setStdinText(ai.stdinHint);
        setExecutionResult(null);
      }

      if (data.project) {
        setProjectId(data.project.id);
        setFilename(data.project.filename);
        setProjectTitle(data.project.title);
        void fetchProjects();
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: 'error',
          content: err instanceof Error ? err.message : '요청 중 네트워크 오류가 발생했습니다.',
          timestamp: new Date().toLocaleTimeString('ko-KR'),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function handleOpenSavedProject(id: string) {
    try {
      const res = await fetch(`/api/workspace/project/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { project: ProjectDetail };
      const p = data.project;
      setProjectId(p.id);
      setProjectTitle(p.title);
      setLanguage(p.language);
      setFilename(p.filename);
      setCode(p.code);
      setExecutionResult(null);
      setIdeNotice(null);
      setActiveTab('workbench');
    } catch {
      // ignore
    }
  }

  async function handleDeleteProject(id: string) {
    try {
      const res = await fetch(`/api/workspace/project/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        if (projectId === id) {
          setProjectId(null);
        }
        void fetchProjects();
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="min-h-screen lg:h-screen w-full overflow-y-auto lg:overflow-hidden flex flex-col bg-[#0B0F17] text-slate-100">
      <TopBar activeTab={activeTab} onSelectTab={setActiveTab} onNewProject={handleNewProject} />

      {activeTab === 'workbench' && (
        <WorkbenchView
          envReport={envReport}
          onGoToEnvironment={() => setActiveTab('environment')}
          messages={messages}
          chatLoading={chatLoading}
          onSendPrompt={handleSendPrompt}
          projectId={projectId}
          projectTitle={projectTitle}
          language={language}
          filename={filename}
          code={code}
          stdinText={stdinText}
          onChangeLanguage={handleChangeLanguage}
          onChangeFilename={setFilename}
          onChangeCode={setCode}
          onChangeStdin={setStdinText}
          onSaveCode={handleSaveCode}
          saving={saving}
          onRunCode={handleRunCode}
          running={running}
          executionResult={executionResult}
          onOpenIDE={handleOpenIDE}
          ideNotice={ideNotice}
        />
      )}

      {activeTab === 'environment' && (
        <EnvironmentView
          report={envReport}
          scanning={scanning}
          onRescan={() => void fetchEnvironment(true)}
          onGoToDesktop={() => setActiveTab('desktop')}
        />
      )}

      {activeTab === 'projects' && (
        <ProjectsView
          projects={projects}
          loading={projectsLoading}
          onOpenProject={(id) => void handleOpenSavedProject(id)}
          onDeleteProject={(id) => void handleDeleteProject(id)}
          onCreateNew={handleNewProject}
        />
      )}

      {activeTab === 'desktop' && <DesktopBuildView />}
    </div>
  );
}
