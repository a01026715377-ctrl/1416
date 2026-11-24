import { useMemo, useState } from 'react';
import { FolderOpen, Download, Trash2, Search } from 'lucide-react';
import { triggerFileDownload } from '../utils/downloadFile';
import type { ProjectMeta, SupportedLanguage } from '../types';

interface ProjectsViewProps {
  projects: ProjectMeta[];
  loading: boolean;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onCreateNew: () => void;
}

const LANG_LABEL: Record<SupportedLanguage, string> = {
  python: 'Python',
  java: 'Java',
  cpp: 'C++',
  javascript: 'JavaScript',
  arduino: 'Arduino (.ino)',
};

export function ProjectsView({
  projects,
  loading,
  onOpenProject,
  onDeleteProject,
  onCreateNew,
}: ProjectsViewProps) {
  const [query, setQuery] = useState('');
  const [langFilter, setLangFilter] = useState<'all' | SupportedLanguage>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (langFilter !== 'all' && p.language !== langFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.filename.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [projects, query, langFilter]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0F17] px-8 py-8">
      <div className="max-w-[1200px] mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
              저장된 워크스페이스 프로젝트
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              AI가 생성하거나 실행한 코드는 IntelliJ IDEA 호환 설정(.idea, .iml, CMakeLists.txt)과 함께 자동 저장됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateNew}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            새 코드 작성하기
          </button>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-md">
            {(
              [
                { id: 'all', label: '전체' },
                { id: 'java', label: 'Java' },
                { id: 'python', label: 'Python' },
                { id: 'cpp', label: 'C++' },
                { id: 'javascript', label: 'JS' },
                { id: 'arduino', label: 'Arduino' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setLangFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  langFilter === tab.id
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="프로젝트 제목 또는 파일명 검색"
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#111827] border border-slate-800 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Projects Table */}
        <div className="border border-slate-800 bg-[#111827] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0E1420] text-xs font-medium text-slate-400">
                  <th className="py-3 px-4">프로젝트</th>
                  <th className="py-3 px-4">언어 · 진입 파일</th>
                  <th className="py-3 px-4 text-right">줄 수</th>
                  <th className="py-3 px-4">IntelliJ 호환</th>
                  <th className="py-3 px-4">수정 시각</th>
                  <th className="py-3 px-4 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-sm">
                {loading && (
                  <tr>
                    <td colSpan={6} className="py-10 px-4 text-center text-slate-400">
                      프로젝트 목록을 불러오는 중입니다...
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 px-4 text-center">
                      <p className="text-sm text-slate-300">표시할 프로젝트가 없습니다.</p>
                      <p className="mt-1 text-xs text-slate-500">
                        워크벤치에서 프롬프트를 입력해 Java, Python, C++ 코드를 생성해 보세요.
                      </p>
                    </td>
                  </tr>
                )}
                {!loading &&
                  filtered.map((proj) => (
                    <tr key={proj.id} className="hover:bg-slate-800/35 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-100">{proj.title}</div>
                        <div className="text-xs font-mono text-slate-500">{proj.id}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs text-slate-300">
                          {LANG_LABEL[proj.language]}
                          <span className="mx-1.5 text-slate-600" aria-hidden="true">·</span>
                          <span className="font-mono text-slate-200">{proj.relativeEntryPath}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-300 tabular-nums">
                        {proj.lineCount}
                      </td>
                      <td className="py-3 px-4 text-xs text-emerald-400">
                        {proj.language === 'arduino' ? 'Arduino 스케치' : proj.intellijReady ? '구성 완료 (.idea)' : '기본'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                        {new Date(proj.updatedAt).toLocaleString('ko-KR')}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenProject(proj.id)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            열기
                          </button>
                          <button
                            type="button"
                            onClick={() => void triggerFileDownload(`/api/workspace/export/${encodeURIComponent(proj.id)}`, `${proj.id}-intellij-project.zip`)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            ZIP
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteProject(proj.id)}
                            aria-label={`${proj.title} 삭제`}
                            className="inline-flex items-center p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
