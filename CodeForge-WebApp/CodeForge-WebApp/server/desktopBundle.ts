import { buildZipBuffer } from './zipBuilder.ts';

const PYTHON_DESKTOP_APP = `import os
import sys
import glob
import shutil
import platform
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox, filedialog

from pydantic import BaseModel, Field
from google import genai
from google.genai import types


class CodingResponse(BaseModel):
    explanation: str = Field(description="사용자에게 보여줄 한국어 설명 및 안내")
    language: str = Field(description="프로그래밍 언어 (python, java, cpp, arduino, none 중 하나)")
    filename: str = Field(description="생성할 파일명 (예: main.py, Main.java, main.cpp, ServoControl.ino). 코드가 없으면 빈 문자열")
    code: str = Field(description="실행 가능한 전체 소스 코드. 코드가 없으면 빈 문자열")


class EnvironmentDetector:
    def __init__(self):
        self.os_name = platform.system()
        self.tools = self.scan_all()

    def scan_all(self) -> dict:
        return {
            "python": self._find_python(),
            "javac": self._find_java_tool("javac"),
            "java": self._find_java_tool("java"),
            "cpp": self._find_cpp(),
            "intellij": self._find_intellij(),
            "arduino": self._find_arduino(),
            "arduino_cli": self._find_arduino_cli(),
        }

    def _find_python(self) -> str | None:
        is_frozen = getattr(sys, "frozen", False)
        for cmd in ["python", "python3", "py"]:
            path = shutil.which(cmd)
            if path and (not is_frozen or os.path.abspath(path) != os.path.abspath(sys.executable)):
                return path
        if self.os_name == "Windows":
            for pattern in [
                os.path.expandvars(r"%LOCALAPPDATA%\\Programs\\Python\\Python*\\python.exe"),
                r"C:\\Python*\\python.exe",
            ]:
                matches = sorted(glob.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
        return None

    def _find_java_tool(self, tool_name: str) -> str | None:
        path = shutil.which(tool_name)
        if path:
            return path
        ext = ".exe" if self.os_name == "Windows" else ""
        java_home = os.environ.get("JAVA_HOME")
        if java_home:
            candidate = os.path.join(java_home, "bin", f"{tool_name}{ext}")
            if os.path.isfile(candidate):
                return candidate
        if self.os_name == "Windows":
            for pattern in [
                rf"C:\\Program Files\\Java\\jdk*\\bin\\{tool_name}.exe",
                rf"C:\\Program Files\\Eclipse Adoptium\\jdk*\\bin\\{tool_name}.exe",
                rf"C:\\Program Files\\Zulu\\zulu*\\bin\\{tool_name}.exe",
            ]:
                matches = sorted(glob.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
        elif self.os_name == "Darwin":
            matches = sorted(glob.glob(f"/Library/Java/JavaVirtualMachines/*/Contents/Home/bin/{tool_name}"), reverse=True)
            if matches:
                return matches[0]
        return None

    def _find_cpp(self) -> str | None:
        for cmd in ["g++", "clang++"]:
            path = shutil.which(cmd)
            if path:
                return path
        if self.os_name == "Windows":
            for c in [
                r"C:\\msys64\\ucrt64\\bin\\g++.exe",
                r"C:\\msys64\\mingw64\\bin\\g++.exe",
                r"C:\\MinGW\\bin\\g++.exe",
            ]:
                if os.path.isfile(c):
                    return c
        return None

    def _find_intellij(self) -> str | None:
        for cmd in ["idea64.exe", "idea.cmd", "idea.bat", "idea.sh", "idea"]:
            path = shutil.which(cmd)
            if path:
                return path
        if self.os_name == "Windows":
            for pattern in [
                r"C:\\Program Files\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe",
                r"C:\\Program Files (x86)\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe",
                r"D:\\Program Files\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe",
                r"D:\\JetBrains\\IntelliJ IDEA*\\bin\\idea64.exe",
                os.path.expandvars(r"%LOCALAPPDATA%\\Programs\\IntelliJ IDEA*\\bin\\idea64.exe"),
                os.path.expandvars(r"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\idea.cmd"),
                os.path.expandvars(r"%LOCALAPPDATA%\\JetBrains\\Toolbox\\scripts\\idea.bat"),
                os.path.expandvars(r"%LOCALAPPDATA%\\JetBrains\\Toolbox\\apps\\IDEA-*\\**\\bin\\idea64.exe"),
            ]:
                matches = sorted(glob.glob(pattern, recursive=True), reverse=True)
                if matches:
                    return matches[0]
            try:
                import winreg
                for hive in [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]:
                    for subkey in [
                        r"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\idea64.exe",
                        r"SOFTWARE\\JetBrains\\IntelliJ IDEA",
                    ]:
                        try:
                            with winreg.OpenKey(hive, subkey) as k:
                                val, _ = winreg.QueryValueEx(k, "")
                                if val and os.path.isfile(val):
                                    return val
                        except OSError:
                            pass
            except Exception:
                pass
        elif self.os_name == "Darwin":
            for pattern in [
                "/Applications/IntelliJ IDEA*.app",
                os.path.expanduser("~/Applications/IntelliJ IDEA*.app"),
                os.path.expanduser("~/Applications/JetBrains Toolbox/IntelliJ IDEA*.app"),
            ]:
                matches = sorted(glob.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
            try:
                out = subprocess.check_output(["mdfind", "kMDItemCFBundleIdentifier == 'com.jetbrains.intellij*'"], text=True, timeout=3)
                for line in out.splitlines():
                    if line.strip().endswith(".app") and os.path.exists(line.strip()):
                        return line.strip()
            except Exception:
                pass
        else:
            for pattern in [
                "/opt/*idea*/bin/idea.sh",
                "/snap/intellij-idea*/current/bin/idea.sh",
                os.path.expanduser("~/.local/share/JetBrains/Toolbox/scripts/idea"),
                os.path.expanduser("~/.local/share/JetBrains/Toolbox/apps/IDEA-*/**/bin/idea.sh"),
            ]:
                matches = sorted(glob.glob(pattern, recursive=True), reverse=True)
                if matches:
                    return matches[0]
        return None

    def _find_arduino(self) -> str | None:
        for cmd in ["arduino-ide", "arduino", "Arduino IDE.exe", "arduino.exe"]:
            path = shutil.which(cmd)
            if path:
                return path
        if self.os_name == "Windows":
            for pattern in [
                os.path.expandvars(r"%LOCALAPPDATA%\\Programs\\Arduino IDE\\Arduino IDE.exe"),
                os.path.expandvars(r"%LOCALAPPDATA%\\Programs\\arduino-ide\\Arduino IDE.exe"),
                r"C:\\Program Files\\Arduino IDE\\Arduino IDE.exe",
                r"C:\\Program Files (x86)\\Arduino IDE\\Arduino IDE.exe",
                r"C:\\Program Files\\Arduino\\arduino.exe",
                r"C:\\Program Files (x86)\\Arduino\\arduino.exe",
                r"D:\\Program Files\\Arduino IDE\\Arduino IDE.exe",
            ]:
                matches = sorted(glob.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
            try:
                import winreg
                for hive in [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]:
                    for subkey in [
                        r"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Arduino IDE.exe",
                        r"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\arduino.exe",
                    ]:
                        try:
                            with winreg.OpenKey(hive, subkey) as k:
                                val, _ = winreg.QueryValueEx(k, "")
                                if val and os.path.isfile(val):
                                    return val
                        except OSError:
                            pass
            except Exception:
                pass
        elif self.os_name == "Darwin":
            for pattern in [
                "/Applications/Arduino IDE.app",
                "/Applications/Arduino.app",
                os.path.expanduser("~/Applications/Arduino IDE.app"),
                os.path.expanduser("~/Applications/Arduino.app"),
            ]:
                if os.path.exists(pattern):
                    return pattern
            try:
                for bundle_id in ["cc.arduino.IDE2", "cc.arduino.Arduino"]:
                    out = subprocess.check_output(["mdfind", f"kMDItemCFBundleIdentifier == '{bundle_id}'"], text=True, timeout=3)
                    for line in out.splitlines():
                        if line.strip().endswith(".app") and os.path.exists(line.strip()):
                            return line.strip()
            except Exception:
                pass
        else:
            for p in [
                "/usr/bin/arduino-ide",
                "/usr/bin/arduino",
                "/opt/arduino-ide/arduino-ide",
                "/snap/arduino/current/bin/arduino",
            ]:
                if os.path.isfile(p):
                    return p
        return None

    def _find_arduino_cli(self) -> str | None:
        path = shutil.which("arduino-cli")
        if path:
            return path
        if self.os_name == "Windows":
            for pattern in [
                os.path.expandvars(r"%LOCALAPPDATA%\\Arduino15\\*\\arduino-cli.exe"),
                r"C:\\Program Files\\Arduino CLI\\arduino-cli.exe",
                r"C:\\arduino-cli\\arduino-cli.exe",
            ]:
                matches = sorted(glob.glob(pattern), reverse=True)
                if matches:
                    return matches[0]
        return None


class CodeExecutor:
    def __init__(self, detector: EnvironmentDetector):
        self.detector = detector
        self.workspace_root = Path.home() / "CodeForgeWorkspace"
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.current_project_dir: Path | None = None
        self.current_file_path: Path | None = None
        self.current_language: str = "none"

    def save_code(self, language: str, filename: str, code: str) -> Path:
        lang = language.lower().strip()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        project_dir = self.workspace_root / f"proj_{lang}_{timestamp}"
        project_dir.mkdir(parents=True, exist_ok=True)

        if lang == "java":
            src_dir = project_dir / "src"
            src_dir.mkdir(exist_ok=True)
            file_path = src_dir / (filename or "Main.java")
            self._create_intellij_java_config(project_dir)
        elif lang == "arduino":
            fname = filename or "sketch.ino"
            if not fname.lower().endswith(".ino"):
                fname = f"{Path(fname).stem or 'sketch'}.ino"
            sketch_dir = project_dir / (Path(fname).stem or "sketch")
            sketch_dir.mkdir(exist_ok=True)
            file_path = sketch_dir / fname
        else:
            default_name = {"python": "main.py", "cpp": "main.cpp"}.get(lang, "code.txt")
            file_path = project_dir / (filename or default_name)

        file_path.write_text(code, encoding="utf-8")
        self.current_project_dir = project_dir
        self.current_file_path = file_path
        self.current_language = lang
        return file_path

    def _create_intellij_java_config(self, project_dir: Path):
        (project_dir / "project.iml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\\n'
            '<module type="JAVA_MODULE" version="4">\\n'
            '  <component name="NewModuleRootManager" inherit-compiler-output="true">\\n'
            '    <exclude-output />\\n'
            '    <content url="file://$MODULE_DIR$">\\n'
            '      <sourceFolder url="file://$MODULE_DIR$/src" isTestSource="false" />\\n'
            '    </content>\\n'
            '    <orderEntry type="inheritedJdk" />\\n'
            '    <orderEntry type="sourceFolder" forTests="false" />\\n'
            '  </component>\\n'
            '</module>\\n',
            encoding="utf-8",
        )
        idea_dir = project_dir / ".idea"
        idea_dir.mkdir(exist_ok=True)
        (idea_dir / "modules.xml").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\\n'
            '<project version="4">\\n'
            '  <component name="ProjectModuleManager">\\n'
            '    <modules>\\n'
            '      <module fileurl="file://$PROJECT_DIR$/project.iml" filepath="$PROJECT_DIR$/project.iml" />\\n'
            '    </modules>\\n'
            '  </component>\\n'
            '</project>\\n',
            encoding="utf-8",
        )

    def run_current_code(self, stdin_text: str = "") -> tuple[bool, str]:
        if not self.current_file_path or not self.current_file_path.exists():
            return False, "실행할 코드 파일이 없습니다."
        lang = self.current_language
        file_path = self.current_file_path
        proj_dir = self.current_project_dir
        tools = self.detector.tools
        flags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
        try:
            if lang == "python":
                if not tools["python"]:
                    return False, "[오류] PC에서 Python을 찾지 못했습니다."
                res = subprocess.run([tools["python"], str(file_path)], input=stdin_text, cwd=str(proj_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, creationflags=flags)
                return res.returncode == 0, (res.stdout + ("\\n[STDERR]\\n" + res.stderr if res.stderr else "")).strip() or "(출력 없음)"
            elif lang == "java":
                if not tools["javac"] or not tools["java"]:
                    return False, "[오류] PC에서 JDK(javac/java)를 찾지 못했습니다."
                out_dir = proj_dir / "out"
                out_dir.mkdir(exist_ok=True)
                comp = subprocess.run([tools["javac"], "-encoding", "UTF-8", "-d", str(out_dir), str(file_path)], cwd=str(proj_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, creationflags=flags)
                if comp.returncode != 0:
                    return False, f"[컴파일 실패]\\n{comp.stderr or comp.stdout}"
                run_res = subprocess.run([tools["java"], "-cp", str(out_dir), file_path.stem], input=stdin_text, cwd=str(proj_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, creationflags=flags)
                return run_res.returncode == 0, (run_res.stdout + ("\\n[STDERR]\\n" + run_res.stderr if run_res.stderr else "")).strip() or "(출력 없음)"
            elif lang == "cpp":
                if not tools["cpp"]:
                    return False, "[오류] PC에서 C++ 컴파일러(g++/clang++)를 찾지 못했습니다."
                exe_path = proj_dir / ("app.exe" if platform.system() == "Windows" else "app")
                comp = subprocess.run([tools["cpp"], "-std=c++17", str(file_path), "-o", str(exe_path)], cwd=str(proj_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20, creationflags=flags)
                if comp.returncode != 0:
                    return False, f"[컴파일 실패]\\n{comp.stderr or comp.stdout}"
                run_res = subprocess.run([str(exe_path)], input=stdin_text, cwd=str(proj_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, creationflags=flags)
                return run_res.returncode == 0, (run_res.stdout + ("\\n[STDERR]\\n" + run_res.stderr if run_res.stderr else "")).strip() or "(출력 없음)"
            elif lang == "arduino":
                cli = tools.get("arduino_cli")
                if not cli:
                    return False, (
                        f"아두이노 스케치(.ino)가 저장되었습니다: {file_path}\\n"
                        "직접 컴파일 검증을 하려면 arduino-cli를 설치하거나, 상단 [Arduino IDE로 열기] 버튼으로 Arduino IDE에서 검증/업로드하세요."
                    )
                sketch_dir = file_path.parent
                comp = subprocess.run([cli, "compile", "--fqbn", "arduino:avr:uno", str(sketch_dir)], cwd=str(sketch_dir), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45, creationflags=flags)
                out_text = (comp.stdout + ("\\n" + comp.stderr if comp.stderr else "")).strip()
                if comp.returncode != 0:
                    return False, f"[아두이노 컴파일 실패 (arduino:avr:uno)]\\n{out_text}"
                return True, f"[아두이노 컴파일 성공 (arduino:avr:uno)]\\n{out_text or '스케치 검증을 통과했습니다.'}"
            return False, f"지원하지 않는 언어입니다: {lang}"
        except subprocess.TimeoutExpired:
            return False, "[시간 초과] 실행 시간이 제한을 초과했습니다."
        except Exception as e:
            return False, f"[실행 오류] {e}"

    def open_in_intellij(self) -> tuple[bool, str]:
        idea = self.detector.tools.get("intellij")
        if not idea:
            return False, "PC에서 IntelliJ IDEA를 찾지 못했습니다."
        if not self.current_project_dir or not self.current_file_path:
            return False, "먼저 AI에게 코드를 생성해 주세요."
        if platform.system() == "Darwin" and idea.endswith(".app"):
            subprocess.Popen(["open", "-a", idea, str(self.current_project_dir), str(self.current_file_path)])
        else:
            subprocess.Popen([idea, str(self.current_project_dir), str(self.current_file_path)])
        return True, f"IntelliJ IDEA에서 열었습니다: {self.current_project_dir}"

    def open_in_arduino(self) -> tuple[bool, str]:
        ard = self.detector.tools.get("arduino")
        if not ard:
            return False, "PC에서 Arduino IDE를 찾지 못했습니다. 상단 [Arduino 경로 지정]으로 실행 파일을 선택해 보세요."
        if not self.current_file_path:
            return False, "먼저 아두이노 스케치 코드를 생성해 주세요."
        if platform.system() == "Darwin" and ard.endswith(".app"):
            subprocess.Popen(["open", "-a", ard, str(self.current_file_path)])
        else:
            subprocess.Popen([ard, str(self.current_file_path)])
        return True, f"Arduino IDE에서 스케치를 열었습니다: {self.current_file_path}"


class CodeForgeDesktopApp:
    SYSTEM_INSTRUCTION = (
        "당신은 사용자의 로컬 개발 환경과 연동되는 전문 AI 코딩 어시스턴트입니다. "
        "지원 주력 언어는 python, java, cpp, arduino입니다. "
        "Java 코드는 package 선언을 넣지 말고 public class 이름을 파일명과 일치시키세요. "
        "아두이노 스케치 요청이면 language를 'arduino', filename을 'ServoControl.ino'처럼 .ino 확장자로 작성하세요."
    )

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("CodeForge Desktop (Gemini + Compilers, IntelliJ IDEA & Arduino IDE)")
        self.root.geometry("1120x700")
        self.root.minsize(880, 540)
        self.root.configure(bg="#0B0F17")

        self.detector = EnvironmentDetector()
        self.executor = CodeExecutor(self.detector)
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        self.client = genai.Client(api_key=api_key) if api_key else None
        self.history: list[tuple[str, str]] = []

        self._build_ui()
        self._refresh_status()
        self._load_starter_code()
        self.prompt_input.focus_set()

    def _build_ui(self):
        top = tk.Frame(self.root, bg="#111827", pady=10, padx=14)
        top.pack(side=tk.TOP, fill=tk.X)
        tk.Label(top, text="CodeForge Desktop", fg="#F8FAFC", bg="#111827", font=("Segoe UI", 12, "bold")).pack(side=tk.LEFT)
        self.model_var = tk.StringVar(value="gemini-4-hydrogen")
        ttk.Combobox(top, textvariable=self.model_var, values=["gemini-4-hydrogen", "gemini-3.1-flash-lite"], width=20, state="readonly").pack(side=tk.LEFT, padx=(12, 6))
        tk.Button(top, text="환경 재탐지", command=self._rescan, bg="#2563EB", fg="white", relief=tk.FLAT, padx=10, pady=4).pack(side=tk.LEFT, padx=(6, 4))
        tk.Button(top, text="IntelliJ 경로 지정", command=self._pick_intellij, bg="#334155", fg="white", relief=tk.FLAT, padx=8, pady=4).pack(side=tk.LEFT, padx=(0, 4))
        tk.Button(top, text="Arduino 경로 지정", command=self._pick_arduino, bg="#334155", fg="white", relief=tk.FLAT, padx=8, pady=4).pack(side=tk.LEFT)
        self.status_lbl = tk.Label(top, text="", fg="#94A3B8", bg="#111827", font=("Consolas", 9))
        self.status_lbl.pack(side=tk.RIGHT)

        paned = tk.PanedWindow(self.root, orient=tk.HORIZONTAL, bg="#0B0F17", sashwidth=6)
        paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Left Pane: Pack top header & bottom prompt input FIRST before expand=True chat_box!
        left = tk.Frame(paned, bg="#111827")
        paned.add(left, minsize=340, width=420)

        tk.Label(left, text="AI 프롬프트 채팅", fg="#E2E8F0", bg="#111827", font=("Malgun Gothic", 10, "bold"), anchor=tk.W).pack(side=tk.TOP, fill=tk.X, padx=10, pady=(8, 4))

        inp_outer = tk.Frame(left, bg="#111827", padx=8, pady=8)
        inp_outer.pack(side=tk.BOTTOM, fill=tk.X)
        tk.Label(inp_outer, text="명령어 입력 (Ctrl+Enter 또는 생성 버튼 클릭)", fg="#93C5FD", bg="#111827", font=("Malgun Gothic", 9, "bold"), anchor=tk.W).pack(side=tk.TOP, fill=tk.X, pady=(0, 4))

        inp_frame = tk.Frame(inp_outer, bg="#111827")
        inp_frame.pack(side=tk.TOP, fill=tk.X)
        self.prompt_input = tk.Text(
            inp_frame,
            height=4,
            bg="#1E293B",
            fg="#F8FAFC",
            insertbackground="#60A5FA",
            font=("Malgun Gothic", 10),
            relief=tk.FLAT,
            highlightthickness=1,
            highlightbackground="#3B82F6",
            highlightcolor="#60A5FA",
            padx=8,
            pady=6,
        )
        self.prompt_input.pack(side=tk.LEFT, fill=tk.X, expand=True)
        self.prompt_input.bind("<Control-Return>", lambda e: (self._send(), "break")[1])
        self.send_btn = tk.Button(inp_frame, text="생성\\n(Ctrl+Enter)", command=self._send, bg="#2563EB", fg="white", relief=tk.FLAT, width=12)
        self.send_btn.pack(side=tk.RIGHT, fill=tk.Y, padx=(8, 0))

        self.chat_box = scrolledtext.ScrolledText(left, wrap=tk.WORD, bg="#0F172A", fg="#E2E8F0", font=("Malgun Gothic", 10), state=tk.DISABLED, borderwidth=0, height=10)
        self.chat_box.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 4))

        # Right Pane: Pack top toolbar & bottom console/stdin FIRST before expand=True code_box!
        right = tk.Frame(paned, bg="#111827")
        paned.add(right, minsize=460)

        bar = tk.Frame(right, bg="#111827", padx=8, pady=8)
        bar.pack(side=tk.TOP, fill=tk.X)
        self.lang_var = tk.StringVar(value="python")
        lang_combo = ttk.Combobox(bar, textvariable=self.lang_var, values=["python", "java", "cpp", "arduino"], width=9, state="readonly")
        lang_combo.pack(side=tk.LEFT, padx=(0, 6))
        lang_combo.bind("<<ComboboxSelected>>", lambda e: self._on_lang_change())

        self.filename_var = tk.StringVar(value="main.py")
        tk.Entry(bar, textvariable=self.filename_var, width=16, bg="#1E293B", fg="#F8FAFC", insertbackground="white", font=("Consolas", 10), relief=tk.FLAT, highlightthickness=1, highlightbackground="#334155").pack(side=tk.LEFT, padx=(0, 8))

        tk.Button(bar, text="▶ 컴파일 및 실행", command=self._run, bg="#16A34A", fg="white", relief=tk.FLAT, padx=10, pady=4).pack(side=tk.RIGHT, padx=(6, 0))
        tk.Button(bar, text="Arduino IDE로 열기", command=self._open_arduino, bg="#0F766E", fg="white", relief=tk.FLAT, padx=8, pady=4).pack(side=tk.RIGHT, padx=(6, 0))
        tk.Button(bar, text="IntelliJ IDEA로 열기", command=self._open_idea, bg="#334155", fg="white", relief=tk.FLAT, padx=8, pady=4).pack(side=tk.RIGHT)

        self.console = scrolledtext.ScrolledText(right, wrap=tk.WORD, bg="#080B11", fg="#CBD5E1", font=("Consolas", 10), height=8, state=tk.DISABLED, borderwidth=0)
        self.console.pack(side=tk.BOTTOM, fill=tk.X, padx=8, pady=(0, 8))

        tk.Label(right, text="실행 결과 콘솔", fg="#94A3B8", bg="#111827", font=("Malgun Gothic", 9, "bold"), anchor=tk.W).pack(side=tk.BOTTOM, fill=tk.X, padx=8, pady=(4, 2))

        self.stdin_var = tk.StringVar()
        stdin_row = tk.Frame(right, bg="#111827", padx=8, pady=4)
        stdin_row.pack(side=tk.BOTTOM, fill=tk.X)
        tk.Label(stdin_row, text="표준 입력(stdin):", fg="#94A3B8", bg="#111827", font=("Malgun Gothic", 9)).pack(side=tk.LEFT)
        tk.Entry(stdin_row, textvariable=self.stdin_var, bg="#1E293B", fg="#F8FAFC", insertbackground="white", relief=tk.FLAT, highlightthickness=1, highlightbackground="#334155").pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(8, 0))

        tk.Label(right, text="코드 에디터 (직접 입력/수정 가능)", fg="#CBD5E1", bg="#111827", font=("Malgun Gothic", 9, "bold"), anchor=tk.W).pack(side=tk.TOP, fill=tk.X, padx=8, pady=(0, 4))
        self.code_box = scrolledtext.ScrolledText(
            right,
            wrap=tk.NONE,
            bg="#0B0F17",
            fg="#E2E8F0",
            insertbackground="#60A5FA",
            font=("Consolas", 10),
            height=10,
            borderwidth=0,
            highlightthickness=1,
            highlightbackground="#334155",
            highlightcolor="#3B82F6",
        )
        self.code_box.pack(fill=tk.BOTH, expand=True, padx=8)

    def _load_starter_code(self):
        self._set_editor_code('print("CodeForge Desktop 실행 준비 완료!")\\n')
        if not self.client:
            self._append_chat("안내", "현재 GEMINI_API_KEY 환경 변수가 설정되지 않아 AI 생성 대신 직접 코드 편집·실행만 가능합니다. AI 기능을 쓰려면 실행 전 GEMINI_API_KEY를 설정하세요.")
        else:
            self._append_chat("안내", "아래 입력창에 원하는 기능을 한국어로 입력하고 [생성] 버튼을 누르세요. 우측 에디터에서 코드를 직접 수정·실행할 수도 있습니다.")

    def _on_lang_change(self):
        lang = self.lang_var.get()
        defaults = {"python": "main.py", "java": "Main.java", "cpp": "main.cpp", "arduino": "sketch.ino"}
        self.filename_var.set(defaults.get(lang, "main.py"))

    def _set_editor_code(self, text: str):
        self.code_box.delete("1.0", tk.END)
        self.code_box.insert(tk.END, text)

    def _sync_editor_to_disk(self):
        code_text = self.code_box.get("1.0", tk.END)
        lang = self.lang_var.get().strip() or "python"
        fname = self.filename_var.get().strip() or "main.py"
        if not self.executor.current_file_path or self.executor.current_language != lang or self.executor.current_file_path.name != fname:
            self.executor.save_code(lang, fname, code_text)
        else:
            self.executor.current_file_path.write_text(code_text, encoding="utf-8")

    def _refresh_status(self):
        t = self.detector.tools
        self.status_lbl.config(text=f"Py:{'O' if t['python'] else 'X'}  Java:{'O' if t['javac'] and t['java'] else 'X'}  C++:{'O' if t['cpp'] else 'X'}  IDEA:{'O' if t['intellij'] else 'X'}  Ard:{'O' if t['arduino'] else 'X'}")

    def _rescan(self):
        prev_idea = self.detector.tools.get("intellij")
        prev_ard = self.detector.tools.get("arduino")
        self.detector.tools = self.detector.scan_all()
        if not self.detector.tools.get("intellij") and prev_idea and os.path.exists(prev_idea):
            self.detector.tools["intellij"] = prev_idea
        if not self.detector.tools.get("arduino") and prev_ard and os.path.exists(prev_ard):
            self.detector.tools["arduino"] = prev_ard
        self._refresh_status()
        messagebox.showinfo("탐지 결과", "\\n".join(f"{k}: {v or '미설치'}" for k, v in self.detector.tools.items()))

    def _pick_intellij(self):
        chosen = filedialog.askopenfilename(
            title="IntelliJ IDEA 실행 파일 선택 (idea64.exe 또는 idea.sh)",
            filetypes=[("Executable", "*.exe *.cmd *.bat *.sh *"), ("All files", "*.*")],
        )
        if chosen and os.path.exists(chosen):
            self.detector.tools["intellij"] = chosen
            self._refresh_status()
            self._set_console(f"IntelliJ IDEA 경로가 지정되었습니다: {chosen}")

    def _pick_arduino(self):
        chosen = filedialog.askopenfilename(
            title="Arduino IDE 실행 파일 선택 (Arduino IDE.exe 또는 arduino)",
            filetypes=[("Executable", "*.exe *.app *.sh *"), ("All files", "*.*")],
        )
        if chosen and os.path.exists(chosen):
            self.detector.tools["arduino"] = chosen
            self._refresh_status()
            self._set_console(f"Arduino IDE 경로가 지정되었습니다: {chosen}")

    def _append_chat(self, who: str, text: str):
        self.chat_box.config(state=tk.NORMAL)
        self.chat_box.insert(tk.END, f"[{who}]\\n{text}\\n\\n")
        self.chat_box.see(tk.END)
        self.chat_box.config(state=tk.DISABLED)

    def _set_console(self, text: str):
        self.console.config(state=tk.NORMAL)
        self.console.delete("1.0", tk.END)
        self.console.insert(tk.END, text)
        self.console.config(state=tk.DISABLED)

    def _send(self):
        if not self.client:
            messagebox.showwarning("환경 변수 필요", "실행 전 터미널에서 GEMINI_API_KEY 환경 변수를 설정해 주세요.")
            return
        prompt = self.prompt_input.get("1.0", tk.END).strip()
        if not prompt:
            return
        self.prompt_input.delete("1.0", tk.END)
        self._append_chat("나", prompt)
        self.send_btn.config(state=tk.DISABLED, text="생성 중...")
        threading.Thread(target=self._worker, args=(prompt,), daemon=True).start()

    def _worker(self, prompt: str):
        selected_model = self.model_var.get()
        attempts = [selected_model, selected_model]
        if selected_model != "gemini-3.1-flash-lite":
            attempts.append("gemini-3.1-flash-lite")

        history_text = "\\n".join(f"{who}: {msg}" for who, msg in self.history[-6:])
        full_prompt = f"[이전 대화]\\n{history_text}\\n\\n[사용자 요청]\\n{prompt}" if history_text else prompt

        last_err = None
        for idx, model_name in enumerate(attempts):
            try:
                res = self.client.models.generate_content(
                    model=model_name,
                    contents=full_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=self.SYSTEM_INSTRUCTION,
                        response_mime_type="application/json",
                        response_schema=CodingResponse,
                    ),
                )
                self.history.append(("사용자", prompt))
                self.history.append(("AI", res.parsed.explanation))
                self.root.after(0, self._on_ok, res.parsed)
                return
            except Exception as e:
                last_err = e
                err_str = str(e)
                is_transient = ("503" in err_str) or ("UNAVAILABLE" in err_str) or ("high demand" in err_str) or ("429" in err_str)
                if not is_transient or idx == len(attempts) - 1:
                    break
                time.sleep(1.2 * (idx + 1))

        err_msg = str(last_err)
        if "503" in err_msg or "UNAVAILABLE" in err_msg or "high demand" in err_msg:
            friendly = "현재 Gemini 모델 서버에 요청이 일시적으로 몰려 503 오류가 발생했습니다. 잠시 후 다시 시도하거나 상단 모델을 'gemini-3.1-flash-lite'로 변경해 보세요.\\n\\n상세: " + err_msg
            self.root.after(0, self._on_err, friendly)
        else:
            self.root.after(0, self._on_err, err_msg)

    def _on_ok(self, result: CodingResponse):
        self.send_btn.config(state=tk.NORMAL, text="생성\\n(Ctrl+Enter)")
        self._append_chat("Gemini", result.explanation)
        if result.code.strip() and result.language != "none":
            saved = self.executor.save_code(result.language, result.filename, result.code)
            if result.language in ("python", "java", "cpp", "arduino"):
                self.lang_var.set(result.language)
            self.filename_var.set(saved.name)
            self._set_editor_code(result.code)
            self._set_console(f"저장됨: {saved}")

    def _on_err(self, msg: str):
        self.send_btn.config(state=tk.NORMAL, text="생성\\n(Ctrl+Enter)")
        self._append_chat("오류", msg)

    def _run(self):
        self._sync_editor_to_disk()
        self._set_console("컴파일 및 실행 중...")
        stdin_text = self.stdin_var.get()
        threading.Thread(target=lambda: self.root.after(0, self._set_console, self.executor.run_current_code(stdin_text)[1]), daemon=True).start()

    def _open_idea(self):
        self._sync_editor_to_disk()
        ok, msg = self.executor.open_in_intellij()
        if not ok:
            messagebox.showwarning("IntelliJ IDEA", msg)
        else:
            self._set_console(msg)

    def _open_arduino(self):
        self._sync_editor_to_disk()
        ok, msg = self.executor.open_in_arduino()
        if not ok:
            messagebox.showwarning("Arduino IDE", msg)
        else:
            self._set_console(msg)


if __name__ == "__main__":
    if platform.system() == "Windows":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    root = tk.Tk()
    app = CodeForgeDesktopApp(root)
    root.mainloop()
`;

