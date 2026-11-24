import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { scanEnvironment, setToolOverride, type ToolId } from './server/envDetector.ts';
import {
  deleteProject,
  executeProjectCode,
  exportProjectZip,
  getProject,
  isSupportedLanguage,
  listProjects,
  openProjectInIDE,
  saveProject,
  type SupportedLanguage,
} from './server/workspaceManager.ts';
import { buildDesktopBundleZip } from './server/desktopBundle.ts';
import { buildZipBuffer, type ZipEntryInput } from './server/zipBuilder.ts';

const PORT = Number(process.env.PORT) || 3000;

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets에서 키를 확인해 주세요.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const SYSTEM_INSTRUCTION = `당신은 사용자의 로컬 개발 환경(Java, Python, C++, JavaScript, Arduino) 및 IntelliJ IDEA, Arduino IDE와 직접 연동되는 전문 AI 코딩 어시스턴트입니다.

규칙:
1. 사용자의 자연어 요청을 이해하고, 바로 컴파일 및 실행 가능한 완전한 코드를 작성하세요.
2. Java 코드를 생성할 때는 package 선언을 넣지 말고, public class 이름을 filename(예: Main.java -> public class Main)과 반드시 일치시키세요.
3. 아두이노(Arduino) 제어/스케치 요청일 경우 language는 "arduino", filename은 "ServoControl.ino"처럼 ".ino" 확장자로 작성하세요.
4. Python과 C++ 코드도 별도의 외부 서드파티 패키지 없이 표준 라이브러리 위주로 바로 실행 가능하게 작성하세요. C++는 C++17 표준에 맞춰 작성하세요.
5. 프로그램이 표준 입력(Scanner, input(), std::cin 등)을 받는다면 stdinHint 필드에 테스트용 샘플 입력 예시를 줄바꿈 포함 문자열로 제공하세요. 필요 없으면 빈 문자열("")을 넣으세요.
6. 사용자가 일반 질문만 하고 코드 생성이나 수정이 필요하지 않다면 language는 "none", filename과 code는 빈 문자열("")을 반환하세요.
7. explanation은 친절하고 간결한 한국어로 작성하세요.`;

const CODING_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    explanation: {
      type: Type.STRING,
      description: '사용자에게 보여줄 한국어 설명 및 동작 요약',
    },
    language: {
      type: Type.STRING,
      description: '생성된 코드의 언어: python, java, cpp, javascript, arduino, none 중 하나',
    },
    projectTitle: {
      type: Type.STRING,
      description: '프로젝트의 짧은 한국어 또는 영문 제목',
    },
    filename: {
      type: Type.STRING,
      description: '파일명 (예: Main.java, main.py, main.cpp, main.js, ServoControl.ino). 코드가 없으면 빈 문자열',
    },
    code: {
      type: Type.STRING,
      description: '실행 가능한 전체 소스 코드. 코드가 없으면 빈 문자열',
    },
    stdinHint: {
      type: Type.STRING,
      description: '표준 입력(stdin) 테스트 샘플. 필요하지 않으면 빈 문자열',
    },
    suggestedNextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '사용자가 이어서 요청할 수 있는 짧은 한국어 후속 프롬프트 2~3개',
    },
  },
  required: ['explanation', 'language', 'projectTitle', 'filename', 'code', 'stdinHint', 'suggestedNextSteps'],
};

interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface ParsedAiCodingResponse {
  explanation: string;
  language: string;
  projectTitle: string;
  filename: string;
  code: string;
  stdinHint: string;
  suggestedNextSteps: string[];
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // 1. Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // 2. Scan local compilers, runtimes, and IntelliJ IDEA
  app.get('/api/environment/scan', async (req: Request, res: Response) => {
    try {
      const refresh = req.query.refresh === '1';
      const report = await scanEnvironment(refresh);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '환경 탐지 중 오류가 발생했습니다.' });
    }
  });

  // 2b. Set or clear manual executable path override
  app.post('/api/environment/override', async (req: Request, res: Response) => {
    try {
      const toolId = String(req.body?.toolId || '') as ToolId;
      const validIds: ToolId[] = ['python', 'javac', 'java', 'cpp', 'node', 'intellij', 'arduino', 'arduino_cli'];
      if (!validIds.includes(toolId)) {
        res.status(400).json({ error: '지원하지 않는 도구 ID입니다.' });
        return;
      }
      const customPath = typeof req.body?.customPath === 'string' ? req.body.customPath : null;
      const outcome = setToolOverride(toolId, customPath);
      if (!outcome.ok) {
        res.status(400).json({ error: outcome.error || '경로 지정 실패' });
        return;
      }
      const report = await scanEnvironment(true);
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '경로 저장 실패' });
    }
  });

  // 3. Test a specific detected language runtime with a clean verification snippet
  app.post('/api/environment/test', async (req: Request, res: Response) => {
    try {
      const rawLang = String(req.body?.language || '');
      if (!isSupportedLanguage(rawLang)) {
        res.status(400).json({ error: '지원하지 않는 언어입니다.' });
        return;
      }

      const snippets: Record<SupportedLanguage, { filename: string; code: string }> = {
        python: {
          filename: 'verify_env.py',
          code: 'import sys\nprint("Python runtime verified:", sys.version.split()[0])\n',
        },
        java: {
          filename: 'VerifyEnv.java',
          code: 'public class VerifyEnv {\n    public static void main(String[] args) {\n        System.out.println("Java runtime verified: " + System.getProperty("java.version"));\n    }\n}\n',
        },
        cpp: {
          filename: 'verify_env.cpp',
          code: '#include <iostream>\nint main() {\n    std::cout << "C++17 compiler verified (C++ standard: " << __cplusplus << ")" << std::endl;\n    return 0;\n}\n',
        },
        javascript: {
          filename: 'verify_env.js',
          code: 'console.log("Node.js runtime verified:", process.version);\n',
        },
        arduino: {
          filename: 'VerifyBlink.ino',
          code: 'void setup() {\n  pinMode(LED_BUILTIN, OUTPUT);\n}\n\nvoid loop() {\n  digitalWrite(LED_BUILTIN, HIGH);\n  delay(500);\n  digitalWrite(LED_BUILTIN, LOW);\n  delay(500);\n}\n',
        },
      };

      const sample = snippets[rawLang];
      const execOut = await executeProjectCode({
        projectId: `verify_${rawLang}`,
        title: `Verify ${rawLang}`,
        language: rawLang,
        filename: sample.filename,
        code: sample.code,
      });

      res.json(execOut.result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '런타임 테스트에 실패했습니다.' });
    }
  });

  // 4. Gemini AI Coding Chat & Self-Healing Error Fix
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
      if (!prompt) {
        res.status(400).json({ error: '프롬프트를 입력해 주세요.' });
        return;
      }

      const preferredLanguage = typeof req.body?.preferredLanguage === 'string' ? req.body.preferredLanguage : 'auto';
      const reasoning = typeof req.body?.reasoning === 'string' ? req.body.reasoning : 'medium';
      const currentCode = typeof req.body?.currentCode === 'string' ? req.body.currentCode : '';
      const currentFilename = typeof req.body?.currentFilename === 'string' ? req.body.currentFilename : '';
      const currentLanguage = typeof req.body?.currentLanguage === 'string' ? req.body.currentLanguage : '';
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
      const history: ChatHistoryItem[] = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];

      const env = await scanEnvironment(false);
      const installedSummary = env.tools
        .map((t) => `${t.name}: ${t.installed ? `설치됨 (${t.version || t.executablePath})` : '미설치'}`)
        .join(' | ');

      const thinkingMap: Record<string, ThinkingLevel> = {
        low: ThinkingLevel.LOW,
        medium: ThinkingLevel.MEDIUM,
        high: ThinkingLevel.HIGH,
      };
      const thinkingLevel = thinkingMap[reasoning] || ThinkingLevel.MEDIUM;

      const historyBlock = history.length
        ? `\n\n[이전 대화]\n${history.map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n')}`
        : '';

      const codeContextBlock = currentCode.trim()
        ? `\n\n[현재 에디터 코드 (${currentLanguage} / ${currentFilename})]\n\`\`\`${currentLanguage}\n${currentCode}\n\`\`\``
        : '';

      const langHint =
        preferredLanguage !== 'auto'
          ? `\n선호 언어 설정: ${preferredLanguage} (사용자가 프롬프트에서 다른 언어를 명시했다면 사용자 프롬프트를 우선하세요)`
          : '';

      const fullPrompt = `[로컬 PC 감지 상태]\n${installedSummary}${langHint}${codeContextBlock}${historyBlock}\n\n[사용자 요청]\n${prompt}`;

      const ai = createGeminiClient();
      const modelsToTry: Array<{ model: string; useThinking: boolean }> = [
        { model: 'gemini-4-hydrogen', useThinking: true },
        { model: 'gemini-4-hydrogen', useThinking: true },
        { model: 'gemini-3.1-flash-lite', useThinking: false },
      ];

      let responseText = '';
      let lastError: unknown = null;

      for (let i = 0; i < modelsToTry.length; i++) {
        const attempt = modelsToTry[i];
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: fullPrompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: CODING_RESPONSE_SCHEMA,
              ...(attempt.useThinking ? { thinkingConfig: { thinkingLevel } } : {}),
            },
          });
          responseText = (response.text ?? '').trim();
          if (responseText) break;
        } catch (err) {
          lastError = err;
          const errStr = err instanceof Error ? err.message : String(err);
          const isTransient =
            errStr.includes('503') ||
            errStr.includes('UNAVAILABLE') ||
            errStr.includes('high demand') ||
            errStr.includes('429');
          if (!isTransient || i === modelsToTry.length - 1) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }

      if (!responseText) {
        if (lastError) throw lastError;
        res.status(502).json({ error: 'Gemini 모델에서 빈 응답이 반환되었습니다.' });
        return;
      }

      const parsed = JSON.parse(responseText) as ParsedAiCodingResponse;
      const normalizedLang = (parsed.language || 'none').toLowerCase().trim();

      let savedProject = null;
      if (parsed.code?.trim() && isSupportedLanguage(normalizedLang)) {
        savedProject = saveProject({
          projectId,
          title: parsed.projectTitle || parsed.filename || `${normalizedLang} project`,
          language: normalizedLang,
          filename: parsed.filename || '',
          code: parsed.code,
        });
      }

      res.json({
        ai: {
          ...parsed,
          language: normalizedLang,
        },
        project: savedProject,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'AI 코드 생성 중 오류가 발생했습니다.';
      if (msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('high demand')) {
        res.status(503).json({
          error: '현재 Gemini 모델 서버의 일시적인 요청량 증가(503)로 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      const status = msg.includes('GEMINI_API_KEY') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // 5. Workspace project endpoints
  app.get('/api/workspace/projects', (_req: Request, res: Response) => {
    try {
      res.json({ projects: listProjects() });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '프로젝트 목록 조회 실패' });
    }
  });

  app.get('/api/workspace/project/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const project = getProject(id);
      if (!project) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      res.json({ project });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : '잘못된 요청입니다.' });
    }
  });

  app.post('/api/workspace/save', (req: Request, res: Response) => {
    try {
      const language = String(req.body?.language || '');
      if (!isSupportedLanguage(language)) {
        res.status(400).json({ error: '지원하지 않는 언어입니다.' });
        return;
      }
      const project = saveProject({
        projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : undefined,
        title: typeof req.body?.title === 'string' ? req.body.title : 'Untitled Project',
        language,
        filename: typeof req.body?.filename === 'string' ? req.body.filename : '',
        code: typeof req.body?.code === 'string' ? req.body.code : '',
      });
      res.json({ project });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : '저장 실패' });
    }
  });

  app.delete('/api/workspace/project/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const deleted = deleteProject(id);
      if (!deleted) {
        res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : '삭제 실패' });
    }
  });

  // 6. Execute code using detected local compiler/runtime
  app.post('/api/execute', async (req: Request, res: Response) => {
    try {
      const language = String(req.body?.language || '');
      if (!isSupportedLanguage(language)) {
        res.status(400).json({ error: '지원하지 않는 실행 언어입니다.' });
        return;
      }
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      if (!code.trim()) {
        res.status(400).json({ error: '실행할 코드가 비어 있습니다.' });
        return;
      }

      const out = await executeProjectCode({
        projectId: typeof req.body?.projectId === 'string' ? req.body.projectId : undefined,
        title: typeof req.body?.title === 'string' ? req.body.title : undefined,
        language,
        filename: typeof req.body?.filename === 'string' ? req.body.filename : '',
        code,
        stdin: typeof req.body?.stdin === 'string' ? req.body.stdin : '',
      });

      res.json(out);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : '실행 중 오류가 발생했습니다.' });
    }
  });

  // 7. Launch IntelliJ IDEA or Arduino IDE locally
  app.post('/api/ide/open', async (req: Request, res: Response) => {
    try {
      const projectId = String(req.body?.projectId || '');
      if (!projectId) {
        res.status(400).json({ error: '먼저 코드를 생성하거나 저장해 주세요.' });
        return;
      }
      const ideRaw = req.body?.ide;
      const preferredIde = ideRaw === 'arduino' || ideRaw === 'intellij' ? ideRaw : undefined;
      const result = await openProjectInIDE(projectId, preferredIde);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'IDE 연동 실패' });
    }
  });

  // 8. Export IntelliJ IDEA project ZIP
  app.get('/api/workspace/export/:id', (req: Request, res: Response) => {
    try {
      const id = String(req.params.id || '');
      const zipData = exportProjectZip(id);
      if (!zipData) {
        res.status(404).json({ error: '내보낼 프로젝트를 찾을 수 없습니다.' });
        return;
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipData.filename}"`);
      res.send(zipData.buffer);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'ZIP 내보내기 실패' });
    }
  });

  // 9. Download Standalone Desktop Builder ZIP (.exe / .app)
  app.get('/api/desktop-bundle', (_req: Request, res: Response) => {
    try {
      const zipBuffer = buildDesktopBundleZip();
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="CodeForgeDesktop-Builder.zip"');
      res.send(zipBuffer);
    } catch (error) {
      res.status(500).json({ error: '데스크톱 번들 생성 실패' });
    }
  });

  // 10. Download Full Web Workbench Project ZIP (CodeForge-WebApp.zip)
  app.get('/api/app-bundle', (_req: Request, res: Response) => {
    try {
      const rootDir = process.cwd();
      const entries: ZipEntryInput[] = [];
      const rootAllowlist = [
        '.env.example',
        '.gitignore',
        'index.html',
        'metadata.json',
        'package.json',
        'server.ts',
        'tsconfig.json',
        'vite.config.ts',
      ];

      for (const file of rootAllowlist) {
        const full = path.join(rootDir, file);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          entries.push({
            name: `CodeForge-WebApp/${file}`,
            content: fs.readFileSync(full),
          });
        }
      }

      const walkDir = (relDir: string) => {
        const fullDir = path.join(rootDir, relDir);
        if (!fs.existsSync(fullDir)) return;
        for (const item of fs.readdirSync(fullDir, { withFileTypes: true })) {
          if (item.name === 'node_modules' || item.name === 'dist' || item.name.startsWith('.')) continue;
          const relPath = `${relDir}/${item.name}`;
          const absPath = path.join(rootDir, relPath);
          if (item.isDirectory()) {
            walkDir(relPath);
          } else if (item.isFile()) {
            entries.push({
              name: `CodeForge-WebApp/${relPath}`,
              content: fs.readFileSync(absPath),
            });
          }
        }
      };

      walkDir('server');
      walkDir('src');

      entries.push({
        name: 'CodeForge-WebApp/README_KO.txt',
        content: [
          '# CodeForge 웹 워크벤치 로컬 실행 가이드',
          '',
          '1. Node.js 20 이상을 설치합니다.',
          '2. 압축을 푼 폴더에서 패키지를 설치합니다:',
          '   npm install',
          '',
          '3. GEMINI_API_KEY 환경 변수를 설정하고 실행합니다:',
          '   - Windows (PowerShell):',
          '     $env:GEMINI_API_KEY="YOUR_KEY"; npm run dev',
          '   - Windows (CMD):',
          '     set GEMINI_API_KEY=YOUR_KEY && npm run dev',
          '   - macOS / Linux:',
          '     GEMINI_API_KEY="YOUR_KEY" npm run dev',
          '',
          '4. 브라우저에서 http://localhost:3000 으로 접속하면 내 PC의 Python, Java, C++, IntelliJ IDEA, Arduino IDE를 자동으로 탐지해 실행합니다.',
          '',
        ].join('\n'),
      });

      const zipBuffer = buildZipBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="CodeForge-WebApp.zip"');
      res.send(zipBuffer);
    } catch (error) {
      res.status(500).json({ error: '웹 프로젝트 ZIP 생성 실패' });
    }
  });

  // Guard unmatched /api/* routes from falling through to HTML
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API 엔드포인트를 찾을 수 없습니다.' });
  });

  // Production static dist serving or Vite dev middleware
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const preferStatic =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start';

  if (preferStatic && fs.existsSync(distIndex)) {
    app.use(express.static(distDir, { index: 'index.html' }));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    const url = `http://localhost:${PORT}`;
    console.log(`CodeForge server listening on ${url}`);
    if (process.argv.includes('--open') || process.env.OPEN_BROWSER === 'true') {
      try {
        if (process.platform === 'win32') {
          spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        }
      } catch {
        // ignore browser auto-open failures in headless shells
      }
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
