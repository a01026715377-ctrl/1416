# CodeForge 웹 워크벤치 로컬 실행 가이드

1. Node.js 20 이상을 설치합니다.
2. 압축을 푼 폴더에서 패키지를 설치합니다:
   npm install

3. GEMINI_API_KEY 환경 변수를 설정하고 실행합니다:
   - Windows (PowerShell):
     $env:GEMINI_API_KEY="YOUR_KEY"; npm run dev
   - Windows (CMD):
     set GEMINI_API_KEY=YOUR_KEY && npm run dev
   - macOS / Linux:
     GEMINI_API_KEY="YOUR_KEY" npm run dev

4. 브라우저에서 http://localhost:3000 으로 접속하면 내 PC의 Python, Java, C++, IntelliJ IDEA, Arduino IDE를 자동으로 탐지해 실행합니다.
