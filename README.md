# God's Eye Dashboard v2

BTC/USD, VIX, DXY, US10Y, Nasdaq 100, S&P 500과 Fear & Greed Index를 한 화면에서 보는 대시보드입니다.
레이아웃 편집(드래그드롭/폭 변경), Firebase 전역 저장, AI 추천/분석 기능을 포함합니다.

## Tech

- Vanilla HTML/CSS/JS
- Tailwind CSS (CDN)
- TradingView Embed Widgets
- Firebase Functions + Firestore
- Gemini API + NewsAPI + FRED
- Alternative.me Fear & Greed API
- Firebase Hosting

## Local Preview

정적 파일만 사용하므로 `public/index.html`을 브라우저에서 바로 열어도 동작합니다.  
로컬 서버가 필요하면 아래처럼 실행할 수 있습니다.

```bash
npx serve public
```

## Firebase Deploy (Windows PowerShell 정책 대응)

PowerShell 정책 때문에 `firebase`와 `npm` 실행이 막히는 환경에서는 `cmd /c`를 사용합니다.

```bash
cmd /c firebase login
cmd /c firebase projects:create godseye-dashboard -n GodsEyeDashboard
cmd /c firebase functions:secrets:set GEMINI_API_KEY
cmd /c firebase functions:secrets:set NEWSAPI_KEY
cmd /c firebase functions:secrets:set FRED_API_KEY
cmd /c firebase functions:secrets:set LAYOUT_ADMIN_PIN
cmd /c firebase deploy --only functions,hosting --project <projectId>
```

## Files

- `public/index.html`: 레이아웃/위젯 컨테이너
- `public/styles.css`: 다크 테마 + 반응형 레이아웃
- `public/app.js`: 레이아웃 편집/드래그드롭/저장 + AI 연동 + TradingView/F&G 렌더
- `firebase.json`: Hosting 대상 디렉터리 설정
- `functions/index.js`: 레이아웃 API + AI 추천/분석 API
- `.firebaserc`: 기본 Firebase 프로젝트 매핑