const WINDOWS_BAT = `@echo off
echo Installing dependencies...
pip install --upgrade google-genai pydantic pyinstaller
echo Building standalone Windows executable...
pyinstaller --onefile --windowed --name "CodeForgeDesktop" GeminiLocalCoder.py
echo Done! Check dist\\CodeForgeDesktop.exe
pause
`;

const MAC_SH = `#!/usr/bin/env bash
set -e
pip3 install --upgrade google-genai pydantic pyinstaller
pyinstaller --onefile --windowed --name "CodeForgeDesktop" GeminiLocalCoder.py
echo "Build complete! Check dist/CodeForgeDesktop.app"
`;

const README_KO = `# CodeForge Desktop 단독 실행 파일(.exe / .app) 빌드 가이드

1. 빌드용 PC(개발 환경)에 Python 3.10 이상을 한 번만 설치합니다.
2. 환경 변수 GEMINI_API_KEY를 설정한 뒤 테스트합니다:
   - Windows (PowerShell): $env:GEMINI_API_KEY="YOUR_KEY"; python GeminiLocalCoder.py
   - macOS / Linux: export GEMINI_API_KEY="YOUR_KEY" && python3 GeminiLocalCoder.py
3. 단일 실행 파일(.exe / .app)로 패키징합니다:
   - Windows: build_windows.bat 실행 -> dist\\CodeForgeDesktop.exe 생성
   - macOS: chmod +x build_mac.sh && ./build_mac.sh -> dist/CodeForgeDesktop.app 생성
4. 완성된 파일은 파이썬이 없는 다른 컴퓨터에서도 단독으로 실행되며, 실행 후 내 PC의 Java/Python/C++/IntelliJ IDEA/Arduino IDE를 자동 감지합니다.
`;

export function buildDesktopBundleZip(): Buffer {
  return buildZipBuffer([
    { name: 'CodeForgeDesktop/GeminiLocalCoder.py', content: PYTHON_DESKTOP_APP },
    { name: 'CodeForgeDesktop/build_windows.bat', content: WINDOWS_BAT },
    { name: 'CodeForgeDesktop/build_mac.sh', content: MAC_SH },
    { name: 'CodeForgeDesktop/README_KO.txt', content: README_KO },
  ]);
}
